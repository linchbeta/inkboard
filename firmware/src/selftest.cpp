// ── Panel fine-detail self-test pattern (built with -DEPD_SELFTEST) ──────
// Supported panels:
//   SE0398 (768x552, B/W/Y/R): rows are generated and streamed straight to the
//     controller RAM — no frame buffer.
//   HINK 4.2" SSD1683 (400x300, B/W/R): the pattern is written into colorBuf and
//     shown through epdDisplay2bpp(), the same path real 2bpp content takes, so the
//     2bpp -> black/red plane decode is exercised too. Code 10 (yellow) must come out RED.
//
// What to look for on the panel:
//   - 1px border fully visible on all four edges
//   - the two 1px diagonals are straight and unbroken (on SE0398 especially where
//     they cross the middle = seam between the two interleaved gate halves)
//   - 1px line gratings / checkerboards resolve as clean patterns, not grey mush
//   - 1px-stroke text (scale 1) is legible

#include "epd_driver.h"
#include "config.h"

#if defined(EPD_SELFTEST) && (defined(EPD_PANEL_398_SE0398NZ07A0) || defined(EPD_PANEL_42_HINK_SSD1683))

namespace {

constexpr uint8_t K = 0b00;  // black
constexpr uint8_t Wt = 0b01; // white
constexpr uint8_t Y = 0b10;  // yellow (rendered red on B/W/R panels)
constexpr uint8_t R = 0b11;  // red

// Classic 5x7 font, column-major, bit 0 = top row.
struct Glyph { char c; uint8_t col[5]; };
const Glyph FONT[] = {
    {' ', {0x00,0x00,0x00,0x00,0x00}}, {'.', {0x00,0x60,0x60,0x00,0x00}},
    {',', {0x00,0x50,0x30,0x00,0x00}}, {'(', {0x00,0x1C,0x22,0x41,0x00}},
    {')', {0x00,0x41,0x22,0x1C,0x00}}, {'>', {0x00,0x41,0x22,0x14,0x08}},
    {'-', {0x08,0x08,0x08,0x08,0x08}}, {':', {0x00,0x36,0x36,0x00,0x00}},
    {'/', {0x20,0x10,0x08,0x04,0x02}}, {'%', {0x23,0x13,0x08,0x64,0x62}},
    {'0', {0x3E,0x51,0x49,0x45,0x3E}}, {'1', {0x00,0x42,0x7F,0x40,0x00}},
    {'2', {0x42,0x61,0x51,0x49,0x46}}, {'3', {0x22,0x41,0x49,0x49,0x36}},
    {'4', {0x18,0x14,0x12,0x7F,0x10}}, {'5', {0x27,0x45,0x45,0x45,0x39}},
    {'6', {0x3C,0x4A,0x49,0x49,0x30}}, {'7', {0x01,0x71,0x09,0x05,0x03}},
    {'8', {0x36,0x49,0x49,0x49,0x36}}, {'9', {0x06,0x49,0x49,0x29,0x1E}},
    {'A', {0x7E,0x11,0x11,0x11,0x7E}}, {'B', {0x7F,0x49,0x49,0x49,0x36}},
    {'C', {0x3E,0x41,0x41,0x41,0x22}}, {'D', {0x7F,0x41,0x41,0x22,0x1C}},
    {'E', {0x7F,0x49,0x49,0x49,0x41}}, {'F', {0x7F,0x09,0x09,0x09,0x01}},
    {'G', {0x3E,0x41,0x49,0x49,0x7A}}, {'H', {0x7F,0x08,0x08,0x08,0x7F}},
    {'I', {0x00,0x41,0x7F,0x41,0x00}}, {'J', {0x20,0x40,0x41,0x3F,0x01}},
    {'K', {0x7F,0x08,0x14,0x22,0x41}}, {'L', {0x7F,0x40,0x40,0x40,0x40}},
    {'M', {0x7F,0x02,0x0C,0x02,0x7F}}, {'N', {0x7F,0x04,0x08,0x10,0x7F}},
    {'O', {0x3E,0x41,0x41,0x41,0x3E}}, {'P', {0x7F,0x09,0x09,0x09,0x06}},
    {'Q', {0x3E,0x41,0x51,0x21,0x5E}}, {'R', {0x7F,0x09,0x19,0x29,0x46}},
    {'S', {0x26,0x49,0x49,0x49,0x32}}, {'T', {0x01,0x01,0x7F,0x01,0x01}},
    {'U', {0x3F,0x40,0x40,0x40,0x3F}}, {'V', {0x1F,0x20,0x40,0x20,0x1F}},
    {'W', {0x3F,0x40,0x38,0x40,0x3F}}, {'X', {0x63,0x14,0x08,0x14,0x63}},
    {'Y', {0x07,0x08,0x70,0x08,0x07}}, {'Z', {0x61,0x51,0x49,0x45,0x43}},
};

const uint8_t *glyphFor(char c) {
    for (const Glyph &g : FONT) {
        if (g.c == c) return g.col;
    }
    return FONT[0].col;  // unknown -> space
}

struct TextLine {
    int x, y, scale;
    uint8_t fg;
    const char *text;
};

// ── Per-panel layout ─────────────────────────────────────────────────
// Bands (top to bottom): colour swatches, vertical gratings, checkerboards,
// horizontal gratings, text, a "yellow" text strip on black, more text, 1px grid.
#if defined(EPD_PANEL_398_SE0398NZ07A0)
constexpr int BAND_H = 64, GAP = 8, HBAND_H = 40;
constexpr int YSTRIP_Y0 = 362, YSTRIP_Y1 = 384, GRID_Y0 = 480;
const TextLine LINES[] = {
    {16, 296, 2, K, "SE0398 A0 SELFTEST 768X552 B/W/Y/R"},
    {16, 322, 1, K, "SCALE 1 BLACK: THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG 0123456789"},
    {16, 334, 1, R, "SCALE 1 RED:   THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG 0123456789"},
    {16, 346, 1, K, "1PX STROKES SHOULD LOOK CRISP - NO BLEED, NO GAPS - 12:34 56% 2026/10/02"},
    {16, 400, 2, K, "SCALE 2 BLACK 0123456789"},
    {16, 420, 2, R, "SCALE 2 RED ABCDEFGHIJKLM"},
    {16, 446, 3, K, "SCALE 3 NOPQRSTUVWXYZ"},
};
const TextLine YLINE = {16, 370, 1, Y, "SCALE 1 YELLOW ON BLACK: THE QUICK BROWN FOX 0123456789"};
const char *const PANEL_NAME = "SE0398";
#else  // EPD_PANEL_42_HINK_SSD1683
constexpr int BAND_H = 28, GAP = 4, HBAND_H = 16;
constexpr int YSTRIP_Y0 = 196, YSTRIP_Y1 = 212, GRID_Y0 = 252;
const TextLine LINES[] = {
    {8, 140, 2, K, "HINK 4.2 SELFTEST 400X300"},
    {8, 160, 1, K, "SCALE 1 BLACK: QUICK BROWN FOX 0123456789"},
    {8, 170, 1, R, "SCALE 1 RED:   QUICK BROWN FOX 0123456789"},
    {8, 180, 1, K, "1PX STROKES: CRISP, NO BLEED - 12:34 56%"},
    {8, 218, 2, K, "SCALE 2 0123456789"},
    {8, 236, 2, R, "SCALE 2 RED ABCXYZ"},
};
// Drawn with code 10 (yellow); the B/W/R driver must render it RED.
const TextLine YLINE = {8, 201, 1, Y, "CODE 10 (YELLOW) ON BLACK -> SHOULD BE RED"};
const char *const PANEL_NAME = "HINK 4.2";
#endif

constexpr int B1_Y0 = 8;
constexpr int B2_Y0 = B1_Y0 + BAND_H + GAP;
constexpr int B3_Y0 = B2_Y0 + BAND_H + GAP;
constexpr int B4_Y0 = B3_Y0 + BAND_H + GAP;

// Returns true and sets *out if (x,y) is a foreground pixel of the text line.
bool textPixel(const TextLine &t, int x, int y, uint8_t *out) {
    const int gh = 7 * t.scale;
    if (y < t.y || y >= t.y + gh) return false;
    const int advance = 6 * t.scale;  // 5 columns + 1 spacing
    if (x < t.x) return false;
    const int idx = (x - t.x) / advance;
    const int len = (int)strlen(t.text);
    if (idx >= len) return false;
    const int col = ((x - t.x) % advance) / t.scale;
    if (col >= 5) return false;
    const int row = (y - t.y) / t.scale;
    if (glyphFor(t.text[idx])[col] & (1 << row)) {
        *out = t.fg;
        return true;
    }
    return false;
}

// Four equal-width segments across the inner area.
inline int segment(int x) { return (x - 8) / ((W - 16) / 4); }

uint8_t pixelAt(int x, int y) {
    // 1px border
    if (x == 0 || x == W - 1 || y == 0 || y == H - 1) return K;

    // 1px diagonals across the full height. Each row covers [d0, d1) so the
    // line stays continuous when the slope is more than 1 px/row.
    const int d0 = (y * (W - 1)) / (H - 1);
    const int d1 = ((y + 1) * (W - 1)) / (H - 1);
    const int dEnd = d1 > d0 ? d1 : d0 + 1;
    if (x >= d0 && x < dEnd) return R;
    if ((W - 1) - x >= d0 && (W - 1) - x < dEnd) return K;

    // Middle marker: short yellow ticks on both edges around row H/2
    // (on SE0398 this is the seam between the two interleaved gate halves)
    if ((x < 6 || x > W - 7) && y >= H / 2 - 4 && y < H / 2 + 4) return Y;

    const bool inner = x >= 8 && x < W - 8;

    // Band 1: colour swatches K / W(outlined) / Y / R
    if (inner && y >= B1_Y0 && y < B1_Y0 + BAND_H) {
        switch (segment(x)) {
            case 0: return K;
            case 1: {
                const int sx0 = 8 + (W - 16) / 4, sx1 = 8 + 2 * (W - 16) / 4 - 1;
                return (x == sx0 || x == sx1 || y == B1_Y0 || y == B1_Y0 + BAND_H - 1) ? K : Wt;
            }
            case 2: return Y;
            default: return R;
        }
    }

    // Band 2: vertical line gratings
    if (inner && y >= B2_Y0 && y < B2_Y0 + BAND_H) {
        switch (segment(x)) {
            case 0: return (x % 2 == 0) ? K : Wt;   // 1 on / 1 off
            case 1: return (x % 3 == 0) ? K : Wt;   // 1 on / 2 off
            case 2: return (x % 4 < 2) ? K : Wt;    // 2 on / 2 off
            default: return (x % 2 == 0) ? R : Wt;  // red 1/1
        }
    }

    // Band 3: 1px checkerboards
    if (inner && y >= B3_Y0 && y < B3_Y0 + BAND_H) {
        const bool on = ((x + y) & 1) == 0;
        switch (segment(x)) {
            case 0: return on ? K : Wt;
            case 1: return on ? R : Wt;
            case 2: return on ? Y : Wt;
            default: return on ? K : Y;
        }
    }

    // Band 4: horizontal line gratings (adjacent rows)
    if (inner && y >= B4_Y0 && y < B4_Y0 + HBAND_H) {
        switch (segment(x)) {
            case 0: return (y % 2 == 0) ? K : Wt;
            case 1: return (y % 2 == 0) ? R : Wt;
            case 2: return (y % 2 == 0) ? Y : Wt;
            default: return (y % 3 == 0) ? K : Wt;
        }
    }

    // Text
    uint8_t c;
    if (y >= YSTRIP_Y0 && y < YSTRIP_Y1 && inner) {
        return textPixel(YLINE, x, y, &c) ? c : K;
    }
    for (const TextLine &t : LINES) {
        if (textPixel(t, x, y, &c)) return c;
    }

    // 1px grid (10px pitch) in the bottom area
    if (inner && y >= GRID_Y0 && y < H - 8) {
        if (x % 10 == 0 || y % 10 == 0) return K;
    }

    return Wt;
}

void packRow(int y, uint8_t *row) {
    for (int bx = 0; bx < W / 4; bx++) {
        const int x = bx * 4;
        row[bx] = (pixelAt(x, y) << 6) | (pixelAt(x + 1, y) << 4)
                | (pixelAt(x + 2, y) << 2) | pixelAt(x + 3, y);
    }
}

}  // namespace

