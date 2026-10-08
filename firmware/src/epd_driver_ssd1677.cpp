// ── SSD1677 7.5寸 HD 驱动 ──────────────────────────────────────────────
// Controller: SSD1677, 880x528
//   EPD_PANEL_75HD_SSD1677_BWR  7.5" HD B/W/R (Waveshare 7.5" HD B, GDEH075Z90)
//   EPD_PANEL_75HD_SSD1677_BW   7.5" HD B/W   (Waveshare 7.5" HD, GDEW075T7 HD)
// Ported from EPD-nRF5 (SSD16xx.c, GPL-3.0). Not yet checked on hardware here.
//
// Two RAMs: 0x24 black/white (1 = white), 0x26 red. Display update control 1 inverts
// the red RAM (B/W/R) or ignores it (B/W), so the red plane is written active-low like
// the black one. The controller holds the frame, so each 2bpp row is split into its two
// planes and written at that row: no frame buffer. BUSY is HIGH while it works.

#include "epd_driver.h"
#include "config.h"

#if defined(EPD_CONTROLLER_SSD1677)

#include <SPI.h>
#if defined(EPD_COLOR_PAGED)
#include <LittleFS.h>
#endif

#ifndef EPD_GXEPD2_SPI_HZ
#define EPD_GXEPD2_SPI_HZ 4000000
#endif

#if defined(EPD_PANEL_75HD_SSD1677_BWR)
#define SSD1677_HAS_RED 1
#else
#define SSD1677_HAS_RED 0
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
    const unsigned long t0 = millis();
    while (digitalRead(PIN_EPD_BUSY) == HIGH) {
        delay(5);
        if (millis() - t0 > timeout_ms) {
            Serial.printf("[EPD-SSD1677] %s: busy timeout\n", what);
            return;
        }
    }
    if (millis() - t0 > 100) Serial.printf("[EPD-SSD1677] %s: busy %lums\n", what, millis() - t0);
}

static void hardwareReset() {
    digitalWrite(PIN_EPD_RST, HIGH);
    delay(10);
    digitalWrite(PIN_EPD_RST, LOW);
    delay(10);
    digitalWrite(PIN_EPD_RST, HIGH);
    delay(10);
}

// ── RAM window ───────────────────────────────────────────────────────
// SSD1677 addresses X in pixels (two bytes), Y in rows; entry mode X+, Y+.

