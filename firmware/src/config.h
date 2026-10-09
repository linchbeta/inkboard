#ifndef INKSIGHT_CONFIG_H
#define INKSIGHT_CONFIG_H

#include <Arduino.h>

#if defined(BOARD_PROFILE_ESP32_C3)
#define PIN_EPD_MOSI   6
#define PIN_EPD_SCK    4
#define PIN_EPD_CS     7
#define PIN_EPD_DC     1
#define PIN_EPD_RST    2
#define PIN_EPD_BUSY   10
#define PIN_BAT_ADC    0
#define PIN_CFG_BTN    9
#if defined(BOARD_VARIANT_C3_LED5)
#define PIN_LED        5   // local board: LED on GPIO5 (envs *_led5)
#else
#define PIN_LED        3   // upstream board
#endif
#define PIN_AI_CHAT_SW -1
#elif defined(BOARD_PROFILE_ESP32_C3_WROOM02)
#define PIN_EPD_MOSI   6
#define PIN_EPD_SCK    4
#define PIN_EPD_CS     7
#define PIN_EPD_DC     1
#define PIN_EPD_RST    2
#define PIN_EPD_BUSY   10
#define PIN_BAT_ADC    0
#define PIN_CFG_BTN    9
#define PIN_LED        5
#define PIN_AI_CHAT_SW -1
#elif defined(BOARD_PROFILE_ESP32_WROOM32E)
#define PIN_EPD_MOSI   14
#define PIN_EPD_SCK    13
#define PIN_EPD_CS     15
#define PIN_EPD_DC     27
#define PIN_EPD_RST    26
#define PIN_EPD_BUSY   25
#define PIN_BAT_ADC    35
#define PIN_CFG_BTN    0
#define PIN_LED        2
#define PIN_EPD_MISO   -1
#define PIN_AI_CHAT_SW 23
#define BOARD_HAS_AUDIO
#elif defined(BOARD_PROFILE_SMT_WROOM32E)
#define PIN_EPD_MOSI   14
#define PIN_EPD_SCK    13
#define PIN_EPD_CS     15
#define PIN_EPD_DC     27
#define PIN_EPD_RST    26
#define PIN_EPD_BUSY   25
#define PIN_BAT_ADC    35
#define PIN_CFG_BTN    0
#define PIN_LED        2
#define PIN_AI_CHAT_SW 4
#define BOARD_HAS_AUDIO
#elif defined(BOARD_PROFILE_SMT_C3)
#define PIN_EPD_MOSI   6
#define PIN_EPD_SCK    4
#define PIN_EPD_CS     7
#define PIN_EPD_DC     1
#define PIN_EPD_RST    2
#define PIN_EPD_BUSY   10
#define PIN_BAT_ADC    0
#ifndef PIN_CFG_BTN
#define PIN_CFG_BTN    9
#endif
#define PIN_LED        5
#define PIN_AI_CHAT_SW -1
#elif defined(BOARD_PROFILE_YD_ESP32_S3_N16R8)
#define PIN_EPD_MOSI   11
#define PIN_EPD_SCK    12
#define PIN_EPD_CS     10
#define PIN_EPD_DC     9
#define PIN_EPD_RST    8
#define PIN_EPD_BUSY   7
#define PIN_BAT_ADC    4
#define PIN_CFG_BTN    0
#define PIN_LED        -1
#define PIN_RGB_LED    48
#define PIN_AI_CHAT_SW -1
#else
#error "Unsupported board profile"
#endif

#ifndef PIN_RGB_LED
#define PIN_RGB_LED -1
#endif

// ── Display constants ────────────────────────────────────────
// Default for 4.2" E-Paper (400x300, 1-bit).
// Override via build flags: -D EPD_WIDTH=800 -D EPD_HEIGHT=480
// Supported configurations:
//   4.2"  (400x300) - default
//   2.9"  (296x128)
//   5.83" (648x480)
//   7.5"  (800x480)
//   5.65" (600x448), 7.5" V1 (640x384), 7.3" (800x480)
#ifndef EPD_WIDTH
#define EPD_WIDTH  400
#endif
#ifndef EPD_HEIGHT
#define EPD_HEIGHT 300
#endif

