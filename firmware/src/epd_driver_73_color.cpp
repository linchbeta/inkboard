// ── 7.3寸七色 / 六色屏驱动 ─────────────────────────────────────────────
// Panels:
//   EPD_PANEL_73_ACEP         7.3" ACeP 7-colour 800x480 (Waveshare 7.3" F, GDEY073D46)
//   EPD_PANEL_73_SPECTRA6     7.3" Spectra 6 800x480 (Waveshare 7.3" E, GDEP073E01)
// Their makers do not name the controller. The init is nearly command for command the
// 3.98" A1's (JD79661: 0xAA 49 55 20 08 09 18, BTST1-3, PFS, PWS...), so most likely a
// JD7966x part. 4 bits per pixel in
// the controller; the whole frame goes in order through DTM1 (0x10), two pixels per byte,
// high nibble first. Init as the Waveshare references (epd7in3f / epd7in3e). Not checked
// on hardware here yet.
//
// The frame arrives as 2bpp codes (00 black, 01 white, 10 yellow, 11 red; the server
// maps its inks to them, server/src/panels.ts) and each code becomes the panel's own
// colour index: they show black, white, yellow and red of their colours. Frames are
// streamed row by row (W/2 bytes on the wire per row), with no frame buffer.
// BUSY is LOW while the controller works.

#include "epd_driver.h"
#include "config.h"

#if defined(EPD_CONTROLLER_73_COLOR)

#include <SPI.h>
#if defined(EPD_COLOR_PAGED)
#include <LittleFS.h>
#endif

#ifndef EPD_GXEPD2_SPI_HZ
#define EPD_GXEPD2_SPI_HZ 4000000
#endif

// Panel colour index for each 2bpp code: black, white, yellow, red.
#if defined(EPD_PANEL_73_ACEP)
// ACeP: 0 black, 1 white, 2 green, 3 blue, 4 red, 5 yellow, 6 orange
static const uint8_t CODE_TO_PIXEL[4] = {0x0, 0x1, 0x5, 0x4};
static const uint8_t PIXEL_WHITE = 0x1;
#define EPD_73_NAME "ACeP"
#elif defined(EPD_PANEL_73_SPECTRA6)
// Spectra 6: 0 black, 1 white, 2 yellow, 3 red, 5 blue, 6 green
static const uint8_t CODE_TO_PIXEL[4] = {0x0, 0x1, 0x2, 0x3};
static const uint8_t PIXEL_WHITE = 0x1;
#define EPD_73_NAME "Spectra6"
#else
#error "epd_driver_73_color.cpp: no panel"
#endif

// One 2bpp byte (4 pixels) -> two bytes of the panel's 4bpp data.
static uint16_t s_expand[256];

static void buildExpandTable() {
    for (int b = 0; b < 256; b++) {
        const uint8_t p0 = CODE_TO_PIXEL[(b >> 6) & 3], p1 = CODE_TO_PIXEL[(b >> 4) & 3];
        const uint8_t p2 = CODE_TO_PIXEL[(b >> 2) & 3], p3 = CODE_TO_PIXEL[b & 3];
        s_expand[b] = (uint16_t)(((p0 << 4) | p1) << 8 | ((p2 << 4) | p3));
    }
}

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

// BUSY is LOW while the controller works; it goes low a moment after the command.
static void waitBusy(const char *what, unsigned long timeout_ms = 30000) {
    delay(5);
    const unsigned long t0 = millis();
    while (digitalRead(PIN_EPD_BUSY) == LOW) {
        delay(5);
        if (millis() - t0 > timeout_ms) {
            Serial.printf("[EPD-%s] %s: busy timeout\n", EPD_73_NAME, what);
            return;
        }
    }
    if (millis() - t0 > 100) Serial.printf("[EPD-%s] %s: busy %lums\n", EPD_73_NAME, what, millis() - t0);
}

static void hardwareReset() {
    digitalWrite(PIN_EPD_RST, HIGH);
    delay(20);
    digitalWrite(PIN_EPD_RST, LOW);
    delay(5);
    digitalWrite(PIN_EPD_RST, HIGH);
    delay(20);
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
    buildExpandTable();
    s_spiStarted = true;
}

static void sendResolution() {
    sendCommandData(0x61, {(uint8_t)(W >> 8), (uint8_t)(W & 0xFF), (uint8_t)(H >> 8), (uint8_t)(H & 0xFF)});  // TRES
}

