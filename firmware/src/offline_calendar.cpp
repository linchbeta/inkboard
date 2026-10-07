#include "offline_calendar.h"
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_sntp.h>
#include <math.h>
#include <sys/stat.h>
#include <sys/time.h>
#include "calendar_render.h"
#include "cert_bundle.h"
#include "holiday_table.h"
#include "display.h"
#include "epd_driver.h"
#include "network.h"

static const char *NVS_NS = "offcal";
static const char *TZ_CHINA = "CST-8";
static const time_t MIN_VALID = 1735689600;   // 2025-01-01: anything earlier means the clock restarted
static const time_t FLOOR_TIME = 1790784000;  // 2026-10-01 00:00 China time: the earliest date to assume

// ── RTC memory: survives deep sleep, not power loss ────────────
RTC_DATA_ATTR static bool s_synced = false;          // set from a trusted source since power-on
RTC_DATA_ATTR static double s_sleepStart = 0;        // device time when deep sleep began
RTC_DATA_ATTR static double s_sleptSinceSync = 0;    // device seconds slept since the last sync
RTC_DATA_ATTR static float s_drift = 0;              // sleep clock rate error (+ = runs fast)
RTC_DATA_ATTR static float s_driftSaved = 0;         // the value in NVS
RTC_DATA_ATTR static bool s_driftLoaded = false;
RTC_DATA_ATTR static int64_t s_savedClock = 0;       // last time written to NVS
RTC_DATA_ATTR static int32_t s_holidaysCheckedYmd = 0;
RTC_DATA_ATTR static uint8_t s_offlineCount = 0;     // wakes in a row without the server
static bool s_syncedThisBoot = false;
static time_t s_nextWake = 0;  // from the server this boot (X-Next-Wake), 0 = none


// LittleFS.exists() / open() log an error for a missing file in this core; stat() does not.
static bool fileExists(const char *path) {
    char full[48];
    snprintf(full, sizeof full, "/littlefs%s", path);
    struct stat st;
    return stat(full, &st) == 0;
}

static double nowSec() {
    struct timeval tv;
    gettimeofday(&tv, nullptr);
    return tv.tv_sec + tv.tv_usec / 1e6;
}

static void setTime(double t) {
    struct timeval tv;
    tv.tv_sec = (time_t)t;
    tv.tv_usec = (suseconds_t)((t - floor(t)) * 1e6);
    settimeofday(&tv, nullptr);
}

static int32_t todayYmd() {
    time_t now = time(nullptr);
    struct tm lt;
    localtime_r(&now, &lt);
    return (lt.tm_year + 1900) * 10000 + (lt.tm_mon + 1) * 100 + lt.tm_mday;
}

// This firmware's build time (China time) as UTC seconds.
static time_t buildTime() {
    static const char *M = "JanFebMarAprMayJunJulAugSepOctNovDec";
    char mon[4] = {0};
    int d = 1, y = 2026, hh = 0, mm = 0, ss = 0;
    sscanf(__DATE__, "%3s %d %d", mon, &d, &y);
    sscanf(__TIME__, "%d:%d:%d", &hh, &mm, &ss);
    const char *p = strstr(M, mon);
    struct tm t = {};
    t.tm_year = y - 1900;
    t.tm_mon = p ? (int)(p - M) / 3 : 0;
    t.tm_mday = d;
    t.tm_hour = hh;
    t.tm_min = mm;
    t.tm_sec = ss;
    return mktime(&t);  // TZ is already China time
}

// Kept in NVS so that after a reset or power loss (which stop the clock) the date is
// still right: written when the local date changed since the last write (about daily).
static void saveClock(bool force) {
    time_t now = time(nullptr), saved = (time_t)s_savedClock;
    struct tm a, b;
    localtime_r(&now, &a);
    localtime_r(&saved, &b);
    bool sameDay = a.tm_year == b.tm_year && a.tm_yday == b.tm_yday;
    if (!force && sameDay && llabs((long long)now - s_savedClock) < 20 * 3600) return;
    Preferences p;
    p.begin(NVS_NS, false);
    p.putLong64("clk", now);
    p.end();
    s_savedClock = now;
}

