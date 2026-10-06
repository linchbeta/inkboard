// Dictionaries: a word's IPA, Chinese meaning, part of speech and an example sentence.
//
// Providers (no API keys):
//  - 有道 (dict.youdao.com/jsonapi): English, French, German, Spanish, Portuguese, Japanese,
//    Korean -- Chinese meanings; IPA / readings and bilingual examples where it has them.
//  - Free Dictionary API (dictionaryapi.dev): English, English definitions and examples.
//  - MyMemory (api.mymemory.translated.net, ~5000 characters a day): a Chinese translation
//    for any language -- the last resort.
//  - The user's own: a URL template with {word} and {lang}, answering JSON with any of
//    ipa / phonetic, pos, meaning / zh / translation, example, exampleZh / exampleTranslation.
//
// define() asks the chosen provider first, then the others for whatever it left empty.
// Results are cached in the database ("vocab:dict:<provider>:<lang>:<word>", shared by all
// users): found words for good, misses for a week (negative caching), so a word nobody
// knows is not asked for on every refresh -- but not when no provider answered at all. Concurrent requests for a word share one lookup.
import { type Db, rawSetting, setRawSetting } from "../../db.js";
import type { Entry } from "./parsers.js";

export interface Provider {
  name: string;
  langs: readonly string[] | "*";
  lookup: (word: string, lang: string, custom?: string) => Promise<Entry | undefined>;
}

const HAN = /[㐀-鿿]/;
/** Meanings not for a family screen (frequency lists come from film subtitles). */
const UNSUITABLE = /妓|婊|娼|他妈|屄|屌|鸡巴|阴茎|阴道|性交|淫|狗屎|混蛋|贱人|王八蛋|操你|下流|粗俗|脏话/;
const MISS_TTL = 7 * 86_400_000;

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Shortens a dictionary meaning to its first senses, e.g. "v. 学习，学会；得知" -> "v. 学习，学会". */
export function shortMeaning(s: string, max = 2): string {
  return s.split(/[；;]/).slice(0, max).join("；").trim();
}

/** "v. 学习 n. 知识" -> pos "v." + zh "学习；n. 知识" (the first part of speech goes in red). */
function splitSense(s: string): { pos: string; zh: string } {
  const m = s.match(/^([a-z]+\.)\s*(.*)$/);
  return m ? { pos: m[1], zh: m[2] } : { pos: "", zh: s };
}

// ── 有道 ─────────────────────────────────────────────────────

type Tr = { pos?: string; tr?: { l?: { i?: (string | object)[] } }[] }[];
export interface Youdao {
  web_trans?: { "web-translation"?: { trans?: { value?: string }[] }[] };
  ec?: { word?: { ukphone?: string; usphone?: string; trs?: Tr }[] };
  fc?: { word?: { phone?: string; trs?: Tr }[] };
  jc?: { word?: { "return-phrase"?: { l?: { i?: string } }; trs?: Tr }[] };
  kc?: { word?: { trs?: Tr }[] };
  multle?: { word?: { phone?: string; trs?: Tr }[] };
  blng_sents_part?: { "sentence-pair"?: { sentence?: string; "sentence-translation"?: string }[] };
}
const firstText = (t: Tr[number]) => t.tr?.map((x) => x.l?.i?.find((s) => typeof s === "string") as string | undefined).find(Boolean)?.trim() ?? "";
const plain = (s: string) => s.replace(/<[^>]+>/g, "").trim();
/** 有道's web translation of the word itself (when its dictionaries have nothing). */
const webMeaning = (d: Youdao) => d.web_trans?.["web-translation"]?.[0]?.trans?.map((t) => t.value ?? "").find((v) => HAN.test(v)) ?? "";

