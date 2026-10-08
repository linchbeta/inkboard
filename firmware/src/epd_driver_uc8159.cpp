// ── UC8159 驱动 ───────────────────────────────────────────────────────
// Controller: UC8159 / UC8159C (Ultrachip). 4 bits per pixel in the controller; the
// whole frame goes in order through DTM1 (0x10), two pixels per byte, high nibble first.
//   EPD_PANEL_565_UC8159      5.65" ACeP 7-colour 600x448 (UC8159C; Waveshare 5.65" F,
//                             Good Display GDEP0565D90)
//   EPD_PANEL_75_UC8159_BWR   7.5" B/W/R 640x384 (Waveshare 7.5" B V1, GDEW075Z09)
//   EPD_PANEL_75_UC8159_BW    7.5" B/W 640x384 (Waveshare 7.5" V1, GDEW075T8)
//   EPD_PANEL_583_UC8159_BWR  5.83" B/W/R 600x448 (Waveshare 5.83" B V1, GDEW0583Z21)
//   EPD_PANEL_583_UC8159_BW   5.83" B/W 600x448 (Waveshare 5.83" V1, GDEW0583T7)
//                             (the 648x480 5.83" V2 is a UC8179: epd_driver_uc8179.cpp)
// Init: the 5.65" as the Waveshare / GxEPD2 references, the V1 panels as EPD-nRF5
// (GPL-3.0, like the offline calendar). None checked on hardware here yet.
//
// The frame arrives as 2bpp codes (00 black, 01 white, 10 yellow, 11 red; the server
// maps its inks to them, server/src/panels.ts) and each code becomes the panel's own
// colour index: the 7-colour panel shows black, white, yellow and red of its colours, the
// B/W/R ones show yellow as red. Since the controller holds the whole frame, frames are
// streamed row by row (W/2 bytes on the wire per row), with no frame buffer.
// BUSY is LOW while the controller works.

#include "epd_driver.h"
#include "config.h"

#if defined(EPD_CONTROLLER_UC8159)

#include <SPI.h>
#if defined(EPD_COLOR_PAGED)
#include <LittleFS.h>
#endif

#ifndef EPD_GXEPD2_SPI_HZ
#define EPD_GXEPD2_SPI_HZ 4000000
#endif

// The UC8159 B/W/R and B/W panels of the first generation (7.5" 640x384, 5.83" 600x448).
#if defined(EPD_PANEL_75_UC8159_BWR) || defined(EPD_PANEL_583_UC8159_BWR)
#define UC8159_V1_BWR
#endif
#if defined(UC8159_V1_BWR) || defined(EPD_PANEL_75_UC8159_BW) || defined(EPD_PANEL_583_UC8159_BW)
#define UC8159_V1
#endif

// Panel colour index for each 2bpp code: black, white, yellow, red.
#if defined(EPD_PANEL_565_UC8159)
// ACeP: 0 black, 1 white, 2 green, 3 blue, 4 red, 5 yellow, 6 orange
static const uint8_t CODE_TO_PIXEL[4] = {0x0, 0x1, 0x5, 0x4};
static const uint8_t PIXEL_WHITE = 0x1;
#define EPD_UC8159_NAME "UC8159C"
#elif defined(UC8159_V1)
// UC8159 V1 panels: 0 black, 3 white, 4 red (the B/W panels ignore red)
static const uint8_t CODE_TO_PIXEL[4] = {0x0, 0x3, 0x4, 0x4};
static const uint8_t PIXEL_WHITE = 0x3;
#define EPD_UC8159_NAME "UC8159"
#else
#error "epd_driver_uc8159.cpp: no panel"
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
            Serial.printf("[EPD-%s] %s: busy timeout\n", EPD_UC8159_NAME, what);
            return;
        }
    }
    if (millis() - t0 > 100) Serial.printf("[EPD-%s] %s: busy %lums\n", EPD_UC8159_NAME, what, millis() - t0);
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
#if defined(EPD_PANEL_565_UC8159)
    // Waveshare epd5in65f / GxEPD2_565c
    sendCommandData(0x00, {0xEF, 0x08});              // PSR
    sendCommandData(0x01, {0x37, 0x00, 0x23, 0x23});  // PWR
    sendCommandData(0x03, {0x00});                    // PFS
    sendCommandData(0x06, {0xC7, 0xC7, 0x1D});        // BTST
    sendCommandData(0x30, {0x3C});                    // PLL
    sendCommandData(0x41, {0x00});                    // TSE
    sendCommandData(0x50, {0x37});                    // CDI
    sendCommandData(0x60, {0x22});                    // TCON
    sendResolution();
    sendCommandData(0xE3, {0xAA});                    // PWS
    delay(100);
    sendCommandData(0x50, {0x37});
#elif defined(UC8159_V1)
    // as EPD-nRF5 (UC81xx.c), the same for the B/W and B/W/R panels
#ifndef UC8159_VCOM
#define UC8159_VCOM 0x28
#endif
    sendCommandData(0x01, {0x37, 0x00});              // PWR
    sendCommandData(0x00, {0xCF, 0x08});              // PSR
    sendCommandData(0x30, {0x3A});                    // PLL
    sendCommandData(0x82, {UC8159_VCOM});             // VDCS (-DUC8159_VCOM=0x.. to tune)
    sendCommandData(0x06, {0xC7, 0xCC, 0x15});        // BTST
    sendCommandData(0x50, {0x77});                    // CDI
    sendCommandData(0x60, {0x22});                    // TCON
    sendCommandData(0x65, {0x00});                    // flash control
    sendCommandData(0xE5, {0x03});                    // flash mode
    sendResolution();
#endif
    s_asleep = false;
}

// ── Refresh, then deep sleep ─────────────────────────────────────────

static void refreshAndSleep() {
    Serial.printf("[EPD-%s] refresh\n", EPD_UC8159_NAME);
    sendCommand(0x04);                                // PON
    waitBusy("PON", 5000);
    sendCommand(0x12);                                // DRF
    waitBusy("DRF", 60000);                           // the 7-colour panel takes ~15-30 s
    sendCommand(0x02);                                // POF
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
        Serial.printf("[EPD-%s] color file missing\n", EPD_UC8159_NAME);
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

// No partial refresh on these panels: a full one instead.
void epdPartialDisplayWithOld(uint8_t *data, const uint8_t *oldData, int xStart, int yStart, int xEnd, int yEnd) {
    (void)oldData;
    epdPartialDisplay(data, xStart, yStart, xEnd, yEnd);
}

void epdPartialDisplay(uint8_t *data, int xStart, int yStart, int xEnd, int yEnd) {
    (void)data; (void)xStart; (void)yStart; (void)xEnd; (void)yEnd;
#if EPD_BPP < 2 && !defined(EPD_COLOR_PAGED)
    // B/W build: imgBuf holds the whole screen, so show it with a full refresh
    // (colour builds never get here: updateTimeDisplay skips them)
    epdDisplay(imgBuf);
#endif
}

void epdSleep() {
    // every refresh already ends in deep sleep
    if (s_asleep) return;
    sendCommand(0x02);
    waitBusy("POF", 5000);
    sendCommandData(0x07, {0xA5});
    s_asleep = true;
}

#endif  // EPD_CONTROLLER_UC8159
