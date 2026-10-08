// Device side of the calendar comparison (see expected.ts): renders every day with
// src/calendar_render.cpp and prints the same lines. Each frame is drawn twice -- whole,
// and in 24-row bands as panels that take frames row by row draw it -- and the two must
// match. "all" as a third argument covers every panel the firmware has a calendar for,
// not just our two. With "dump Y M D" it writes our two panels' frames as raw 2bpp files.
#include "../../src/calendar_render.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned long long fnv(const unsigned char *b, size_t n) {
    unsigned long long h = 0xcbf29ce484222325ULL;
    for (size_t i = 0; i < n; i++) { h ^= b[i]; h *= 0x100000001b3ULL; }
    return h;
}

struct Panel { const char *id; int w, h; uint8_t codes[4]; int bpp; };
static const Panel PANELS[] = {
    {"se0398", 768, 552, {0, 1, 2, 3}, 2},
    {"hink42_bwr", 400, 300, {0, 1, 3, 3}, 2},
    // the other panels of the firmware (expected.ts: the same ids)
    {"bwry42", 400, 300, {0, 1, 2, 3}, 2},
    {"bwr583", 648, 480, {0, 1, 3, 3}, 2},
    {"bwr75", 800, 480, {0, 1, 3, 3}, 2},
    {"bw42", 400, 300, {0, 1, 0, 0}, 1},
    {"bw583", 648, 480, {0, 1, 0, 0}, 1},
    {"bw75", 800, 480, {0, 1, 0, 0}, 1},
    {"color565", 600, 448, {0, 1, 2, 3}, 2},
    {"bwr75v1", 640, 384, {0, 1, 3, 3}, 2},
    {"bwry75", 800, 480, {0, 1, 2, 3}, 2},
    {"bw75v1", 640, 384, {0, 1, 0, 0}, 1},
    {"bwr583v1", 600, 448, {0, 1, 3, 3}, 2},
    {"bw583v1", 600, 448, {0, 1, 0, 0}, 1},
    {"bwry583", 648, 480, {0, 1, 2, 3}, 2},
    {"bwr75hd", 880, 528, {0, 1, 3, 3}, 2},
    {"bw75hd", 880, 528, {0, 1, 0, 0}, 1},
};
static const int BAND = 24;

static unsigned char full[880 * 552 / 4], banded[880 * 552 / 4], band[880 * BAND / 4];
static int rot = 0;  // 0 landscape, 1 portrait, 2 landscape-flip, 3 portrait-flip (CalTarget::rot)

// Draws the frame whole and in bands; returns its size, or 0 if the two differ.
static size_t draw(const Panel &p, int y, int m, int d, float v) {
    size_t row = (size_t)p.w * p.bpp / 8, n = row * p.h;
    CalTarget t = {p.w, p.h, {p.codes[0], p.codes[1], p.codes[2], p.codes[3]}, full, 0, 0, p.bpp, rot};
    calendarRender(t, y, m, d, v);
    for (int y0 = 0; y0 < p.h; y0 += BAND) {
        CalTarget b = {p.w, p.h, {p.codes[0], p.codes[1], p.codes[2], p.codes[3]}, band, y0, BAND, p.bpp, rot};
        calendarRender(b, y, m, d, v);
        int rows = p.h - y0 < BAND ? p.h - y0 : BAND;
        memcpy(banded + row * y0, band, row * rows);
    }
    return memcmp(full, banded, n) ? 0 : n;
}

int main(int argc, char **argv) {
    if (argc == 5 && !strcmp(argv[1], "dump")) {
        int y = atoi(argv[2]), m = atoi(argv[3]), d = atoi(argv[4]);
        for (int p = 0; p < 2; p++) {
            size_t n = draw(PANELS[p], y, m, d, d == 1 ? 3.62f + (m % 5) * 0.13f : 0);
            char name[64];
            snprintf(name, sizeof name, "cal_%s.raw", PANELS[p].id);
            FILE *f = fopen(name, "wb");
            fwrite(full, 1, n, f);
            fclose(f);
        }
        return 0;
    }
    int from = argc > 2 ? atoi(argv[1]) : 2025, to = argc > 2 ? atoi(argv[2]) : 2030;
    int panels = argc > 3 && !strcmp(argv[3], "all") ? (int)(sizeof PANELS / sizeof PANELS[0]) : 2;
    // a fourth argument: the orientation, as expected.ts takes it
    if (argc > 4) {
        static const char *O[] = {"landscape", "portrait", "landscape-flip", "portrait-flip"};
        for (int k = 0; k < 4; k++) if (!strcmp(argv[4], O[k])) rot = k;
    }
    static const int D[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    for (int y = from; y <= to; y++)
        for (int m = 1; m <= 12; m++) {
            int dim = D[m - 1] + (m == 2 && ((y % 4 == 0 && y % 100) || y % 400 == 0));
            for (int d = 1; d <= dim; d++)
                for (int p = 0; p < panels; p++) {
                    size_t n = draw(PANELS[p], y, m, d, d == 1 ? 3.62f + (m % 5) * 0.13f : 0);
                    if (!n) printf("%04d-%02d-%02d %s BANDS DIFFER\n", y, m, d, PANELS[p].id);
                    else printf("%04d-%02d-%02d %s %016llx\n", y, m, d, PANELS[p].id, fnv(full, n));
                }
        }
    return 0;
}
