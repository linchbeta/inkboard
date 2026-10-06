// ── UC8179 通用驱动 ───────────────────────────────────────────────────
// Controller: UC8179 (Ultrachip)
// Supported panels (via EPD_CONTROLLER_UC8179 in config.h):
//   EPD_PANEL_583_UC8179  — Waveshare 5.83" V2 BWR  648×480
//   EPD_PANEL_75_GDEY075Z08 — Good Display 7.5" BWR 800×480
// Resolution comes from W/H macros (EPD_WIDTH/EPD_HEIGHT in build flags).
// Color polarity: default active-low (UC8179 spec). Add -DEPD_COLOR_ACTIVE_HIGH
// to build_flags if your panel wiring is inverted.

#include "epd_driver.h"
#include "config.h"

#if defined(EPD_CONTROLLER_UC8179)

#include <SPI.h>

#ifndef EPD_GXEPD2_SPI_HZ
#define EPD_GXEPD2_SPI_HZ 4000000
#endif

static bool uc8179_initialized = false;

// ── Color plane polarity ─────────────────────────────────────────────
// UC8179 DTM2 (0x13) is active-low: 0 = colored, 1 = no color.
// Add -DEPD_COLOR_ACTIVE_HIGH to build_flags if your panel is wired opposite.
#ifdef EPD_COLOR_ACTIVE_HIGH
  #define COLOR_FILL_BLANK   0x00
  #define COLOR_SET_PIXEL(b, mask)  ((b) |= (mask))
#else
  #define COLOR_FILL_BLANK   0xFF
  #define COLOR_SET_PIXEL(b, mask)  ((b) &= ~(mask))
#endif

// ── Hardware SPI helpers ─────────────────────────────────────────────

static void uc8179BeginTransfer(bool data_mode) {
    digitalWrite(PIN_EPD_DC, data_mode ? HIGH : LOW);
    digitalWrite(PIN_EPD_CS, LOW);
    SPI.beginTransaction(SPISettings(EPD_GXEPD2_SPI_HZ, MSBFIRST, SPI_MODE0));
}

static void uc8179EndTransfer() {
    SPI.endTransaction();
    digitalWrite(PIN_EPD_CS, HIGH);
}

static void epdSendCommand(uint8_t cmd) {
    uc8179BeginTransfer(false);
    SPI.transfer(cmd);
    uc8179EndTransfer();
}

static void epdSendData(uint8_t data) {
    uc8179BeginTransfer(true);
    SPI.transfer(data);
    uc8179EndTransfer();
}

// ── Busy wait / Reset ────────────────────────────────────────────────

static void epdWaitBusy(unsigned long timeout_ms = 30000) {
    const unsigned long t0 = millis();
    while (digitalRead(PIN_EPD_BUSY) == LOW) {
        delay(10);
        if (millis() - t0 > timeout_ms) {
            Serial.println("[EPD-UC8179] busy timeout");
            return;
        }
    }
}

static void epdReset() {
    digitalWrite(PIN_EPD_RST, HIGH);
    delay(10);
    digitalWrite(PIN_EPD_RST, LOW);
    delay(10);
    digitalWrite(PIN_EPD_RST, HIGH);
    delay(10);
}

// ── Power control ────────────────────────────────────────────────────

static void uc8179PowerOn() {
    epdSendCommand(0x04);
    epdWaitBusy(500);
}

static void uc8179PowerOff() {
    epdSendCommand(0x02);
    epdWaitBusy(500);
}

// ── Window address (0x90) ────────────────────────────────────────────

static void uc8179WriteWindow(uint16_t x, uint16_t y, uint16_t w, uint16_t h) {
    const uint16_t xe = (x + w - 1) | 0x0007;
    const uint16_t ye = y + h - 1;
    x &= 0xFFF8;

    epdSendCommand(0x90);
    epdSendData(x >> 8);
    epdSendData(x & 0xFF);
    epdSendData(xe >> 8);
    epdSendData(xe & 0xFF);
    epdSendData(y >> 8);
    epdSendData(y & 0xFF);
    epdSendData(ye >> 8);
    epdSendData(ye & 0xFF);
    epdSendData(0x00);
}

// ── Controller init (runs once, guarded by flag) ─────────────────────

