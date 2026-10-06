// SQLite storage via Node's built-in node:sqlite (no native build step, works in Docker).
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { scopedKeys, currentUser, scopeOf, isDeviceKey, syncIdOf, deviceKey, userKey } from "./scope.js";

export interface Device {
  mac: string;
  key: string;
  panel: string | null;
  width: number | null;
  height: number | null;
  colors: number | null;
  name: string | null;
  status: "active" | "pending";
  created_at: string;
  last_seen: string | null;
  battery_v: number | null;
  rssi: number | null;
  pair_code: string | null;
  boot: string | null;
  fw: string | null;
  requests: number;
  /** JSON DeviceSettings (data/devices.ts); empty = defaults. */
  settings: string | null;
  /** JSON rotation state (data/devices.ts). */
  state: string | null;
  /** Owning user (null: not paired yet). */
  owner_id: number | null;
}

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS device (
      mac        TEXT PRIMARY KEY,
      key        TEXT NOT NULL,
      panel      TEXT,
      width      INTEGER,
      height     INTEGER,
      colors     INTEGER,
      name       TEXT,
      status     TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      last_seen  TEXT,
      battery_v  REAL,
      rssi       INTEGER,
      pair_code  TEXT,
      boot       TEXT,
      fw         TEXT,
      requests   INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS telemetry (
      mac       TEXT NOT NULL,
      ts        TEXT NOT NULL,
      battery_v REAL,
      rssi      INTEGER
    );
    CREATE INDEX IF NOT EXISTS telemetry_mac_ts ON telemetry (mac, ts);
    CREATE TABLE IF NOT EXISTS photo (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      width      INTEGER NOT NULL,
      height     INTEGER NOT NULL,
      png        BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass       TEXT NOT NULL,
      admin      INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL,
      expires    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS setting (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // Columns added after the first release of the photo table.
  const cols = (db.prepare("PRAGMA table_info(photo)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("edits")) db.exec("ALTER TABLE photo ADD COLUMN edits TEXT NOT NULL DEFAULT '{}'");
  if (!cols.includes("enabled")) db.exec("ALTER TABLE photo ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
  // per-device settings / rotation state (added with playlists)
  const dcols = (db.prepare("PRAGMA table_info(device)").all() as { name: string }[]).map((c) => c.name);
  if (!dcols.includes("settings")) db.exec("ALTER TABLE device ADD COLUMN settings TEXT");
  if (!dcols.includes("state")) db.exec("ALTER TABLE device ADD COLUMN state TEXT");
  // multi-user: devices and photos belong to a user
  if (!dcols.includes("owner_id")) db.exec("ALTER TABLE device ADD COLUMN owner_id INTEGER");
  const pcols = (db.prepare("PRAGMA table_info(photo)").all() as { name: string }[]).map((c) => c.name);
  if (!pcols.includes("user_id")) db.exec("ALTER TABLE photo ADD COLUMN user_id INTEGER");
  reseedInheritedStudy(db);
  return db;
}

/**
 * Screens used to start their word plan from the user's (e.g. one made by a preview), so
 * several screens shared its shuffle and showed the same words. Once: a screen's plan with
 * the shuffle of a user's plan for the same book gets its own (place and history kept).
 */
function reseedInheritedStudy(db: Db): void {
  const FLAG = "fix:study-seed";
  if (rawSetting(db, FLAG) !== undefined) return;
  const rows = db.prepare("SELECT key, value FROM setting WHERE key LIKE 'u:%:study:%' OR key LIKE 'd:%:study:%'")
    .all() as { key: string; value: string }[];
  const seedOf = (v: string) => { try { return (JSON.parse(v) as { seed?: number }).seed; } catch { return undefined; } };
  const bookOf = (k: string) => k.slice(k.indexOf(":study:") + 7);
  const userSeeds = new Set(rows.filter((r) => r.key.startsWith("u:")).map((r) => `${bookOf(r.key)}|${seedOf(r.value)}`));
  for (const r of rows) {
    if (!r.key.startsWith("d:") || !userSeeds.has(`${bookOf(r.key)}|${seedOf(r.value)}`)) continue;
    const p = JSON.parse(r.value) as { seed: number };
    p.seed = Math.floor(Math.random() * 1e6);
    setRawSetting(db, r.key, JSON.stringify(p));
  }
  setRawSetting(db, FLAG, "1");
}

const nowIso = (): string => new Date().toISOString();

export function getDevice(db: Db, mac: string): Device | undefined {
  return db.prepare("SELECT * FROM device WHERE mac = ?").get(normalizeMac(mac)) as Device | undefined;
}

/** The current user's devices (all devices outside a user's context). */
export function listDevices(db: Db): Device[] {
  const u = currentUser();
  return (u === undefined
    ? db.prepare("SELECT * FROM device ORDER BY last_seen DESC").all()
    : db.prepare("SELECT * FROM device WHERE owner_id = ? ORDER BY last_seen DESC").all(u)) as unknown as Device[];
}

/** The device if the current user may see it (any device outside a user's context). */
export function getOwnDevice(db: Db, mac: string): Device | undefined {
  const d = getDevice(db, mac);
  const u = currentUser();
  return d && (u === undefined || d.owner_id === u) ? d : undefined;
}

export function setDeviceOwner(db: Db, mac: string, owner: number | null): void {
  db.prepare("UPDATE device SET owner_id = ?, pair_code = CASE WHEN ? IS NULL THEN pair_code ELSE NULL END WHERE mac = ?")
    .run(owner, owner, normalizeMac(mac));
}

/** Returns the device, creating it with a fresh key if it does not exist yet. */
export function registerDevice(db: Db, mac: string, status: Device["status"] = "active"): Device {
  mac = normalizeMac(mac);
  const existing = getDevice(db, mac);
  if (existing) return existing;
  db.prepare("INSERT INTO device (mac, key, status, created_at) VALUES (?, ?, ?, ?)")
    .run(mac, randomBytes(16).toString("hex"), status, nowIso());
  return getDevice(db, mac)!;
}

/** Records a request from the device: last seen, optional telemetry and attributes. */
export function touchDevice(
  db: Db,
  mac: string,
  fields: Partial<Pick<Device, "panel" | "width" | "height" | "colors" | "battery_v" | "rssi" | "boot" | "fw" | "pair_code">> = {},
  countRequest = false,
): void {
  mac = normalizeMac(mac);
  const sets = ["last_seen = ?"];
  const vals: (string | number | null)[] = [nowIso()];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (countRequest) sets.push("requests = requests + 1");
  db.prepare(`UPDATE device SET ${sets.join(", ")} WHERE mac = ?`).run(...vals, mac);
  if (fields.battery_v !== undefined || fields.rssi !== undefined) {
    db.prepare("INSERT INTO telemetry (mac, ts, battery_v, rssi) VALUES (?, ?, ?, ?)")
      .run(mac, nowIso(), fields.battery_v ?? null, fields.rssi ?? null);
  }
}

export function deleteDevice(db: Db, mac: string): void {
  mac = normalizeMac(mac);
  db.prepare("DELETE FROM device WHERE mac = ?").run(mac);
  db.prepare("DELETE FROM telemetry WHERE mac = ?").run(mac);
  deleteRawSettings(db, `d:${mac}:`);
}

/** Forgets the device's owner and settings (it keeps its key and shows a new pairing code). */
export function unbindDevice(db: Db, mac: string): void {
  mac = normalizeMac(mac);
  db.prepare("UPDATE device SET owner_id = NULL, settings = NULL, state = NULL, pair_code = NULL WHERE mac = ?").run(mac);
  deleteRawSettings(db, `d:${mac}:`); // its own content
}

export function approveDevice(db: Db, mac: string): void {
  db.prepare("UPDATE device SET status = 'active' WHERE mac = ?").run(normalizeMac(mac));
}

/** Battery / RSSI history since `sinceIso`, oldest first. */
export function telemetry(db: Db, mac: string, sinceIso: string): { ts: string; battery_v: number | null; rssi: number | null }[] {
  return db.prepare("SELECT ts, battery_v, rssi FROM telemetry WHERE mac = ? AND ts >= ? ORDER BY ts")
    .all(normalizeMac(mac), sinceIso) as { ts: string; battery_v: number | null; rssi: number | null }[];
}

/** A setting; per-user / per-device keys (see scope.ts) are read for the current scope. */
export function getSetting(db: Db, key: string, fallback: string): string {
  for (const k of scopedKeys(key)) {
    const v = rawSetting(db, k);
    if (v !== undefined) return v;
  }
  return fallback;
}

export function setSetting(db: Db, key: string, value: string): void {
  const s = scopeOf();
  if (s?.device && isDeviceKey(key)) { // a screen's content: to it and the screens synced with it
    for (const mac of syncMembers(db, s.userId, syncIdOf(key), s.device)) setRawSetting(db, deviceKey(mac, key), value);
    return;
  }
  setRawSetting(db, scopedKeys(key)[0], value);
}

/** The screens synced with `mac` for `syncId` (itself included), among the user's own. */
export function syncMembers(db: Db, userId: number, syncId: string, mac: string): string[] {
  let groups: string[][] = [];
  try { groups = JSON.parse(rawSetting(db, userKey(userId, `sync:${syncId}`)) ?? "[]") as string[][]; } catch { /* none */ }
  const g = Array.isArray(groups) ? groups.find((x) => Array.isArray(x) && x.includes(mac)) : undefined;
  if (!g) return [mac];
  const owned = new Set((db.prepare("SELECT mac FROM device WHERE owner_id = ?").all(userId) as { mac: string }[]).map((r) => r.mac));
  return [mac, ...g.filter((m) => m !== mac && owned.has(m))];
}

/** A stored key as is (no scoping). */
export function rawSetting(db: Db, key: string): string | undefined {
  return (db.prepare("SELECT value FROM setting WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}

export function setRawSetting(db: Db, key: string, value: string): void {
  db.prepare("INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/** Deletes stored keys starting with `prefix` (no scoping). */
export function deleteRawSettings(db: Db, prefix: string): void {
  db.prepare("DELETE FROM setting WHERE substr(key, 1, ?) = ?").run(prefix.length, prefix);
}

export function normalizeMac(mac: string): string {
  return mac.trim().toUpperCase();
}
