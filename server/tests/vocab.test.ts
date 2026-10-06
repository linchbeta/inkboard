import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { openDb, rawSetting } from "../src/db.js";
import { BOOKS, LANGS, bookById, bookOptions, resolveBook, defaultBook } from "../src/data/vocab/catalog.js";
import { parseLines, parseFrequency, parseJlpt, parseMahavivo, parseKajweb, unzip, parseSource } from "../src/data/vocab/parsers.js";
import { bundledBook, loadBook } from "../src/data/vocab/books.js";
import { PROVIDERS, define, parseYoudao } from "../src/data/vocab/dictionary.js";
import { step, skipCurrent, newProgress, orderAt, REVIEW_DAYS, type Progress } from "../src/data/vocab/schedule.js";
import { studyCard, type StudySettings } from "../src/data/vocab/index.js";
import { bigFont } from "../src/render/fonts.js";

// ── catalog ──────────────────────────────────────────────────

test("catalog: unique ids, every language has books, earlier settings still resolve", () => {
  assert.equal(new Set(BOOKS.map((b) => b.id)).size, BOOKS.length);
  for (const [lang] of LANGS) assert.ok(bookOptions(lang).length >= 2, lang);
  assert.ok(!LANGS.some(([k]) => (k as string) === "ru"));
  assert.ok(bookOptions("en").length > 40);
  assert.deepEqual([defaultBook("en").id, defaultBook("ja").id, defaultBook("fr").id], ["primary", "n5", "fr-common"]);
  // a book of another language falls back to the language's default; "common" / "advanced" of v1
  assert.deepEqual([resolveBook("ja", "cet4").id, resolveBook("ja", "n3").id, resolveBook("fr", "n3").id,
    resolveBook("fr", "common").id, resolveBook("de", "advanced").id, resolveBook("en", "cet4").id, resolveBook("xx", "pep3a").id],
    ["n5", "n3", "fr-common", "fr-common", "de-advanced", "cet4", "pep3a"]);
  for (const b of BOOKS.filter((x) => x.bundled)) assert.ok((bundledBook(b.id)?.length ?? 0) >= 50, b.id);
  assert.ok(bookById("pep3a")!.ordered && !bookById("cet4")!.ordered);
});

// ── parsers (samples of the real files) ──────────────────────

test("parsers: lines, frequency, JLPT, mahavivo, kajweb, zip", () => {
  assert.deepEqual(parseLines("apple\tn. 苹果，苹果树\nbanane, 香蕉\nchat|猫\n# comment\nMädchen"),
    [{ word: "apple", zh: "n. 苹果，苹果树" }, { word: "banane", zh: "香蕉" }, { word: "chat", zh: "猫" }, { word: "Mädchen", zh: "" }]);
  assert.deepEqual(parseFrequency("de 10\nje 9\nêtre 8\nc' 7\nmaison 6\n123 5", 0, 6).map((e) => e.word), ["être", "maison"]);
  assert.deepEqual(parseJlpt('expression,reading,meaning,tags,guid\r\n会う,あう,"to meet, to see",JLPT,x\r\nああ,ああ,"Ah!",JLPT,y\r\n～区,～く,"~ ward",JLPT,z'),
    [{ word: "会う", ipa: "あう" }, { word: "ああ", ipa: "" }]);
  assert.deepEqual(parseMahavivo("大学英语四级大纲单词表\n(共 4615 词)\n\nA\n\na art.一(个)\nabandon [əˈbændən] vt.丢弃；放弃\n*abacus [ˈæbəkəs] n. 算盘\nalso\nabate             [ə'beit]              vt. 缓和"),
    [{ word: "abandon", zh: "vt.丢弃；放弃", ipa: "əˈbændən" }, { word: "abacus", zh: "n. 算盘", ipa: "ˈæbəkəs" }, { word: "also", zh: "", ipa: "" }, { word: "abate", zh: "vt. 缓和", ipa: "ə'beit" }]);
  const line = JSON.stringify({ headWord: "ruler", content: { word: { content: { ukphone: "'ruːlə", trans: [{ tranCn: "尺子" }],
    sentence: { sentences: [{ sContent: "a 12-inch ruler", sCn: "一把12英寸的尺子" }] } } } } });
  assert.deepEqual(parseKajweb(line), [{ word: "ruler", zh: "尺子", ipa: "ruːlə", pos: "", example: "a 12-inch ruler", exampleZh: "一把12英寸的尺子" }]);
  // a one-file zip (deflated), built by hand -- and parseSource on it drops empty fields
  const comp = deflateRawSync(Buffer.from(line)), name = Buffer.from("a.json");
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(comp.length, 20); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + comp.length, 16);
  const zip = Buffer.concat([local, name, comp, central, name, end]);
  assert.equal(unzip(zip).get("a.json")?.toString(), line);
  assert.deepEqual(parseSource({ format: "kajweb", url: "" }, zip), [{ word: "ruler", zh: "尺子", ipa: "ruːlə", example: "a 12-inch ruler", exampleZh: "一把12英寸的尺子" }]);
  assert.deepEqual(parseSource({ format: "frequency", url: "", ranks: [0, 9], skip: 1 }, Buffer.from("the 9\nhouse 8\ntree 7")).map((e) => e.word), ["house", "tree"]);
});

