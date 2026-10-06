// The word books, in one table: what each is, in which language, where its words come from
// and in what format. Everything else (loading, caching, the admin's lists, the bundling
// script) works from this table, so adding a book is one line here.
//
// Sources (all via jsDelivr):
//  - kajweb/dict: the books of the 有道 vocabulary app (zipped JSON lines): 人教版 textbooks,
//    IELTS, GRE, GMAT, BEC, TEM-4/8 -- with IPA, meanings and example sentences. Bundled.
//  - mahavivo/english-wordlists: 小学英语大纲, 中考 (IPA, meanings), COCA 20000. Bundled.
//  - KyleBing/english-vocabulary (BSD 3-Clause): 初中 / 高中 / 四六级 / 考研 / 托福 / SAT.
//  - jamsinclair/open-anki-jlpt-decks (MIT): JLPT N5-N1, with kana readings.
//  - hermitdave/FrequencyWords (CC BY-SA 4.0, from OpenSubtitles): the common / advanced
//    words of any language by frequency rank.
// Bundled books are in assets/words/<id>.json.gz (scripts/fetch-wordbooks.ts); the others
// are downloaded on first use and kept in the database.

export type Lang = "en" | "fr" | "de" | "es" | "it" | "pt" | "ja" | "ko";
export const LANGS: [Lang, string][] = [
  // (no Russian: 有道 has no entries for inflected forms, and machine translation of single
  // words was too often wrong)
  ["en", "英语"], ["fr", "法语"], ["de", "德语"], ["es", "西班牙语"], ["it", "意大利语"], ["pt", "葡萄牙语"],
  ["ja", "日语"], ["ko", "韩语"],
];
export const langName = (lang: string) => LANGS.find(([k]) => k === lang)?.[1] ?? "英语";
export const isLang = (s: string): s is Lang => LANGS.some(([k]) => k === s);

export type Format = "lines" | "kajweb" | "mahavivo" | "jlpt" | "frequency";
export interface Source {
  format: Format;
  url: string;
  /** frequency lists: the ranks to take, [from, to). */
  ranks?: [number, number];
  /** frequency lists: the shortest word kept (letters / syllables). */
  minLen?: number;
  /** entries to drop from the start (COCA: the, be, and…). */
  skip?: number;
}

export interface Book {
  id: string;
  lang: Lang;
  name: string;
  /** For the list: 课本 / 考试 / 分级 / 常用 / 能力考试. */
  group: string;
  /** "builtin": the words in data/words.ts. */
  source: Source | "builtin";
  /** Shipped in assets/words/<id>.json.gz. */
  bundled?: boolean;
  /** Keep the book's order (textbooks: unit by unit) instead of a shuffled one. */
  ordered?: boolean;
}

const JSD = "https://cdn.jsdelivr.net/gh";
const kajweb = (file: string): Source => ({ format: "kajweb", url: `${JSD}/kajweb/dict@master/book/${file}.zip` });
const mahavivo = (file: string, skip?: number): Source => ({ format: "mahavivo", url: `${JSD}/mahavivo/english-wordlists@master/${encodeURIComponent(file)}`, skip });
const kyle = (file: string): Source => ({ format: "lines", url: `${JSD}/KyleBing/english-vocabulary@master/${encodeURIComponent(file)}` });
const jlpt = (level: string): Source => ({ format: "jlpt", url: `${JSD}/jamsinclair/open-anki-jlpt-decks@main/src/${level}.csv` });
const frequency = (lang: Lang, ranks: [number, number]): Source => ({
  format: "frequency", url: `${JSD}/hermitdave/FrequencyWords@master/content/2018/${lang}/${lang}_50k.txt`,
  ranks, minLen: lang === "ja" || lang === "ko" ? 2 : 3,
});
const COMMON: [number, number] = [100, 2100], ADVANCED: [number, number] = [2100, 8000];

const pep = (id: string, name: string, file: string): Book =>
  ({ id, lang: "en", name: `人教版 ${name}`, group: "课本", source: kajweb(file), bundled: true, ordered: true });