static void setWindow(int y0, int y1) {
    sendCommandData(0x11, {0x03});                                                        // data entry mode
    sendCommandData(0x44, {0x00, 0x00, (uint8_t)((W - 1) & 0xFF), (uint8_t)((W - 1) >> 8)});  // RAM X
    sendCommandData(0x45, {(uint8_t)(y0 & 0xFF), (uint8_t)(y0 >> 8), (uint8_t)(y1 & 0xFF), (uint8_t)(y1 >> 8)});  // RAM Y
    sendCommandData(0x4E, {0x00, 0x00});                                                  // X counter
    sendCommandData(0x4F, {(uint8_t)(y0 & 0xFF), (uint8_t)(y0 >> 8)});                    // Y counter
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

static void controllerInit() {
    startSpi();
    hardwareReset();
    sendCommand(0x12);                                      // SW reset
    delay(10);
    waitBusy("sw reset", 5000);
    sendCommandData(0x01, {(uint8_t)((H - 1) & 0xFF), (uint8_t)((H - 1) >> 8), 0x00});  // driver output: H gates
    sendCommandData(0x3C, {0x01});                          // border waveform
    sendCommandData(0x18, {0x80});                          // internal temperature sensor
    setWindow(0, H - 1);
    s_asleep = false;
}

// ── Refresh, then deep sleep ─────────────────────────────────────────

static void refreshAndSleep() {
    Serial.println("[EPD-SSD1677] refresh");
    sendCommandData(0x21, {SSD1677_HAS_RED ? 0x80 : 0x40, 0x00});  // red RAM: inverted / ignored
    sendCommandData(0x22, {0xF7});
    sendCommand(0x20);                                      // master activation
    waitBusy("refresh", 60000);
    sendCommandData(0x10, {0x01});                          // deep sleep: only a reset wakes it
    delay(10);
    s_asleep = true;
}

// ── Frame writing ────────────────────────────────────────────────────

// 2 bytes of the 2bpp frame (8 pixels) -> one byte of each plane, both active-low.
static inline void decode2bppPair(uint8_t src0, uint8_t src1, uint8_t &black, uint8_t &red) {
    black = 0xFF;
    red = 0xFF;
    for (int px = 0; px < 4; px++) {
        const uint8_t c0 = (src0 >> (6 - px * 2)) & 0x03, c1 = (src1 >> (6 - px * 2)) & 0x03;
        if (c0 == 0x00) black &= ~(0x80 >> px);
        else if (c0 >= 0x02) red &= ~(0x80 >> px);
        if (c1 == 0x00) black &= ~(0x08 >> px);
        else if (c1 >= 0x02) red &= ~(0x08 >> px);
    }
#if !SSD1677_HAS_RED
    black &= red;  // (no red on the panel: red and yellow are black, as the server sends them)
#endif
}

static void writeRowPlanes(int row, const uint8_t *black, const uint8_t *red) {
    setWindow(row, row);
    sendCommand(0x24);
    beginTransfer(true);
    for (int i = 0; i < W / 8; i++) SPI.transfer(black[i]);
    endTransfer();
#if SSD1677_HAS_RED
    setWindow(row, row);
    sendCommand(0x26);
    beginTransfer(true);
    for (int i = 0; i < W / 8; i++) SPI.transfer(red ? red[i] : 0xFF);
    endTransfer();
#else
    (void)red;
#endif
}

static void frameWriteRow2bpp(int row, const uint8_t *row2bpp) {
    uint8_t black[W / 8], red[W / 8];
    for (int i = 0; i < W / 8; i++) decode2bppPair(row2bpp[i * 2], row2bpp[i * 2 + 1], black[i], red[i]);
    writeRowPlanes(row, black, red);
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

// 1bpp image (1 = white): written as the black plane, no red.
void epdDisplay(const uint8_t *image) {
    controllerInit();
    setWindow(0, H - 1);
    sendCommand(0x24);
    beginTransfer(true);
    for (int i = 0; i < IMG_BUF_LEN; i++) SPI.transfer(image[i]);
    endTransfer();
#if SSD1677_HAS_RED
    setWindow(0, H - 1);
    sendCommand(0x26);
    beginTransfer(true);
    for (int i = 0; i < IMG_BUF_LEN; i++) SPI.transfer(0xFF);
    endTransfer();
#endif
    refreshAndSleep();
}

void epdDisplayFast(const uint8_t *image) {
    epdDisplay(image);
}

void epdDisplay2bpp(const uint8_t *image2bpp) {
    controllerInit();
    for (int r = 0; r < H; r++) frameWriteRow2bpp(r, image2bpp + r * (W / 4));
    refreshAndSleep();
}

#if defined(EPD_COLOR_PAGED)
void epdDisplay2bppPaged(const char *path) {
    File f = LittleFS.open(path, "r");
    if (!f) {
        Serial.println("[EPD-SSD1677] color file missing");
        return;
    }
    controllerInit();
    uint8_t row[W / 4];
    for (int r = 0; r < H; r++) {
        if (f.read(row, sizeof row) != sizeof row) memset(row, 0x55, sizeof row);  // (white)
        frameWriteRow2bpp(r, row);
    }
    f.close();
    refreshAndSleep();
}
#endif

#if EPD_STREAMS_FRAMES
// ── Streaming frame API ──────────────────────────────────────────────
// Each row is written at its own address; every row 0..H-1 once between Begin and End.

bool epdStreamBegin() {
    controllerInit();
    return true;
}

void epdStreamWriteRow(int imageRow, const uint8_t *row2bpp) {
    frameWriteRow2bpp(imageRow, row2bpp);
}

void epdStreamEnd() {
    refreshAndSleep();
}

void epdStreamAbort() {}  // (the next frame starts with a reset)
#endif

// No partial refresh here: a full one instead.
void epdPartialDisplayWithOld(uint8_t *data, const uint8_t *oldData, int xStart, int yStart, int xEnd, int yEnd) {
    (void)oldData;
    epdPartialDisplay(data, xStart, yStart, xEnd, yEnd);
}

void epdPartialDisplay(uint8_t *data, int xStart, int yStart, int xEnd, int yEnd) {
    (void)data; (void)xStart; (void)yStart; (void)xEnd; (void)yEnd;
#if EPD_BPP < 2 && !defined(EPD_COLOR_PAGED)
    // B/W build: imgBuf holds the whole screen (colour builds never get here)
    epdDisplay(imgBuf);
#endif
}

void epdSleep() {
    // every refresh already ends in deep sleep
    if (s_asleep) return;
    sendCommandData(0x10, {0x01});
    delay(10);
    s_asleep = true;
}

#endif  // EPD_CONTROLLER_SSD1677