void clockInit() {
    setenv("TZ", TZ_CHINA, 1);
    tzset();
    if (!s_driftLoaded) {
        Preferences p;
        p.begin(NVS_NS, false);  // (read-write: creates the namespace on first use, no write)
        s_drift = s_driftSaved = p.isKey("drift") ? p.getFloat("drift", 0) : 0;
        s_savedClock = p.isKey("clk") ? p.getLong64("clk", 0) : 0;
        p.end();
        s_driftLoaded = true;
    }
    double now = nowSec();
    if (now < MIN_VALID) {
        // Power-on: the clock starts at 1970. Use the last saved time (or the build time,
        // or 2026-10-01) until a sync: close enough for a calendar after a battery swap.
        time_t t = FLOOR_TIME;
        if (buildTime() > t) t = buildTime();
        if (s_savedClock > t) t = (time_t)s_savedClock;
        setTime(t);
        s_synced = false;
        s_sleptSinceSync = 0;
        Serial.printf("[CLOCK] restarted, assuming %ld (not synced)\n", (long)t);
    } else if (s_sleepStart > 0 && esp_reset_reason() == ESP_RST_DEEPSLEEP) {
        // The sleep clock ran (1 + drift) times too fast: take the excess back.
        double slept = now - s_sleepStart;
        if (slept > 0) {
            setTime(now - slept * s_drift / (1 + s_drift));
            s_sleptSinceSync += slept;
        }
    }
    s_sleepStart = 0;
}

// Learns the sleep clock's rate error from how far it was off at a sync. Every sync after
// at least half an hour asleep counts, weighted by how long it slept (a 1 s reading error
// over 30 min is 0.06 %, the drift is typically 1-5 %), so a device on the normal schedule
// already knows its drift when it goes offline.
static void clockLearn(double device, double actual) {
    if (s_synced && s_sleptSinceSync >= 1800) {
        double e = (device - actual) / s_sleptSinceSync;
        if (fabs(e) < 0.2) {
            float before = s_drift;
            double w = s_sleptSinceSync / (6 * 3600.0);
            if (w > 1) w = 1;
            s_drift = (float)((1 + s_drift) * (1 + e * w) - 1);
            if (s_drift > 0.2f) s_drift = 0.2f;
            if (s_drift < -0.2f) s_drift = -0.2f;
            Serial.printf("[CLOCK] off by %.0fs after %.1fh asleep; drift %.0f -> %.0f ppm\n",
                          device - actual, s_sleptSinceSync / 3600, before * 1e6, s_drift * 1e6);
            if (fabs(s_drift - s_driftSaved) > 1e-3f) {  // kept for power loss; rarely written
                Preferences p;
                p.begin(NVS_NS, false);
                p.putFloat("drift", s_drift);
                p.end();
                s_driftSaved = s_drift;
            }
        }
    }
    s_sleptSinceSync = 0;
    s_synced = true;
    s_syncedThisBoot = true;
}

void clockSync(time_t utc, const char *source) {
    if (utc < MIN_VALID) return;
    double device = nowSec();
    clockLearn(device, (double)utc);
    setTime((double)utc);
    saveClock(false);
    Serial.printf("[CLOCK] synced from %s (was off by %.0fs)\n", source, device - utc);
}

bool clockSyncFromHttpDate(const String &date) {
    static const char *M = "JanFebMarAprMayJunJulAugSepOctNovDec";
    char mon[4] = {0};
    int d, y, hh, mm, ss;
    if (sscanf(date.c_str(), "%*3s, %d %3s %d %d:%d:%d", &d, mon, &y, &hh, &mm, &ss) != 6) return false;
    const char *p = strstr(M, mon);
    if (!p) return false;
    int m = (int)(p - M) / 3 + 1;
    // days since 1970-01-01 (proleptic Gregorian), then UTC seconds
    int yy = y - (m <= 2);
    long era = yy / 400, yoe = yy - era * 400;
    long doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    long days = era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
    clockSync((time_t)(days * 86400L + hh * 3600L + mm * 60L + ss), "server");
    return true;
}