// trimmed from real 有道 answers (dict.youdao.com/jsonapi, October 2026)
test("有道: English / French / German / Spanish / Japanese / Korean sections, web translation", () => {
  const fr = parseYoudao({
    fc: { word: [{ phone: "bɔ̃ʒu:r", trs: [{ pos: "m.", tr: [{ l: { i: ["早安，日安，白天好，你好"] } }] }] }] },
    blng_sents_part: { "sentence-pair": [{ sentence: "Client: <b>Bonjour</b>, monsieur.", "sentence-translation": "顾客：你好，先生。" }] },
  }, "bonjour");
  assert.deepEqual([fr.ipa, fr.pos, fr.zh, fr.example, fr.exampleZh], ["bɔ̃ʒu:r", "m.", "早安，日安，白天好，你好", "Client: Bonjour, monsieur.", "顾客：你好，先生。"]);
  const de = parseYoudao({ multle: { word: [{ trs: [
    { tr: [{ l: { i: ["der; -s, -e \n"] } }] }, { tr: [{ l: { i: ["蝴蝶 \n"] } }] },
    { tr: [{ l: { i: ["Aus dem Ei wird eine Raupe. Diese verpuppt sich, und aus der Puppe schlüpft der Schmetterling.由卵变成幼虫。 \n"] } }] },
  ] }] } }, "Schmetterling");
  assert.deepEqual([de.pos, de.zh], ["der", "蝴蝶"]);
  assert.match(de.example!, /^Aus dem Ei/);
  assert.equal(parseYoudao({ multle: { word: [{ trs: [{ tr: [{ l: { i: ["4\n"] } }] }] }] } }, "vier").zh, "4");
  const ja = parseYoudao({ jc: { word: [{ "return-phrase": { l: { i: "あ·う" } }, trs: [{ pos: "自五", tr: [{ l: { i: ["见，会见"] } }] }] }] } }, "会う");
  assert.deepEqual([ja.ipa, ja.pos, ja.zh], ["あう", "自五", "见，会见"]);
  const ko = parseYoudao({ kc: { word: [{ trs: [{ pos: "名", tr: [{ l: { i: ["爱，爱情。"] } }] }] }] } }, "사랑");
  assert.deepEqual([ko.pos, ko.zh], ["名", "爱，爱情"]);
  assert.equal(parseYoudao({ web_trans: { "web-translation": [{ trans: [{ value: "Hello" }, { value: "您好" }] }] } }, "x").zh, "您好");
});

// ── dictionary: fallbacks, caching ───────────────────────────

function fakeProviders(answers: Record<string, Record<string, { zh?: string; ipa?: string; pos?: string } | "error">>) {
  const calls: string[] = [];
  const saved = { ...PROVIDERS };
  for (const id of Object.keys(answers)) {
    PROVIDERS[id] = { ...PROVIDERS[id], lookup: async (word) => {
      calls.push(`${id}:${word}`);
      const a = answers[id][word];
      if (a === "error") throw new Error("offline");
      return a ? { word, ...a } : undefined;
    } };
  }
  return { calls, restore: () => Object.assign(PROVIDERS, saved) };
}

test("dictionary: the chosen provider first, fallbacks fill in, misses cached a week, offline not cached", async () => {
  const db = openDb(":memory:");
  const f = fakeProviders({
    freedict: { tree: { zh: "a woody plant", ipa: "triː" }, nobody: undefined as never },
    youdao: { tree: { zh: "树", pos: "n." }, nobody: undefined as never, flaky: "error", rude: { zh: "妓女" } },
    mymemory: { flaky: "error" },
  });
  try {
    assert.deepEqual(await define(db, "tree", "en", { dict: "freedict" }), { word: "tree", zh: "a woody plant", ipa: "triː" });
    assert.equal(await define(db, "nobody", "en", { dict: "youdao" }), undefined);
    assert.equal(await define(db, "nobody", "en", { dict: "youdao" }), undefined);  // cached miss: not asked again
    assert.equal(f.calls.filter((c) => c.endsWith(":nobody")).length, 2);           // youdao + mymemory, once
    assert.equal(await define(db, "flaky", "fr", { dict: "youdao" }), undefined);
    assert.equal(rawSetting(db, "vocab:dict:youdao:fr:flaky"), undefined);          // offline: no miss stored
    assert.equal(await define(db, "rude", "es", { dict: "youdao" }), undefined);    // unsuitable meaning
    // concurrent requests share one lookup
    const before = f.calls.length;
    await Promise.all([define(db, "tree", "en", { dict: "youdao" }), define(db, "tree", "en", { dict: "youdao" })]);
    assert.equal(f.calls.length - before, 1, f.calls.slice(before).join(","));
  } finally { f.restore(); }
});

