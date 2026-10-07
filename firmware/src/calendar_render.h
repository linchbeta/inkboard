// Offline month calendar: the same picture the InkBoard server draws for its "日历"
// layout (server/src/screens/calendar.ts), rendered on the device from bundled data
// (calendar_data.h, generated from the server's sources). Plain C++, no Arduino: the
// host test (tools/calendar_test) renders every day and compares with the server.
#pragma once
#include <stdint.h>

// Inks, as on the server (Ink in server/src/panels.ts).
enum CalInk { CAL_BLACK = 0, CAL_WHITE = 1, CAL_YELLOW = 2, CAL_RED = 3 };

// The frame to draw into, and the panel's hardware code for each ink.
//  - bpp 2 (0 = 2): 4 px per byte, first pixel in bits 7..6, rows top to bottom.
//  - bpp 1: 8 px per byte, MSB first, the code (0 / 1) is the bit -- B/W panels, whose
//    codes are {0, 1, 0, 0} (red and yellow drawn black, as the server does).
//  - A band: buf holds only rows y0 .. y0 + rows - 1 of the frame (rows 0: all rows);
//    the calendar is drawn whole but only those rows are written, so a panel that takes a
//    frame row by row needs just a band buffer, drawing the calendar once per band.
//  - rot: how the screen stands (Orientation in server/src/panels.ts): 0 landscape,
//    1 portrait (the panel turned a quarter counter-clockwise), 2 landscape upside down,
//    3 portrait the other way. The calendar is laid out upright at the turned size and
//    each pixel written where the panel shows it (render/orient.ts). width / height, y0
//    and rows are always the panel's own.
struct CalTarget {
    int width, height;
    uint8_t codes[4];
    uint8_t *buf;  // width * (rows or height) * bpp / 8 bytes
    int y0, rows;
    int bpp;
    int rot;
};

// Official holidays: 1 = day off (休), 2 = make-up work day (班), 0 = neither,
// -1 = the year's schedule is unknown.
typedef int (*CalHolidayFn)(int year, int month, int day);

// Holidays from the bundled table (calendar_data.h).
int calBundledHoliday(int year, int month, int day);

// Lookup used while rendering; default calBundledHoliday. The firmware adds years it
// downloaded later.
void calSetHolidayFn(CalHolidayFn fn);

// First and last year the bundled lunar data covers.
int calFirstYear();
int calLastYear();

// Draws the month calendar of year-month with `day` as today. batteryV <= 0: no battery.
void calendarRender(const CalTarget &t, int year, int month, int day, float batteryV);
