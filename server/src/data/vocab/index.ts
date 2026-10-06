// The word card's data, in one call: which book (catalog), its words (books), the plan's
// new word and reviews (schedule), and whatever an entry lacks from the dictionaries
// (dictionary). The screen only draws what studyCard returns.
import { type Db, getSetting, setSetting } from "../../db.js";
import { WORDS, parseWords, type Word } from "../words.js";
import { isLang, resolveBook, type Lang } from "./catalog.js";
import { loadBook, loadUrlList } from "./books.js";
import { define, type DictPrefs } from "./dictionary.js";
import type { Entry } from "./parsers.js";
import { step, skipCurrent, newProgress, dayNumber, orderAt, type Progress } from "./schedule.js";

export { LANGS, langName, bookOptions, resolveBook, BOOKS } from "./catalog.js";
export { providerOptions, shortMeaning } from "./dictionary.js";

/** The screen's settings (see screens/words.ts). */
export interface StudySettings {
  lang: string;
  level: string;   // book id
  dict: string;
  dictUrl: string;
  listUrl: string;
  words: string;   // the parent's own list
  use: string;     // "builtin" | "custom" | "both"
  change: string;  // "refresh" | "daily"
}

export interface StudyCard {
  card: Word;
  reviews: { word: Word; label: string }[];
  /** The book's name, and the place in it ("23/392", "第2轮 5/392"). */
  title: string;
  progress: string;
  lang: Lang;
}

const toWord = (e: Entry): Word =>
  ({ word: e.word, ipa: e.ipa ?? "", pos: e.pos ?? "", zh: e.zh ?? "", example: e.example ?? "", exampleZh: e.exampleZh ?? "" });

/**
 * `e` with what it lacks from the dictionaries: IPA, a meaning, and (for the card's word)
 * an example. A list's meaning stays unless the dictionary also has the part of speech.
 */
const BUILTIN = new Map(WORDS.map((w) => [w.word.toLowerCase(), w]));

async function complete(db: Db, e: Entry, lang: string, prefs: DictPrefs, needExample: boolean): Promise<Word> {
  // English words the built-in list has (with IPA and a children's example) start from it
  const b = lang === "en" ? BUILTIN.get(e.word.toLowerCase()) : undefined;
  const w = toWord(b ? { ...b, ...Object.fromEntries(Object.entries(e).filter(([, v]) => v)) } : e);
  if (w.zh && w.ipa && (w.example || !needExample)) return w;
  const d = await define(db, w.word, lang, prefs);
  if (!d) return w;
  const useDict = !w.zh || (!w.pos && !!d.pos);
  return {
    word: w.word, ipa: w.ipa || d.ipa || "",
    pos: w.pos || (useDict ? d.pos ?? "" : ""), zh: useDict ? d.zh ?? w.zh : w.zh,
    example: w.example || d.example || "", exampleZh: w.example ? w.exampleZh : d.exampleZh ?? "",
  };
}

const ago = (d: number) => (d <= 0 ? "" : d === 1 ? "昨天" : d === 2 ? "前天" : `${d}天前`);

/** The card for now; on a device refresh (`advance`) the plan moves on and is saved. */
export async function studyCard(db: Db, s: StudySettings, now: Date, advance: boolean, reviews = 2): Promise<StudyCard> {
  const lang: Lang = isLang(s.lang) ? s.lang : "en";
  const book = resolveBook(lang, s.level);
  const prefs: DictPrefs = { dict: s.dict, custom: s.dictUrl };
  const own: Entry[] = [...parseWords(s.words), ...await loadUrlList(db, s.listUrl.trim())];
  const ownOnly = s.use === "custom" && own.length > 0;
  let pool: Entry[] = ownOnly ? own : s.use === "both" && own.length ? [...own, ...await loadBook(db, book)] : await loadBook(db, book);
  if (!pool.length) pool = WORDS;
  const n = pool.length;
  // the parent's list in its own order; a book's per its kind
  const ordered = ownOnly || !!book.ordered;
  const key = `study:${ownOnly ? "own" : s.use === "both" && own.length ? `own+${book.id}` : book.id}`;
  let saved: Progress | undefined;
  try { saved = JSON.parse(getSetting(db, key, "")) as Progress; } catch { /* a new plan */ }
  const today = dayNumber(now);
  const opts = { daily: s.change === "daily", advance, ordered, reviews };
  let { progress, pick } = step(saved ?? newProgress(), n, today, opts);

  // a new word nobody has a meaning for (e.g. a name in a frequency list): the next one
  let card = await complete(db, pool[pick.current], lang, prefs, true);
  for (let tries = 0; !card.zh && tries < 4; tries++) {
    progress = skipCurrent(progress, n, today, ordered);
    ({ progress, pick } = step(progress, n, today, { ...opts, advance: false }));
    card = await complete(db, pool[pick.current], lang, prefs, true);
  }
  if (advance || !saved) setSetting(db, key, JSON.stringify(progress));

  const reviewWords = await Promise.all(pick.reviews.map(async (r) => ({
    word: await complete(db, pool[r.index], lang, prefs, false), label: ago(r.daysAgo),
  })));
  // the next new word's entry, fetched now (in the background) so the next refresh is quick
  if (advance && !opts.daily) {
    const next = pool[orderAt(progress.next + 1, n, ordered, progress.seed)];
    if (next) void complete(db, next, lang, prefs, true).catch(() => undefined);
  }
  return {
    card, reviews: reviewWords, lang,
    title: ownOnly ? "我的单词" : s.use === "both" && own.length ? `我的单词 + ${book.name}` : book.name,
    progress: `${pick.round > 1 ? `第${pick.round}轮 ` : ""}${pick.learned}/${n}`,
  };
}
