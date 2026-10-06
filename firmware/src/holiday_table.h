// Official holiday schedules downloaded from the server (GET /api/holidays/<year>), as the
// offline calendar uses them. Plain C++ so the host test (tools/calendar_test) runs the
// same code as the device.
//
// A year's schedule covers that year and the December before it: holiday-cn files can
// start a block there (元旦 from Dec 31), and the server shows such days too.
#pragma once
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static const int HOLIDAY_MAX_DAYS = 96;  // a year has ~30-45 entries

struct HolidayYear {
    int year;
    int count;                         // -1: not downloaded
    uint16_t days[HOLIDAY_MAX_DAYS];   // day since (year-1)-12-01 | 0x8000 = work day (班)
};

// Days since 1970-01-01 (proleptic Gregorian).
static inline long holidayDayNumber(int y, int m, int d) {
    y -= m <= 2;
    long era = (y >= 0 ? y : y - 399) / 400;
    long yoe = y - era * 400;
    long doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    return era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
}

// Parses the server's reply ("YYYYMMDD 1" = day off, "YYYYMMDD 2" = work day, one per
// line) for `year` into `out`; returns the number of days (lines outside the range are
// skipped).
static inline int holidayParse(const char *text, int year, uint16_t *out, int max) {
    const long first = holidayDayNumber(year - 1, 12, 1), last = holidayDayNumber(year, 12, 31);
    int n = 0;
    while (*text && n < max) {
        long ymd;
        int kind;
        if (sscanf(text, "%ld %d", &ymd, &kind) == 2 && (kind == 1 || kind == 2)) {
            int y = (int)(ymd / 10000), m = (int)(ymd / 100 % 100), d = (int)(ymd % 100);
            long dn = m >= 1 && m <= 12 && d >= 1 && d <= 31 ? holidayDayNumber(y, m, d) : -1;
            if (dn >= first && dn <= last) out[n++] = (uint16_t)((dn - first) | (kind == 2 ? 0x8000 : 0));
        }
        const char *nl = strchr(text, '\n');
        if (!nl) break;
        text = nl + 1;
    }
    return n;
}

// 1 = day off, 2 = work day, 0 = neither, -1 = the date is outside this schedule.
static inline int holidayFind(const HolidayYear *h, int y, int m, int d) {
    if (!h || h->count < 0) return -1;
    long k = holidayDayNumber(y, m, d) - holidayDayNumber(h->year - 1, 12, 1);
    if (k < 0 || k > holidayDayNumber(h->year, 12, 31) - holidayDayNumber(h->year - 1, 12, 1)) return -1;
    for (int i = 0; i < h->count; i++)
        if ((h->days[i] & 0x7FFF) == k) return (h->days[i] & 0x8000) ? 2 : 1;
    return 0;
}

// The day's status from the downloaded schedules (`downloaded(year)`: that year's, or
// nullptr) and the bundled table (`bundled`, -1 = year not covered): next year's schedule
// first (its December days), then the year's own, then the bundled one.
static inline int holidayCombined(int y, int m, int d, const HolidayYear *(*downloaded)(int year),
                                  int (*bundled)(int year, int month, int day)) {
    int r = holidayFind(downloaded(y + 1), y, m, d);
    if (r > 0) return r;
    r = holidayFind(downloaded(y), y, m, d);
    if (r >= 0) return r;
    return bundled ? bundled(y, m, d) : -1;
}
