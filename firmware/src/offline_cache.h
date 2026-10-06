#ifndef INKSIGHT_OFFLINE_CACHE_H
#define INKSIGHT_OFFLINE_CACHE_H

#include <Arduino.h>

// Initialize LittleFS filesystem
bool cacheInit();

// Save current imgBuf to flash cache
bool cacheSave(const uint8_t *buf, int len);

// Load cached image into imgBuf, returns true if cache exists
bool cacheLoad(uint8_t *buf, int len);

// Check if cache file exists
bool cacheExists();

// Save/load color buffer (2bpp layer) for offline replay
// Only meaningful when EPD_BPP >= 2 and EPD_COLOR_PAGED is not defined
bool colorCacheSave(const uint8_t *buf, int len);
bool colorCacheLoad(uint8_t *buf, int len);
bool colorCacheExists();

// Check if /color.raw (paged color frame) exists — valid offline cache for EPD_COLOR_PAGED panels
bool colorRawExists();

// Byte-sum checksum of /color.raw (same scheme as the in-memory frame checksum);
// returns 0 if the file is missing. Used to skip refreshes when paged color content is unchanged.
uint32_t colorRawChecksum();

// Remove color caches (/cache_color.bin and /color.raw) so a newer mono frame wins offline
void colorCacheClear();

#endif
