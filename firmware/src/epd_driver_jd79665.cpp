// ── JD79665 黑白黄红四色屏驱动 ─────────────────────────────────────────
// Controller: JD79665 (black/white/yellow/red, 2 bits per pixel in the controller)
//   EPD_PANEL_75_JD79665    7.5" 800x480 (Good Display GDEM075F52)
//   EPD_PANEL_583_JD79665   5.83" 648x480
// Ported from EPD-nRF5 (UC81xx.c, GPL-3.0). Not yet checked on hardware here.
//
// The controller takes the server's 2bpp codes as they are (00 black, 01 white,
// 10 yellow, 11 red), in order through DTM1, so frames are streamed row by row with no
// frame buffer. BUSY is LOW while the controller works.

#include "epd_driver.h"
#include "config.h"

#if defined(EPD_CONTROLLER_JD79665)

#include <SPI.h>
#if defined(EPD_COLOR_PAGED)
#include <LittleFS.h>
#endif

#ifndef EPD_GXEPD2_SPI_HZ
#define EPD_GXEPD2_SPI_HZ 4000000
#endif

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

static void sendCommandData(uint8_t cmd, std::initializer_list<uint8_t> data) {
    sendCommand(cmd);
    beginTransfer(true);
    for (uint8_t d : data) SPI.transfer(d);
    endTransfer();
}

// ── Busy / reset ─────────────────────────────────────────────────────

static void waitBusy(const char *what, unsigned long timeout_ms = 30000) {
    delay(5);
    const unsigned long t0 = millis();
    while (digitalRead(PIN_EPD_BUSY) == LOW) {
        delay(5);
        if (millis() - t0 > timeout_ms) {
            Serial.printf("[EPD-JD79665] %s: busy timeout\n", what);
            return;
        }
    }
    if (millis() - t0 > 100) Serial.printf("[EPD-JD79665] %s: busy %lums\n", what, millis() - t0);
}

static void hardwareReset() {
    digitalWrite(PIN_EPD_RST, HIGH);
    delay(50);
    digitalWrite(PIN_EPD_RST, LOW);
    delay(50);
    digitalWrite(PIN_EPD_RST, HIGH);
    delay(50);
    waitBusy("reset", 5000);
}

// ── Controller init (after every reset: each refresh ends in deep sleep) ──

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

// Partial window 0x83 over the whole panel (x/y start and end, inclusive; mode 1).
static void setFullWindow() {
    sendCommandData(0x83, {0x00, 0x00, (uint8_t)((W - 1) >> 8), (uint8_t)((W - 1) & 0xFF),
                           0x00, 0x00, (uint8_t)((H - 1) >> 8), (uint8_t)((H - 1) & 0xFF), 0x01});
}

static void controllerInit() {
    startSpi();
    hardwareReset();
    sendCommandData(0x4D, {0x78});
    sendCommandData(0x00, {0x2F, 0x29});                    // PSR
    sendCommandData(0x06, {0x0F, 0x8B, 0x93, 0xA1});        // BTST
    sendCommandData(0x41, {0x00});                          // TSE
    sendCommandData(0x50, {0x37});                          // CDI
    sendCommandData(0x60, {0x02, 0x02});                    // TCON
    sendCommandData(0x61, {(uint8_t)(W >> 8), (uint8_t)(W & 0xFF), (uint8_t)(H >> 8), (uint8_t)(H & 0xFF)});  // TRES
    sendCommandData(0x62, {0x98, 0x98, 0x98, 0x75, 0xCA, 0xB2, 0x98, 0x7E});
#if defined(EPD_PANEL_75_JD79665)
    sendCommandData(0x65, {0x00, 0x00, 0x00, 0x00});        // GSST
#else
    sendCommandData(0x65, {0x00, 0x10, 0x00, 0x00});        // GSST (5.83", as EPD-nRF5)
#endif
    sendCommandData(0xE7, {0x1C});
    sendCommandData(0xE3, {0x00});                          // PWS
    sendCommandData(0xE9, {0x01});
    sendCommandData(0x30, {0x08});                          // PLL
    sendCommand(0x04);                                      // PON
    waitBusy("PON", 5000);
    s_asleep = false;
}

// ── Refresh, then deep sleep ─────────────────────────────────────────

