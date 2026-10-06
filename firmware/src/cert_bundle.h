// Root certificates trusted for HTTPS (generated: tools/make_cert_bundle.py, src/cert_bundle.cpp).
// Common public CAs (Let's Encrypt, DigiCert, Sectigo, GlobalSign, GoDaddy, ...), so the
// server can sit behind any usual HTTPS reverse proxy.
#pragma once
#include <WiFiClientSecure.h>

extern const uint8_t CERT_BUNDLE[];

// Makes `client` verify servers against the bundled roots (call before connecting).
void setTrustedRoots(WiFiClientSecure &client);
