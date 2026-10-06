// Device side of the holiday consistency check (see holidays.mts): the firmware's lookup
// (src/holiday_table.h + the bundled table) over the endpoint's replies, for every day,
// as shipped ("device": bundled years + downloads for the others) and with nothing
// bundled ("download": every published year downloaded). Then the calendar frames
// around both year ends rendered with it.
//   holidays.exe <dir with holidays_*.txt> device|download|frames
#include "../../src/calendar_render.h"
#include "../../src/holiday_table.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *dir;
static bool useBundled;
static HolidayYear years[8];

static const HolidayYear *downloaded(int year) {
    HolidayYear &y = years[year - 2024];
    if (year < 2024 || year > 2031) return nullptr;
    if (y.year != year) {  // load once, like the device's NVS read
        y.year = year;
        y.count = -1;
        bool bundled = calBundledHoliday(year, 1, 1) >= 0;
        if (!(useBundled && bundled)) {  // the device downloads only years it does not have
            char path[512];
            snprintf(path, sizeof path, "%s/holidays_%d.txt", dir, year);
            FILE *f = fopen(path, "rb");
            if (f) {
                static char text[8192];
                size_t n = fread(text, 1, sizeof text - 1, f);
                text[n] = 0;
                fclose(f);
                y.count = holidayParse(text, year, y.days, HOLIDAY_MAX_DAYS);
            }
        }
    }
    return y.count >= 0 ? &y : nullptr;
}

static int lookup(int y, int m, int d) { return holidayCombined(y, m, d, downloaded, useBundled ? calBundledHoliday : nullptr); }

static unsigned long long fnv(const unsigned char *b, size_t n) {
    unsigned long long h = 0xcbf29ce484222325ULL;
    for (size_t i = 0; i < n; i++) { h ^= b[i]; h *= 0x100000001b3ULL; }
    return h;
}

int main(int argc, char **argv) {
    dir = argv[1];
    useBundled = strcmp(argv[2], "download") != 0;
    calSetHolidayFn(lookup);
    long from = holidayDayNumber(2024, 12, 1), to = holidayDayNumber(2028, 12, 31);
    static unsigned char b398[768 * 552 / 4], b42[400 * 300 / 4];
    CalTarget panels[2] = {{768, 552, {0, 1, 2, 3}, b398}, {400, 300, {0, 1, 3, 3}, b42}};
    const char *ids[2] = {"se0398", "hink42_bwr"};
    for (long dn = from; dn <= to; dn++) {
        // civil date from the day number
        long z = dn + 719468, era = (z >= 0 ? z : z - 146096) / 146097, doe = z - era * 146097;
        long yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365, doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        long mp = (5 * doy + 2) / 153;
        int d = (int)(doy - (153 * mp + 2) / 5 + 1), m = (int)(mp < 10 ? mp + 3 : mp - 9), y = (int)(yoe + era * 400 + (m <= 2));
        if (!strcmp(argv[2], "frames")) {
            if (dn < holidayDayNumber(2026, 12, 1) || dn > holidayDayNumber(2028, 1, 31) || (m > 1 && m < 12)) continue;
            for (int p = 0; p < 2; p++) {
                calendarRender(panels[p], y, m, d, 0);
                printf("%04d%02d%02d %s %016llx\n", y, m, d, ids[p], fnv(panels[p].buf, panels[p].width * panels[p].height / 4));
            }
            continue;
        }
        int r = lookup(y, m, d);
        printf("%04d%02d%02d %d\n", y, m, d, r < 0 ? 0 : r);
    }
    return 0;
}
