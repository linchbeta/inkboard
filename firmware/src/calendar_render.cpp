// Port of server/src/screens/calendar.ts (and the helpers it uses: render/reftext.ts,
// render/gfx.ts, data/calendar.ts). Kept line by line close to the TypeScript so the two
// stay pixel-identical; tools/calendar_test checks that for every day of several years.
#include "calendar_render.h"
#include "calendar_data.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

namespace {

// ── canvas (render/canvas.ts) on a 2bpp buffer ─────────────────────────────

const CalTarget *T;
int bandY0, bandY1;  // the frame rows the target buffer holds (the panel's own rows)
int LW, LH;          // the upright size the calendar is laid out at
int cx0, cy0, cx1, cy1;  // the part of the upright picture that lands in the band

int jsRound(double v) { return (int)floor(v + 0.5); }  // Math.round
const double JS_PI = 3.141592653589793;                  // Math.PI

// (x, y) upright -> the panel's own pixel (toNative in server/src/render/orient.ts)
void set(int x, int y, int ink) {
    if (x < cx0 || y < cy0 || x >= cx1 || y >= cy1) return;
    switch (T->rot) {
        case 1: { int t = x; x = T->width - 1 - y; y = t; break; }
        case 2: x = T->width - 1 - x; y = T->height - 1 - y; break;
        case 3: { int t = x; x = y; y = T->height - 1 - t; break; }
        default: break;
    }
    if (y < bandY0 || y >= bandY1) return;
    int i = (y - bandY0) * T->width + x;
    if (T->bpp == 1) {
        uint8_t &b = T->buf[i >> 3], m = (uint8_t)(0x80 >> (i & 7));
        b = T->codes[ink] ? (uint8_t)(b | m) : (uint8_t)(b & ~m);
        return;
    }
    int shift = 6 - 2 * (i & 3);
    uint8_t &b = T->buf[i >> 2];
    b = (uint8_t)((b & ~(3 << shift)) | (T->codes[ink] << shift));
}

// [x0, x1) x [y0, y1)
void rect(int x0, int y0, int x1, int y1, int ink) {
    if (x0 < cx0) x0 = cx0;
    if (y0 < cy0) y0 = cy0;
    if (x1 > cx1) x1 = cx1;
    if (y1 > cy1) y1 = cy1;
    for (int y = y0; y < y1; y++)
        for (int x = x0; x < x1; x++) set(x, y, ink);
}

void frameRect(int x0, int y0, int x1, int y1, int ink) {
    rect(x0, y0, x1, y0 + 1, ink);
    rect(x0, y1 - 1, x1, y1, ink);
    rect(x0, y0, x0 + 1, y1, ink);
    rect(x1 - 1, y0, x1, y1, ink);
}

// ── Adafruit-GFX primitives (render/gfx.ts) ────────────────────────────────

void vline(int x, int y, int h, int ink) {
    if (h <= 0) return;
    rect(x, y, x + 1, y + h, ink);
}

void fillCircleHelper(int x0, int y0, int r, int corners, int delta, int ink) {
    int f = 1 - r, ddFx = 1, ddFy = -2 * r, x = 0, y = r, px = x, py = y;
    delta++;
    while (x < y) {
        if (f >= 0) { y--; ddFy += 2; f += ddFy; }
        x++;
        ddFx += 2;
        f += ddFx;
        if (x < y + 1) {
            if (corners & 1) vline(x0 + x, y0 - y, 2 * y + delta, ink);
            if (corners & 2) vline(x0 - x, y0 - y, 2 * y + delta, ink);
        }
        if (y != py) {
            if (corners & 1) vline(x0 + py, y0 - px, 2 * px + delta, ink);
            if (corners & 2) vline(x0 - py, y0 - px, 2 * px + delta, ink);
            py = y;
        }
        px = x;
    }
}

void fillCircle(int x0, int y0, int r, int ink) {
    vline(x0, y0 - r, 2 * r + 1, ink);
    fillCircleHelper(x0, y0, r, 3, 0, ink);
}

void drawCircle(int x0, int y0, int r, int ink) {
    int f = 1 - r, ddFx = 1, ddFy = -2 * r, x = 0, y = r;
    set(x0, y0 + r, ink); set(x0, y0 - r, ink); set(x0 + r, y0, ink); set(x0 - r, y0, ink);
    while (x < y) {
        if (f >= 0) { y--; ddFy += 2; f += ddFy; }
        x++;
        ddFx += 2;
        f += ddFx;
        set(x0 + x, y0 + y, ink); set(x0 - x, y0 + y, ink); set(x0 + x, y0 - y, ink); set(x0 - x, y0 - y, ink);
        set(x0 + y, y0 + x, ink); set(x0 - y, y0 + x, ink); set(x0 + y, y0 - x, ink); set(x0 - y, y0 - x, ink);
    }
}

void fillRoundRect(int x, int y, int w, int h, int r, int ink) {
    int maxRadius = (w < h ? w : h) / 2;
    if (r > maxRadius) r = maxRadius;
    rect(x + r, y, x + w - r, y + h, ink);
    fillCircleHelper(x + w - r - 1, y + r, r, 1, h - 2 * r - 1, ink);
    fillCircleHelper(x + r, y + r, r, 2, h - 2 * r - 1, ink);
}

void dottedLine(int x0, int y0, int x1, int y1, int ink, int dot, int space) {
    bool steep = abs(y1 - y0) > abs(x1 - x0);
    int t;
    if (steep) { t = x0; x0 = y0; y0 = t; t = x1; x1 = y1; y1 = t; }
    if (x0 > x1) { t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; }
    int dx = x1 - x0, dy = abs(y1 - y0), err = dx / 2, ystep = y0 < y1 ? 1 : -1, len = 0;
    bool draw = true;
    for (; x0 <= x1; x0++) {
        if (draw) {
            if (steep) set(y0, x0, ink); else set(x0, y0, ink);
            if (++len >= dot) { len = 0; draw = false; }
        } else if (++len >= space) {
            len = 0;
            draw = true;
        }
        err -= dy;
        if (err < 0) { y0 += ystep; err += dx; }
    }
}

// ── text (render/reftext.ts) ───────────────────────────────────────────────

// Next code point of a UTF-8 string; advances *s.
uint32_t nextCp(const char **s) {
    const uint8_t *p = (const uint8_t *)*s;
    uint32_t c = *p++;
    if (c >= 0xF0) { c = ((c & 7) << 18) | ((p[0] & 63) << 12) | ((p[1] & 63) << 6) | (p[2] & 63); p += 3; }
    else if (c >= 0xE0) { c = ((c & 15) << 12) | ((p[0] & 63) << 6) | (p[1] & 63); p += 2; }
    else if (c >= 0xC0) { c = ((c & 31) << 6) | (p[0] & 63); p += 1; }
    *s = (const char *)p;
    return c;
}

const CalGlyph *glyph(const CalFont &f, uint32_t cp) {
    int lo = 0, hi = f.count - 1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (f.glyphs[mid].cp == cp) return &f.glyphs[mid];
        if (f.glyphs[mid].cp < cp) lo = mid + 1; else hi = mid - 1;
    }
    return nullptr;
}