static void refreshAndSleep() {
    Serial.println("[EPD-JD79665] refresh");
    setFullWindow();
    sendCommandData(0x12, {0x00});                          // DRF
    waitBusy("DRF", 60000);
    sendCommandData(0x02, {0x00});                          // POF
    waitBusy("POF", 5000);
    delay(100);
    sendCommandData(0x07, {0xA5});                          // DSLP: only a reset wakes it again
    s_asleep = true;
}

// ── Frame writing ────────────────────────────────────────────────────

static void frameBegin() {
    controllerInit();
    setFullWindow();
    sendCommand(0x10);                                      // DTM1: the 2bpp frame, in order
}

static void frameWriteRow2bpp(const uint8_t *row2bpp) {
    beginTransfer(true);
    for (int i = 0; i < W / 4; i++) SPI.transfer(row2bpp[i]);
    endTransfer();
}

// 1bpp (1 = white, MSB first) -> 2bpp black (00) / white (01).
static void frameWriteRow1bpp(const uint8_t *row1bpp) {
    static const uint8_t NIBBLE_TO_2BPP[16] = {
        0x00, 0x01, 0x04, 0x05, 0x10, 0x11, 0x14, 0x15, 0x40, 0x41, 0x44, 0x45, 0x50, 0x51, 0x54, 0x55};
    beginTransfer(true);
    for (int i = 0; i < W / 8; i++) {
        SPI.transfer(NIBBLE_TO_2BPP[row1bpp[i] >> 4]);
        SPI.transfer(NIBBLE_TO_2BPP[row1bpp[i] & 0x0F]);
    }
    endTransfer();
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
    controllerInit();
}

void epdInitFast() {
    epdInit();
}

void epdDisplay(const uint8_t *image) {
    frameBegin();
    for (int r = 0; r < H; r++) frameWriteRow1bpp(image + r * (W / 8));
    refreshAndSleep();
}

void epdDisplayFast(const uint8_t *image) {
    epdDisplay(image);
}

void epdDisplay2bpp(const uint8_t *image2bpp) {
    frameBegin();
    for (int r = 0; r < H; r++) frameWriteRow2bpp(image2bpp + r * (W / 4));
    refreshAndSleep();
}

#if defined(EPD_COLOR_PAGED)
void epdDisplay2bppPaged(const char *path) {
    File f = LittleFS.open(path, "r");
    if (!f) {
        Serial.println("[EPD-JD79665] color file missing");
        return;
    }
    frameBegin();
    uint8_t row[W / 4];
    for (int r = 0; r < H; r++) {
        if (f.read(row, sizeof row) != sizeof row) memset(row, 0x55, sizeof row);  // (white)
        frameWriteRow2bpp(row);
    }
    f.close();
    refreshAndSleep();
}
#endif

#if EPD_STREAMS_FRAMES
// ── Streaming frame API ──────────────────────────────────────────────
// Rows go straight into DTM1 in order; every row 0..H-1 once between Begin and End.

bool epdStreamBegin() {
    frameBegin();
    return true;
}

void epdStreamWriteRow(int imageRow, const uint8_t *row2bpp) {
    (void)imageRow;  // (rows arrive in order)
    frameWriteRow2bpp(row2bpp);
}

void epdStreamEnd() {
    refreshAndSleep();
}

void epdStreamAbort() {}  // (the next frame starts with a reset)
#endif

// No partial refresh on these panels (colour builds never ask for one).
void epdPartialDisplayWithOld(uint8_t *data, const uint8_t *oldData, int xStart, int yStart, int xEnd, int yEnd) {
    (void)oldData;
    epdPartialDisplay(data, xStart, yStart, xEnd, yEnd);
}

void epdPartialDisplay(uint8_t *data, int xStart, int yStart, int xEnd, int yEnd) {
    (void)data; (void)xStart; (void)yStart; (void)xEnd; (void)yEnd;
}

void epdSleep() {
    // every refresh already ends in deep sleep
    if (s_asleep) return;
    sendCommandData(0x02, {0x00});
    waitBusy("POF", 5000);
    sendCommandData(0x07, {0xA5});
    s_asleep = true;
}

#endif  // EPD_CONTROLLER_JD79665
