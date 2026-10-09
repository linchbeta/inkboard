// ── SSD1680 4.2寸黑白屏驱动（自带 LUT）────────────────────────────────
// Panel: 400x300 B/W on an SSD1680-class controller (EPD_PANEL_42_SSD1680_BW), driven with
// LUTs written by the MCU instead of the panel's OTP ones (the skeleton of the DKE
// DEPG0213RH reference sequence):
//   - FAST: the full transition phases, for the periodic full refresh (epdDisplay);
//   - SOFT: the same phases, weaker and shorter: less flashing, black still returns to
//     white -- the everyday refresh (epdDisplayFast) and what partial updates fall back to.
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

    sendCommand(0x3C);  // border waveform
    sendData(0x01);

    loadLut(lut);
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

// A 2bpp frame on this B/W panel: white stays white, everything else is black (as the
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

// No partial refresh (the reference has it disabled): the whole screen (imgBuf, which the
// callers draw into first) with the lighter LUT.
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