bool bit(const CalFont &f, const CalGlyph *g, int r, int c) {
    return f.bits[g->off + r * ((g->w + 7) / 8) + c / 8] & (0x80 >> (c % 8));
}

int height(const CalFont &f) { return f.ascent - f.descent; }

// GFX_getUTF8Width: advances, but the last glyph counts its real ink width + x offset
int width(const CalFont &f, const char *s) {
    int w = 0;
    const CalGlyph *last = nullptr;
    while (*s) {
        last = glyph(f, nextCp(&s));
        w += last ? last->adv : 0;
    }
    if (last && last->w != 0) w = w - last->adv + last->w + last->xo;
    return w;
}

struct InkBox { int x0, x1, y0, y1; bool ok; };

InkBox inkBounds(const CalFont &f, const char *s, int x, int baseline) {
    InkBox b = {0, 0, 0, 0, false};
    while (*s) {
        const CalGlyph *g = glyph(f, nextCp(&s));
        if (!g) continue;
        int top = baseline - g->yo - g->h, first = -1, lastCol = -1;
        for (int r = 0; r < g->h; r++) {
            bool any = false;
            for (int c = 0; c < g->w; c++)
                if (bit(f, g, r, c)) {
                    any = true;
                    if (first < 0 || c < first) first = c;
                    if (c > lastCol) lastCol = c;
                }
            if (!any) continue;
            int y = top + r;
            if (!b.ok) { b.ok = true; b.x0 = 1 << 30; b.x1 = -(1 << 30); b.y0 = b.y1 = y; }
            else { if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; }
        }
        if (first >= 0) {
            if (x + g->xo + first < b.x0) b.x0 = x + g->xo + first;
            if (x + g->xo + lastCol > b.x1) b.x1 = x + g->xo + lastCol;
        }
        x += g->adv;
    }
    return b;
}

