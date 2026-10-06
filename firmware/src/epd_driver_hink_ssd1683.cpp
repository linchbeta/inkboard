// ── HINK 4.2" SSD1683 三色屏驱动 ────────────────────────────────────────
// Panel: HINK 4.2" Black/White/Red tri-color e-ink
// Controller: SSD1683
// Reference: GxEPD2 src/gdey3c/GxEPD2_420c_GDEY042Z98.cpp
// BUSY=HIGH means busy; wait for LOW.

#include "epd_driver.h"
#include "config.h"

#if defined(EPD_PANEL_42_HINK_SSD1683)

#include <SPI.h>

#ifndef EPD_GXEPD2_SPI_HZ
#define EPD_GXEPD2_SPI_HZ 4000000
#endif

static bool ssd1683_initialized = false;

static uint8_t* epdColorPlaneBuffer() {
    return colorBuf + IMG_BUF_LEN;
}

// ── Low-level SPI helpers ────────────────────────────────────

static void ssd1683BeginTransfer(bool data_mode) {
    digitalWrite(PIN_EPD_DC, data_mode ? HIGH : LOW);
    digitalWrite(PIN_EPD_CS, LOW);
    SPI.beginTransaction(SPISettings(EPD_GXEPD2_SPI_HZ, MSBFIRST, SPI_MODE0));
}

static void ssd1683EndTransfer() {
    SPI.endTransaction();
    digitalWrite(PIN_EPD_CS, HIGH);
}

static void ssd1683WriteCommand(uint8_t cmd) {
    ssd1683BeginTransfer(false);
    SPI.transfer(cmd);
    ssd1683EndTransfer();
}

static void ssd1683WriteData(uint8_t data) {
    ssd1683BeginTransfer(true);
    SPI.transfer(data);
    ssd1683EndTransfer();
}

// BUSY is HIGH while the SSD1683 works. `what` (optional) logs how long it took.
static void ssd1683WaitBusy(unsigned long timeout_ms = 30000, const char *what = nullptr) {
    const unsigned long t0 = millis();
    while (digitalRead(PIN_EPD_BUSY) == HIGH) {
        delay(10);
        if (millis() - t0 > timeout_ms) {
            Serial.printf("[EPD-SSD1683] %s: busy timeout\n", what ? what : "wait");
            return;
        }
    }
    if (what) Serial.printf("[EPD-SSD1683] %s: busy %lums\n", what, millis() - t0);
}

static void ssd1683Reset() {
    delay(20);
    digitalWrite(PIN_EPD_RST, LOW);
    delay(20);
    digitalWrite(PIN_EPD_RST, HIGH);
    delay(130);
}

// ── 2bpp decode ──────────────────────────────────────────────
// raw2bpp lives in colorBuf[0..COLOR_BUF_LEN-1].
// color_plane reuses the upper half (colorBuf + IMG_BUF_LEN).
// Active-LOW convention: 0=black/color, 1=white/no-color.
// Backward loop: writes to color_plane never overtake reads from raw2bpp.

// 2 bytes of the 2bpp frame (8 pixels) -> one byte of each plane (active-LOW).
static inline void decode2bppPair(uint8_t src0, uint8_t src1, uint8_t &black_byte, uint8_t &color_byte) {
    black_byte = 0xFF;
    color_byte = 0xFF;
    for (int px = 0; px < 4; px++) {
        const uint8_t code = (src0 >> (6 - px * 2)) & 0x03;
        const uint8_t mask = 0x80 >> px;
        if (code == 0x00)      black_byte &= ~mask;
        else if (code >= 0x02) color_byte &= ~mask;
    }
    for (int px = 0; px < 4; px++) {
        const uint8_t code = (src1 >> (6 - px * 2)) & 0x03;
        const uint8_t mask = 0x08 >> px;
        if (code == 0x00)      black_byte &= ~mask;
        else if (code >= 0x02) color_byte &= ~mask;
    }
}

static void decodeRaw2bppToTriColorPlanes(const uint8_t* raw2bpp, uint8_t* black_plane, uint8_t* color_plane) {
    memset(black_plane, 0xFF, IMG_BUF_LEN);
    // backwards: color_plane may share the end of raw2bpp's buffer (colorBuf + IMG_BUF_LEN)
    for (int out = IMG_BUF_LEN - 1; out >= 0; out--) {
        uint8_t black_byte, color_byte;
        decode2bppPair(raw2bpp[out * 2], raw2bpp[out * 2 + 1], black_byte, color_byte);
        black_plane[out] = black_byte;
        color_plane[out] = color_byte;
    }
}

// ── RAM window + pointer reset ───────────────────────────────
// Must be called before each plane write: SSD1683 needs full window
// re-declaration to correctly reset the Y address counter.

