// ── SSD1680 4.2寸黑白红屏驱动 ─────────────────────────────────────────
// Panel: DKE DEPG0420RWS830F0, 400x300 black / white / red (SSD1680-class controller;
// typical 3-colour update 17 s at 23 C). Two ways to drive it:
//   EPD_PANEL_42_SSD1680_BW   B/W only, with LUTs written by the MCU instead of the panel's
//     OTP ones (the skeleton of the DKE DEPG0213RH reference sequence). They use only VSH1 /
//     VSL / VSS -- never VSH2, the red voltage -- so red is never drawn, and the refresh is
//     quick:
//       - FAST: the full transition phases, for the periodic full refresh (epdDisplay);
//       - SOFT: the same phases, weaker and shorter: less flashing, black still returns to
//         white -- the everyday refresh (epdDisplayFast) and what partial updates fall back to.
//   EPD_PANEL_42_SSD1680_BWR  black, white and red: the panel's own 3-colour waveform from
//     its OTP (display update 0xF7 loads it for the measured temperature), the red plane in
//     RAM 0x26 (1 = red). Frames are streamed row by row, no frame buffer.
// Ported from the user's ssd1680_native.cpp (command sequence, LUTs and frame layout as
// there: RAM entry X+ / Y-, cursor at the bottom row, each row written mirrored).
// BUSY is HIGH while the controller works.

#include "epd_driver.h"
#include "config.h"

#if defined(EPD_CONTROLLER_SSD1680)

#include <SPI.h>

#ifndef EPD_GXEPD2_SPI_HZ
#define EPD_GXEPD2_SPI_HZ 4000000
#endif

static_assert(EPD_WIDTH == 400 && EPD_HEIGHT == 300, "epd_driver_ssd1680.cpp: a 400x300 panel");

static const int kLineBytes = W / 8;

// 70 bytes of waveform (0x32), then VGH (0x03), VSH1/VSH2/VSL (0x04), dummy line (0x3A)
// and gate line width (0x3B).
static const uint8_t kFastLut[76] = {
    0x80, 0x60, 0x40, 0x00, 0x00, 0x00, 0x00,
    0x10, 0x60, 0x20, 0x00, 0x00, 0x00, 0x00,
    0x80, 0x60, 0x40, 0x00, 0x00, 0x00, 0x00,
    0x10, 0x60, 0x20, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x03, 0x03, 0x00, 0x00, 0x02,
    0x09, 0x09, 0x00, 0x00, 0x02,
    0x09, 0x09, 0x00, 0x00, 0x02,
    0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00,
    0x15, 0x41, 0xA8, 0x32, 0x30, 0x0A,
};

static const uint8_t kSoftLut[76] = {
    0x40, 0x20, 0x10, 0x00, 0x00, 0x00, 0x00,
    0x08, 0x20, 0x04, 0x00, 0x00, 0x00, 0x00,
    0x40, 0x20, 0x10, 0x00, 0x00, 0x00, 0x00,
    0x08, 0x20, 0x04, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x02, 0x02, 0x00, 0x00, 0x01,
    0x04, 0x04, 0x00, 0x00, 0x01,
    0x04, 0x04, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00,
    0x15, 0x41, 0xA8, 0x32, 0x18, 0x08,
};

// ── Hardware SPI helpers ─────────────────────────────────────────────

static void beginTransfer(bool data_mode) {
    digitalWrite(PIN_EPD_DC, data_mode ? HIGH : LOW);
    digitalWrite(PIN_EPD_CS, LOW);
    SPI.beginTransaction(SPISettings(EPD_GXEPD2_SPI_HZ, MSBFIRST, SPI_MODE0));
}

static void endTransfer() {
    SPI.endTransaction();
    digitalWrite(PIN_EPD_CS, HIGH);
}

static void sendCommand(uint8_t cmd) {
    beginTransfer(false);
    SPI.transfer(cmd);
    endTransfer();
}

static void sendData(uint8_t data) {
    beginTransfer(true);
    SPI.transfer(data);
    endTransfer();
}

// ── Busy / reset ─────────────────────────────────────────────────────

static unsigned long waitBusy(const char *what, unsigned long timeout_ms = 30000) {
    const unsigned long t0 = millis();
    while (digitalRead(PIN_EPD_BUSY) == HIGH) {
        delay(10);
        if (millis() - t0 > timeout_ms) {
            Serial.printf("[EPD-SSD1680] %s: busy timeout\n", what);
            break;
        }
    }
    return millis() - t0;
}