int print(const CalFont &f, const char *s, int x, int baseline, int ink) {
    while (*s) {
        const CalGlyph *g = glyph(f, nextCp(&s));
        if (!g) continue;
        int top = baseline - g->yo - g->h;
        if (top + g->h <= cy0 || top >= cy1 || x + g->xo + g->w <= cx0 || x + g->xo >= cx1) { x += g->adv; continue; }  // (outside this band)
        for (int r = 0; r < g->h; r++)
            for (int c = 0; c < g->w; c++)
                if (bit(f, g, r, c)) set(x + g->xo + c, top + r, ink);
        x += g->adv;
    }
    return x;
}

int centeredX(const CalFont &f, const char *s, double cx) {
    InkBox b = inkBounds(f, s, 0, 0);
    return b.ok ? jsRound(cx - (b.x0 + b.x1) / 2.0) : jsRound(cx);
}

void centeredAt(const CalFont &f, const char *s, double cx, double cy, int *x, int *baseline) {
    InkBox b = inkBounds(f, s, 0, 0);
    if (!b.ok) { *x = (int)cx; *baseline = (int)cy; return; }
    *x = jsRound(cx - (b.x0 + b.x1) / 2.0);
    *baseline = jsRound(cy - (b.y0 + b.y1) / 2.0);
}

// ── battery (reftext.ts drawBattery, data/calendar.ts batteryLevel) ─────────

int batteryLevel(int mv) {
    static const int C[][2] = {{3300, 0}, {3610, 5}, {3690, 10}, {3730, 20}, {3770, 30}, {3800, 40},
                               {3840, 50}, {3870, 60}, {3950, 70}, {4020, 80}, {4110, 90}, {4200, 100}};
    if (mv <= C[0][0]) return 0;
    for (int i = 1; i < 12; i++)
        if (mv <= C[i][0])
            return jsRound(C[i - 1][1] + (double)(mv - C[i - 1][0]) * (C[i][1] - C[i - 1][1]) / (C[i][0] - C[i - 1][0]));
    return 100;
}

void drawBattery(int x, int y, float volts) {
    int mv = jsRound(volts * 1000.0);
    int iw = 20, bx = x - iw, level = batteryLevel(mv);
    char s[16];
    snprintf(s, sizeof s, "%d.%dV", mv / 1000, (mv % 1000) / 100);
    print(CAL_wqy9, s, bx - width(CAL_wqy9, "3.2V") - 2, y + 9, CAL_BLACK);
    rect(bx, y, bx + iw, y + 10, CAL_WHITE);
    frameRect(bx, y, bx + iw, y + 10, CAL_BLACK);
    rect(bx + iw, y + 4, bx + iw + 2, y + 6, CAL_BLACK);
    rect(bx + 2, y + 2, bx + 2 + (16 * level) / 100, y + 8, CAL_BLACK);
}

