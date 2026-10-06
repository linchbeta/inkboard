// Draws the hotspot name in white on the setup screen's black pill (1 bpp, 1 = white,
// MSB first). Shared by display.cpp and the host check in tools/make_setup_screen.py's
// sibling test, so what the generator previews is what the firmware draws.
#pragma once
#include <stdint.h>
#include <string.h>
#include "setup_screen_data.h"

#if defined(HAVE_SETUP_SCREEN)
static inline void setupDrawName(uint8_t *img, int width, int height, const char *name) {
    const int rowBytes = width / 8;
    int x = SETUP_NAME_X;
    for (const char *s = name; *s; s++) {
        const char *p = strchr(SETUP_CHARS, *s);
        if (!p || !*p) continue;
        const int16_t *g = SETUP_GLYPHS[p - SETUP_CHARS];  // offset, advance, w, h, xoff, yoff
        int nbytes = (g[2] + 7) / 8, top = SETUP_NAME_BASE - g[5] - g[3];
        for (int r = 0; r < g[3]; r++)
            for (int c = 0; c < g[2]; c++)
                if (SETUP_GLYPH_BITS[g[0] + r * nbytes + c / 8] & (0x80 >> (c % 8))) {
                    int px = x + g[4] + c, py = top + r;
                    if (px >= 0 && px < width && py >= 0 && py < height)
                        img[py * rowBytes + px / 8] |= (uint8_t)(0x80 >> (px % 8));  // white
                }
        x += g[1];
    }
}
#endif