static void resetPanel() {
    digitalWrite(PIN_EPD_RST, HIGH);
    delay(2);
    digitalWrite(PIN_EPD_RST, LOW);
    delay(2);
    digitalWrite(PIN_EPD_RST, HIGH);
    delay(2);
}

// ── Init (after every reset: each refresh ends in deep sleep) ────────

static bool s_spiStarted = false;
static bool s_asleep = true;  // deep sleep (or not yet reset): only a reset wakes it

static void startSpi() {
    if (s_spiStarted) return;
    // MISO is not used, but on the C3 SPI.begin() with -1 ends in a bus error (see the
    // HINK driver): a free pin that is not the LED stands in for it.
#if defined(BOARD_PROFILE_ESP32_C3)
    SPI.begin(PIN_EPD_SCK, (PIN_LED == 3) ? 5 : 3, PIN_EPD_MOSI, PIN_EPD_CS);
#elif defined(BOARD_PROFILE_YD_ESP32_S3_N16R8)
    SPI.begin(PIN_EPD_SCK, 13, PIN_EPD_MOSI, PIN_EPD_CS);
#else
    SPI.begin(PIN_EPD_SCK, -1, PIN_EPD_MOSI, PIN_EPD_CS);
#endif
    s_spiStarted = true;
}

static void setCursorOrigin() {
    sendCommand(0x4E);  // X counter
    sendData(0x00);
    sendCommand(0x4F);  // Y counter: the bottom row (Y counts down)
    sendData((H - 1) & 0xFF);
    sendData(((H - 1) >> 8) & 0xFF);
}

static void loadLut(const uint8_t *lut) {
    sendCommand(0x2C);  // VCOM
    sendData(0x5A);
    sendCommand(0x03);  // gate voltage
    sendData(lut[70]);
    sendCommand(0x04);  // source voltages
    sendData(lut[71]);
    sendData(lut[72]);
    sendData(lut[73]);
    sendCommand(0x3A);  // dummy line period
    sendData(lut[74]);
    sendCommand(0x3B);  // gate line width
    sendData(lut[75]);
    sendCommand(0x32);  // waveform
    beginTransfer(true);
    for (int i = 0; i < 70; ++i) SPI.transfer(lut[i]);
    endTransfer();
}

// lut: the MCU's waveform; nullptr: the panel's OTP one (3-colour)
static void initPanel(const uint8_t *lut, const char *tag) {
    startSpi();
    resetPanel();
    const unsigned long resetBusy = waitBusy("reset", 5000);

    sendCommand(0x12);  // SW reset
    const unsigned long softResetBusy = waitBusy("sw reset", 5000);

    sendCommand(0x74);  // analog block control
    sendData(0x54);
    sendCommand(0x7E);  // digital block control
    sendData(0x3B);

    sendCommand(0x01);  // driver output: H gates
    sendData((H - 1) & 0xFF);
    sendData(((H - 1) >> 8) & 0xFF);
    sendData(0x00);

    // as the reference: X+, Y-, the cursor starting at the bottom row
    sendCommand(0x11);
    sendData(0x01);
    sendCommand(0x44);  // RAM X window
    sendData(0x00);
    sendData(kLineBytes - 1);
    sendCommand(0x45);  // RAM Y window: H-1 down to 0
    sendData((H - 1) & 0xFF);
    sendData(((H - 1) >> 8) & 0xFF);
    sendData(0x00);
    sendData(0x00);

    sendCommand(0x3C);  // border waveform: the GS transition of LUT1 (white)
    sendData(0x01);

    if (lut) {
        loadLut(lut);
    } else {
        // DEPG0420RWS830F0 spec: 0x2B "should be set" to 0x04 0x63 (fewer glitches when
        // VCOM toggles); the internal temperature sensor (POR: an external I2C one, which
        // the module may not have) picks the OTP waveform
        sendCommand(0x2B);
        sendData(0x04);
        sendData(0x63);
        sendCommand(0x18);
        sendData(0x80);
    }
    setCursorOrigin();
    delay(10);
    s_asleep = false;
    Serial.printf("[EPD-SSD1680] %s init busy reset=%lums soft_reset=%lums\n", tag, resetBusy, softResetBusy);
}

