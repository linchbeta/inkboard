// Per-device settings and the "what does this device show now" logic.
//
// Each device has a playlist of modes. An item may be limited to a time window (and to
// workdays / weekends); items whose window is open take precedence, otherwise the
// untimed items play. Items rotate (in order or shuffled) on every refresh, or every N
// minutes; or only the first one plays. A mode can be
// pinned for a while ("临时显示"), overriding the playlist. Also per device: the wake-up
// schedule, the large-text font and live mode.
import { type Db, type Device, getSetting } from "../db.js";
import { DEFAULT_SCHEDULE, type Schedule } from "../schedule.js";
import { type Orientation, isOrientation } from "../panels.js";

export interface PlaylistItem {
  mode: string;
  /** "HH:MM" local time window [from, to); may wrap past midnight. Both or neither. */
  from?: string;
  to?: string;
  days?: "all" | "workday" | "weekend";
}

export interface DeviceSettings {
  name: string;
  playlist: PlaylistItem[];
  /** "refresh": next item on every refresh; a number: next item every that many minutes. */
  rotate: "refresh" | number;
  /** In order, shuffled, or only the first item that is on. */
  order: "sequence" | "random" | "single";
  /** Shown instead of the playlist until `until` (ISO) — or for one refresh if `once`. */
  pin?: { mode: string; until?: string; once?: boolean };
  schedule: Schedule;
  /** Large-text font: "wenkai" (default), "sans" (Noto Sans SC), "pixel" (4.2" only). */
  font: "wenkai" | "sans" | "pixel";
  /** Live mode: the firmware stays awake (USB power). */
  live: boolean;
  /** How the screen stands; layouts are drawn upright for it. */
  orientation: Orientation;
}

interface DeviceState { cursor: number; lastMode?: string }

export const DEFAULT_MODE = "datecard";

export function defaultSettings(db: Db): DeviceSettings {
  // the global switch of earlier versions seeds the first playlist
  const legacy = getSetting(db, "screen", "");
  return {
    name: "",
    playlist: [{ mode: legacy && legacy !== "test" ? legacy : DEFAULT_MODE }],
    rotate: "refresh",
    order: "sequence",
    schedule: { ...DEFAULT_SCHEDULE },
    font: "wenkai",
    live: false,
    orientation: "landscape",
  };
}

const parse = <T>(s: string | null | undefined): Partial<T> => {
  try { return s ? JSON.parse(s) as Partial<T> : {}; } catch { return {}; }
};

export function getSettings(db: Db, device: Pick<Device, "settings">): DeviceSettings {
  const d = defaultSettings(db);
  const s = parse<DeviceSettings>(device.settings);
  return {
    ...d, ...s,
    playlist: Array.isArray(s.playlist) && s.playlist.length ? s.playlist : d.playlist,
    schedule: { ...d.schedule, ...(s.schedule ?? {}) },
    orientation: isOrientation(s.orientation) ? s.orientation : d.orientation,
  };
}

const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Cleans settings coming from the admin form (unknown modes are dropped by the caller). */
export function sanitizeSettings(s: Partial<DeviceSettings>, base: DeviceSettings): DeviceSettings {
  const out: DeviceSettings = { ...base };
  if (typeof s.name === "string") out.name = s.name.trim().slice(0, 24);
  if (Array.isArray(s.playlist)) {
    out.playlist = s.playlist.filter((i) => i && typeof i.mode === "string" && i.mode).slice(0, 20).map((i) => {
      const item: PlaylistItem = { mode: i.mode };
      if (i.from && i.to && HM.test(i.from) && HM.test(i.to) && i.from !== i.to) { item.from = i.from; item.to = i.to; }
      if (i.days === "workday" || i.days === "weekend") item.days = i.days;
      return item;
    });
    if (!out.playlist.length) out.playlist = [{ mode: DEFAULT_MODE }];
  }
  if (s.rotate === "refresh" || (typeof s.rotate === "number" && [15, 30, 60, 120, 180, 360, 720, 1440].includes(s.rotate))) out.rotate = s.rotate;
  if (s.schedule) {
    const n = (v: unknown, d: number, lo: number, hi: number) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);
    const sc = { ...base.schedule };
    sc.dayStartHour = n(s.schedule.dayStartHour, sc.dayStartHour, 0, 23);
    sc.dayEndHour = n(s.schedule.dayEndHour, sc.dayEndHour, 1, 24);
    if (sc.dayEndHour <= sc.dayStartHour) sc.dayEndHour = Math.min(24, sc.dayStartHour + 1);
    sc.dayMinutes = n(s.schedule.dayMinutes, sc.dayMinutes, 10, 240);
    sc.nightMinutes = n(s.schedule.nightMinutes, sc.nightMinutes, 10, 1440);
    out.schedule = sc;
  }
  if (s.order === "sequence" || s.order === "random" || s.order === "single") out.order = s.order;
  if (s.font === "wenkai" || s.font === "sans" || s.font === "pixel") out.font = s.font;
  if (typeof s.live === "boolean") out.live = s.live;
  if (isOrientation(s.orientation)) out.orientation = s.orientation;
  if (s.pin === undefined || s.pin === null) out.pin = undefined;
  else if (typeof s.pin.mode === "string") out.pin = { mode: s.pin.mode, until: s.pin.until, once: s.pin.once };
  return out;
}