/** 有道's entry, whichever of its dictionary sections the language has. */
export function parseYoudao(d: Youdao, word: string): Entry {
  const pairs = (d.blng_sents_part?.["sentence-pair"] ?? []).slice(0, 5)
    .filter((p) => p.sentence && p["sentence-translation"] && plain(p.sentence).length <= 90)
    .sort((a, b) => a.sentence!.length - b.sentence!.length);
  const example = pairs[0] ? { example: plain(pairs[0].sentence!), exampleZh: plain(pairs[0]["sentence-translation"]!) } : {};
  const ec = d.ec?.word?.[0];
  if (ec) {
    const senses = (ec.trs ?? []).map(firstText).filter(Boolean);
    return { word, ipa: ec.ukphone ?? ec.usphone ?? "", ...(senses.length ? splitSense(senses.slice(0, 2).map((s) => shortMeaning(s)).join(" ")) : {}), ...example };
  }
  // French / Japanese / Korean sections: part of speech + senses; Japanese gives the reading
  const xc = d.fc?.word?.[0] ?? d.jc?.word?.[0] ?? d.kc?.word?.[0];
  if (xc) {
    const trs = xc.trs ?? [];
    const zh = trs.map(firstText).filter(Boolean).slice(0, 2).join("；").replace(/。$/, "");
    const reading = (d.jc?.word?.[0]?.["return-phrase"]?.l?.i ?? "").replace(/·/g, "");
    const ipa = "phone" in xc ? (xc as { phone?: string }).phone ?? "" : reading !== word ? reading : "";
    return { word, ipa, pos: trs[0]?.pos ?? "", zh, ...example };
  }
  // 多语种 (de / es / pt): plain lines -- meanings (Chinese), grammar ("der; -s, -e"),
  // examples ("Satz.中文")
  const ml = d.multle?.word?.[0];
  if (ml) {
    const lines = (ml.trs ?? []).map(firstText).map((s) => s.replace(/\n/g, " ").trim()).filter(Boolean);
    const meanings: string[] = [];
    let pos = "", ex: Partial<Entry> = { ...example };
    for (const l of lines) {
      const han = l.search(HAN);
      if (han < 0) {
        if (/^\d+$/.test(l)) meanings.push(l);  // (numbers: "vier" -> "4")
        const a = l.match(/^(der|die|das)\b/);
        if (a && !pos) pos = a[1];
        continue;
      }
      if (han > 12 && /\s\S+\s/.test(l.slice(0, han))) {  // a sentence, then its translation
        if (!ex.example) ex = { example: l.slice(0, han).trim(), exampleZh: l.slice(han).trim() };
        continue;
      }
      meanings.push(l.replace(/^\[[^\]]*\]\s*/, ""));
    }
    return { word, ipa: ml.phone ?? "", pos, zh: meanings.slice(0, 2).join("；") || webMeaning(d), ...ex };
  }
  return { word, zh: webMeaning(d) };
}

// ── providers ────────────────────────────────────────────────

const YOUDAO_LE: Record<string, string> = { en: "en", fr: "fr", de: "de", es: "es", pt: "pt", ja: "ja", ko: "ko" };
const FREE_POS: Record<string, string> = { noun: "n", verb: "v", adjective: "adj", adverb: "adv" };

