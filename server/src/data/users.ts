// Accounts, sessions and device pairing. Each user has their own devices and content
// (settings keys, photos — see scope.ts). The first account is the administrator, and
// takes over everything that existed before accounts (one-household installs).
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { type Db, getDevice, normalizeMac, unbindDevice, deleteRawSettings } from "../db.js";
import { isUserKey } from "../scope.js";

export interface User { id: number; name: string; admin: boolean; created_at: string }
interface Row { id: number; name: string; pass: string; admin: number; created_at: string }

const SESSION_DAYS = 30;

function hash(password: string, salt = randomBytes(16).toString("hex")): string {
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString("hex")}`;
}

function check(password: string, stored: string): boolean {
  const [, salt, h] = stored.split("$");
  if (!salt || !h) return false;
  const a = Buffer.from(hash(password, salt).split("$")[2], "hex"), b = Buffer.from(h, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

const toUser = (r: Row): User => ({ id: r.id, name: r.name, admin: r.admin === 1, created_at: r.created_at });

export const userCount = (db: Db): number => (db.prepare("SELECT COUNT(*) AS n FROM user").get() as { n: number }).n;

export function listUsers(db: Db): User[] {
  return (db.prepare("SELECT * FROM user ORDER BY id").all() as unknown as Row[]).map(toUser);
}

export function getUser(db: Db, id: number): User | undefined {
  const r = db.prepare("SELECT * FROM user WHERE id = ?").get(id) as Row | undefined;
  return r && toUser(r);
}

/** Creates an account; the first one is the administrator and adopts all existing data. */
export function createUser(db: Db, name: string, password: string): User {
  name = name.trim();
  if (!/^[\p{L}\p{N}_.-]{1,24}$/u.test(name)) throw new Error("用户名为 1-24 个字母、数字、汉字或 _ . -");
  if (password.length < 6) throw new Error("密码至少 6 位");
  if (db.prepare("SELECT 1 FROM user WHERE name = ?").get(name)) throw new Error("用户名已存在");
  const first = userCount(db) === 0;
  const r = db.prepare("INSERT INTO user (name, pass, admin, created_at) VALUES (?, ?, ?, ?)")
    .run(name, hash(password), first ? 1 : 0, new Date().toISOString());
  const id = Number(r.lastInsertRowid);
  if (first) adoptLegacyData(db, id);
  return getUser(db, id)!;
}

/** Data from before accounts (global keys, unowned photos and devices) goes to `userId`. */
function adoptLegacyData(db: Db, userId: number): void {
  const keys = (db.prepare("SELECT key FROM setting").all() as { key: string }[]).map((r) => r.key);
  for (const k of keys) {
    if (!k.startsWith("u:") && isUserKey(k)) {
      db.prepare("INSERT OR REPLACE INTO setting (key, value) SELECT ?, value FROM setting WHERE key = ?").run(`u:${userId}:${k}`, k);
      db.prepare("DELETE FROM setting WHERE key = ?").run(k);
    }
  }
  db.prepare("UPDATE photo SET user_id = ? WHERE user_id IS NULL").run(userId);
  db.prepare("UPDATE device SET owner_id = ? WHERE owner_id IS NULL").run(userId);
}

export function verifyUser(db: Db, name: string, password: string): User | undefined {
  const r = db.prepare("SELECT * FROM user WHERE name = ?").get(name.trim()) as Row | undefined;
  return r && check(password, r.pass) ? toUser(r) : undefined;
}

export function setPassword(db: Db, id: number, password: string): void {
  if (password.length < 6) throw new Error("密码至少 6 位");
  db.prepare("UPDATE user SET pass = ? WHERE id = ?").run(hash(password), id);
  db.prepare("DELETE FROM session WHERE user_id = ?").run(id);
}

/** Deletes an account with its data; its devices become unpaired. */
export function deleteUser(db: Db, id: number): void {
  db.prepare("DELETE FROM user WHERE id = ?").run(id);
  db.prepare("DELETE FROM session WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM setting WHERE key LIKE ?").run(`u:${id}:%`);
  db.prepare("DELETE FROM photo WHERE user_id = ?").run(id);
  for (const d of db.prepare("SELECT mac FROM device WHERE owner_id = ?").all(id) as { mac: string }[]) unbindDevice(db, d.mac);
}

export function createSession(db: Db, userId: number): string {
  const token = randomBytes(24).toString("base64url");
  db.prepare("INSERT INTO session (token, user_id, expires) VALUES (?, ?, ?)")
    .run(token, userId, new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString());
  db.prepare("DELETE FROM session WHERE expires < ?").run(new Date().toISOString());
  return token;
}

export function sessionUser(db: Db, token: string | undefined): User | undefined {
  if (!token) return undefined;
  const r = db.prepare("SELECT user_id, expires FROM session WHERE token = ?").get(token) as { user_id: number; expires: string } | undefined;
  return r && r.expires > new Date().toISOString() ? getUser(db, r.user_id) : undefined;
}

export function endSession(db: Db, token: string | undefined): void {
  if (token) db.prepare("DELETE FROM session WHERE token = ?").run(token);
}

export const SESSION_DAYS_MAX_AGE = SESSION_DAYS * 86_400;

// ── device pairing ──

/** The device's pairing code, creating a 6-digit one if it has none. */
export function pairCode(db: Db, mac: string): string {
  const d = getDevice(db, mac);
  if (d?.pair_code && /^\d{4,8}$/.test(d.pair_code)) return d.pair_code;
  const code = String(randomInt(100000, 1000000));
  db.prepare("UPDATE device SET pair_code = ? WHERE mac = ?").run(code, normalizeMac(mac));
  return code;
}

/** Binds the unpaired device showing `code` to `userId`; returns its MAC, or undefined. */
export function claimDevice(db: Db, code: string, userId: number): string | undefined {
  const d = db.prepare("SELECT mac FROM device WHERE owner_id IS NULL AND pair_code = ?").get(code.trim()) as { mac: string } | undefined;
  if (!d) return undefined;
  db.prepare("UPDATE device SET owner_id = ?, pair_code = NULL, settings = NULL, state = NULL WHERE mac = ?").run(userId, d.mac);
  deleteRawSettings(db, `d:${d.mac}:`);
  return d.mac;
}

/**
 * The owner to render a device for. A device nobody has paired yet goes to the only
 * account when there is exactly one (a single household needs no pairing step).
 */
export function deviceOwner(db: Db, mac: string): number | undefined {
  const d = getDevice(db, mac);
  if (!d) return undefined;
  if (d.owner_id !== null && d.owner_id !== undefined) return d.owner_id;
  const users = listUsers(db);
  if (users.length === 1) {
    db.prepare("UPDATE device SET owner_id = ? WHERE mac = ?").run(users[0].id, d.mac);
    return users[0].id;
  }
  return undefined;
}
