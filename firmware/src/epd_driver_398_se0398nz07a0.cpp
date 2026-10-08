// ── 3.98寸四色屏 SE0398NZ07A0 独立驱动 ──────────────────────────────────────
// Panel: SE0398NZ07A0 (768×552, 4-Color 2bpp)
// Protocol verified against BLE_EPD_DISPLAY reference implementation.
//
// Data format: raw 2bpp packed (4 pixels/byte). 00=black 01=white 10=yellow 11=red.
// Written directly to DTM (0x10) — the controller handles 4-color natively.
//
// A0 (JD79660) row mapping (two gate drivers scanning in opposite directions):
//   Image rows 0..(H/2-1)   → physical even rows 0, 2, 4, …, H-2
//   Image rows (H/2)..(H-1) → physical odd  rows H-1, H-3, …, 1
// Each row is addressed via command 0x83 (partial-window entry).
//
// A1 (JD79661, -DSE0398_A1): long init (parameters from the EPD-nRF5 reference), then
// one full-screen window and the whole frame in order into DTM1 -- no row mapping.
// Verified on A1 hardware.

#include "epd_driver.h"
#include "config.h"

#if defined(EPD_PANEL_398_SE0398NZ07A0)

#if defined(EPD_COLOR_PAGED)
#include <LittleFS.h>
#endif

// ── Software SPI (bit-bang) ─────────────────────────────────────────
// portENTER_CRITICAL prevents FreeRTOS task preemption mid-byte.
// On single-core C3 with USB-CDC tasks this is necessary; on dual-core
// WROOM32E it is a safe no-cost guard that doesn't change behavior.

static portMUX_TYPE s_spiMux = portMUX_INITIALIZER_UNLOCKED;

static void spiWriteByte(uint8_t data) {
    portENTER_CRITICAL(&s_spiMux);
    for (int i = 0; i < 8; i++) {
        digitalWrite(PIN_EPD_MOSI, (data & 0x80) ? HIGH : LOW);
        data <<= 1;
        digitalWrite(PIN_EPD_SCK, HIGH);
        digitalWrite(PIN_EPD_SCK, LOW);
    }
    portEXIT_CRITICAL(&s_spiMux);
}

static void epdSendCommand(uint8_t cmd) {
    digitalWrite(PIN_EPD_DC, LOW);
    digitalWrite(PIN_EPD_CS, LOW);
    spiWriteByte(cmd);
    digitalWrite(PIN_EPD_CS, HIGH);
}

static void epdSendData(uint8_t data) {
    digitalWrite(PIN_EPD_DC, HIGH);
    digitalWrite(PIN_EPD_CS, LOW);
    spiWriteByte(data);
    digitalWrite(PIN_EPD_CS, HIGH);
}

// ── Busy / Reset ─────────────────────────────────────────────────────

// BUSY is LOW while the controller works. It is asserted a short time after a
// command / reset edge, so wait `settle_ms` first; otherwise a fast read can see
// the idle HIGH level and the next command is sent while the controller is busy.
static void epdWaitBusy(const char *what, unsigned long timeout_ms = 30000, unsigned long settle_ms = 20) {
    delay(settle_ms);
    unsigned long t0 = millis();
    if (digitalRead(PIN_EPD_BUSY) != LOW) {
        // Either the step finished within the settle time (normal for short steps
        // like PON) or BUSY never asserted. Only suspicious for DRF, which takes seconds.
        Serial.printf("[EPD-SE0398] %s: BUSY idle after %lums settle%s\n", what, settle_ms,
                      strcmp(what, "DRF") == 0 ? " -- refresh did not run? check BUSY wiring" : "");
        return;
    }
    while (digitalRead(PIN_EPD_BUSY) == LOW) {
        delay(1);
        if (millis() - t0 > timeout_ms) {
            Serial.printf("[EPD-SE0398] %s: BUSY TIMEOUT after %lums\n", what, timeout_ms);
            return;
        }
    }
    Serial.printf("[EPD-SE0398] %s: busy %lums\n", what, millis() - t0 + settle_ms);
}