bool clockSyncNtp(unsigned long timeoutMs) {
    if (WiFi.status() != WL_CONNECTED) return false;
    double before = nowSec();
    unsigned long t0 = millis();
    sntp_set_sync_mode(SNTP_SYNC_MODE_IMMED);
    configTzTime(TZ_CHINA, "ntp.aliyun.com", "ntp.tencent.com", "cn.pool.ntp.org");
    // (the status reads COMPLETED once, then resets)
    bool ok = false;
    while (!(ok = sntp_get_sync_status() == SNTP_SYNC_STATUS_COMPLETED) && millis() - t0 < timeoutMs) delay(50);
    sntp_stop();
    setenv("TZ", TZ_CHINA, 1);
    tzset();
    if (!ok) {
        Serial.println("[CLOCK] NTP failed");
        return false;
    }
    double device = before + (millis() - t0) / 1000.0;
    clockLearn(device, nowSec());  // SNTP has already set the time
    saveClock(false);
    Serial.printf("[CLOCK] synced from NTP (was off by %.0fs)\n", device - nowSec());
    return true;
}

bool clockSyncedThisBoot() { return s_syncedThisBoot; }
bool clockSyncedSincePowerOn() { return s_synced; }

uint32_t secondsUntilNextDay() {
    time_t now = time(nullptr);
    struct tm lt;
    localtime_r(&now, &lt);
    uint32_t left = 86400 - (lt.tm_hour * 3600 + lt.tm_min * 60 + lt.tm_sec);
    // a little after midnight: the clock may still be a few minutes off
    return left + 60 + (uint32_t)(left * 0.003);
}

void setNextWake(time_t unix) { s_nextWake = unix; }

uint32_t alignedSleepSeconds(int minutes) {
    const uint32_t LAG = 30;  // after the boundary: the clock and the timer are a few s off
    uint32_t plain = (uint32_t)minutes * 60U;
    time_t now = time(nullptr);
    // The server's schedule (day / night steps, day start) wins. Its X-Refresh-Minutes is a
    // countdown for InkSight firmware, not an interval, so it must not be aligned again.
    if (s_synced && s_nextWake > 0) {
        int64_t wait = (int64_t)s_nextWake - now + LAG;
        if (wait <= 2 * 86400) {
            // past the boundary already (a slow refresh): wake shortly for the next frame
            if (wait < (int64_t)LAG) wait = LAG;
            Serial.printf("[SLEEP] until the server's next wake (+%us)\n", (unsigned)LAG);
            return (uint32_t)wait;
        }
    }
    if (!s_synced || minutes <= 0) return plain;
    struct tm lt;
    localtime_r(&now, &lt);
    uint32_t sod = lt.tm_hour * 3600 + lt.tm_min * 60 + lt.tm_sec;
    uint32_t step = plain;
    uint32_t next = (sod >= LAG ? (sod - LAG) / step + 1 : 0) * step + LAG;  // next boundary + LAG after now
    uint32_t wait = next - sod;
    if (wait < step / 4) wait += step;  // just refreshed at (or right before) this boundary
    return wait;
}

uint64_t clockSleepMicros(uint32_t seconds) {
    s_sleepStart = nowSec();
    return (uint64_t)((double)seconds * (1 + s_drift) * 1e6);
}

// ── calendar-only mode ──────────────────────────────────────

bool calendarOnly() {
    Preferences p;
    p.begin(NVS_NS, false);  // (read-write: creates the namespace on first use, no write)
    bool on = p.getBool("calonly", false);
    p.end();
    return on;
}

void setCalendarOnly(bool on) {
    if (calendarOnly() == on) return;
    Preferences p;
    p.begin(NVS_NS, false);
    p.putBool("calonly", on);
    p.end();
    Serial.printf("[CAL] calendar-only mode %s\n", on ? "on" : "off");
}

// ── orientation ─────────────────────────────────────────────

RTC_DATA_ATTR static int8_t s_rot = -1;  // -1: not read from NVS yet

int screenRotation() {
    if (s_rot < 0) {
        Preferences p;
        p.begin(NVS_NS, false);  // (read-write: creates the namespace on first use, no write)
        s_rot = (int8_t)p.getUChar("rot", 0);
        p.end();
        if (s_rot > 3) s_rot = 0;
    }
    return s_rot;
}

void setScreenRotation(int rot) {
    if (rot < 0 || rot > 3 || rot == screenRotation()) return;
    Preferences p;
    p.begin(NVS_NS, false);
    p.putUChar("rot", (uint8_t)rot);
    p.end();
    s_rot = (int8_t)rot;
    Serial.printf("[CAL] orientation %d\n", rot);
}

// ── 2bpp frame in RAM ───────────────────────────────────────