static const int W = EPD_WIDTH;
static const int H = EPD_HEIGHT;
static const int ROW_BYTES   = W / 8;
static const int ROW_STRIDE  = (ROW_BYTES + 3) & ~3;  // BMP row stride (4-byte aligned)
static const int IMG_BUF_LEN = ROW_BYTES * H;
/** Preprocessor image buffer size for #if (IMG_BUF_LEN is not a cpp constant). */
#define INKSIGHT_IMG_BUF_BYTES_MACRO ((EPD_WIDTH / 8) * (EPD_HEIGHT))

#ifndef EPD_BPP
#define EPD_BPP 1
#endif
static const int COLOR_BUF_LEN = (W * H) / 4;  // 2bpp: 4 pixels per byte

// ── UC8179 controller macro ──────────────────────────────────
// 5.83" UC8179: color builds use the BWR driver (epd_driver_uc8179.cpp);
// mono builds (EPD_BPP=1) use the upstream GxEPD2 driver in epd_driver.cpp.
#if (defined(EPD_PANEL_583_UC8179) && (EPD_BPP >= 2 || defined(EPD_COLOR_PAGED))) || defined(EPD_PANEL_75_GDEY075Z08) \
    || defined(EPD_PANEL_42_UC8176_BWR)
#define EPD_CONTROLLER_UC8179
#endif

// ── UC8159 (epd_driver_uc8159.cpp) ───────────────────────────
// 5.65" 7-colour, 7.5" 640x384 and 5.83" 600x448 B/W/R and B/W.
#if defined(EPD_PANEL_565_UC8159) || defined(EPD_PANEL_75_UC8159_BWR) || defined(EPD_PANEL_75_UC8159_BW) \
    || defined(EPD_PANEL_583_UC8159_BWR) || defined(EPD_PANEL_583_UC8159_BW)
#define EPD_CONTROLLER_UC8159
#endif

// ── 7.3" 7-colour / Spectra 6 (epd_driver_73_color.cpp) ──────
#if defined(EPD_PANEL_73_ACEP) || defined(EPD_PANEL_73_SPECTRA6)
#define EPD_CONTROLLER_73_COLOR
#endif

// ── JD79665 (epd_driver_jd79665.cpp) and SSD1677 (epd_driver_ssd1677.cpp) ──
#if defined(EPD_PANEL_75_JD79665) || defined(EPD_PANEL_583_JD79665)
#define EPD_CONTROLLER_JD79665
#endif
#if defined(EPD_PANEL_75HD_SSD1677_BWR) || defined(EPD_PANEL_75HD_SSD1677_BW) || defined(EPD_PANEL_97_SSD_BWR)
#define EPD_CONTROLLER_SSD1677
#endif

// ── SSD1680 4.2" B/W/R: B/W with its own LUTs, or 3-colour (epd_driver_ssd1680.cpp) ──
#if defined(EPD_PANEL_42_SSD1680_BW) || defined(EPD_PANEL_42_SSD1680_BWR)
#define EPD_CONTROLLER_SSD1680
#endif

// ── EPD color capability ─────────────────────────────────────
// 2 = BW only, 3 = BWR (tri-color), 4 = BWRY (quad-color)
#if (defined(EPD_CONTROLLER_UC8179) || defined(EPD_PANEL_42_HINK_SSD1683) || defined(EPD_PANEL_42_WFT) \
     || defined(EPD_PANEL_75_UC8159_BWR) || defined(EPD_PANEL_583_UC8159_BWR) \
     || defined(EPD_PANEL_75HD_SSD1677_BWR) || defined(EPD_PANEL_97_SSD_BWR) \
     || defined(EPD_PANEL_42_SSD1680_BWR)) && (EPD_BPP >= 2 || defined(EPD_COLOR_PAGED))