static void epdReset() {
    Serial.printf("[EPD-SE0398] reset, BUSY=%d\n", digitalRead(PIN_EPD_BUSY));
    delay(200);
    digitalWrite(PIN_EPD_RST, LOW);
    delay(100);
    digitalWrite(PIN_EPD_RST, HIGH);
    epdWaitBusy("reset", 5000, 50);  // reference waits 50ms after RST high
    Serial.printf("[EPD-SE0398] reset done, BUSY=%d\n", digitalRead(PIN_EPD_BUSY));
}

// ── Init (minimal, matches reference) ────────────────────────────────

// True once DSLP has been sent. In deep sleep the controller holds BUSY LOW and
// ignores commands until the next hardware reset (se0398Init clears this).
static bool s_controllerAsleep = false;

static void epdSendCommandData(uint8_t cmd, std::initializer_list<uint8_t> data) {
    epdSendCommand(cmd);
    for (uint8_t d : data) epdSendData(d);
}

static void se0398SetFullWindow() {
    epdSendCommandData(0x83, {0x00, 0x00, (uint8_t)((W - 1) >> 8), (uint8_t)((W - 1) & 0xFF),
                              0x00, 0x00, (uint8_t)((H - 1) >> 8), (uint8_t)((H - 1) & 0xFF), 0x01});
}

static void se0398Init() {
    epdReset();
    s_controllerAsleep = false;
#if defined(SE0398_A1)
    epdSendCommandData(0xAA, {0x49, 0x55, 0x20, 0x08, 0x09, 0x18});
    epdSendCommandData(0x01, {0x3F});                    // PWR
    epdSendCommandData(0x00, {0x4B, 0x69});              // PSR
    epdSendCommandData(0x05, {0x40, 0x1F, 0x1F, 0x2C});  // PMES
    epdSendCommandData(0x08, {0x6F, 0x1F, 0x1F, 0x22});
    epdSendCommandData(0x06, {0x6F, 0x1F, 0x14, 0x14});  // BTST
    epdSendCommandData(0x03, {0x00, 0x54, 0x00, 0x44});  // PFS
    epdSendCommandData(0x60, {0x02, 0x00});              // TCON
    epdSendCommandData(0x30, {0x08});                    // PLL
    epdSendCommandData(0x50, {0x3F});                    // CDI
    epdSendCommandData(0x61, {(uint8_t)(W >> 8), (uint8_t)(W & 0xFF), (uint8_t)(H >> 8), (uint8_t)(H & 0xFF)});  // TRES
    epdSendCommandData(0x65, {0x10, 0x00, 0x20, 0x00});  // GSST
    epdSendCommandData(0xE3, {0x2F});                    // PWS
    epdSendCommandData(0x84, {0x01});
    Serial.println("[EPD-SE0398] A1 PON");
    epdSendCommand(0x04);   // PON (the reference powers on right after init)
    epdWaitBusy("PON", 5000);
#else
    epdSendCommand(0x00);   // PSR
    epdSendData(0x0B);
#if defined(SE0398_PSR2)
    // 2nd PSR byte (JD79660 datasheet 8.2.1; otherwise the panel's MTP preset, usually 0x09):
    // bit5 FOPT=1 skips the extra frame scanned after the waveform, sources then Hi-Z
    epdSendData(SE0398_PSR2);
#endif

    epdSendCommand(0x61);   // TRES: resolution
    epdSendData(W >> 8);
    epdSendData(W & 0xFF);
    epdSendData(H >> 8);
    epdSendData(H & 0xFF);
#if defined(SE0398_VDCS)
    // VCOM DC (8.2.23): 0x00 = 0 V, each step -0.05 V (0x1E -1.5 V, 0x28 -2.0 V); otherwise
    // the value the panel maker programmed into the MTP. Not written to the MTP.
    epdSendCommand(0x82);
    epdSendData(SE0398_VDCS);
#endif
#if defined(SE0398_PSR2) || defined(SE0398_VDCS)
    Serial.printf("[EPD-SE0398] test settings: PSR2=0x%02X VDCS=0x%02X\n",
#if defined(SE0398_PSR2)
                  SE0398_PSR2,
#else
                  0xFF,
#endif
#if defined(SE0398_VDCS)
                  SE0398_VDCS);
#else
                  0xFF);