static void controllerInit() {
    startSpi();
    hardwareReset();
#if defined(EPD_PANEL_73_ACEP)
    // Waveshare epd7in3f
    delay(30);
    sendCommandData(0xAA, {0x49, 0x55, 0x20, 0x08, 0x09, 0x18});  // CMDH
    sendCommandData(0x01, {0x3F, 0x00, 0x32, 0x2A, 0x0E, 0x2A});  // PWR
    sendCommandData(0x00, {0x5F, 0x69});              // PSR
    sendCommandData(0x03, {0x00, 0x54, 0x00, 0x44});  // POFS
    sendCommandData(0x05, {0x40, 0x1F, 0x1F, 0x2C});  // BTST1
    sendCommandData(0x06, {0x6F, 0x1F, 0x1F, 0x22});  // BTST2
    sendCommandData(0x08, {0x6F, 0x1F, 0x1F, 0x22});  // BTST3
    sendCommandData(0x13, {0x00, 0x04});              // IPC
    sendCommandData(0x30, {0x3C});                    // PLL
    sendCommandData(0x41, {0x00});                    // TSE
    sendCommandData(0x50, {0x3F});                    // CDI
    sendCommandData(0x60, {0x02, 0x00});              // TCON
    sendResolution();
    sendCommandData(0x82, {0x1E});                    // VDCS
    sendCommandData(0x84, {0x00});                    // T_VDCS
    sendCommandData(0x86, {0x00});                    // AGID
    sendCommandData(0xE3, {0x2F});                    // PWS
    sendCommandData(0xE0, {0x00});                    // CCSET
    sendCommandData(0xE6, {0x00});                    // TSSET
#elif defined(EPD_PANEL_73_SPECTRA6)
    // Waveshare epd7in3e
    delay(30);
    sendCommandData(0xAA, {0x49, 0x55, 0x20, 0x08, 0x09, 0x18});  // CMDH
    sendCommandData(0x01, {0x3F});                    // PWR
    sendCommandData(0x00, {0x5F, 0x69});              // PSR
    sendCommandData(0x03, {0x00, 0x54, 0x00, 0x44});  // POFS
    sendCommandData(0x05, {0x40, 0x1F, 0x1F, 0x2C});  // BTST1
    sendCommandData(0x06, {0x6F, 0x1F, 0x17, 0x49});  // BTST2
    sendCommandData(0x08, {0x6F, 0x1F, 0x1F, 0x22});  // BTST3
    sendCommandData(0x30, {0x03});                    // PLL
    sendCommandData(0x50, {0x3F});                    // CDI
    sendCommandData(0x60, {0x02, 0x00});              // TCON
    sendResolution();
    sendCommandData(0x84, {0x01});                    // T_VDCS
    sendCommandData(0xE3, {0x2F});                    // PWS
#endif
    s_asleep = false;
}

// ── Refresh, then deep sleep ─────────────────────────────────────────

static void refreshAndSleep() {
    Serial.printf("[EPD-%s] refresh\n", EPD_73_NAME);
    sendCommand(0x04);                                // PON
    waitBusy("PON", 5000);
#if defined(EPD_PANEL_73_SPECTRA6)
    sendCommandData(0x06, {0x6F, 0x1F, 0x17, 0x49});  // BTST2 again after power-on (reference)
#endif
    sendCommandData(0x12, {0x00});                    // DRF
    waitBusy("DRF", 60000);                           // the 7-colour panels take ~15-30 s
    sendCommandData(0x02, {0x00});                    // POF
    waitBusy("POF", 5000);
    delay(100);
    sendCommandData(0x07, {0xA5});                    // DSLP: only a reset wakes it again
    s_asleep = true;
}

// ── Frame writing ────────────────────────────────────────────────────

static void frameBegin() {
    controllerInit();
    sendCommand(0x10);                                // DTM1: the frame follows, in order
}

static void frameWriteRow2bpp(const uint8_t *row2bpp) {
    beginTransfer(true);
    for (int i = 0; i < W / 4; i++) {
        const uint16_t two = s_expand[row2bpp[i]];
        SPI.transfer((uint8_t)(two >> 8));
        SPI.transfer((uint8_t)two);
    }
    endTransfer();
}

// 1bpp (1 = white, MSB first) -> the panel's black and white.
static void frameWriteRow1bpp(const uint8_t *row1bpp) {
    static const uint8_t PAIR[4] = {
        0x00, (uint8_t)PIXEL_WHITE, (uint8_t)(PIXEL_WHITE << 4), (uint8_t)(PIXEL_WHITE << 4 | PIXEL_WHITE)};
    beginTransfer(true);
    for (int i = 0; i < W / 8; i++) {
        const uint8_t b = row1bpp[i];
        SPI.transfer(PAIR[(b >> 6) & 3]);
        SPI.transfer(PAIR[(b >> 4) & 3]);
        SPI.transfer(PAIR[(b >> 2) & 3]);
        SPI.transfer(PAIR[b & 3]);
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
        Serial.printf("[EPD-%s] color file missing\n", EPD_73_NAME);
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
    sendCommand(0x02);
    waitBusy("POF", 5000);
    sendCommandData(0x07, {0xA5});
    s_asleep = true;
}

#endif  // EPD_CONTROLLER_73_COLOR
