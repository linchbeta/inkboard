// Loading word books. Bundled books are read from assets/words/; the others are downloaded
// once and kept in the database as parsed entries (key "vocab:book:<id>", shared by all
// users). A copy older than a month is still served, and refreshed in the background
// (stale-while-revalidate), so a device never waits for a download except the very first.
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { type Db, rawSetting, setRawSetting, deleteRawSettings } from "../../db.js";
import { WORDS } from "../words.js";
import type { Book, Source } from "./catalog.js";
import { parseSource, type Entry } from "./parsers.js";

const DIR = fileURLToPath(new URL("../../../assets/words/", import.meta.url));
const MONTH = 30 * 86_400_000;
const RETRY = 86_400_000;  // a failed refresh is tried again a day later

const memory = new Map<string, { at: number; entries: Entry[] }>();
const inflight = new Map<string, Promise<Entry[] | undefined>>();
const failedAt = new Map<string, number>();

/** A bundled book's entries (assets/words/<id>.json.gz), or undefined. */
export function bundledBook(id: string): Entry[] | undefined {
  const hit = memory.get(`bundled:${id}`);
  if (hit) return hit.entries;
  const file = `${DIR}${id}.json.gz`;
  if (!existsSync(file)) return undefined;
  const entries = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as Entry[];
  memory.set(`bundled:${id}`, { at: Date.now(), entries });
  return entries;
}

export async function download(src: Source): Promise<Entry[]> {
  const r = await fetch(src.url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const entries = parseSource(src, Buffer.from(await r.arrayBuffer()));
  if (!entries.length) throw new Error("内容不对");
  return entries;
}

/** Entries of `src`, cached under `key`: memory, then the database, then the network. */
async function cached(db: Db, key: string, src: Source): Promise<Entry[] | undefined> {
  let hit = memory.get(key);
  if (!hit) {
    try { hit = JSON.parse(rawSetting(db, key) ?? "null") ?? undefined; } catch { /* refetch */ }
    if (hit) memory.set(key, hit);
  }
  const stale = !hit || Date.now() - hit.at > MONTH;
  if (stale && !inflight.has(key) && Date.now() - (failedAt.get(key) ?? 0) > RETRY) {
    inflight.set(key, download(src).then((entries) => {
      const v = { at: Date.now(), entries };
      memory.set(key, v);
      setRawSetting(db, key, JSON.stringify(v));
      return entries;
    }, (e) => {
      failedAt.set(key, Date.now());
      console.warn(`[vocab] ${src.url}: ${e instanceof Error ? e.message : e}`);
      return undefined;
    }).finally(() => inflight.delete(key)));
  }
  // the first time there is nothing else: wait; later the stale copy is served meanwhile
  return hit?.entries ?? await inflight.get(key);
}

let cleaned = false;

/** A book's words (the built-in words if it cannot be had). */
export async function loadBook(db: Db, book: Book): Promise<Entry[]> {
  if (!cleaned) {  // lists of earlier versions, stored as raw text (some 650 KB each)
    deleteRawSettings(db, "wordlist:");
    cleaned = true;
  }
  if (book.source === "builtin") return WORDS;
  return (book.bundled ? bundledBook(book.id) : undefined) ?? await cached(db, `vocab:book:${book.id}`, book.source) ?? WORDS;
}

/** A list at the parent's own URL ("word" or "word<TAB>meaning" lines). */
export async function loadUrlList(db: Db, url: string): Promise<Entry[]> {
  if (!/^https?:\/\//.test(url)) return [];
  const id = createHash("sha1").update(url).digest("hex").slice(0, 12);
  return await cached(db, `vocab:list:${id}`, { format: "lines", url }) ?? [];
}

/** (tests) forget what is held in memory. */
export function _resetBookMemory(): void {
  memory.clear();
  failedAt.clear();
  cleaned = false;
}