static void ssd1683SetFullWindowAndPointer() {
    ssd1683WriteCommand(0x11);      // data entry mode: X inc, Y inc
    ssd1683WriteData(0x03);
    ssd1683WriteCommand(0x44);      // RAM X window
    ssd1683WriteData(0x00);
    ssd1683WriteData((W - 1) / 8);
    ssd1683WriteCommand(0x45);      // RAM Y window
    ssd1683WriteData(0x00);
    ssd1683WriteData(0x00);
    ssd1683WriteData((H - 1) & 0xFF);
    ssd1683WriteData(((H - 1) >> 8) & 0xFF);
    ssd1683WriteCommand(0x4E);      // X address counter
    ssd1683WriteData(0x00);
    ssd1683WriteCommand(0x4F);      // Y address counter
    ssd1683WriteData(0x00);
    ssd1683WriteData(0x00);
}

// ── Controller init ──────────────────────────────────────────

static void ssd1683InitController() {
    if (ssd1683_initialized) return;

    const uint16_t y_end = H - 1;

    // SSD1683 is write-only; MISO is unused but SPI.begin() requires a valid pin on ESP32-C3
    // (passing -1 triggers spiAttachMISO with no default MISO on C3, causing a fatal bus error).
    // GPIO3 is the only unassigned GPIO on the C3 Mini pinout, used here as a no-connect dummy.
#if defined(BOARD_PROFILE_ESP32_C3)
    // The dummy MISO must not be the LED: upstream C3 boards have the LED on GPIO3,
    // local *_led5 boards on GPIO5, and the other one of the two is free.
    SPI.begin(PIN_EPD_SCK, (PIN_LED == 3) ? 5 : 3, PIN_EPD_MOSI, PIN_EPD_CS);
#else
    SPI.begin(PIN_EPD_SCK, -1, PIN_EPD_MOSI, PIN_EPD_CS);
#endif
    ssd1683Reset();

    ssd1683WriteCommand(0x12);  // software reset
    delay(10);
    ssd1683WaitBusy(30000, "sw reset");          // SSD1683 requires BUSY=LOW before commands after SW reset

    ssd1683WriteCommand(0x01);  // driver output control
    ssd1683WriteData(y_end & 0xFF);
    ssd1683WriteData((y_end >> 8) & 0xFF);
    ssd1683WriteData(0x00);

    ssd1683WriteCommand(0x3C);  // border waveform
    ssd1683WriteData(0x05);

    ssd1683WriteCommand(0x18);  // internal temperature sensor
    ssd1683WriteData(0x80);

    ssd1683SetFullWindowAndPointer();

    ssd1683_initialized = true;
}

// ── Frame write ──────────────────────────────────────────────
// 0x24 BW RAM:    active-LOW  (0=black,  1=white)    → write directly
// 0x26 color RAM: active-HIGH (1=color,  0=no-color) → invert active-LOW plane

static void ssd1683WriteFrame(const uint8_t* black_plane, const uint8_t* color_plane) {
    ssd1683InitController();

    ssd1683SetFullWindowAndPointer();
    ssd1683WriteCommand(0x26);  // color RAM — invert active-LOW color_plane
    ssd1683BeginTransfer(true);
    for (int i = 0; i < IMG_BUF_LEN; i++) {
        SPI.transfer(color_plane ? static_cast<uint8_t>(~color_plane[i]) : 0x00);
    }
    ssd1683EndTransfer();

    ssd1683SetFullWindowAndPointer();
    ssd1683WriteCommand(0x24);  // BW RAM — write directly
    ssd1683BeginTransfer(true);
    for (int i = 0; i < IMG_BUF_LEN; i++) {
        SPI.transfer(black_plane ? black_plane[i] : 0xFF);
    }
    ssd1683EndTransfer();

    ssd1683WriteCommand(0x22);
    ssd1683WriteData(0xF7);
    ssd1683WriteCommand(0x20);  // master activation
    ssd1683WaitBusy(60000, "refresh (3-color)");
}

static void ssd1683DisplayMonoFrame(const uint8_t* image) {
    ssd1683InitController();

    ssd1683SetFullWindowAndPointer();
    ssd1683WriteCommand(0x26);  // color RAM: all 0x00 = no color
    ssd1683BeginTransfer(true);
    for (int i = 0; i < IMG_BUF_LEN; i++) SPI.transfer(0x00);
    ssd1683EndTransfer();

    ssd1683SetFullWindowAndPointer();
    ssd1683WriteCommand(0x24);  // BW RAM
    ssd1683BeginTransfer(true);
    for (int i = 0; i < IMG_BUF_LEN; i++) SPI.transfer(image[i]);
    ssd1683EndTransfer();

    ssd1683WriteCommand(0x22);
    ssd1683WriteData(0xF7);
    ssd1683WriteCommand(0x20);
    ssd1683WaitBusy(60000, "refresh (mono)");
}