void epdShowSelfTest() {
    Serial.printf("[SELFTEST] %s %dx%d test pattern\n", PANEL_NAME, W, H);
    const unsigned long t0 = millis();
#if defined(EPD_PANEL_398_SE0398NZ07A0)
    // Stream rows straight into the controller RAM.
    uint8_t row[W / 4];
    epdStreamBegin();
    for (int y = 0; y < H; y++) {
        packRow(y, row);
        epdStreamWriteRow(y, row);
    }
    Serial.printf("[SELFTEST] rows sent in %lums, refreshing\n", millis() - t0);
    epdStreamEnd();
#else
    // Build the 2bpp frame in colorBuf, then use the normal 2bpp display path
    // (which decodes colorBuf in place into black/red planes).
    if (!ensureColorBuf()) {
        Serial.println("[SELFTEST] colorBuf allocation failed");
        return;
    }
    for (int y = 0; y < H; y++) {
        packRow(y, colorBuf + y * (W / 4));
    }
    Serial.printf("[SELFTEST] frame built in %lums, sending + refreshing\n", millis() - t0);
    epdDisplay2bpp(colorBuf);
#endif
    Serial.printf("[SELFTEST] done in %lums\n", millis() - t0);
}

#endif  // EPD_SELFTEST && supported panel