static void uc8179InitController() {
    if (uc8179_initialized) return;

    SPI.begin(PIN_EPD_SCK, -1, PIN_EPD_MOSI, PIN_EPD_CS);

    epdReset();

    epdSendCommand(0x01);  // PWRSET
    epdSendData(0x07);
    epdSendData(0x07);
    epdSendData(0x3F);
    epdSendData(0x3F);

    epdSendCommand(0x00);  // PSR
    epdSendData(0x0F);

    epdSendCommand(0x61);  // TRES: use runtime W/H instead of hardcoded values
    epdSendData(W >> 8);
    epdSendData(W & 0xFF);
    epdSendData(H >> 8);
    epdSendData(H & 0xFF);

    epdSendCommand(0x15);  // DUSPI
    epdSendData(0x00);

    epdSendCommand(0x50);  // CDI: border & data interval
#if defined(EPD_PANEL_75_GDEY075Z08)
    epdSendData(0x57);  // GDEY075Z08 reference value (white border, correct polarity)
#else
    epdSendData(0x77);  // default for 5.83" and others
#endif

    epdSendCommand(0x60);  // TCON
    epdSendData(0x22);

    uc8179_initialized = true;
}

// ── Plane write: one batched SPI transaction for the whole plane ─────

static void uc8179WritePlane(uint8_t command, const uint8_t *buffer, uint8_t fill) {
    epdSendCommand(command);
    uc8179BeginTransfer(true);
    for (int i = 0; i < IMG_BUF_LEN; i++) {
        SPI.transfer(buffer ? buffer[i] : fill);
    }
    uc8179EndTransfer();
}

// ── Write image data (full-screen, no PTIN/PTOUT) ────────────────────
// UC8179 full-screen update: write DTM1/DTM2 directly without partial
// enter/exit. PTIN (0x91) is for sub-region partial updates only; wrapping
// a full-panel write in PTIN can cause border pixels to be skipped on
// panels like GDEY075Z08 that enforce the partial-window area strictly.

static void uc8179WriteImage(const uint8_t *black_plane, const uint8_t *color_plane) {
    uc8179WritePlane(0x10, black_plane, 0xFF);       // DTM1: black plane
    uc8179WritePlane(0x13, color_plane, COLOR_FILL_BLANK);  // DTM2: color plane
}

// ── Refresh: power on → trigger → wait → power off ──────────────────
// No window command (0x90) here: 0x90 is PTWIN and belongs inside
// PTIN/PTOUT context. Issuing it before DRF outside that context caused
// the 7.5" GDEY075Z08 to restrict the refresh area, producing black borders.

static void uc8179Refresh() {
    uc8179PowerOn();
    epdSendCommand(0x12);
    delay(100);
    epdWaitBusy(30000);
    uc8179PowerOff();
}

// ── Full display pipeline ─────────────────────────────────────────────

static void epdDisplayPreparedPlanes(const uint8_t *black_plane, const uint8_t *color_plane) {
    uc8179InitController();
    uc8179WriteImage(black_plane, color_plane);
    uc8179Refresh();
}

// ── GPIO initialization ──────────────────────────────────────────────

void gpioInit() {
    pinMode(PIN_EPD_BUSY, INPUT);
    pinMode(PIN_EPD_RST, OUTPUT);
    pinMode(PIN_EPD_DC, OUTPUT);
    pinMode(PIN_EPD_CS, OUTPUT);
    pinMode(PIN_EPD_SCK, OUTPUT);
    pinMode(PIN_EPD_MOSI, OUTPUT);
    pinMode(PIN_CFG_BTN, INPUT_PULLUP);
    digitalWrite(PIN_EPD_RST, HIGH);
    digitalWrite(PIN_EPD_CS, HIGH);
    digitalWrite(PIN_EPD_SCK, LOW);
}

// ── Public EPD interface ─────────────────────────────────────────────

void epdInit() {
    uc8179InitController();
}

void epdInitFast() {
    epdInit();
}

void epdDisplay(const uint8_t *image) {
#if EPD_BPP >= 2 && !defined(EPD_COLOR_PAGED)
    epdDisplayPreparedPlanes(image, colorBuf);
#else
    epdDisplayPreparedPlanes(image, nullptr);
#endif
}

// ── 2bpp decode + display ─────────────────────────────────────────────
// Encoding: 00=black, 01=white, 10=red, 11=yellow (shown as red)
// Black plane: 0=black (active low).  Color plane: 1=colored (active high).

#if EPD_BPP >= 2 && !defined(EPD_COLOR_PAGED)

static uint8_t *epdColorPlaneBuffer() {
    return colorBuf + IMG_BUF_LEN;
}