#if !(EPD_BPP >= 2 && !defined(EPD_COLOR_PAGED))
static uint8_t *s_frameRam = nullptr;
#endif

uint8_t *frameRam2bpp() {
#if EPD_BPP >= 2 && !defined(EPD_COLOR_PAGED)
    return ensureColorBuf() ? colorBuf : nullptr;
#else
    if (!s_frameRam) {
        s_frameRam = (uint8_t *)malloc(COLOR_BUF_LEN);
        Serial.printf("[MEM] frame buffer %d bytes: %s (free heap %u)\n", COLOR_BUF_LEN, s_frameRam ? "ok" : "FAILED",
                      (unsigned)ESP.getFreeHeap());
    }
    return s_frameRam;
#endif
}

void frameRamRelease() {
#if !(EPD_BPP >= 2 && !defined(EPD_COLOR_PAGED))
    free(s_frameRam);
    s_frameRam = nullptr;
#endif
}

// ── holidays ────────────────────────────────────────────────
// Bundled years in calendar_data.h; later ones downloaded once from the server and kept
// in NVS ("hy<year>"); parsing and lookup in holiday_table.h (shared with the host test).

static HolidayYear s_years[3];  // cache: also remembers years that were not downloaded
static int s_yearsNext = 0;

// The year's downloaded schedule, or nullptr.
static const HolidayYear *downloadedYear(int year) {
    for (auto &y : s_years)
        if (y.year == year) return y.count >= 0 ? &y : nullptr;
    HolidayYear &y = s_years[s_yearsNext];
    s_yearsNext = (s_yearsNext + 1) % 3;
    y.year = year;
    y.count = -1;
    Preferences p;
    p.begin(NVS_NS, false);  // (read-write: creates the namespace on first use, no write)
    char key[10];
    snprintf(key, sizeof key, "hy%d", year);
    size_t n = p.isKey(key) ? p.getBytesLength(key) : 0;
    if (n <= sizeof y.days && n % 2 == 0 && p.isKey(key)) y.count = (int)(p.getBytes(key, y.days, n) / 2);
    p.end();
    return y.count >= 0 ? &y : nullptr;
}

static int holidayLookup(int year, int month, int day) {
    return holidayCombined(year, month, day, downloadedYear, calBundledHoliday);
}

void holidaysInit() {
    calSetHolidayFn(holidayLookup);
#if LOCAL_CALENDAR
    // frames cached by earlier firmware (offline replay is now the calendar / message board)
    if (fileExists("/cache.bmp")) LittleFS.remove("/cache.bmp");
    if (fileExists("/cache_color.bin")) LittleFS.remove("/cache_color.bin");
#endif
}

static bool holidaysKnown(int year) { return calBundledHoliday(year, 1, 1) >= 0 || downloadedYear(year) != nullptr; }

// GET <server>/api/holidays/<year>: lines "YYYYMMDD 1" (day off) / "YYYYMMDD 2" (work day)
// for the year and the December before; 404 until published. ~300 bytes.
static void fetchHolidays(const String &server, int year) {
    HTTPClient http;
    WiFiClient plain;
    WiFiClientSecure secure;  // a public server behind HTTPS
    bool tls = server.startsWith("https://");
    if (tls) setTrustedRoots(secure);
    if (!http.begin(tls ? (WiFiClient &)secure : plain, server + "/api/holidays/" + String(year))) return;
    http.setTimeout(8000);
    int code = http.GET();
    int size = http.getSize();
    if (code != 200 || size > 4096) {  // (a wrong address answering with a big page: not read)
        Serial.printf("[HOLIDAY] %d: HTTP %d, %d bytes\n", year, code, size);
        http.end();
        return;
    }
    String body = http.getString();
    http.end();
    if (body.length() > 4096) return;
    uint16_t days[HOLIDAY_MAX_DAYS];
    int n = holidayParse(body.c_str(), year, days, HOLIDAY_MAX_DAYS);
    Preferences p;
    p.begin(NVS_NS, false);
    char key[10];
    snprintf(key, sizeof key, "hy%d", year);
    p.putBytes(key, days, n * 2);
    p.end();
    for (auto &y : s_years)
        if (y.year == year) y.year = 0;  // reload from NVS on next use
    Serial.printf("[HOLIDAY] %d: %d days saved\n", year, n);
}

