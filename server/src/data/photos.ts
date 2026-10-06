// Photos for the photo-frame screen, stored as uploaded PNGs (browsers decode JPEG/HEIC
// and downscale before uploading, so the server needs no image libraries). Each photo
// keeps its own non-destructive edits (rotation, crop, tone, dithering), applied in that
// order before Floyd–Steinberg at render time.
import { type Db, getSetting } from "../db.js";
import { getModeConfig, setModeConfig, type ConfigField } from "./modeConfig.js";
import { currentUser } from "../scope.js";

/** SQL condition + parameter limiting photos to the current user (none outside a user's context). */
const mine = (): [string, (number | null)[]] => {
  const u = currentUser();
  return u === undefined ? ["1 = 1", []] : ["user_id = ?", [u]];
};
import { decodePng, type RgbImage } from "../render/png.js";
import { DITHER_DEFAULTS, type DitherOptions } from "../render/image.js";

export interface PhotoEdits extends Required<DitherOptions> {
  /** Quarter turns clockwise, 0..3. */
  rotate: number;
  /** Crop in fractions of the rotated image (0..1 = the image; may reach beyond it when zoomed out). */
  crop: { x: number; y: number; w: number; h: number };
}

export interface PhotoInfo {
  id: number; title: string; created_at: string; width: number; height: number;
  enabled: boolean; edits: PhotoEdits;
}

export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

/** Slider ranges (also used by the editor page). */
export const EDIT_RANGES = {
  brightness: { min: -50, max: 50, step: 1, label: "亮度" },
  contrast: { min: 0.5, max: 2, step: 0.05, label: "对比度" },
  saturation: { min: 0, max: 3, step: 0.05, label: "饱和度" },
  gamma: { min: 0.4, max: 2.5, step: 0.05, label: "伽马（中间调）" },
  sharpen: { min: 0, max: 3, step: 0.1, label: "锐化" },
  strength: { min: 0.3, max: 1, step: 0.05, label: "抖动强度" },
} as const;

export const DEFAULT_EDITS: PhotoEdits = { ...DITHER_DEFAULTS, rotate: 0, crop: { x: 0, y: 0, w: 1, h: 1 } };

/** Accepts any (possibly partial or hostile) value and returns valid edits. */
export function sanitizeEdits(v: unknown): PhotoEdits {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const num = (x: unknown, d: number, lo: number, hi: number) => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
  };
  const e = { ...DEFAULT_EDITS, crop: { ...DEFAULT_EDITS.crop } };
  for (const [k, r] of Object.entries(EDIT_RANGES) as [keyof typeof EDIT_RANGES, (typeof EDIT_RANGES)[keyof typeof EDIT_RANGES]][]) {
    e[k] = num(o[k], DEFAULT_EDITS[k], r.min, r.max);
  }
  e.rotate = Math.round(num(o.rotate, 0, 0, 3));
  const c = (o.crop && typeof o.crop === "object" ? o.crop : {}) as Record<string, unknown>;
  // zoomed out up to 4x the image; the box must still overlap the image
  const w = num(c.w, 1, 0.01, 4), h = num(c.h, 1, 0.01, 4);
  e.crop = { x: num(c.x, 0, 0.01 - w, 0.99), y: num(c.y, 0, 0.01 - h, 0.99), w, h };
  return e;
}

interface Row { id: number; title: string; created_at: string; width: number; height: number; enabled: number; edits: string }
const toInfo = (r: Row): PhotoInfo => ({
  id: r.id, title: r.title, created_at: r.created_at, width: r.width, height: r.height,
  enabled: r.enabled !== 0, edits: sanitizeEdits(safeJson(r.edits)),
});
function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return {}; } }

export function listPhotos(db: Db): PhotoInfo[] {
  const [w, p] = mine();
  return (db.prepare(`SELECT id, title, created_at, width, height, enabled, edits FROM photo WHERE ${w} ORDER BY id`).all(...p) as unknown as Row[]).map(toInfo);
}

