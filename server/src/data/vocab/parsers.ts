// Word-list formats -> entries. Pure functions (tested on samples of the real files).
import { inflateRawSync } from "node:zlib";
import type { Format, Source } from "./catalog.js";

/** A word as a list or dictionary gives it; any field but the word may be missing. */
export interface Entry { word: string; zh?: string; ipa?: string; pos?: string; example?: string; exampleZh?: string }

const HAN = /[一-鿿]/;

/** "word<TAB>n. 释义" (or "word,释义", "word|释义", "word") lines. */
export function parseLines(text: string): Entry[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
    // split at the first separator only: meanings have commas of their own
    const at = l.includes("\t") ? l.indexOf("\t") : l.search(/[|,，]/);
    return at < 0 ? { word: l, zh: "" } : { word: l.slice(0, at).trim(), zh: l.slice(at + 1).trim() };
  }).filter((e) => /^\p{L}[\p{L}\p{M}' -]*$/u.test(e.word));
}

/** FrequencyWords "word count" lines -> the words ranked [from, to), letters only, minLen+ long. */
export function parseFrequency(text: string, from: number, to: number, minLen = 3): Entry[] {
  return text.split("\n").slice(from, to).map((l) => l.split(" ")[0]?.trim() ?? "")
    .filter((w) => /^\p{L}+$/u.test(w) && [...w].length >= minLen).map((word) => ({ word }));
}

/** open-anki-jlpt-decks CSV (expression,reading,meaning,tags,…) -> words with their kana readings. */
export function parseJlpt(text: string): Entry[] {
  return text.split("\n").slice(1).map((l) => {
    const [word = "", reading = ""] = l.split(",").map((x) => x.trim());
    return { word, ipa: reading && reading !== word ? reading : "" };
  }).filter((e) => e.word && !e.word.startsWith('"') && !e.word.includes("～"));  // (no affixes like ～区)
}

/** mahavivo lists: "word", "word [ipa] pos. 释义" or "*word, an [ipa] …" (headings, letters skipped). */
export function parseMahavivo(text: string): Entry[] {
  const out: Entry[] = [];
  for (const raw of text.split("\n")) {
    const m = raw.trim().match(/^\*?([A-Za-z][A-Za-z'-]*(?: [a-z][A-Za-z'-]*)?)(?:\s*,\s*[a-z]+)?(?:\s*\(\w+\))?\s*(?:\[([^\]]*)\])?\s*(.*)$/);
    if (!m) continue;
    let [, word, ipa = "", rest] = m;
    // "a art.一(个)": the second word was the part of speech
    if (word.includes(" ") && rest.startsWith(".")) { rest = word.slice(word.indexOf(" ") + 1) + rest; word = word.slice(0, word.indexOf(" ")); }
    if (word.length < 2 || (!ipa && rest && !HAN.test(rest))) continue;
    out.push({ word, zh: rest.replace(/\s+/g, " ").trim(), ipa: ipa.trim() });
  }
  return out;
}

interface KajwebWord {
  headWord?: string;
  content?: { word?: { content?: {
    ukphone?: string; usphone?: string;
    trans?: { pos?: string; tranCn?: string }[];
    sentence?: { sentences?: { sContent?: string; sCn?: string }[] };
  } } };
}

/** kajweb/dict book: one JSON object per line -> entries with IPA, meaning and the shortest example. */
export function parseKajweb(text: string): Entry[] {
  const out: Entry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let w: KajwebWord;
    try { w = JSON.parse(line) as KajwebWord; } catch { continue; }
    const c = w.content?.word?.content, word = w.headWord?.trim();
    if (!c || !word) continue;
    const trans = (c.trans ?? []).filter((t) => t.tranCn);
    const zh = trans.slice(0, 2).map((t, i) => `${i && t.pos ? `${t.pos}. ` : ""}${t.tranCn!.trim()}`).join("；");
    const sent = (c.sentence?.sentences ?? []).filter((x) => x.sContent && x.sContent.length <= 90).sort((a, b) => a.sContent!.length - b.sContent!.length)[0];
    out.push({ word, zh, ipa: (c.ukphone ?? c.usphone ?? "").replace(/^'|'$/g, ""), pos: trans[0]?.pos ? `${trans[0].pos}.` : "",
      example: sent?.sContent?.trim() ?? "", exampleZh: sent?.sCn?.trim() ?? "" });
  }
  return out;
}

/** The files in a zip archive (stored or deflated), by name. */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("不是 zip 文件");
  let p = buf.readUInt32LE(e + 16);
  for (let i = buf.readUInt16LE(e + 10); i > 0; i--) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.subarray(start, start + size);
    out.set(buf.subarray(p + 46, p + 46 + nl).toString("utf8"), method === 8 ? inflateRawSync(data) : data);
    p += 46 + nl + xl + cl;
  }
  return out;
}

const PARSE: Record<Format, (data: Buffer, src: Source) => Entry[]> = {
  lines: (b) => parseLines(b.toString("utf8")),
  kajweb: (b) => [...unzip(b).values()].flatMap((f) => parseKajweb(f.toString("utf8"))),
  mahavivo: (b) => parseMahavivo(b.toString("utf8")),
  jlpt: (b) => parseJlpt(b.toString("utf8")),
  frequency: (b, s) => parseFrequency(b.toString("utf8"), ...(s.ranks ?? [0, 2000]), s.minLen),
};

/** A downloaded source's entries (skipping its first `skip`), without empty fields. */
export function parseSource(src: Source, data: Buffer): Entry[] {
  return PARSE[src.format](data, src).slice(src.skip ?? 0)
    .map((e) => Object.fromEntries(Object.entries(e).filter(([, v]) => v)) as unknown as Entry);
}