void holidaysUpdate(const String &server) {
    int32_t ymd = todayYmd();
    if (!clockSyncedThisBoot() || s_holidaysCheckedYmd == ymd || server.length() == 0) return;
    s_holidaysCheckedYmd = ymd;
    int year = ymd / 10000, month = ymd / 100 % 100;
    if (!holidaysKnown(year)) fetchHolidays(server, year);
    // next year's schedule is published in the autumn (usually Nov / Dec)
    if (month >= 10 && !holidaysKnown(year + 1)) fetchHolidays(server, year + 1);
}

// ── local calendar ──────────────────────────────────────────

#if LOCAL_CALENDAR
// Draws the calendar of ymd and refreshes the panel; false if memory is short.
static bool drawCalendar(int32_t ymd, float batteryV) {
    const int y = ymd / 10000, m = ymd / 100 % 100, d = ymd % 100;
#if EPD_STREAMS_FRAMES
    // in bands of rows straight into the panel: the calendar is drawn once per band
    const int BAND = 24, rowBytes = W / 4;
    uint8_t *band = (uint8_t *)malloc(rowBytes * BAND);
    if (!band) return false;
    if (!epdStreamBegin()) { free(band); return false; }
    unsigned long t0 = millis();
    for (int y0 = 0; y0 < H; y0 += BAND) {
        const int rows = H - y0 < BAND ? H - y0 : BAND;
        CalTarget t = {W, H, LOCAL_CALENDAR_CODES, band, y0, rows, 2, screenRotation()};
        calendarRender(t, y, m, d, batteryV);
        for (int r = 0; r < rows; r++) epdStreamWriteRow(y0 + r, band + r * rowBytes);
    }
    free(band);
    Serial.printf("[CAL] drawn in %d-row bands, %lu ms\n", BAND, millis() - t0);
    epdStreamEnd();
#elif LOCAL_CALENDAR_BPP == 1
    CalTarget t = {W, H, LOCAL_CALENDAR_CODES, imgBuf, 0, 0, 1, screenRotation()};
    calendarRender(t, y, m, d, batteryV);
    epdDisplay(imgBuf);
#else
    uint8_t *buf = frameRam2bpp();
    if (!buf) return false;
    CalTarget t = {W, H, LOCAL_CALENDAR_CODES, buf, 0, 0, 2, screenRotation()};
    calendarRender(t, y, m, d, batteryV);
    epdDisplay2bpp(buf);
#endif
    return true;
}
#endif

bool showLocalCalendar(bool force) {
#if LOCAL_CALENDAR
    int32_t ymd = todayYmd();
    if (!force && displayShowsLocalCalendar(ymd)) {
        Serial.println("[CAL] panel already shows today's calendar");
        return true;
    }
    float v = readBatteryVoltage();
    Serial.printf("[CAL] local calendar %ld%s\n", (long)ymd, clockSyncedSincePowerOn() ? "" : " (clock not synced)");
    if (!drawCalendar(ymd, v > 2.5f && v < 5.0f ? v : 0)) {
        Serial.printf("[CAL] not enough memory (free heap %u)\n", (unsigned)ESP.getFreeHeap());
        return false;
    }
    displayMarkShowsCachedFrame(false);
    displayMarkLocalCalendar(ymd);
    saveClock(false);  // so a battery swap resumes close to today
    return true;
#else
    (void)force;
    return false;
#endif
}

// ── offline: message cache and rotation ─────────────────────

#if LOCAL_CALENDAR
static const char *MSG_FILE = "/msg.raw";
static const char *MSG_TMP = "/msg.tmp";
static const char *MSG_ETAG_FILE = "/msg.etag";

static String cachedMessageEtag() {
    if (!fileExists(MSG_FILE) || !fileExists(MSG_ETAG_FILE)) return "";
    File f = LittleFS.open(MSG_ETAG_FILE, "r");
    if (!f) return "";
    String e = f.readString();
    f.close();
    return e;
}
#endif

bool messageFrameIsNew(const String &modeId, const String &etag) {
#if LOCAL_CALENDAR
    if (!modeId.equalsIgnoreCase("MESSAGES")) return false;
    return etag.length() == 0 || etag != cachedMessageEtag();  // (no ETag: an older server)
#else
    (void)modeId; (void)etag;
    return false;
#endif
}

File messageCacheOpen() {
#if LOCAL_CALENDAR
    return LittleFS.open(MSG_TMP, "w");
#else
    return File();
#endif
}

