#ifndef INKSIGHT_DISPLAY_H
#define INKSIGHT_DISPLAY_H

#include <Arduino.h>

// Whether the panel currently shows the frame held in the offline cache. Kept in RTC
// memory, so it survives deep sleep (e-paper keeps its image without power). Status
// screens (setup/error/diagnostic/preview...) clear it; callers set it after showing
// fetched content. Lets offline mode skip a pointless full refresh.
void displayMarkShowsCachedFrame(bool shows);
bool displayShowsCachedFrame();

// The local calendar of `ymd` (yyyymmdd) is on the panel (RTC memory too); any other
// screen clears it.
void displayMarkLocalCalendar(int32_t ymd);
bool displayShowsLocalCalendar(int32_t ymd);

// ETag of the server frame on the panel ("" if something else is there): sent as
// If-None-Match, so an unchanged frame is neither downloaded nor refreshed.
const char *displayFrameEtag();

// Look up glyph data for a character (5x7 pixel font)
const uint8_t* getGlyph(char c);

// Draw scaled text into imgBuf at (x, y)
void drawText(const char *msg, int x, int y, int scale);

// Show WiFi setup screen with AP name
void showSetupScreen(const char *apName);

// Show centered error message on screen
void showError(const char *msg);

// Show diagnostic screen with up to 4 lines
void showDiagnostic(const char *line1, const char *line2, const char *line3, const char *line4);

// Dedicated status screen for local AI chat flow
void showAiChatStatus(const char *state, const char *detail);

// Single-turn: small partial-refresh overlay in footer.
// footerCenter=true puts icon centered; false puts it bottom-right.
void showVoiceIndicator(bool footerCenter = false);
void hideVoiceIndicator();

// Multi-turn: full-screen with large centered robot icon (uses fast full refresh).
void showVoiceChatScreen();

int currentPeriodIndex();

void updateTimeDisplay();

// Refresh the reveal/control region from the current vocab review imgBuf.
void updateVocabRatingRegion(const uint8_t *oldImage = nullptr);

// Smart display: uses no-flash partial refresh normally, full refresh every N cycles
void smartDisplay(const uint8_t *image);

// Show mode name preview screen (displayed briefly on double-click before loading)
void showModePreview(const char *modeName);

#endif // INKSIGHT_DISPLAY_H
