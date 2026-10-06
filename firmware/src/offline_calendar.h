// Offline calendar: the device keeps working without the server.
//
//  - Clock: China time; kept through deep sleep; restored (approximately) after power
//    loss; set from the server (HTTP Date header), NTP as a backup, or the phone in the
//    setup page. The chip's sleep clock drifts (no 32 kHz crystal on these boards), so the
//    drift is measured between syncs and corrected.
//  - Local calendar: the server's month calendar rendered on the device
//    (calendar_render.cpp), shown when the server cannot be reached, and in
//    "calendar only" mode (no WiFi needed; wakes once a day after midnight).
//  - Holidays: bundled years plus later years fetched once from the server.
//  - Message cache: the last message board frame is the only content kept in flash;
//    offline, the screen alternates between it and the calendar.
#pragma once
#include <Arduino.h>
#include <time.h>
#include <FS.h>
#include "config.h"

// Every panel has the local calendar except the 2.9" (296x128: the server's layouts do
// not fit it). Ink codes as the server's panel for it (server/src/panels.ts):
//  - 4 colours (3.98", 4.2" B/W/Y/R): 2bpp, {0, 1, 2, 3}
//  - 3 colours (4.2" HINK / WFT, 5.83" / 7.5" UC8179): 2bpp, yellow shown red, {0, 1, 3, 3}
//  - B/W: 1 bit per pixel in imgBuf (as a downloaded BMP), red and yellow black
// How it reaches the panel (offline_calendar.cpp showLocalCalendar):
//  - panels that take frames row by row (EPD_STREAMS_FRAMES): drawn in bands of rows,
//    each band written to the panel -- no frame buffer;
//  - other colour panels: drawn in the 2bpp colour buffer (30 KB, WiFi off);
//  - B/W panels: drawn in imgBuf, which they always have.
#if defined(EPD_PANEL_29)
#define LOCAL_CALENDAR 0
#else
#define LOCAL_CALENDAR 1
#if EPD_COLOR_CAPABILITY >= 4
#define LOCAL_CALENDAR_BPP 2
#define LOCAL_CALENDAR_CODES {0, 1, 2, 3}
#elif EPD_COLOR_CAPABILITY == 3
#define LOCAL_CALENDAR_BPP 2
#define LOCAL_CALENDAR_CODES {0, 1, 3, 3}
#else
#define LOCAL_CALENDAR_BPP 1
#define LOCAL_CALENDAR_CODES {0, 1, 0, 0}
#endif
#endif

// ── clock ───────────────────────────────────────────────────

// At boot: time zone, restore after power loss, drift correction after deep sleep.
void clockInit();
// A trusted time (UTC seconds) from `source` ("server", "ntp", "phone").
void clockSync(time_t utc, const char *source);
// HTTP Date header ("Sun, 04 Oct 2026 09:00:00 GMT"); false if unparsable.
bool clockSyncFromHttpDate(const String &date);
// NTP (aliyun / tencent / pool), waiting up to timeoutMs; needs WiFi.
bool clockSyncNtp(unsigned long timeoutMs);
// Synced from a trusted source since this wake / ever since power-on.
bool clockSyncedThisBoot();
bool clockSyncedSincePowerOn();
// Seconds from now until a little after the next local midnight.
uint32_t secondsUntilNextDay();
// Seconds to sleep for a refresh every `minutes`, ending on the clock: at the next multiple
// of the interval counted from midnight (15 -> :00 :15 :30 :45, 120 -> even hours), plus a
// little so the wake is never early. A wake due very soon moves to the following one.
// Without a synced clock: plain minutes * 60.
// If the server named the next wake this boot (setNextWake), it sleeps until then instead.
uint32_t alignedSleepSeconds(int minutes);
// The server's next wake (X-Next-Wake, Unix s), for this boot's sleep.
void setNextWake(time_t unix);
// Before deep sleep: the device-timer duration for `seconds` real seconds (drift
// compensated), and remembers the sleep start for the correction at wake.
uint64_t clockSleepMicros(uint32_t seconds);

// ── calendar-only mode (no WiFi; set from the setup page or when setup is skipped) ──
bool calendarOnly();
void setCalendarOnly(bool on);

// ── local calendar ──────────────────────────────────────────
// Today's calendar on the panel. Unless `force`, does nothing if it already shows it.
// False if this panel has no local calendar or memory is short.
bool showLocalCalendar(bool force);

// ── 2bpp frame in RAM: the colour buffer of colour panels that do not stream (allocated
// when first needed); elsewhere a temporary allocation ──
// A COLOR_BUF_LEN buffer, or nullptr.
uint8_t *frameRam2bpp();
void frameRamRelease();

// ── holidays ────────────────────────────────────────────────
void holidaysInit();
// When online: fetches this year's / next year's schedule if missing (at most daily).
void holidaysUpdate(const String &server);

// ── offline: message cache and rotation ─────────────────────
// The message board is the only server frame kept in flash (for offline use), and only
// when it changed: the frame being fetched is the message board with a new ETag.
bool messageFrameIsNew(const String &modeId, const String &etag);
// Writing a new message frame into the cache (streamed); commit keeps the old one on failure.
File messageCacheOpen();
void messageCacheCommit(File &f, bool ok, const String &etag);
// After a fetch into RAM (panels that do not stream): caches it if it is a new message board.
void frameFetched(const String &modeId);
// Offline: shows the calendar or the cached message (alternating); false if nothing shown.
bool offlineShow();
// Seconds until the next attempt to reach the server (backs off while offline; never past
// the next midnight, when the calendar changes).
uint32_t offlineSleepSeconds(int normalMinutes);
// The server answered: back to the normal schedule.
void offlineReset();
