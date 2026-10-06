#include "offline_cache.h"
#include <LittleFS.h>

static const char *CACHE_FILE       = "/cache.bmp";
static const char *COLOR_CACHE_FILE = "/cache_color.bin";
static const char *COLOR_RAW_FILE   = "/color.raw";
static bool fsReady = false;

bool cacheInit() {
    if (!LittleFS.begin(true)) {  // true = format on failure
        Serial.println("LittleFS mount failed");
        return false;
    }
    fsReady = true;
    Serial.println("LittleFS ready");
    return true;
}

bool cacheSave(const uint8_t *buf, int len) {
    if (!fsReady) return false;
    File f = LittleFS.open(CACHE_FILE, "w");
    if (!f) {
        Serial.println("Cache write failed: cannot open file");
        return false;
    }
    size_t written = f.write(buf, len);
    f.close();
    Serial.printf("Cache saved: %d bytes\n", written);
    return (int)written == len;
}

bool cacheLoad(uint8_t *buf, int len) {
    if (!fsReady) return false;
    File f = LittleFS.open(CACHE_FILE, "r");
    if (!f) {
        Serial.println("No cache file found");
        return false;
    }
    size_t read = f.readBytes((char *)buf, len);
    f.close();
    Serial.printf("Cache loaded: %d bytes\n", read);
    return (int)read == len;
}

bool cacheExists() {
    if (!fsReady) return false;
    return LittleFS.exists(CACHE_FILE);
}

bool colorCacheSave(const uint8_t *buf, int len) {
    if (!fsReady) return false;
    File f = LittleFS.open(COLOR_CACHE_FILE, "w");
    if (!f) {
        Serial.println("Color cache write failed");
        return false;
    }
    size_t written = f.write(buf, len);
    f.close();
    Serial.printf("Color cache saved: %d bytes\n", written);
    return (int)written == len;
}

bool colorCacheLoad(uint8_t *buf, int len) {
    if (!fsReady) return false;
    File f = LittleFS.open(COLOR_CACHE_FILE, "r");
    if (!f) return false;
    size_t read = f.readBytes((char *)buf, len);
    f.close();
    Serial.printf("Color cache loaded: %d bytes\n", read);
    return (int)read == len;
}

bool colorCacheExists() {
    if (!fsReady) return false;
    return LittleFS.exists(COLOR_CACHE_FILE);
}

bool colorRawExists() {
    if (!fsReady) return false;
    return LittleFS.exists(COLOR_RAW_FILE);
}

uint32_t colorRawChecksum() {
    if (!fsReady) return 0;
    File f = LittleFS.open(COLOR_RAW_FILE, "r");
    if (!f) return 0;
    uint32_t sum = 0;
    uint8_t buf[512];
    while (f.available()) {
        int n = f.read(buf, sizeof(buf));
        if (n <= 0) break;
        for (int i = 0; i < n; i++) sum += buf[i];
    }
    f.close();
    return sum;
}

void colorCacheClear() {
    if (!fsReady) return;
    if (LittleFS.exists(COLOR_CACHE_FILE)) LittleFS.remove(COLOR_CACHE_FILE);
    if (LittleFS.exists(COLOR_RAW_FILE)) LittleFS.remove(COLOR_RAW_FILE);
}
