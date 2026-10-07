// Draws the hotspot name in white on the setup screen's black pill (1 bpp, 1 = white,
// MSB first, rows of (width + 7) / 8 bytes). Shared by display.cpp and the host check in
// tools/make_setup_screen.py's sibling test, so what the generator previews is what the
// firmware draws. The upright image (portrait screens) has its own glyphs and position.
#pragma once
#include <stdint.h>
#include <string.h>
#include "setup_screen_data.h"

#if defined(HAVE_SETUP_SCREEN)
static inline void setupDrawNameWith(uint8_t *img, int width, int height, const char *name,
                                     const uint8_t *bits, const int16_t (*glyphs)[6], int nameX, int nameBase) {
    const int rowBytes = (width + 7) / 8;
    int x = nameX;
    for (const char *s = name; *s; s++) {
        const char *p = strchr(SETUP_CHARS, *s);
        if (!p || !*p) continue;
        const int16_t *g = glyphs[p - SETUP_CHARS];  // offset, advance, w, h, xoff, yoff
        int nbytes = (g[2] + 7) / 8, top = nameBase - g[5] - g[3];
        for (int r = 0; r < g[3]; r++)
            for (int c = 0; c < g[2]; c++)
                if (bits[g[0] + r * nbytes + c / 8] & (0x80 >> (c % 8))) {
                    int px = x + g[4] + c, py = top + r;
                    if (px >= 0 && px < width && py >= 0 && py < height)
                        img[py * rowBytes + px / 8] |= (uint8_t)(0x80 >> (px % 8));  // white
                }
        x += g[1];
    }
}

static inline void setupDrawName(uint8_t *img, int width, int height, const char *name) {
    setupDrawNameWith(img, width, height, name, SETUP_GLYPH_BITS, SETUP_GLYPHS, SETUP_NAME_X, SETUP_NAME_BASE);
}
#endif