static inline uint8_t reverseBits(uint8_t v) {
    v = (uint8_t)(((v & 0xF0) >> 4) | ((v & 0x0F) << 4));
    v = (uint8_t)(((v & 0xCC) >> 2) | ((v & 0x33) << 2));
    v = (uint8_t)(((v & 0xAA) >> 1) | ((v & 0x55) << 1));
    return v;
}

#if !defined(EPD_PANEL_42_SSD1680_BWR)  // (B/W build: frames with the MCU LUTs)
// The 1bpp frame (1 = white) from its last row up, each row mirrored -- the reference's layout.
static void writeBwPlane(const uint8_t *image) {
    setCursorOrigin();
    sendCommand(0x24);
    beginTransfer(true);
    for (int row = H - 1; row >= 0; --row) {
        const uint8_t *src = image + row * kLineBytes;
        for (int b = kLineBytes - 1; b >= 0; --b) SPI.transfer(reverseBits(src[b]));
    }
    endTransfer();
}

static void writeColorPlaneWhite() {
    setCursorOrigin();
    sendCommand(0x26);
    beginTransfer(true);
    for (int i = 0; i < IMG_BUF_LEN; ++i) SPI.transfer(0xFF);
    endTransfer();
}

static void displayFullFrame(const uint8_t *image, const uint8_t *lut, const char *tag) {
    initPanel(lut, tag);
    writeBwPlane(image);
    writeColorPlaneWhite();
    sendCommand(0x22);  // display mode 1 with the LUT loaded above
    sendData(0xC7);
    sendCommand(0x20);
    const unsigned long busy = waitBusy("refresh", 60000);
    delay(100);
    Serial.printf("[EPD-SSD1680] %s display busy=%lums\n", tag, busy);
    sendCommand(0x10);  // deep sleep: only a reset wakes it again
    sendData(0x01);
    delay(100);
    s_asleep = true;
}
#endif

#if defined(EPD_PANEL_42_SSD1680_BWR)
// ── 3-colour frames ──────────────────────────────────────────────────
// Each 2bpp row (00 black, 01 white, 10 / 11 red) goes to its own row of both RAMs,
// mirrored as the B/W frames are: RAM byte b of row r holds image bytes W/8-1-b, bits
// reversed. The RAM counts Y down (X+ / Y-), so a one-row window is [r, r].

static void setRow(int row) {
    sendCommand(0x45);  // RAM Y window: this row only
    sendData(row & 0xFF);
    sendData((row >> 8) & 0xFF);
    sendData(row & 0xFF);
    sendData((row >> 8) & 0xFF);
    sendCommand(0x4E);
    sendData(0x00);
    sendCommand(0x4F);
    sendData(row & 0xFF);
    sendData((row >> 8) & 0xFF);
}

static void writeRow2bpp(int row, const uint8_t *row2bpp) {
    uint8_t black[kLineBytes], red[kLineBytes];
    for (int i = 0; i < kLineBytes; i++) {
        uint8_t k = 0xFF, r = 0x00;  // black plane: 1 = white; red plane: 1 = red
        for (int px = 0; px < 8; px++) {
            const uint8_t code = (row2bpp[i * 2 + px / 4] >> (6 - (px % 4) * 2)) & 0x03;
            if (code == 0x00) k &= ~(0x80 >> px);
            else if (code >= 0x02) r |= 0x80 >> px;
        }
        black[i] = k;
        red[i] = r;
    }
    setRow(row);
    sendCommand(0x24);
    beginTransfer(true);
    for (int b = kLineBytes - 1; b >= 0; --b) SPI.transfer(reverseBits(black[b]));
    endTransfer();
    setRow(row);
    sendCommand(0x26);
    beginTransfer(true);
    for (int b = kLineBytes - 1; b >= 0; --b) SPI.transfer(reverseBits(red[b]));
    endTransfer();
}

static void refreshColour() {
    // clock, analog on, load the temperature, load the OTP waveform, display, analog and
    // clock off: the spec's 0x90 (load LUT) and 0x47 (display) in one, with the temperature
    sendCommand(0x22);
    sendData(0xF7);
    sendCommand(0x20);
    const unsigned long busy = waitBusy("refresh", 60000);
    Serial.printf("[EPD-SSD1680] 3-colour display busy=%lums\n", busy);
    sendCommand(0x10);  // deep sleep
    sendData(0x01);
    delay(100);
    s_asleep = true;
}

bool epdStreamBegin() {
    initPanel(nullptr, "BWR");
    return true;
}

void epdStreamWriteRow(int imageRow, const uint8_t *row2bpp) {
    writeRow2bpp(imageRow, row2bpp);
}