#endif
#endif
#endif
}

// ── Partial-window: single row ────────────────────────────────────────

static void se0398SetWriteRow(uint16_t physicalRow) {
    epdSendCommand(0x83);
    epdSendData(0x00);
    epdSendData(0x00);
    epdSendData((W - 1) >> 8);
    epdSendData((W - 1) & 0xFF);
    epdSendData(physicalRow >> 8);
    epdSendData(physicalRow & 0xFF);
    epdSendData(physicalRow >> 8);
    epdSendData(physicalRow & 0xFF);
    epdSendData(0x01);  // PMODE=1
}

// ── Refresh + sleep ───────────────────────────────────────────────────

static void se0398AutoSequence() {
    se0398SetFullWindow();
#if !defined(SE0398_A1)  // (A1: powered on in se0398Init)
    Serial.println("[EPD-SE0398] PON");
    epdSendCommand(0x04);   // PON
    epdWaitBusy("PON", 5000);
#endif
    Serial.printf("[EPD-SE0398] DRF 0x%02X\n", SE0398_DRF_PARAM);
    epdSendCommand(0x12);   // DRF
    epdSendData(SE0398_DRF_PARAM);
    epdWaitBusy("DRF", 60000);
    Serial.println("[EPD-SE0398] POF");
    epdSendCommand(0x02);   // POF
    epdSendData(0x00);
    epdWaitBusy("POF", 5000);
    epdSendCommand(0x07);   // DSLP
    epdSendData(0xA5);
    s_controllerAsleep = true;
}

// ── Core row writer ───────────────────────────────────────────────────

static void se0398WriteRow(int imageRow, const uint8_t *rowData) {
#if defined(SE0398_A1)
    // one full-screen window, then every row in order as one DTM1 transfer
    if (imageRow == 0) {
        se0398SetFullWindow();
        epdSendCommand(0x10);   // DTM1
    }
    digitalWrite(PIN_EPD_DC, HIGH);
    digitalWrite(PIN_EPD_CS, LOW);
    for (int j = 0; j < W / 4; j++) spiWriteByte(rowData[j]);
    digitalWrite(PIN_EPD_CS, HIGH);
    return;
#endif
    uint16_t physicalRow;
    if (imageRow < H / 2) {
        physicalRow = (uint16_t)(imageRow * 2);
    } else {
        physicalRow = (uint16_t)(H - 1) - (uint16_t)(2 * (imageRow - H / 2));
    }

    se0398SetWriteRow(physicalRow);

    epdSendCommand(0x10);   // DTM
    digitalWrite(PIN_EPD_DC, HIGH);
    digitalWrite(PIN_EPD_CS, LOW);
    const int bytesPerRow = W / 4;
    for (int j = 0; j < bytesPerRow; j++) {
        spiWriteByte(rowData[j]);
    }
    digitalWrite(PIN_EPD_CS, HIGH);
}

// ── Streaming frame API ───────────────────────────────────────────────
// The controller's own RAM holds the frame, so callers only need one row
// (W/4 bytes) at a time — same idea the nRF52 reference uses to drive this
// panel with a few KB of RAM. Every image row 0..H-1 must be written once
// between Begin and End.

bool epdStreamBegin() {
    se0398Init();
    return true;
}

void epdStreamAbort() {}  // (the controller memory is simply overwritten next time)

void epdStreamWriteRow(int imageRow, const uint8_t *row2bpp) {
    se0398WriteRow(imageRow, row2bpp);
}

void epdStreamEnd() {
    Serial.println("[EPD-SE0398] refresh");
    se0398AutoSequence();
    Serial.println("[EPD-SE0398] done");
}