#define EPD_COLOR_CAPABILITY 3
#elif EPD_BPP >= 2 || defined(EPD_COLOR_PAGED)
#define EPD_COLOR_CAPABILITY 4
#else
#define EPD_COLOR_CAPABILITY 2
#endif

// ── Diagonal (inches), reported to the server (&inch=) ───────
// Panels of one resolution can differ in size (800x480: 3.97", 4.26", 7.3", 7.5"), so the
// server cannot tell from width and height alone what to call the screen.
#if defined(EPD_PANEL_29)
#define EPD_INCH "2.9"
#elif defined(EPD_PANEL_397_GDEM0397T81)
#define EPD_INCH "3.97"
#elif defined(EPD_PANEL_398_SE0398NZ07A0)
#define EPD_INCH "3.98"
#elif defined(EPD_PANEL_42_HINK_SSD1683) \
    || defined(EPD_PANEL_42_SSD1683_BW) \
    || defined(EPD_PANEL_42_DKE_RY683) \
    || defined(EPD_PANEL_42_GDEM042F52) \
    || defined(EPD_PANEL_42_GXEPD2_T81) \
    || defined(EPD_PANEL_42_GXEPD2_GYE042A87) \
    || defined(EPD_PANEL_42_GXEPD2_420) \
    || defined(EPD_PANEL_42_GXEPD2_M01) \
    || defined(EPD_PANEL_42_WFT) \
    || defined(EPD_PANEL_42_UC8176_BWR) \
    || defined(EPD_PANEL_42_SE0420NQ04) \
    || defined(EPD_PANEL_42_SSD1680_BW) \
    || defined(EPD_PANEL_42_SSD1680_BWR)
#define EPD_INCH "4.2"
#elif defined(EPD_PANEL_426_GDEQ0426T82)
#define EPD_INCH "4.26"
#elif defined(EPD_PANEL_565_UC8159)
#define EPD_INCH "5.65"
#elif defined(EPD_PANEL_576_GDEH0576T81)
#define EPD_INCH "5.76"
#elif defined(EPD_PANEL_583) \
    || defined(EPD_PANEL_583_UC8179) \
    || defined(EPD_PANEL_583_UC8159_BW) \
    || defined(EPD_PANEL_583_UC8159_BWR) \
    || defined(EPD_PANEL_583_JD79665) \
    || defined(EPD_PANEL_583_GDEW0583T8)
#define EPD_INCH "5.83"
#elif defined(EPD_PANEL_73_ACEP) \
    || defined(EPD_PANEL_73_SPECTRA6)
#define EPD_INCH "7.3"
#elif defined(EPD_PANEL_75) \
    || defined(EPD_PANEL_75_GDEY075Z08) \
    || defined(EPD_PANEL_75_UC8159_BW) \
    || defined(EPD_PANEL_75_UC8159_BWR) \
    || defined(EPD_PANEL_75_JD79665) \
    || defined(EPD_PANEL_75HD_SSD1677_BW) \
    || defined(EPD_PANEL_75HD_SSD1677_BWR) \
    || defined(EPD_PANEL_75_GDEY075T7)
#define EPD_INCH "7.5"
#elif defined(EPD_PANEL_97_SSD_BWR)
#define EPD_INCH "9.7"
#elif defined(EPD_PANEL_102_GDEM102T91)
#define EPD_INCH "10.2"
#elif defined(EPD_PANEL_116_GDEH116T91)
#define EPD_INCH "11.6"
#elif defined(EPD_PANEL_133_GDEM133T91)
#define EPD_INCH "13.3"
#else
#define EPD_INCH ""  // (not sent)
#endif

#if defined(EPD_COLOR_PAGED)
#define EPD_COLOR_FILE "/color.raw"
#endif

// Shared framebuffers (defined in main.cpp)
extern uint8_t imgBuf[];
#if EPD_BPP >= 2 && !defined(EPD_COLOR_PAGED)
extern uint8_t *colorBuf;
bool ensureColorBuf();
#endif
#if EPD_BPP >= 2 || defined(EPD_COLOR_PAGED)
extern bool useColorBuf;
#endif