void epdStreamEnd() {
    refreshColour();
}

void epdStreamAbort() {}  // (the next frame starts with a reset)

#if defined(EPD_COLOR_PAGED)
#include <LittleFS.h>
void epdDisplay2bppPaged(const char *path) {
    File f = LittleFS.open(path, "r");
    if (!f) {
        Serial.println("[EPD-SSD1680] color file missing");
        return;
    }
    epdStreamBegin();
    uint8_t row[W / 4];
    for (int r = 0; r < H; r++) {
        if (f.read(row, sizeof row) != sizeof row) memset(row, 0x55, sizeof row);  // (white)
        writeRow2bpp(r, row);
    }
    f.close();
    epdStreamEnd();
}
#endif
#endif  // EPD_PANEL_42_SSD1680_BWR

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

#if defined(EPD_PANEL_42_SSD1680_BWR)
// 3-colour build: every frame with the panel's own waveform, B/W screens (setup, errors,
// imgBuf) too -- the MCU LUTs never drive red, so they could leave the red of an earlier
// frame on the panel.

void epdInit() {
    initPanel(nullptr, "BWR");
}

void epdInitFast() {
    epdInit();
}

void epdDisplay(const uint8_t *image) {
    static const uint8_t NIBBLE_TO_2BPP[16] = {
        0x00, 0x01, 0x04, 0x05, 0x10, 0x11, 0x14, 0x15, 0x40, 0x41, 0x44, 0x45, 0x50, 0x51, 0x54, 0x55};
    epdStreamBegin();
    uint8_t row[W / 4];
    for (int r = 0; r < H; r++) {
        const uint8_t *src = image + r * kLineBytes;
        for (int i = 0; i < kLineBytes; i++) {
            row[i * 2] = NIBBLE_TO_2BPP[src[i] >> 4];
            row[i * 2 + 1] = NIBBLE_TO_2BPP[src[i] & 0x0F];
        }
        writeRow2bpp(r, row);
    }
    epdStreamEnd();
}

void epdDisplayFast(const uint8_t *image) {
    epdDisplay(image);
}

void epdDisplay2bpp(const uint8_t *image2bpp) {
    epdStreamBegin();
    for (int r = 0; r < H; r++) writeRow2bpp(r, image2bpp + r * (W / 4));
    epdStreamEnd();
}
#else
void epdInit() {
    initPanel(kFastLut, "FAST");
}

void epdInitFast() {
    initPanel(kSoftLut, "SOFT");
}

// The periodic full refresh: the full-strength LUT clears ghosting.
void epdDisplay(const uint8_t *image) {
    displayFullFrame(image, kFastLut, "FAST");
}

// The everyday refresh: the lighter LUT, less flashing.
void epdDisplayFast(const uint8_t *image) {
    displayFullFrame(image, kSoftLut, "SOFT");
}

// A 2bpp frame in the B/W build: white stays white, everything else is black (as the
// server draws red and yellow for B/W panels).
void epdDisplay2bpp(const uint8_t *image2bpp) {
    for (int i = 0; i < IMG_BUF_LEN; i++) {
        uint8_t b = 0;
        for (int px = 0; px < 8; px++) {
            const uint8_t code = (image2bpp[i * 2 + px / 4] >> (6 - (px % 4) * 2)) & 0x03;
            if (code == 0x01) b |= 0x80 >> px;
        }
        imgBuf[i] = b;
    }
    epdDisplay(imgBuf);
}
#endif

// No partial refresh (the reference has it disabled): the whole screen (imgBuf, which the
// callers draw into first) -- with the lighter LUT in the B/W build.
bool epdSupportsPartialRefresh() {
    return false;
}

void epdPartialDisplayWithOld(uint8_t *data, const uint8_t *oldData, int xStart, int yStart, int xEnd, int yEnd) {
    (void)oldData;
    epdPartialDisplay(data, xStart, yStart, xEnd, yEnd);
}

void epdPartialDisplay(uint8_t *data, int xStart, int yStart, int xEnd, int yEnd) {
    (void)data; (void)xStart; (void)yStart; (void)xEnd; (void)yEnd;
    epdDisplayFast(imgBuf);
}

void epdSleep() {
    // every refresh already ends in deep sleep
    if (s_asleep) return;
    sendCommand(0x10);
    sendData(0x01);
    delay(100);
    s_asleep = true;
}

#endif  // EPD_CONTROLLER_SSD1680