// ── GPIO initialization ───────────────────────────────────────────────

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

// ── Public EPD interface ──────────────────────────────────────────────

void epdInit() {
    se0398Init();
}

void epdInitFast() {
    se0398Init();
}

void epdDisplay(const uint8_t *image) {
    epdStreamBegin();
    const int srcBytesPerRow = W / 8;   // 1bpp input
    const int dstBytesPerRow = W / 4;   // 2bpp output
    uint8_t rowBuf[dstBytesPerRow];

    for (int imageRow = 0; imageRow < H; imageRow++) {
        const uint8_t *src = image + imageRow * srcBytesPerRow;
        for (int i = 0; i < srcBytesPerRow; i++) {
            uint8_t b = src[i];
            // Expand 1bpp → 2bpp: 0=black(00), 1=white(01)
            // Each input byte (8 pixels) → 2 output bytes (4 pixels each)
            rowBuf[i * 2]     = (((b >> 7) & 1) << 6) | (((b >> 6) & 1) << 4)
                              | (((b >> 5) & 1) << 2) |  ((b >> 4) & 1);
            rowBuf[i * 2 + 1] = (((b >> 3) & 1) << 6) | (((b >> 2) & 1) << 4)
                              | (((b >> 1) & 1) << 2) |  ((b >> 0) & 1);
        }
        epdStreamWriteRow(imageRow, rowBuf);
    }
    epdStreamEnd();
}

void epdDisplayFast(const uint8_t *image) {
    epdDisplay(image);
}

// ── 2bpp display from RAM buffer ──────────────────────────────────────

void epdDisplay2bpp(const uint8_t *image2bpp) {
    Serial.println("[EPD-SE0398] epdDisplay2bpp");
    epdStreamBegin();
    const int bytesPerRow = W / 4;
    for (int imageRow = 0; imageRow < H; imageRow++) {
        epdStreamWriteRow(imageRow, image2bpp + imageRow * bytesPerRow);
    }
    epdStreamEnd();
}

// ── 2bpp paged display from LittleFS ─────────────────────────────────

#if defined(EPD_COLOR_PAGED)
void epdDisplay2bppPaged(const char *path) {
    File f = LittleFS.open(path, "r");
    if (!f) {
        Serial.println("[EPD-SE0398] color file missing");
        return;
    }

    Serial.println("[EPD-SE0398] epdDisplay2bppPaged");
    epdStreamBegin();

    const int bytesPerRow = W / 4;
    uint8_t lineBuf[bytesPerRow];

    for (int imageRow = 0; imageRow < H; imageRow++) {
        int n = f.read(lineBuf, bytesPerRow);
        if (n < bytesPerRow) {
            Serial.printf("[EPD-SE0398] short read at row %d\n", imageRow);
            break;
        }
        epdStreamWriteRow(imageRow, lineBuf);
    }

    f.close();
    epdStreamEnd();
}
#endif

// No old-frame differential support on this controller; plain partial refresh.
void epdPartialDisplayWithOld(uint8_t *data, const uint8_t *oldData, int xStart, int yStart, int xEnd, int yEnd) {
    (void)oldData;
    epdPartialDisplay(data, xStart, yStart, xEnd, yEnd);
}

void epdPartialDisplay(uint8_t *data, int xStart, int yStart, int xEnd, int yEnd) {
    (void)data; (void)xStart; (void)yStart; (void)xEnd; (void)yEnd;
}

void epdSleep() {
    // Every refresh already ends in DSLP. Sending POF again would wait on a BUSY
    // line that stays LOW in deep sleep, burning the full timeout (~30s) awake.
    if (s_controllerAsleep) return;
    epdSendCommand(0x02);
    epdWaitBusy("sleep POF");
    epdSendCommand(0x07);
    epdSendData(0xA5);
    s_controllerAsleep = true;
}

#endif  // EPD_PANEL_398_SE0398NZ07A0
