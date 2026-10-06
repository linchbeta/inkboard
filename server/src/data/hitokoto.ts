// 一言 (hitokoto.cn): a short sentence from anime, literature, poetry, films, the web...
// A new one on every device refresh, kept per screen ("quote:hitokoto") so previews and
// failed requests show the last one; a few built-in sentences when there has never been one.
import { type Db, getSetting, setSetting } from "../db.js";
import { scopeOf } from "../scope.js";

export interface Quote { text: string; from: string; who: string; type: string }

export const TYPES: Record<string, string> = {
  a: "动画", b: "漫画", c: "游戏", d: "文学", e: "原创", f: "网络", g: "其他", h: "影视", i: "诗词", j: "网易云", k: "哲学", l: "抖机灵",
};
/** Category choices on the settings page: value = the API's type letters. */
export const CATEGORIES: [string, string][] = [
  ["", "全部"], ["dik", "文学、诗词、哲学"], ["abc", "动画、漫画、游戏"], ["hj", "影视、网易云"], ["efgl", "原创、网络、抖机灵"],
  ["d", "只要文学"], ["i", "只要诗词"], ["k", "只要哲学"],
];
export const LENGTHS: [string, string][] = [["", "不限"], ["0-20", "短句（20 字以内）"], ["10-40", "中等（10–40 字）"], ["30-", "长句（30 字以上）"]];

const BUILTIN: Quote[] = [
  { text: "生活不止眼前的苟且，还有诗和远方的田野。", from: "生活不止眼前的苟且", who: "高晓松", type: "j" },
  { text: "人生如逆旅，我亦是行人。", from: "临江仙·送钱穆父", who: "苏轼", type: "i" },
  { text: "世界上只有一种英雄主义，就是在认清生活真相之后依然热爱生活。", from: "米开朗基罗传", who: "罗曼·罗兰", type: "d" },
  { text: "知足者富，强行者有志。", from: "道德经", who: "老子", type: "k" },
];

async function fetchQuote(opts: { categories: string; length: string }): Promise<Quote> {
  const q = new URLSearchParams({ encode: "json", charset: "utf-8" });
  for (const c of opts.categories) if (TYPES[c]) q.append("c", c);
  const [min, max] = opts.length.split("-");
  if (min) q.set("min_length", min);
  if (max) q.set("max_length", max);
  const r = await fetch(`https://v1.hitokoto.cn/?${q}`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { hitokoto?: string; from?: string; from_who?: string | null; type?: string };
  if (!d.hitokoto) throw new Error("没有内容");
  return { text: d.hitokoto.trim(), from: (d.from ?? "").trim(), who: (d.from_who ?? "").trim(), type: d.type ?? "" };
}

const read = (db: Db, key: string) => { try { return JSON.parse(getSetting(db, key, "")) as Quote & { opts?: string }; } catch { return undefined; } };
const prefetching = new Set<string>();

/**
 * A new sentence (on a device refresh), else the screen's last one (kept under `key`).
 * hitokoto.cn often takes seconds, so the device never waits for it: a refresh shows the
 * sentence fetched in the background after the previous one, and starts fetching the next
 * (before the first one has arrived: a built-in sentence).
 */
export async function hitokoto(db: Db, opts: { categories: string; length: string; advance: boolean; key?: string }): Promise<Quote> {
  const KEY = opts.key ?? "quote:hitokoto", NEXT = `${KEY}:next`;
  const want = `${opts.categories}|${opts.length}`;  // (a sentence fetched for other settings is not used)
  let last = read(db, KEY);
  if (last && !opts.advance) return last;
  const next = read(db, NEXT);
  if (next && next.opts === want) {
    last = next;
    setSetting(db, KEY, JSON.stringify(next));
    setSetting(db, NEXT, "");
  }
  // the next one, in the background (the request scope -- user, screen -- carries over)
  const flight = `${JSON.stringify(scopeOf() ?? {})}:${KEY}:${want}`;
  if (!prefetching.has(flight)) {
    prefetching.add(flight);
    fetchQuote(opts)
      .then((q) => setSetting(db, NEXT, JSON.stringify({ ...q, opts: want })))
      .catch((e) => console.warn(`[hitokoto] prefetch: ${e instanceof Error ? e.message : e}`))
      .finally(() => prefetching.delete(flight));
  }
  return last ?? BUILTIN[Math.floor(Date.now() / 3_600_000) % BUILTIN.length];
}

/** "—— 作者《出处》", "—— 《出处》", "—— 作者" or "". */
export function attribution(q: Quote): string {
  const from = q.from && !/^[《「『]/.test(q.from) ? `《${q.from}》` : q.from;
  const who = q.who && q.who !== q.from ? q.who : "";
  return who || from ? `—— ${who}${from}` : "";
}
