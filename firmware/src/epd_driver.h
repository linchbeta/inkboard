#ifndef INKSIGHT_EPD_DRIVER_H
#define INKSIGHT_EPD_DRIVER_H

#include <Arduino.h>

// Initialize GPIO pins and SPI for EPD
void gpioInit();

// Initialize EPD controller (full refresh mode)
void epdInit();

// Initialize EPD controller in fast refresh mode
void epdInitFast();

// Full-screen display with full refresh (clears ghosting, has black-white flash)
void epdDisplay(const uint8_t *image);

// Deep clear: multi-cycle black/white flush then display image (eliminates stubborn ghosting)
void epdDisplayDeepClear(const uint8_t *image);

// Full-screen display with pre-packed 2bpp data (4-color panels)
void epdDisplay2bpp(const uint8_t *image2bpp);

// Full-screen display with fast refresh (reduced flashing)
void epdDisplayFast(const uint8_t *image);

// Partial display refresh for a rectangular region
bool epdSupportsPartialRefresh();
void epdPartialDisplay(uint8_t *data, int xStart, int yStart, int xEnd, int yEnd);
void epdPartialDisplayWithOld(uint8_t *data, const uint8_t *oldData, int xStart, int yStart, int xEnd, int yEnd);

// Put EPD into deep sleep mode
void epdSleep();

#if defined(EPD_COLOR_PAGED)
// Full-screen display from paged 2bpp file on LittleFS (for large color panels)
void epdDisplay2bppPaged(const char *path);
#endif

#if defined(EPD_PANEL_398_SE0398NZ07A0)
// Two versions of the panel: A0 (JD79660, the default) and A1 (JD79661, build with
// -DSE0398_A1). Same 2bpp data; A1 needs a long init and takes the frame in order.
// DRF (display refresh) parameter: A0 0x00, A1 0x01 as the EPD-nRF5 reference. The JD79660
// datasheet (8.2.9) marks every bit of it "don't care", so 0x00 and 0x01 refresh the same.
// Panel tuning for tests (A0, off by default): -DSE0398_PSR2=0x.. (2nd PSR byte, e.g. 0x29
// = the MTP default 0x09 + FOPT) and -DSE0398_VDCS=0x.. (VCOM DC, 0.05 V steps below 0 V).
// Tried on a panel with a faint mirrored band (the panel's own fault, it moved with the
// panel): neither helped, and VCOM DC 0 V / -0.5 V / -1.5 V turned the whole screen
// yellowish -- the panel's MTP value was best.
#ifndef SE0398_DRF_PARAM
#if defined(SE0398_A1)
#define SE0398_DRF_PARAM 0x01
#else
#define SE0398_DRF_PARAM 0x00
#endif
#endif

#endif

// Panels whose driver takes a frame row by row into the controller's own memory: frames
// are streamed from the network, without a frame buffer. (UC8179: the black plane goes to
// the controller as it arrives, the colour plane waits in RAM -- half the 2bpp frame.)
#if (defined(EPD_PANEL_398_SE0398NZ07A0) || defined(EPD_PANEL_42_HINK_SSD1683) \
     || defined(EPD_PANEL_583_UC8179) || defined(EPD_PANEL_75_GDEY075Z08)) \
    && ((defined(EPD_BPP) && EPD_BPP >= 2) || defined(EPD_COLOR_PAGED))  // (colour builds)
#define EPD_STREAMS_FRAMES 1
// Row-streaming frame API: a caller only needs one 2bpp row (W/4 bytes) at a time.
// Begin (false: not enough memory), every row 0..H-1 in order, then End to refresh --
// or Abort when the frame is not complete or not to be shown.
bool epdStreamBegin();
void epdStreamWriteRow(int imageRow, const uint8_t *row2bpp);
void epdStreamEnd();
void epdStreamAbort();
#else
#define EPD_STREAMS_FRAMES 0
#endif

#if defined(EPD_SELFTEST)
// Built-in fine-detail test pattern (1px lines, checkerboards, colour swatches,
// 1px text). Supported on SE0398 and HINK 4.2" SSD1683; see selftest.cpp.
void epdShowSelfTest();
#endif

#endif // INKSIGHT_EPD_DRIVER_H
