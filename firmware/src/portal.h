#ifndef INKSIGHT_PORTAL_H
#define INKSIGHT_PORTAL_H

#include <Arduino.h>

// Portal state
extern bool portalActive;
extern bool wifiConnected;

// Start the captive portal (AP mode + web server)
void startCaptivePortal();

// Process pending portal HTTP/DNS requests (call in loop)
void handlePortalClients();

// Stop the hotspot and web server (leaving setup without a restart).
void stopCaptivePortal();

// The page asked for calendar-only mode (handled by the main loop).
extern bool g_portalCalendarRequested;

#endif // INKSIGHT_PORTAL_H