export const BOOKS: Book[] = [
  // English: textbooks (in unit order), then by level and exam
  { id: "primary", lang: "en", name: "小学基础词", group: "分级", source: "builtin" },
  { id: "syllabus", lang: "en", name: "小学英语大纲词汇", group: "分级", source: mahavivo("小学英语大纲词汇.txt"), bundled: true },
  pep("pep3a", "三年级上册", "1521164661774_PEPXiaoXue3_1"), pep("pep3b", "三年级下册", "1521164656604_PEPXiaoXue3_2"),
  pep("pep4a", "四年级上册", "1521164677447_PEPXiaoXue4_1"), pep("pep4b", "四年级下册", "1521164663086_PEPXiaoXue4_2"),
  pep("pep5a", "五年级上册", "1530101080610_PEPXiaoXue5_1"), pep("pep5b", "五年级下册", "1530101073491_PEPXiaoXue5_2"),
  pep("pep6a", "六年级上册", "1530101075331_PEPXiaoXue6_1"), pep("pep6b", "六年级下册", "1521164632445_PEPXiaoXue6_2"),
  pep("pep7a", "七年级上册", "1530101067588_PEPChuZhong7_1"), pep("pep7b", "七年级下册", "1521164677043_PEPChuZhong7_2"),
  pep("pep8a", "八年级上册", "1530101070747_PEPChuZhong8_1"), pep("pep8b", "八年级下册", "1521164666522_PEPChuZhong8_2"),
  pep("pep9", "九年级全一册", "1530101078234_PEPChuZhong9_1"),
  pep("pepg1", "高中必修1", "1521164674793_PEPGaoZhong_1"), pep("pepg2", "高中必修2", "1521164678610_PEPGaoZhong_2"),
  pep("pepg3", "高中必修3", "1521164676690_PEPGaoZhong_3"), pep("pepg4", "高中必修4", "1521164657462_PEPGaoZhong_4"),
  pep("pepg5", "高中必修5", "1521164657147_PEPGaoZhong_5"), pep("pepg6", "高中选修6", "1521164629184_PEPGaoZhong_6"),
  pep("pepg7", "高中选修7", "1521164648940_PEPGaoZhong_7"), pep("pepg8", "高中选修8", "1521164666266_PEPGaoZhong_8"),
  pep("pepg9", "高中选修9", "1521164670293_PEPGaoZhong_9"), pep("pepg10", "高中选修10", "1521164634796_PEPGaoZhong_10"),
  pep("pepg11", "高中选修11", "1521164639915_PEPGaoZhong_11"),
  { id: "junior", lang: "en", name: "初中", group: "分级", source: kyle("1 初中-乱序.txt") },
  { id: "zhongkao", lang: "en", name: "中考词汇", group: "考试", source: mahavivo("中考英语词汇表.txt"), bundled: true },
  { id: "senior", lang: "en", name: "高中", group: "分级", source: kyle("2 高中-乱序.txt") },
  { id: "cet4", lang: "en", name: "大学四级", group: "考试", source: kyle("3 四级-乱序.txt") },
  { id: "cet6", lang: "en", name: "大学六级", group: "考试", source: kyle("4 六级-乱序.txt") },
  { id: "kaoyan", lang: "en", name: "考研", group: "考试", source: kyle("5 考研-乱序.txt") },
  { id: "tem4", lang: "en", name: "专业四级", group: "考试", source: kajweb("1521164647417_Level4_1"), bundled: true },
  { id: "tem8", lang: "en", name: "专业八级", group: "考试", source: kajweb("1521164635290_Level8_1"), bundled: true },
  { id: "toefl", lang: "en", name: "托福", group: "考试", source: kyle("6 托福-乱序.txt") },
  { id: "ielts", lang: "en", name: "雅思", group: "考试", source: kajweb("1521164666922_IELTS_3"), bundled: true },
  { id: "sat", lang: "en", name: "SAT", group: "考试", source: kyle("7 SAT-乱序.txt") },
  { id: "gre", lang: "en", name: "GRE", group: "考试", source: kajweb("1521164677706_GRE_3"), bundled: true },
  { id: "gmat", lang: "en", name: "GMAT", group: "考试", source: kajweb("1521164662073_GMAT_2"), bundled: true },
  { id: "bec", lang: "en", name: "BEC 商务英语", group: "考试", source: kajweb("1521164626760_BEC_2"), bundled: true },
  { id: "coca", lang: "en", name: "COCA 常用两万词", group: "常用", source: mahavivo("COCA_20000.txt", 300), bundled: true },
  // Japanese by JLPT level
  ...(["n5", "n4", "n3", "n2", "n1"] as const).map((n): Book =>
    ({ id: n, lang: "ja", name: n.toUpperCase(), group: "能力考试", source: jlpt(n) })),
  // every language: common and advanced words by frequency
  ...LANGS.flatMap(([lang]): Book[] => [
    { id: `${lang}-common`, lang, name: "常用词", group: "常用", source: frequency(lang, COMMON) },
    { id: `${lang}-advanced`, lang, name: "进阶词", group: "常用", source: frequency(lang, ADVANCED) },
  ]),
];

const byId = new Map(BOOKS.map((b) => [b.id, b]));
export const bookById = (id: string) => byId.get(id);

/** The books of a language, for the admin's list: [id, "group · name"]. */
export function bookOptions(lang: string): [string, string][] {
  return BOOKS.filter((b) => b.lang === (isLang(lang) ? lang : "en")).map((b) => [b.id, `${b.group} · ${b.name}`]);
}

/** A language's first book (its default). */
export const defaultBook = (lang: string): Book => BOOKS.find((b) => b.lang === lang && b.id !== `${lang}-advanced`) ?? BOOKS[0];

/**
 * The book a screen's settings mean: the chosen one if it is in the language, else the
 * language's default. (Also maps the ids of earlier versions: "common" / "advanced".)
 */
export function resolveBook(lang: string, id: string): Book {
  const l = isLang(lang) ? lang : "en";
  const b = bookById(id) ?? (id === "common" || id === "advanced" ? bookById(`${l}-${id}`) : undefined);
  return b && b.lang === l ? b : defaultBook(l);
}
