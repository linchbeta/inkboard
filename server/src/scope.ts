// Which user (and screen) a request or a device frame belongs to. Admin requests run as
// the logged-in user, device frames as the device's owner and the device; per-user data
// (settings keys, photos, devices) is then read and written for that user only.
// AsyncLocalStorage carries the scope through awaits, so the data modules need no extra
// parameter.
//
// What a screen shows is its own: each layout's content (todo list, events, weather city,
// photo selection…) is stored per screen as "d:<mac>:<key>". Screens can be synced per
// layout (see content.ts): a write then goes to every screen of the sync group. Reads
// fall back to the user's value from before content was per screen ("u:<id>:<key>").
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ userId: number; device?: string }>();

export function runAs<T>(userId: number, fn: () => T, device?: string): T {
  return store.run({ userId, device }, fn);
}

/** The current user's id, or undefined outside any user's context. */
export function currentUser(): number | undefined {
  return store.getStore()?.userId;
}

/** The screen whose content is being read or edited, if any. */
export function currentDevice(): string | undefined {
  return store.getStore()?.device;
}

/** Setting keys that belong to a user (everything else is shared, e.g. holiday data). */
const USER_KEYS = /^(mode:|messages$|weather_place$|weather_cache$|photo_|poetry:|counter:|quote:|study:|test_date$|screen$)/;
/** Of those, a screen's content. */
const DEVICE_KEYS = /^(mode:|poetry:|counter:|quote:|study:|weather_place$|weather_cache$)/;
export const isDeviceKey = (key: string) => DEVICE_KEYS.test(key);

/** The sync unit a content key belongs to: a layout id, or "weather" (日期牌 and 天气 share the city). */
export function syncIdOf(key: string): string {
  if (key.startsWith("mode:")) return key.slice(5);
  if (key.startsWith("counter:")) return key.slice(8);
  if (key.startsWith("poetry:")) return "poetry";
  if (key.startsWith("study:")) return "words";
  if (key.startsWith("quote:")) return key.startsWith("quote:dashboard") ? "dashboard" : "hitokoto";
  return "weather";
}

/** The current scope (user, and screen if any). */
export const scopeOf = () => store.getStore();

export const userKey = (userId: number, key: string) => `u:${userId}:${key}`;
export const deviceKey = (mac: string, key: string) => `d:${mac}:${key}`;

/** Stored keys for `key` in the current scope, in read order; writes go to the first. */
export function scopedKeys(key: string): string[] {
  const s = store.getStore();
  if (!s || !USER_KEYS.test(key)) return [key];
  const u = userKey(s.userId, key);
  if (!s.device || !DEVICE_KEYS.test(key)) return [u];
  // a word plan is never inherited: screens starting from the same one (same shuffle,
  // same place) would show the same words in step
  return key.startsWith("study:") ? [deviceKey(s.device, key)] : [deviceKey(s.device, key), u];
}

export const isUserKey = (key: string) => USER_KEYS.test(key);

/**
 * The user's test date ("设置 → 测试日期"): that day, at the real time of day. `read`
 * returns the stored setting (passed in to keep this module free of the database).
 */
export function withTestDate(t: Date, read: () => string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(read());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), t.getHours(), t.getMinutes(), t.getSeconds()) : t;
}