// Decodes raw2bpp into separate black and color planes.
// Iterates in reverse so color_plane (colorBuf+IMG_BUF_LEN) doesn't
// overwrite raw2bpp (colorBuf) before it's read.
static void decodeRaw2bppToTriColorPlanes(const uint8_t *raw2bpp,
                                           uint8_t *black_plane,
                                           uint8_t *color_plane) {
    for (int out = IMG_BUF_LEN - 1; out >= 0; out--) {
        const uint8_t src0 = raw2bpp[out * 2];
        const uint8_t src1 = raw2bpp[out * 2 + 1];
        uint8_t black_byte = 0xFF;
        uint8_t color_byte = COLOR_FILL_BLANK;

        for (int px = 0; px < 4; px++) {
            const uint8_t code = (src0 >> (6 - px * 2)) & 0x03;
            const uint8_t mask = 0x80 >> px;
            if (code == 0x00) black_byte &= ~mask;
            else if (code >= 0x02) COLOR_SET_PIXEL(color_byte, mask);
        }
        for (int px = 0; px < 4; px++) {
            const uint8_t code = (src1 >> (6 - px * 2)) & 0x03;
            const uint8_t mask = 0x08 >> px;
            if (code == 0x00) black_byte &= ~mask;
            else if (code >= 0x02) COLOR_SET_PIXEL(color_byte, mask);
        }

        black_plane[out] = black_byte;
        color_plane[out] = color_byte;
    }
}

void epdDisplay2bpp(const uint8_t *image2bpp) {
    decodeRaw2bppToTriColorPlanes(image2bpp, imgBuf, epdColorPlaneBuffer());
    epdDisplayPreparedPlanes(imgBuf, epdColorPlaneBuffer());
}

#else

// Fallback when colorBuf is unavailable: two-pass on-the-fly decode.
void epdDisplay2bpp(const uint8_t *image2bpp) {
    uc8179InitController();
    uc8179WriteImage(nullptr, nullptr);
    uc8179Refresh();

    epdSendCommand(0x91);
    uc8179WriteWindow(0, 0, W, H);

    epdSendCommand(0x10);
    uc8179BeginTransfer(true);
    for (int i = 0; i < IMG_BUF_LEN; i++) {
        uint8_t bk = 0xFF;
        for (int px = 0; px < 4; px++) {
            const uint8_t code = (image2bpp[i * 2] >> (6 - px * 2)) & 0x03;
            if (code == 0x00) bk &= ~(0x80 >> px);
        }
        for (int px = 0; px < 4; px++) {
            const uint8_t code = (image2bpp[i * 2 + 1] >> (6 - px * 2)) & 0x03;
            if (code == 0x00) bk &= ~(0x08 >> px);
        }
        SPI.transfer(bk);
    }
    uc8179EndTransfer();

    epdSendCommand(0x13);
    uc8179BeginTransfer(true);
    for (int i = 0; i < IMG_BUF_LEN; i++) {
        uint8_t rd = COLOR_FILL_BLANK;
        for (int px = 0; px < 4; px++) {
            const uint8_t code = (image2bpp[i * 2] >> (6 - px * 2)) & 0x03;
            if (code >= 0x02) COLOR_SET_PIXEL(rd, (0x80 >> px));
        }
        for (int px = 0; px < 4; px++) {
            const uint8_t code = (image2bpp[i * 2 + 1] >> (6 - px * 2)) & 0x03;
            if (code >= 0x02) COLOR_SET_PIXEL(rd, (0x08 >> px));
        }
        SPI.transfer(rd);
    }
    uc8179EndTransfer();

    epdSendCommand(0x92);
    uc8179Refresh();
}

#endif  // EPD_BPP >= 2 && !EPD_COLOR_PAGED

// ── Paged 2bpp display (reads from LittleFS, no colorBuf needed) ─────

#if defined(EPD_COLOR_PAGED)
#include <LittleFS.h>
#define EPD_COLOR_PAGE 512