// ── GPIO initialization ──────────────────────────────────────

void gpioInit() {
    pinMode(PIN_EPD_BUSY, INPUT);
    pinMode(PIN_EPD_RST,  OUTPUT);
    pinMode(PIN_EPD_DC,   OUTPUT);
    pinMode(PIN_EPD_CS,   OUTPUT);
    pinMode(PIN_EPD_SCK,  OUTPUT);
    pinMode(PIN_EPD_MOSI, OUTPUT);
    pinMode(PIN_CFG_BTN,  INPUT_PULLUP);
    digitalWrite(PIN_EPD_RST, HIGH);
    digitalWrite(PIN_EPD_CS,  HIGH);
    digitalWrite(PIN_EPD_SCK, LOW);
}

// ── Public EPD interface ─────────────────────────────────────

void epdInit() {
    ssd1683InitController();
}

void epdInitFast() {
    epdInit();
}

void epdDisplay(const uint8_t* image) {
    ssd1683DisplayMonoFrame(image);
}

void epdDisplay2bpp(const uint8_t* image2bpp) {
    decodeRaw2bppToTriColorPlanes(image2bpp, imgBuf, epdColorPlaneBuffer());
    ssd1683WriteFrame(imgBuf, epdColorPlaneBuffer());
}

void epdDisplayFast(const uint8_t* image) {
    epdDisplay(image);
}

// ── Streaming frame API (as on the 3.98") ────────────────────
// The controller holds both planes, so a frame can arrive one 2bpp row (W/4 bytes) at a
// time: each row is split into its black/white and colour bytes and written at that row
// of both RAMs. Every row 0..H-1 must be written once between Begin and End.

// A one-row window plus both counters: like ssd1683SetFullWindowAndPointer(), the window
// is declared again before each write so the address counters reliably start at the row.
static void ssd1683SetRow(int row) {
    ssd1683WriteCommand(0x45);  // RAM Y window: this row only
    ssd1683WriteData(row & 0xFF);
    ssd1683WriteData((row >> 8) & 0xFF);
    ssd1683WriteData(row & 0xFF);
    ssd1683WriteData((row >> 8) & 0xFF);
    ssd1683WriteCommand(0x4E);  // X address counter
    ssd1683WriteData(0x00);
    ssd1683WriteCommand(0x4F);  // Y address counter
    ssd1683WriteData(row & 0xFF);
    ssd1683WriteData((row >> 8) & 0xFF);
}

bool epdStreamBegin() {
    ssd1683InitController();
    ssd1683SetFullWindowAndPointer();
    return true;
}

void epdStreamAbort() {}  // (the controller memory is simply overwritten next time)

void epdStreamWriteRow(int imageRow, const uint8_t *row2bpp) {
    uint8_t black[W / 8], color[W / 8];
    for (int i = 0; i < W / 8; i++) decode2bppPair(row2bpp[i * 2], row2bpp[i * 2 + 1], black[i], color[i]);
    ssd1683SetRow(imageRow);
    ssd1683WriteCommand(0x26);  // color RAM (active-HIGH): inverted
    ssd1683BeginTransfer(true);
    for (int i = 0; i < W / 8; i++) SPI.transfer(static_cast<uint8_t>(~color[i]));
    ssd1683EndTransfer();
    ssd1683SetRow(imageRow);
    ssd1683WriteCommand(0x24);  // BW RAM
    ssd1683BeginTransfer(true);
    for (int i = 0; i < W / 8; i++) SPI.transfer(black[i]);
    ssd1683EndTransfer();
}

void epdStreamEnd() {
    ssd1683WriteCommand(0x22);
    ssd1683WriteData(0xF7);
    ssd1683WriteCommand(0x20);  // master activation
    ssd1683WaitBusy(60000, "refresh (3-color, streamed)");
    ssd1683SetFullWindowAndPointer();  // later full-frame writes expect the full window
}

// No old-frame differential support on this controller; plain partial refresh.
void epdPartialDisplayWithOld(uint8_t *data, const uint8_t *oldData, int xStart, int yStart, int xEnd, int yEnd) {
    (void)oldData;
    epdPartialDisplay(data, xStart, yStart, xEnd, yEnd);
}

void epdPartialDisplay(uint8_t* data, int xStart, int yStart, int xEnd, int yEnd) {
    (void)data; (void)xStart; (void)yStart; (void)xEnd; (void)yEnd;
    epdDisplay(imgBuf);
}

void epdSleep() {
    if (!ssd1683_initialized) return;
    ssd1683WriteCommand(0x10);  // deep sleep
    ssd1683WriteData(0x11);
    delay(20);
    ssd1683_initialized = false;
}

#endif  // EPD_PANEL_42_HINK_SSD1683