// ── Refresh strategy ─────────────────────────────────────────
static const int FULL_REFRESH_INTERVAL = 10;  // Full refresh every N updates to clear ghosting

// ── Config defaults ─────────────────────────────────────────
static const char *DEFAULT_SERVER  = "";  // Must be set via captive portal
static const int   WIFI_TIMEOUT    = 15000;   // ms
static const int   MAX_WIFI_NETWORKS = 5;     // Max saved WiFi credentials (tried in order on boot)
static const int   HTTP_TIMEOUT    = 30000;   // ms
static const int   CFG_BTN_HOLD_MS = 2000;    // Long press duration to trigger config mode
static const int   AI_CHAT_BTN_HOLD_MS = 3000; // Long press duration to enter AI chat mode
static const int   VOCAB_ENTER_HOLD_MS = 2000; // Long press duration to enter vocab review
static const int   VOCAB_BTN_HOLD_MS = 1500;  // Long press duration to submit vocab rating
static const int   VOCAB_EXIT_HOLD_MS = 5000; // Long press duration to exit vocab review
static const int   SHORT_PRESS_MIN_MS = 50;   // Minimum short press duration (debounce)
static const int   LIVE_POLL_MS = 5000;       // Poll interval for pending remote actions
static const int   LIVE_WIFI_RETRY_MS = 5000; // Retry interval when WiFi is disconnected
static const unsigned long TEMP_ONLINE_WINDOW_MS = 10UL * 60UL * 1000UL;
static const unsigned long PORTAL_AUTO_TIMEOUT_MS = 3UL * 60UL * 1000UL;
static const unsigned long PORTAL_MANUAL_TIMEOUT_MS = 10UL * 60UL * 1000UL;
static const unsigned long HEARTBEAT_INTERVAL_MS = 10UL * 60UL * 1000UL;
static const int   MAX_RETRY_COUNT = 5;       // Max retries before deep sleep
// WiFi -> captive portal fallback: when ALL saved networks fail to connect,
// do this many quick in-place retry sweeps (no reboot) before opening the AP.
// Keeps the portal fast to appear (user is likely waiting to reconfigure)
// while still riding out a brief blip such as a router rebooting.
static const int           WIFI_PORTAL_RETRY_SWEEPS   = 1;
static const unsigned long WIFI_PORTAL_RETRY_DELAY_MS = 3000;
// Progressive retry delays in seconds: 5s, 15s, 30s, 60s, 120s
static const int   RETRY_DELAYS[] = {5, 15, 30, 60, 120};

// ── Time zone ───────────────────────────────────────────────
#define NTP_UTC_OFFSET  (8 * 3600)  // UTC+8 (China Standard Time), adjust for your region

// ── Debug mode ──────────────────────────────────────────────
#ifndef DEBUG_MODE
#define DEBUG_MODE 0  // 1 = fast refresh (1 min) for testing; set with -DDEBUG_MODE=1 (see *_test envs)
#endif
#if DEBUG_MODE
static const int DEBUG_REFRESH_MIN = 1;  // 1 minute for debugging
#endif

// ── Time display region (partial refresh area) ──────────────
// Proportional to screen size (scales across 2.9"/4.2"/7.5")
#define TIME_RGN_X0   (0)
#define TIME_RGN_X1   ((W * 14 / 100) & ~7)
#define TIME_RGN_Y0   (H * 2 / 100)
#define TIME_RGN_Y1   (H * 8 / 100)

#define TIME_TEXT_X   (W * 1 / 100)
#define TIME_TEXT_Y   (H * 4 / 100)

#ifndef AUTO_BOOT_AI_CHAT
#define AUTO_BOOT_AI_CHAT 0
#endif
#ifndef VOCAB_REVIEW_BUILD
#define VOCAB_REVIEW_BUILD 0
#endif

#endif // INKSIGHT_CONFIG_H