export function saveSettings(db: Db, mac: string, s: DeviceSettings): void {
  db.prepare("UPDATE device SET settings = ? WHERE mac = ?").run(JSON.stringify(s), mac);
}

const toMin = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };

/** Is the item's time window (and day filter) open at `now`? Untimed items: always. */
export function itemActive(i: PlaylistItem, now: Date): boolean {
  const dow = now.getDay();
  if (i.days === "workday" && (dow === 0 || dow === 6)) return false;
  if (i.days === "weekend" && dow !== 0 && dow !== 6) return false;
  if (!i.from || !i.to) return true;
  const t = now.getHours() * 60 + now.getMinutes(), a = toMin(i.from), b = toMin(i.to);
  return a < b ? t >= a && t < b : t >= a || t < b; // wraps past midnight
}

/** The items that play now: open time windows first, else the untimed ones. */
export function activeItems(s: DeviceSettings, now: Date): PlaylistItem[] {
  const windowed = s.playlist.filter((i) => i.from && itemActive(i, now));
  if (windowed.length) return windowed;
  const untimed = s.playlist.filter((i) => !i.from && itemActive(i, now));
  return untimed.length ? untimed : s.playlist.filter((i) => !i.from).length ? s.playlist.filter((i) => !i.from) : s.playlist;
}

/**
 * The mode the device shows at `now`. `advance` (a real device request, not a preview)
 * moves the "every refresh" rotation on and uses up a one-refresh pin.
 */
export function pickMode(db: Db, device: Pick<Device, "mac" | "settings" | "state">, now: Date, advance: boolean): { mode: string; pinned: boolean } {
  const s = getSettings(db, device);
  if (s.pin && (s.pin.once || !s.pin.until || now < new Date(s.pin.until))) {
    if (advance && s.pin.once) saveSettings(db, device.mac, { ...s, pin: undefined });
    return { mode: s.pin.mode, pinned: true };
  }
  if (s.pin && advance) saveSettings(db, device.mac, { ...s, pin: undefined }); // expired
  const items = activeItems(s, now);
  const n = items.length;
  if (n === 1 || s.order === "single") return { mode: items[0].mode, pinned: false };
  const st = parse<DeviceState>(device.state);
  let k: number;
  if (s.rotate === "refresh") {
    const prev = Math.min(st.cursor ?? -1, n - 1);
    if (!advance) k = Math.max(0, prev);
    else if (s.order === "random") k = (Math.max(0, prev) + 1 + Math.floor(Math.random() * (n - 1))) % n; // never the same twice
    else k = (prev + 1) % n;
    if (advance) db.prepare("UPDATE device SET state = ? WHERE mac = ?").run(JSON.stringify({ cursor: k, lastMode: items[k].mode }), device.mac);
  } else {
    const localMin = Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 60_000);
    const slot = Math.floor(localMin / s.rotate);
    const pos = ((slot % n) + n) % n;
    if (s.order === "random" && n > 2) {
      // shuffled rounds: each layout once per round, never the same twice in a row
      const round = (c: number) => {
        const a = shuffle(n, c);
        if (a[0] === shuffle(n, c - 1)[n - 1]) [a[0], a[1]] = [a[1], a[0]];
        return a;
      };
      k = round(Math.floor(slot / n))[pos];
    } else k = pos;
  }
  return { mode: items[k].mode, pinned: false };
}

function hash(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** A permutation of 0..n-1 for round `c` (Fisher–Yates seeded by the round). */
function shuffle(n: number, c: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = hash(c * 7919 + i) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** "until" for a pin of the given kind. */
export function pinUntil(kind: string, now: Date): { until?: string; once?: boolean } {
  if (kind === "once") return { once: true };
  if (kind === "1h") return { until: new Date(now.getTime() + 3600_000).toISOString() };
  if (kind === "3h") return { until: new Date(now.getTime() + 3 * 3600_000).toISOString() };
  if (kind === "today") return { until: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString() };
  return {}; // until cleared
}