// ── schedule ─────────────────────────────────────────────────

test("schedule: one new word per refresh or per day; reviews on days 1, 2, 4, 7, 15", () => {
  const o = { daily: true, advance: true, ordered: true, reviews: 2 };
  let p: Progress = newProgress(7);
  const shown: Record<number, number> = {};  // index -> day it was new
  const reviewsOn: Record<number, number[]> = {};
  for (let day = 100; day < 130; day++) {
    for (let r = 0; r < 3; r++) {  // three refreshes a day: still one new word
      const s = step(p, 50, day, o);
      p = s.progress;
      shown[s.pick.current] ??= day;
      for (const rv of s.pick.reviews) (reviewsOn[rv.index] ??= []).push(day - shown[rv.index]);
    }
  }
  assert.equal(p.next, 29);  // 30 days, 30 new words
  // the word of day 100 (index 0) came back exactly on the review days (each shown on 3 refreshes)
  const due = [...new Set(reviewsOn[0])];
  assert.deepEqual(due.filter((d) => REVIEW_DAYS.includes(d)), REVIEW_DAYS);
  // once the plan has run 15 days, reviews are due-words only
  const s = step(p, 50, 130, { ...o, advance: false });
  assert.ok(s.pick.reviews.every((r) => REVIEW_DAYS.includes(r.daysAgo)));
  assert.ok(p.log.length <= 20, "old log entries are dropped");

  // per refresh: a new word every time; many due ones take turns
  let q = newProgress(3);
  const seen = new Set<number>();
  for (let r = 0; r < 60; r++) { const t = step(q, 40, 200 + Math.floor(r / 20), { ...o, daily: false, ordered: false }); q = t.progress; seen.add(t.pick.current); }
  assert.equal(seen.size, 40);  // shuffled, every word once per round
  const reviewed = new Set<number>();
  for (let r = 0; r < 10; r++) { const t = step(q, 40, 202, { ...o, daily: false, ordered: false }); q = t.progress; t.pick.reviews.forEach((x) => reviewed.add(x.index)); }
  assert.ok(reviewed.size >= 10, "the due words of two days ago take turns");
  // skipping a word without a meaning replaces it in the log
  const k = skipCurrent(q, 40, 202, false);
  assert.equal(k.next, q.next + 1);
  assert.equal(k.log.at(-1)![0], orderAt(k.next, 40, false, k.seed));
});

// ── the card ─────────────────────────────────────────────────

const settings = (s: Partial<StudySettings>): StudySettings =>
  ({ lang: "en", level: "pep3a", dict: "youdao", dictUrl: "", listUrl: "", words: "", use: "builtin", change: "refresh", ...s });

test("studyCard: a textbook in its order, progress saved, reviews labelled, own words", async () => {
  const db = openDb(":memory:");
  const f = fakeProviders({ youdao: {}, mymemory: {} });  // (no network in tests)
  try {
    const book = (await loadBook(db, bookById("pep3a")!)).map((e) => e.word);
    const day = new Date(2026, 9, 6, 9);
    const a = await studyCard(db, settings({}), day, true);
    const b = await studyCard(db, settings({}), day, true);
    assert.deepEqual([a.card.word, b.card.word], book.slice(0, 2));
    assert.equal(b.title, "人教版 三年级上册");
    assert.equal(b.progress, `2/${book.length}`);
    assert.equal(b.reviews[0].word.word, book[0]);
    assert.equal((await studyCard(db, settings({}), day, false)).card.word, book[1]);  // a preview does not move on
    const tomorrow = await studyCard(db, settings({}), new Date(2026, 9, 7, 9), true);
    assert.deepEqual(tomorrow.reviews.map((r) => r.label), ["昨天", "昨天"]);
    // own words only, in their order
    const own = await studyCard(db, settings({ words: "elephant|/ˈelɪfənt/|n.|大象\ngiraffe|n.|长颈鹿", use: "custom" }), day, true);
    assert.deepEqual([own.card.word, own.card.zh, own.title], ["elephant", "大象", "我的单词"]);
    // Japanese and Korean fonts have the glyphs the books use
    for (const ch of "談図駅사랑あ") assert.ok(bigFont("wenkai", 24).glyphs.has(ch.codePointAt(0)!), ch);
  } finally { f.restore(); }
});