export const PROVIDERS: Record<string, Provider> = {
  youdao: {
    name: "有道（中文释义；英、法、德、西、葡、日、韩）", langs: Object.keys(YOUDAO_LE),
    lookup: async (word, lang) => parseYoudao(await getJson(`https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}&le=${YOUDAO_LE[lang]}`) as Youdao, word),
  },
  freedict: {
    name: "Free Dictionary（英英释义，只限英语）", langs: ["en"],
    lookup: async (word) => {
      const d = await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`) as
        { phonetic?: string; phonetics?: { text?: string }[]; meanings?: { partOfSpeech?: string; definitions?: { definition?: string; example?: string }[] }[] }[];
      const e = d[0];
      if (!e) return undefined;
      const m = e.meanings?.[0], def = m?.definitions?.find((x) => x.example) ?? m?.definitions?.[0];
      return { word, ipa: (e.phonetic ?? e.phonetics?.find((p) => p.text)?.text ?? "").replace(/^\/|\/$/g, ""),
        pos: m?.partOfSpeech ? `${FREE_POS[m.partOfSpeech] ?? m.partOfSpeech}.` : "", zh: def?.definition ?? "", example: def?.example ?? "" };
    },
  },
  mymemory: {
    name: "MyMemory 翻译（任何语言，只有中文意思）", langs: "*",
    lookup: async (word, lang) => {
      const d = await getJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=${lang}|zh-CN`) as { responseData?: { translatedText?: string } };
      const zh = d.responseData?.translatedText?.trim() ?? "";
      return zh && zh.toLowerCase() !== word.toLowerCase() ? { word, zh } : undefined;
    },
  },
  custom: {
    name: "自己的接口（下面填写）", langs: "*",
    lookup: async (word, lang, template = "") => {
      if (!/^https?:\/\//.test(template)) return undefined;
      const d = await getJson(template.replaceAll("{word}", encodeURIComponent(word)).replaceAll("{lang}", lang)) as Record<string, unknown>;
      const s = (...keys: string[]) => keys.map((k) => d[k]).find((v) => typeof v === "string" && v) as string | undefined ?? "";
      return { word, ipa: s("ipa", "phonetic").replace(/^\/|\/$/g, ""), pos: s("pos"), zh: s("meaning", "zh", "translation"),
        example: s("example"), exampleZh: s("exampleZh", "exampleTranslation") };
    },
  },
};
/** The fallbacks asked after the chosen provider, in order. */
const FALLBACKS = ["youdao", "mymemory"];

export const providerOptions = (): [string, string][] => Object.entries(PROVIDERS).map(([id, p]) => [id, p.name]);
const supports = (p: Provider | undefined, lang: string) => !!p && (p.langs === "*" || p.langs.includes(lang));

/** Fills the empty fields of `a` from `b`. */
function fillIn(a: Entry | undefined, b: Entry): Entry {
  if (!a) return b;
  const out: Record<string, string> = { ...a } as Record<string, string>;
  for (const [k, v] of Object.entries(b)) if (!out[k] && v) out[k] = v as string;
  return out as unknown as Entry;
}

export interface DictPrefs { dict: string; custom?: string }
const inflight = new Map<string, Promise<Entry | undefined>>();

/** `word`'s dictionary entry (one with a meaning), or undefined. Cached; see the module notes. */
export function define(db: Db, word: string, lang: string, prefs: DictPrefs): Promise<Entry | undefined> {
  const dict = PROVIDERS[prefs.dict] ? prefs.dict : "youdao";
  const key = `vocab:dict:${dict}:${lang}:${word.toLowerCase()}`;
  let saved: { at: number; entry?: Entry; blocked?: boolean } | undefined;
  try { saved = JSON.parse(rawSetting(db, key) ?? "null") ?? undefined; } catch { /* look up again */ }
  if (saved?.entry) return Promise.resolve(saved.entry);
  if (saved && (saved.blocked || Date.now() - saved.at < MISS_TTL)) return Promise.resolve(undefined);
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      let entry: Entry | undefined, answered = false;
      for (const id of [dict, ...FALLBACKS.filter((f) => f !== dict)]) {
        if (!supports(PROVIDERS[id], lang)) continue;
        try {
          const e = await PROVIDERS[id].lookup(word, lang, prefs.custom);
          answered = true;
          if (e) entry = fillIn(entry, e);
        } catch (e) {
          console.warn(`[vocab] ${id} ${lang} ${word}: ${e instanceof Error ? e.message : e}`);
        }
        if (entry?.zh) break;
      }
      if (!answered) return undefined;  // (offline: not a miss -- ask again next time)
      const blocked = !!entry?.zh && UNSUITABLE.test(entry.zh);
      const found = entry?.zh && !blocked ? entry : undefined;
      setRawSetting(db, key, JSON.stringify(found ? { at: Date.now(), entry: found } : { at: Date.now(), blocked }));
      return found;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}