export function getPhotoInfo(db: Db, id: number): PhotoInfo | undefined {
  const [w, p] = mine();
  const r = db.prepare(`SELECT id, title, created_at, width, height, enabled, edits FROM photo WHERE id = ? AND ${w}`).get(id, ...p) as Row | undefined;
  return r && toInfo(r);
}

/** Validates (decodes) and stores a PNG. Throws on anything that is not a usable PNG. */
export function addPhoto(db: Db, png: Uint8Array, title: string): PhotoInfo {
  if (png.length > MAX_PHOTO_BYTES) throw new Error("图片太大");
  const img = decodePng(png);
  const r = db.prepare("INSERT INTO photo (title, created_at, width, height, png, user_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run(title.slice(0, 40), new Date().toISOString(), img.width, img.height, png, currentUser() ?? null);
  return getPhotoInfo(db, Number(r.lastInsertRowid))!;
}

export function updatePhoto(db: Db, id: number, patch: { title?: string; enabled?: boolean; edits?: unknown }): void {
  if (!getPhotoInfo(db, id)) return; // not this user's
  if (patch.title !== undefined) db.prepare("UPDATE photo SET title = ? WHERE id = ?").run(patch.title.trim().slice(0, 40), id);
  if (patch.enabled !== undefined) db.prepare("UPDATE photo SET enabled = ? WHERE id = ?").run(patch.enabled ? 1 : 0, id);
  if (patch.edits !== undefined) db.prepare("UPDATE photo SET edits = ? WHERE id = ?").run(JSON.stringify(sanitizeEdits(patch.edits)), id);
}

export function deletePhoto(db: Db, id: number): void {
  if (!getPhotoInfo(db, id)) return; // not this user's
  db.prepare("DELETE FROM photo WHERE id = ?").run(id);
  if (getPlayback(db).current === id) setPlayback(db, { mode: "sequence", current: 0 });
}

export function loadPhoto(db: Db, id: number): { info: PhotoInfo; image: RgbImage } | undefined {
  const info = getPhotoInfo(db, id);
  if (!info) return undefined;
  const row = db.prepare("SELECT png FROM photo WHERE id = ?").get(id) as { png: Uint8Array };
  return { info, image: decodePng(row.png) };
}

// ── Playback ──
// The photo frame's settings are the "photo" layout's content of each screen (see
// content.ts): which photos (all, or a selection), the order, interval and style.

export type PhotoMode = "fixed" | "sequence" | "random";
export type PhotoStyle = "frame" | "full";
export interface Playback {
  mode: PhotoMode; current: number | undefined; intervalMin: number; style: PhotoStyle;
  /** Rounded corners on square panels: none / small / medium / large. */
  corner: "none" | "s" | "m" | "l";
  /** The photos to play; undefined: every photo in the album. */
  photos: number[] | undefined;
}
export const INTERVALS = [15, 60, 180, 720, 1440] as const;
export const intervalName = (n: number) => (n < 60 ? `${n} 分钟` : n < 1440 ? `${n / 60} 小时` : "1 天");

export const PHOTO_CONFIG: ConfigField[] = [
  { key: "style", label: "样式", type: "select", options: [["frame", "画框（留白 + 标题）"], ["full", "满屏"]], default: "frame" },
  { key: "order", label: "播放", type: "select", options: [["sequence", "顺序"], ["random", "随机"], ["fixed", "固定一张"]], default: "sequence" },
  { key: "interval", label: "换片", type: "select", options: INTERVALS.map((n): [string, string] => [String(n), `每 ${intervalName(n)}`]), default: "60" },
  { key: "current", label: "固定显示的照片", type: "text", default: "" },
  { key: "photos", label: "播放的照片", type: "text", default: "" },
  { key: "corner", label: "圆角", type: "select", options: [["none", "直角"], ["s", "小"], ["m", "中"], ["l", "大"]], default: "none" },
];

function photoConfig(db: Db): Record<string, string> {
  // never saved: the settings from before they became the layout's content
  if (getSetting(db, "mode:photo", "") === "") {
    return { style: getSetting(db, "photo_style", "frame"), order: getSetting(db, "photo_mode", "sequence"),
      interval: getSetting(db, "photo_interval", "60"), current: getSetting(db, "photo_current", ""), photos: "", corner: "none" };
  }
  return getModeConfig(db, "photo", PHOTO_CONFIG);
}

export function getPlayback(db: Db): Playback {
  const c = photoConfig(db);
  const interval = Number(c.interval);
  const ids = c.photos.split(",").map(Number).filter((n) => n > 0);
  return {
    mode: c.order === "fixed" || c.order === "random" ? c.order : "sequence",
    current: Number(c.current) || undefined,
    intervalMin: (INTERVALS as readonly number[]).includes(interval) ? interval : 60,
    style: c.style === "full" ? "full" : "frame",
    corner: c.corner === "s" || c.corner === "m" || c.corner === "l" ? c.corner : "none",
    photos: c.photos ? ids : undefined,
  };
}

/** Changes the photo frame's settings (in the current scope: shared, or a screen's own). */
export function setPlayback(db: Db, p: Partial<Playback>): void {
  const cur = getPlayback(db);
  const n: Playback = { ...cur };
  if (p.mode === "fixed" || p.mode === "random" || p.mode === "sequence") n.mode = p.mode;
  if (p.current !== undefined) n.current = p.current || undefined;
  if (p.intervalMin && (INTERVALS as readonly number[]).includes(p.intervalMin)) n.intervalMin = p.intervalMin;
  if (p.style === "frame" || p.style === "full") n.style = p.style;
  if (p.corner === "none" || p.corner === "s" || p.corner === "m" || p.corner === "l") n.corner = p.corner;
  if ("photos" in p) n.photos = p.photos?.filter((x) => Number.isInteger(x) && x > 0).slice(0, 200);
  setModeConfig(db, "photo", PHOTO_CONFIG, {
    style: n.style, corner: n.corner, order: n.mode, interval: String(n.intervalMin), current: n.current ? String(n.current) : "",
    // "none selected" is kept as a selection (shows nothing new), not as "all"
    photos: n.photos ? (n.photos.length ? n.photos.join(",") : "0") : "",
  });
}

/** 32-bit integer hash (for a repeatable "random" order per time slot). */
function hash(n: number): number {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}

/** Order of the photos in shuffle cycle `cycle` (Fisher–Yates seeded by the cycle). */
function shuffled(ids: number[], cycle: number): number[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = hash(cycle * 7919 + i) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The photo to show now. fixed: the chosen one. sequence: the photos in rotation in
 * order, one per time slot (local time, so daily slots change at midnight). random:
 * shuffle play: every photo once per round in a fresh random order, never the same
 * photo twice in a row across rounds.
 */
export function currentPhotoId(db: Db, now: Date): number | undefined {
  const all = listPhotos(db);
  const pb = getPlayback(db);
  if (pb.mode === "fixed" && pb.current && all.some((p) => p.id === pb.current)) return pb.current;
  const ids = (pb.photos ? all.filter((p) => pb.photos!.includes(p.id)) : all).map((p) => p.id);
  if (!ids.length) return pb.photos ? undefined : all[0]?.id; // an empty selection shows nothing
  const n = ids.length;
  const localMin = Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 60_000);
  const slot = Math.floor(localMin / pb.intervalMin);
  const pos = ((slot % n) + n) % n;
  if (pb.mode !== "random" || n <= 2) return ids[pos]; // two photos: alternating is all random can do
  const round = (c: number) => {
    const a = shuffled(ids, c);
    // a round must not start with the photo the previous round ended on
    if (a[0] === shuffled(ids, c - 1)[n - 1]) [a[0], a[1]] = [a[1], a[0]];
    return a;
  };
  return round(Math.floor(slot / n))[pos];
}

export const getPhotoStyle = (db: Db): PhotoStyle => getPlayback(db).style;