void epdDisplay2bppPaged(const char *path) {
    File f = LittleFS.open(path, "r");
    if (!f) {
        Serial.println("[EPD-UC8179] color file missing, BW fallback");
        epdDisplay(imgBuf);
        return;
    }

    uc8179InitController();

    uint8_t pageBuf[EPD_COLOR_PAGE];

    // Pass 1: black plane — hold CS for the entire plane (matches uc8179WritePlane)
    epdSendCommand(0x10);
    f.seek(0);
    uc8179BeginTransfer(true);
    while (f.available()) {
        const int n = f.read(pageBuf, sizeof(pageBuf));
        for (int i = 0; i + 1 < n; i += 2) {
            uint8_t bk = 0xFF;
            for (int px = 0; px < 4; px++) {
                const uint8_t code = (pageBuf[i] >> (6 - px * 2)) & 0x03;
                if (code == 0x00) bk &= ~(0x80 >> px);
            }
            for (int px = 0; px < 4; px++) {
                const uint8_t code = (pageBuf[i + 1] >> (6 - px * 2)) & 0x03;
                if (code == 0x00) bk &= ~(0x08 >> px);
            }
            SPI.transfer(bk);
        }
    }
    uc8179EndTransfer();

    // Pass 2: color plane — same single-CS-assertion approach
    epdSendCommand(0x13);
    f.seek(0);
    uc8179BeginTransfer(true);
    while (f.available()) {
        const int n = f.read(pageBuf, sizeof(pageBuf));
        for (int i = 0; i + 1 < n; i += 2) {
            uint8_t rd = COLOR_FILL_BLANK;
            for (int px = 0; px < 4; px++) {
                const uint8_t code = (pageBuf[i] >> (6 - px * 2)) & 0x03;
                if (code >= 0x02) COLOR_SET_PIXEL(rd, (0x80 >> px));
            }
            for (int px = 0; px < 4; px++) {
                const uint8_t code = (pageBuf[i + 1] >> (6 - px * 2)) & 0x03;
                if (code >= 0x02) COLOR_SET_PIXEL(rd, (0x08 >> px));
            }
            SPI.transfer(rd);
        }
    }
    uc8179EndTransfer();

    f.close();
    uc8179Refresh();
}
#endif  // EPD_COLOR_PAGED

// ── Streaming frame API ──────────────────────────────────────────────
// DTM1 takes the black plane sequentially, so each arriving 2bpp row's black bytes go
// straight to the controller (same bytes as epdDisplay2bppPaged's pass 1); its colour
// bytes are kept in RAM (W*H/8) and sent as DTM2 at the end (pass 2), then refresh.

static uint8_t *s_streamColor = nullptr;

bool epdStreamBegin() {
    if (!s_streamColor) s_streamColor = (uint8_t *)malloc(IMG_BUF_LEN);
    if (!s_streamColor) {
        Serial.println("[EPD-UC8179] no memory for streaming");
        return false;
    }
    uc8179InitController();
    epdSendCommand(0x10);  // DTM1: black plane, rows follow
    return true;
}

void epdStreamWriteRow(int imageRow, const uint8_t *row2bpp) {
    uint8_t *color = s_streamColor + imageRow * (W / 8);
    uc8179BeginTransfer(true);
    for (int i = 0; i < W / 8; i++) {
        uint8_t bk = 0xFF, rd = COLOR_FILL_BLANK;
        for (int px = 0; px < 4; px++) {
            const uint8_t code = (row2bpp[i * 2] >> (6 - px * 2)) & 0x03;
            if (code == 0x00) bk &= ~(0x80 >> px);
            else if (code >= 0x02) COLOR_SET_PIXEL(rd, (0x80 >> px));
        }
        for (int px = 0; px < 4; px++) {
            const uint8_t code = (row2bpp[i * 2 + 1] >> (6 - px * 2)) & 0x03;
            if (code == 0x00) bk &= ~(0x08 >> px);
            else if (code >= 0x02) COLOR_SET_PIXEL(rd, (0x08 >> px));
        }
        SPI.transfer(bk);
        color[i] = rd;
    }
    uc8179EndTransfer();
}

void epdStreamEnd() {
    if (!s_streamColor) return;
    uc8179WritePlane(0x13, s_streamColor, COLOR_FILL_BLANK);  // DTM2: colour plane
    epdStreamAbort();
    uc8179Refresh();
}

void epdStreamAbort() {
    free(s_streamColor);
    s_streamColor = nullptr;
}

// ── Stubs ────────────────────────────────────────────────────────────

void epdDisplayFast(const uint8_t *image) {
    epdDisplay(image);
}

// No old-frame differential support on this controller; plain partial refresh.
void epdPartialDisplayWithOld(uint8_t *data, const uint8_t *oldData, int xStart, int yStart, int xEnd, int yEnd) {
    (void)oldData;
    epdPartialDisplay(data, xStart, yStart, xEnd, yEnd);
}

void epdPartialDisplay(uint8_t *data, int xStart, int yStart, int xEnd, int yEnd) {
    (void)data; (void)xStart; (void)yStart; (void)xEnd; (void)yEnd;
#if !defined(EPD_COLOR_PAGED)
    // EPD_COLOR_PAGED builds have no BW imgBuf equivalent of the color content,
    // so skip the BW overwrite that would erase the color plane.
    epdDisplay(imgBuf);
#endif
}

void epdSleep() {
    if (!uc8179_initialized) return;
    uc8179PowerOff();
    epdSendCommand(0x07);
    epdSendData(0xA5);
    delay(20);
    uc8179_initialized = false;
}

#endif  // EPD_CONTROLLER_UC8179