void messageCacheCommit(File &f, bool ok, const String &etag) {
#if LOCAL_CALENDAR
    if (!f) return;
    f.close();
    if (!ok) {
        LittleFS.remove(MSG_TMP);
        return;
    }
    if (fileExists(MSG_FILE)) LittleFS.remove(MSG_FILE);
    LittleFS.rename(MSG_TMP, MSG_FILE);
    File e = LittleFS.open(MSG_ETAG_FILE, "w");
    if (e) { e.print(etag); e.close(); }
    if (fileExists("/msg.sum")) LittleFS.remove("/msg.sum");  // (earlier firmware's)
    Serial.println("[CACHE] message board saved for offline use");
#else
    (void)f; (void)ok; (void)etag;
#endif
}

// (a streamed frame is cached while streaming, network.cpp)
void frameFetched(const String &modeId) {
#if LOCAL_CALENDAR && LOCAL_CALENDAR_BPP == 2 && !defined(EPD_COLOR_PAGED)
    if (g_colorStreamed || !useColorBuf || !colorBuf || !messageFrameIsNew(modeId, g_lastEtag)) return;
    File f = messageCacheOpen();
    bool ok = f && f.write(colorBuf, COLOR_BUF_LEN) == (size_t)COLOR_BUF_LEN;
    messageCacheCommit(f, ok, g_lastEtag);
#elif LOCAL_CALENDAR && LOCAL_CALENDAR_BPP == 1  // B/W: the BMP's pixels in imgBuf
    if (!messageFrameIsNew(modeId, g_lastEtag)) return;
    File f = messageCacheOpen();
    bool ok = f && f.write(imgBuf, IMG_BUF_LEN) == (size_t)IMG_BUF_LEN;
    messageCacheCommit(f, ok, g_lastEtag);
#else
    (void)modeId;
#endif
}

#if LOCAL_CALENDAR
static bool showCachedMessage() {
    if (!fileExists(MSG_FILE)) return false;
#if EPD_STREAMS_FRAMES
    // row by row from the file into the panel
    File f = LittleFS.open(MSG_FILE, "r");
    if (!f || f.size() != (size_t)COLOR_BUF_LEN || !epdStreamBegin()) { if (f) f.close(); return false; }
    uint8_t row[W / 4];
    for (int r = 0; r < H; r++) {
        if (f.read(row, sizeof row) != sizeof row) memset(row, 0x55, sizeof row);  // (white on every panel)
        epdStreamWriteRow(r, row);
    }
    f.close();
    epdStreamEnd();
#elif LOCAL_CALENDAR_BPP == 1
    File f = LittleFS.open(MSG_FILE, "r");
    if (!f) return false;
    size_t n = f.read(imgBuf, IMG_BUF_LEN);
    f.close();
    if ((int)n != IMG_BUF_LEN) return false;
    epdDisplay(imgBuf);
#else
    uint8_t *buf = frameRam2bpp();
    File f = LittleFS.open(MSG_FILE, "r");
    if (!buf || !f) return false;
    size_t n = f.read(buf, COLOR_BUF_LEN);
    f.close();
    if ((int)n != COLOR_BUF_LEN) return false;
    epdDisplay2bpp(buf);
#endif
    displayMarkShowsCachedFrame(false);  // (also forgets that the calendar is on the panel)
    Serial.println("[OFFLINE] cached message board shown");
    return true;
}
#endif

bool offlineShow() {
#if LOCAL_CALENDAR
    bool messageTurn = fileExists(MSG_FILE) && (s_offlineCount & 1);
    if (s_offlineCount < 250) s_offlineCount++;
    if (messageTurn && showCachedMessage()) return true;
    return showLocalCalendar(false);
#else
    return false;
#endif
}

uint32_t offlineSleepSeconds(int normalMinutes) {
    static const int BACKOFF[] = {15, 30, 60, 120, 180};
    int k = s_offlineCount > 0 ? s_offlineCount - 1 : 0;
    int minutes = BACKOFF[k < 4 ? k : 4];
    if (minutes < normalMinutes) minutes = normalMinutes;
    uint32_t sec = (uint32_t)minutes * 60;
    uint32_t midnight = secondsUntilNextDay();
    return sec < midnight ? sec : midnight;
}

void offlineReset() { s_offlineCount = 0; }