// ── calendar data (data/calendar.ts) ───────────────────────────────────────

const char *const WEEKDAY[] = {"日", "一", "二", "三", "四", "五", "六"};
const char *const LUNAR_MONTH[] = {"", "正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "腊月"};
const char *const LUNAR_DATE[] = {"", "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
    "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
    "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"};
const char *const GAN[] = {"甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"};
const char *const ZHI[] = {"子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"};
const char *const ZODIAC[] = {"鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"};

// days since 1970-01-01 (proleptic Gregorian)
long dayNumber(int y, int m, int d) {
    y -= m <= 2;
    long era = (y >= 0 ? y : y - 399) / 400;
    long yoe = y - era * 400;
    long doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + doe - 719468;
}

void civil(long z, int *y, int *m, int *d) {
    z += 719468;
    long era = (z >= 0 ? z : z - 146096) / 146097;
    long doe = z - era * 146097;
    long yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    long doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    long mp = (5 * doy + 2) / 153;
    *d = (int)(doy - (153 * mp + 2) / 5 + 1);
    *m = (int)(mp < 10 ? mp + 3 : mp - 9);
    *y = (int)(yoe + era * 400 + (*m <= 2));
}

int weekdayOf(int y, int m, int d) { return (int)(((dayNumber(y, m, d) % 7) + 11) % 7); }  // 0 = Sunday

int daysInMonth(int y, int m) {
    static const int D[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    bool leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    return m == 2 && leap ? 29 : D[m - 1];
}

int isoWeek(int y, int m, int d) {
    long dn = dayNumber(y, m, d);
    int dow = weekdayOf(y, m, d);
    if (dow == 0) dow = 7;
    long th = dn + 4 - dow;
    int ty, tm, td;
    civil(th, &ty, &tm, &td);
    return (int)((th - dayNumber(ty, 1, 1)) / 7 + 1);
}

struct LunarDay { int month, day; bool leap; int year; const char *jieqi; };

LunarDay lunarOf(int y, int m, int d) {
    LunarDay l = {0, 0, false, 0, ""};
    long k = dayNumber(y, m, d) - CAL_EPOCH_DAY;
    int lo = 0, hi = CAL_LUNAR_MONTH_COUNT - 1, at = -1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (CAL_LUNAR_MONTHS[mid].start <= k) { at = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (at < 0 || y > CAL_LAST_YEAR) return l;  // outside the bundled years
    const CalLunarMonth &e = CAL_LUNAR_MONTHS[at];
    l.month = e.month & 0x7F;
    l.leap = (e.month & 0x80) != 0;
    l.day = (int)(k - e.start + 1);
    l.year = 2000 + e.year;
    if (y >= CAL_FIRST_YEAR && y <= CAL_LAST_YEAR) {
        const uint8_t *row = CAL_TERM_DAYS[y - CAL_FIRST_YEAR];
        if (row[(m - 1) * 2] == d) l.jieqi = CAL_TERM_NAMES[(m - 1) * 2];
        else if (row[(m - 1) * 2 + 1] == d) l.jieqi = CAL_TERM_NAMES[(m - 1) * 2 + 1];
    }
    return l;
}

int dayGanZhiIndex(int year, int month, int day) {
    int a = (14 - month) / 12, y = year + 4800 - a, m = month + 12 * a - 3;
    long jd = day + (153 * m + 2) / 5 + 365L * y + y / 4 - y / 100 + y / 400 - 32045;
    return (int)((jd - 11 + 60000000) % 60);
}

const char *festivalOf(int year, int month, int day, const LunarDay &l) {
    static const struct { int m, d; const char *name; } LUNAR_F[] = {
        {1, 1, "春节"}, {1, 15, "元宵节"}, {2, 2, "龙抬头"}, {5, 5, "端午节"}, {7, 7, "七夕节"}, {7, 15, "中元节"},
        {8, 15, "中秋节"}, {9, 9, "重阳节"}, {10, 1, "寒衣节"}, {12, 8, "腊八节"}, {12, 30, "除夕"}};
    static const struct { int m, d; const char *name; } SOLAR_F[] = {
        {1, 1, "元旦节"}, {2, 14, "情人节"}, {3, 8, "妇女节"}, {3, 12, "植树节"}, {4, 1, "愚人节"},
        {5, 1, "劳动节"}, {5, 4, "青年节"}, {6, 1, "儿童节"}, {7, 1, "建党节"}, {8, 1, "建军节"},
        {9, 10, "教师节"}, {10, 1, "国庆节"}, {11, 1, "万圣节"}, {12, 24, "平安夜"}, {12, 25, "圣诞节"}};
    if (!l.leap) {
        for (auto &f : LUNAR_F) if (f.m == l.month && f.d == l.day) return f.name;
        if (l.month == 12 && l.day == 29) {  // 除夕 when the 12th month has 29 days
            int ny, nm, nd;
            civil(dayNumber(year, month, day) + 1, &ny, &nm, &nd);
            LunarDay n = lunarOf(ny, nm, nd);
            if (n.month == 1 && n.day == 1 && !n.leap) return "除夕";
        }
    }
    int wd = weekdayOf(year, month, day);
    if (month == 5 && wd == 0 && day >= 8 && day <= 14) return "母亲节";
    if (month == 6 && wd == 0 && day >= 15 && day <= 21) return "父亲节";
    if (month == 11 && wd == 4 && day >= 22 && day <= 28) return "感恩节";
    for (auto &f : SOLAR_F) if (f.m == month && f.d == day) return f.name;
    if (strcmp(l.jieqi, "清明") == 0) return "清明节";
    return nullptr;
}

CalHolidayFn holidayFn = calBundledHoliday;

}  // namespace

int calBundledHoliday(int year, int month, int day) {
    if (year < CAL_FIRST_YEAR || year > CAL_LAST_YEAR || !(CAL_HOLIDAY_YEARS >> (year - CAL_FIRST_YEAR) & 1)) return -1;
    long k = dayNumber(year, month, day) - CAL_EPOCH_DAY;
    for (int i = 0; i < CAL_HOLIDAY_COUNT; i++)
        if ((CAL_HOLIDAYS[i] & 0x7FFF) == k) return CAL_HOLIDAYS[i] & 0x8000 ? 2 : 1;
    return 0;
}

void calSetHolidayFn(CalHolidayFn fn) { holidayFn = fn ? fn : calBundledHoliday; }
int calFirstYear() { return CAL_FIRST_YEAR; }
int calLastYear() { return CAL_LAST_YEAR; }

// ── the calendar (screens/calendar.ts renderCalendar, weekStart 0) ───────────

void calendarRender(const CalTarget &t, int year, int month, int today, float batteryV) {
    T = &t;
    bandY0 = t.rows ? t.y0 : 0;
    bandY1 = t.rows && t.y0 + t.rows < t.height ? t.y0 + t.rows : t.height;
    const uint8_t white = t.codes[CAL_WHITE];
    const size_t px = (size_t)t.width * (bandY1 - bandY0);
    if (t.bpp == 1) memset(t.buf, white ? 0xFF : 0x00, px / 8);
    else memset(t.buf, (white << 6) | (white << 4) | (white << 2) | white, px / 4);

    LW = t.rot & 1 ? t.height : t.width;
    LH = t.rot & 1 ? t.width : t.height;
    // the band's rows of the panel, as a box of the upright picture (see set)
    cx0 = 0; cy0 = 0; cx1 = LW; cy1 = LH;
    switch (t.rot) {
        case 0: cy0 = bandY0; cy1 = bandY1; break;
        case 1: cx0 = bandY0; cx1 = bandY1; break;                      // panel y = upright x
        case 2: cy0 = t.height - bandY1; cy1 = t.height - bandY0; break;  // panel y = H-1 - upright y
        case 3: cx0 = t.height - bandY1; cx1 = t.height - bandY0; break; // panel y = H-1 - upright x
    }
    const int W = LW, H = LH;
    const bool large = (W < H ? W : H) >= 400;  // the short side (isLarge), so upright too
    // an upright 4.2": 休 / 班 at the top of their circle, the cell's content a little lower
    const bool tall = H > W && !large;
    const int weekStart = 0;
    const LunarDay todayLunar = lunarOf(year, month, today);
    char s[64];

    // ── DrawDateHeader(gfx, 10, large ? 38 : 28) ──
    {
        const int x = 10, y = large ? 38 : 28;
        snprintf(s, sizeof s, "%d", year);
        int tx = print(CAL_helvB18, s, x, y - 2, CAL_RED);
        tx = print(CAL_wqy12, "年", tx, y - 2, CAL_BLACK);
        snprintf(s, sizeof s, "%d", month);
        tx = print(CAL_helvB18, s, tx, y - 2, CAL_RED);
        tx = print(CAL_wqy12, "月", tx, y - 2, CAL_BLACK);

        int lx = tx;
        if (todayLunar.leap) lx = print(CAL_wqy9, " ", lx, y, CAL_BLACK);
        snprintf(s, sizeof s, "%s%s%s", todayLunar.leap ? "闰" : " ", LUNAR_MONTH[todayLunar.month], LUNAR_DATE[todayLunar.day]);
        lx = print(CAL_wqy9, s, lx, y, CAL_BLACK);
        snprintf(s, sizeof s, " [%d周]", isoWeek(year, month, today));
        print(CAL_wqy9, s, lx, y, CAL_RED);

        int gi = ((todayLunar.year - 4) % 60 + 60) % 60;
        snprintf(s, sizeof s, " %s%s年", GAN[gi % 10], ZHI[gi % 12]);
        int gx = print(CAL_wqy9, s, tx, y - 14, CAL_BLACK);
        snprintf(s, sizeof s, " [%s]", ZODIAC[gi % 12]);
        print(CAL_wqy9, s, gx, y - 14, CAL_RED);

        if (batteryV > 0) drawBattery(W - 12, large ? 16 : 6, batteryV);
    }

    // ── DrawWeekHeader(gfx, 10, large ? 44 : 32) ──
    {
        const int x = 10, y = large ? 44 : 32;
        const CalFont &font = large ? CAL_wqy12 : CAL_wqy9;
        const int w = (W - 2 * x) / 7, h = large ? 32 : 24, r = (W - 2 * x) % 7, radius = h / 2;
        for (int i = 0; i < 7; i++) {
            int day = (weekStart + i) % 7;
            int bg = day == 0 || day == 6 ? CAL_RED : CAL_BLACK;
            int cellX = x + i * w, cellW = i == 6 ? w + r : w;
            if (i == 0) {
                rect(cellX + radius, y, cellX + cellW, y + h, bg);
                fillCircle(cellX + radius, y + radius, radius - 1, bg);
            } else if (i == 6) {
                rect(cellX, y, cellX + cellW - radius, y + h, bg);
                fillRoundRect(cellX, y, cellW, h, radius, bg);
            } else {
                rect(cellX, y, cellX + cellW, y + h, bg);
            }
            double cx = x + i * w + w / 2.0, cy = y + h / 2.0;
            int px, pb;
            centeredAt(font, WEEKDAY[day], cx, cy, &px, &pb);
            print(font, WEEKDAY[day], px, pb, CAL_WHITE);
        }
        for (int i = 1; i < 7; i++) rect(x + i * w, y, x + i * w + 1, y + h, CAL_WHITE);
    }

    // ── DrawMonthDays(gfx, 10, large ? 84 : 64) ──
    {
        const int x = 10, y = large ? 84 : 64;
        const int firstDayWeek = weekdayOf(year, month, 1);
        const int adjustedFirstDay = (firstDayWeek - weekStart + 7) % 7;
        const int monthMaxDays = daysInMonth(year, month);
        const int rows = 1 + (monthMaxDays - (7 - adjustedFirstDay) + 6) / 7;
        const int bw = (W - x - 10) / 7, bh = (H - y - 10) / rows;
        if (large) {
            for (int i = 1; i < rows; i++) dottedLine(x, y + i * bh, x + 7 * bw - 1, y + i * bh, CAL_BLACK, 1, 5);
            for (int i = 1; i < 7; i++) dottedLine(x + i * bw, y, x + i * bw, y + rows * bh - 1, CAL_BLACK, 1, 5);
        }
        const CalFont &dayFont = large ? CAL_helvB18 : CAL_helvB14;
        const CalFont &lunarFont = large ? CAL_wqy12 : CAL_wqy9;
        for (int i = 0; i < monthMaxDays; i++) {
            const int day = i + 1;
            const int actualWeek = (firstDayWeek + i) % 7, displayWeek = (adjustedFirstDay + i) % 7;
            const bool weekend = actualWeek == 0 || actualWeek == 6, isToday = day == today;
            const LunarDay lunar = lunarOf(year, month, day);
            int cr = large ? 15 : 11;
            if (rows > 5) cr -= 1;
            const int bx = x + (bw - 2 * cr) / 2 + displayWeek * bw;
            const int by = y + (bh - 2 * cr) / 2 + ((i + adjustedFirstDay) / 7) * bh + 3 + (tall ? 5 : 0);

            const int colCx = bx + cr;
            char dayStr[4];
            snprintf(dayStr, sizeof dayStr, "%d", day);
            const int dayBaseline = by - (cr - height(dayFont)) - 1;
            const int dayX = centeredX(dayFont, dayStr, colCx);
            const InkBox dayInk = inkBounds(dayFont, dayStr, dayX, dayBaseline);

            const char *festival = festivalOf(year, month, day, lunar);
            if (!festival && lunar.jieqi[0]) festival = lunar.jieqi;
            char label[32];
            if (festival) snprintf(label, sizeof label, "%s", festival);
            else if (lunar.day == 1) snprintf(label, sizeof label, "%s%s", lunar.leap ? "闰" : " ", LUNAR_MONTH[lunar.month]);
            else snprintf(label, sizeof label, "%s", LUNAR_DATE[lunar.day]);
            const int labelX = centeredX(lunarFont, label, colCx);
            const int labelBaseline = dayBaseline + height(lunarFont) + (large ? 5 : 3);

            int ink;
            if (isToday) {
                InkBox a = inkBounds(dayFont, dayStr, dayX, dayBaseline);
                InkBox b = inkBounds(lunarFont, label, labelX, labelBaseline);
                int x0 = b.ok && b.x0 < a.x0 ? b.x0 : a.x0, x1 = b.ok && b.x1 > a.x1 ? b.x1 : a.x1;
                int y0 = a.y0, y1 = b.ok ? b.y1 : a.y1;
                fillCircle(jsRound((x0 + x1) / 2.0), jsRound((y0 + y1) / 2.0), 2 * cr, CAL_RED);
                ink = CAL_WHITE;
            } else {
                ink = weekend ? CAL_RED : CAL_BLACK;
            }
            print(dayFont, dayStr, dayX, dayBaseline, ink);
            if (festival && !isToday) ink = CAL_RED;
            print(lunarFont, label, labelX, labelBaseline, ink);

            // day stem/branch, two tiny characters stacked at the right of the date
            const int gzi = dayGanZhiIndex(year, month, day);
            const char *gan = GAN[gzi % 10], *zhi = ZHI[gzi % 12];
            const int offset = large ? 31 : 22;
            int taxX = bx + offset;
            const int leftEdge = x + displayWeek * bw;
            if (taxX < leftEdge + 2) taxX = leftEdge + 2;
            if (isToday) {
                const int rr = large ? 9 : 7;
                int rx = taxX + (large ? 36 : 27) - offset - 1;
                if (dayInk.x1 + 2 + rr > rx) rx = dayInk.x1 + 2 + rr;
                InkBox lb = inkBounds(lunarFont, label, labelX, labelBaseline);
                int ry1 = by - 2 - 8 - 3;
                if (lb.ok && lb.y0 - 2 - rr - (2 * rr + 1) < ry1) ry1 = lb.y0 - 2 - rr - (2 * rr + 1);
                const int ry2 = ry1 + 2 * rr + 1;
                const char *chs[2] = {gan, zhi};
                const int rys[2] = {ry1, ry2};
                for (int k = 0; k < 2; k++) {
                    fillCircle(rx, rys[k], rr, CAL_WHITE);
                    drawCircle(rx, rys[k], rr, CAL_RED);
                    int px, pb;
                    centeredAt(CAL_wqy6, chs[k], rx, rys[k], &px, &pb);
                    print(CAL_wqy6, chs[k], px, pb, CAL_BLACK);
                }
            } else {
                int gx = taxX > dayInk.x1 + 2 ? taxX : dayInk.x1 + 2;
                print(CAL_wqy6, gan, gx, by - 9, CAL_BLACK);
                print(CAL_wqy6, zhi, gx, by + width(CAL_wqy6, "清") - 7, CAL_BLACK);
            }

            // 休 / 班
            const int hol = holidayFn(year, month, day);
            if (hol > 0) {
                const char *text = hol == 2 ? "班" : "休";
                const int holInk = hol == 2 ? CAL_BLACK : CAL_RED;
                // the 4.2": as small as the stem/branch characters
                const CalFont &hf = large ? CAL_wqy9 : CAL_wqy6;
                // On the circle round the date + lunar label (today's red disc) through the top
                // stem/branch badge: that badge mirrored to the left, moved up along the circle
                // past a two-digit date (upright 4.2": the top of the circle). Today a badge,
                // other days the character alone, in the same place.
                const InkBox &a = dayInk;
                const InkBox b = inkBounds(lunarFont, label, labelX, labelBaseline);
                const int dx0 = b.ok && b.x0 < a.x0 ? b.x0 : a.x0, dx1 = b.ok && b.x1 > a.x1 ? b.x1 : a.x1;
                const int dcx = jsRound((dx0 + dx1) / 2.0), dcy = jsRound((a.y0 + (b.ok ? b.y1 : a.y1)) / 2.0);
                const int rr = large ? 9 : 7;
                int gx = taxX + (large ? 36 : 27) - offset - 1;
                if (dayInk.x1 + 2 + rr > gx) gx = dayInk.x1 + 2 + rr;
                int gy = by - 2 - 8 - 3;
                if (b.ok && b.y0 - 2 - rr - (2 * rr + 1) < gy) gy = b.y0 - 2 - rr - (2 * rr + 1);
                const double R = hypot((double)(gx - dcx), (double)(gy - dcy));
                double th = tall ? -JS_PI / 2 : atan2((double)(gy - dcy), (double)(gx - dcx));
                int rx, ry;
                for (;;) {
                    rx = jsRound(dcx - R * cos(th));
                    ry = jsRound(dcy + R * sin(th));
                    bool clear = rx + rr + 1 < dayInk.x0 || ry + rr + 1 < dayInk.y0;
                    if (clear || !(th > -JS_PI / 2)) break;
                    th -= JS_PI / 90;
                }
                if (isToday) {
                    fillCircle(rx, ry, rr, CAL_WHITE);
                    drawCircle(rx, ry, rr, CAL_RED);
                }
                int px, pb;
                centeredAt(hf, text, rx, ry, &px, &pb);
                print(hf, text, px, pb, holInk);
            }
        }
    }
}
