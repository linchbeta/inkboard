// 外语单词 (TRMNL's "Language Learning"): a word card in English, French, German, Spanish,
// Italian, Portuguese, Japanese or Korean -- the word large, its IPA, part of speech + Chinese
// meaning, an example sentence with the word in red and its translation; the words due
// for review below. Books, dictionaries and the study plan: data/vocab/.
// Sections share the free height, and every size steps down until it fits.
import { cjkDisplay, cjkAt, getFont } from "../render/typography.js";
import { refFonts, width, print, bigRef, type RefFont } from "../render/reftext.js";
import type { Canvas } from "../render/canvas.js";
import { type Panel, Ink } from "../panels.js";
import { WORDS, type Word } from "../data/words.js";
import { LANGS, langName, bookOptions, providerOptions, shortMeaning, studyCard, type StudySettings } from "../data/vocab/index.js";
import { getModeConfig, type ConfigField } from "../data/modeConfig.js";
import type { ScreenContext } from "./testPattern.js";
import type { Screen } from "./screen.js";
import { screenWithHeader, wrapText, ellipsize } from "./common.js";

const CONFIG: ConfigField[] = [
  { key: "lang", label: "语言", type: "select", default: "en", options: LANGS },
  { key: "level", label: "词库", type: "select", default: "primary", options: [],
    dynamicOptions: (v) => bookOptions(v.lang ?? "en"),
    help: "列出所选语言的词库（换了语言先保存，列表随之更新）。课本按课文顺序学，其它词库打乱顺序；整本学完一轮再从头开始。英语课本和雅思、GRE 等自带音标、释义和例句（kajweb/dict），分级词表来自 KyleBing/english-vocabulary，小学大纲、中考、COCA 来自 mahavivo/english-wordlists；日语 N5–N1 来自 open-anki-jlpt-decks；常用词、进阶词取自 FrequencyWords 词频表。" },
  { key: "dict", label: "查词接口", type: "select", default: "youdao", options: providerOptions(),
    help: "给词库里缺的音标、释义和例句查词；查到的保存下来，同一个词只查一次（查不到的一周后再试）。所选接口查不到释义时，自动改用有道和 MyMemory 补上。" },
  { key: "dictUrl", label: "自己的查词接口（可选）", type: "text", default: "",
    placeholder: "https://example.com/dict?q={word}&lang={lang}",
    help: "{word} 换成单词、{lang} 换成语言代码（en、fr、de…）；返回 JSON，字段可有 ipa、pos、meaning、example、exampleZh。查词接口选\"自己的接口\"时使用。" },
  { key: "listUrl", label: "词表链接（可选）", type: "text", default: "",
    placeholder: "https://example.com/my-words.txt",
    help: "网上的文本词表：每行一个单词，可在后面加 Tab 或逗号再写释义。" },
  { key: "words", label: "自己的单词表（可选）", type: "textarea", default: "",
    placeholder: "elephant|/ˈelɪfənt/|n.|大象|The elephant has a long nose.|大象有长长的鼻子。",
    help: "每行一个：单词|/音标/|词性|释义|例句|例句翻译（音标和后几项可省略）。比如本学期课本的单元单词。" },
  { key: "use", label: "使用", type: "select", default: "builtin",
    options: [["builtin", "所选词库"], ["custom", "只用我的词表和词表链接"], ["both", "我的词表 + 所选词库"]] },
  { key: "change", label: "新词", type: "select", default: "refresh",
    options: [["refresh", "每次刷新学一个新词"], ["daily", "每天一个新词"]],
    help: "学过的词按遗忘曲线在第 1、2、4、7、15 天出现在下方的复习栏里（到期的词多时轮流出现）。" },
];

/** Prints `line` with every occurrence of `word` (case-insensitive) in red; returns the end x. */
function printHighlighted(c: Canvas, rf: RefFont, line: string, word: string, x: number, base: number): number {
  const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  let last = 0;
  for (const mt of line.matchAll(re)) {
    x = print(c, rf, line.slice(last, mt.index), x, base, Ink.Black);
    x = print(c, rf, mt[0], x, base, Ink.Red);
    last = mt.index! + mt[0].length;
  }
  return print(c, rf, line.slice(last), x, base, Ink.Black);
}

const fh = (rf: RefFont) => rf.ascent - rf.descent;
/** Whether `rf` has every character of `s` (Inter: Latin and IPA; Cyrillic needs WenKai). */
const covers = (rf: RefFont, s: string) => [...s].every((ch) => ch.trim() === "" || rf.f.glyphs.has(ch.codePointAt(0)!));
/** `latin` if it can draw `s`, else `other`. */
const fontFor = (s: string, latin: RefFont, other: RefFont) => (covers(latin, s) ? latin : other);

/** The new word and the review words (with labels such as "昨天"), the book and place for the header. */
interface WordsData { words: Word[]; level: string; lang?: string; labels?: string[] }

export function renderWords(panel: Panel, ctx: ScreenContext) {
  const { wqy12, wqy9 } = refFonts();
  const data = (ctx.data as WordsData | undefined) ?? { words: WORDS.slice(0, 3), level: "小学基础词", labels: ["昨天", "前天"] };
  const [w, ...prevWords] = data.words;
  const f = screenWithHeader(panel, ctx, `${langName(data.lang ?? "en")}单词`, data.level);
  const { c, W, H, large, m } = f;
  const x0 = m + (large ? 24 : 6), x1 = W - m - (large ? 24 : 6), tw = x1 - x0;
  // type sizes: the 3.98"'s on dense panels; a step smaller on the 5.83" / 7.5" (~130 ppi),
  // where the same pixels come out 1.7x as large (layout and spacing stay the large ones)
  const dense = large && (panel.ppi ?? 130) >= 200;
  const mid = large && !dense;

  // the word as large as fits the width (Latin in Inter; others, e.g. Cyrillic, in the
  // Chinese face); IPA (a Japanese reading in WenKai) and part of speech fixed per panel
  const wordFonts = covers(bigRef("inter", 24), w.word)
    ? (dense ? [80, 64, 48, 32] : [48, 32, 24]).map((px) => bigRef("inter", px))
    : cjkDisplay(large, mid ? 32 : 99);
  const wordFits = wordFonts.filter((rf) => width(rf, w.word) <= tw);
  if (!wordFits.length) wordFits.push(wordFonts[wordFonts.length - 1]);
  const ipaF = fontFor(w.ipa, bigRef("inter", dense ? 32 : mid ? 24 : 20), cjkAt(large, dense ? 28 : mid ? 24 : 20));
  const ipaText = covers(bigRef("inter", 24), w.ipa) ? `/${w.ipa}/` : w.ipa;
  const posF = fontFor(w.pos, bigRef("inter", dense ? 24 : 20), cjkAt(large, dense ? 24 : 20));  // ("名", "自五": Japanese / Korean parts of speech)
  const posW = w.pos ? width(posF, w.pos) + (large ? 16 : 10) : 0;

  // The meaning (all its senses, up to 6) and the example with its translation, whole: of
  // the sizes and line spacings that fit, the least reduced (each step has a cost: tighter
  // lines are cheap, a smaller meaning or word dear, the example in the bitmap face dearer;
  // a last line of one or two characters about a size step), keeping the meaning and the
  // example in proportion. The panel's tier sets the sizes to start from.
  const cjk = (px: number) => (!large && getFont() === "pixel" ? cjkAt(false, px) : bigRef(getFont() === "sans" ? "sans" : "wenkai", px));
  const zhList = [...(dense ? [32, 28, 24, 22] : large ? [24, 22, 20] : [22, 20]).map(cjk), wqy12];
  const exList = [...(dense ? [24, 20] : [20]).map((px) => fontFor(w.example, bigRef("inter", px), cjk(px))),
    covers(wqy12, w.example) ? wqy12 : cjk(20)];
  const exZhList = dense ? [24, 22, 20].map(cjk) : large ? [cjk(20), wqy12] : [wqy12, wqy9];
  const senses = w.zh.split(/[；;]/).map((x) => x.trim()).filter(Boolean).slice(0, 6).join("；");
  const reviewH = prevWords.length ? (large ? 40 : 24) : 0;
  const avail = H - f.top - reviewH - (large ? 12 : 6);
  const minGap = large ? 10 : 4;
  const exRule = large ? 18 : 10;

  const layout = (zi: number, ei: number, ezi: number, wi: number, tight: boolean) => {
    const zhF = zhList[zi], exF = exList[ei], exZhF = exZhList[ezi], wordF = wordFits[wi];
    const zhLH = Math.round(fh(zhF) * (tight ? 1.12 : 1.25));
    const exLH = Math.round(fh(exF) * (tight ? 1.15 : 1.3)), exZhLH = Math.round(fh(exZhF) * (tight ? 1.2 : 1.35));
    const zhLines = wrapText(zhF, senses, tw - posW);
    const exLines = w.example ? wrapText(exF, w.example, tw) : [];
    const exZhLines = w.example && w.exampleZh ? wrapText(exZhF, w.exampleZh, tw) : [];
    return { zhF, exF, exZhF, wordF, zhLH, exLH, exZhLH, zhLines, exLines, exZhLines };
  };
  type Layout = ReturnType<typeof layout>;
  const heights = (L: Layout) => [
    fh(L.wordF),                                                                    // word
    w.ipa ? fh(ipaF) : 0,                                                           // /ipa/
    (L.zhLines.length - 1) * L.zhLH + fh(L.zhF),                                    // pos + meaning
    L.exLines.length ? L.exLines.length * L.exLH + L.exZhLines.length * L.exZhLH + exRule : 0, // example
  ];
  const fits = (L: Layout) => { const h = heights(L); return h.reduce((a, b) => a + b, 0) + minGap * (h.filter((x) => x > 0).length + 1) <= avail; };
  const orphan = (ls: string[]) => (ls.length > 1 && [...ls[ls.length - 1]].length <= 2 ? 1 : 0);
  let L: Layout | undefined, best = Infinity;
  for (let zi = 0; zi < zhList.length; zi++) for (let ei = 0; ei < exList.length; ei++)
    for (let ezi = 0; ezi < exZhList.length; ezi++) for (let wi = 0; wi < wordFits.length; wi++)
      for (const tight of [false, true]) {
        const cost = (tight ? 1 : 0) + zi * 3 + ei * 2 + ezi * 2 + wi * 4 + (exList[ei] === wqy12 ? 6 : 0);
        if (cost >= best) continue;
        // in proportion: the meaning at most a third larger than the example and not
        // smaller, the translation not above the example
        const zh = fh(zhList[zi]), ex = fh(exList[ei]);
        if (w.example && (zh > ex * 1.35 || zh < ex * 0.9 || fh(exZhList[ezi]) > ex)) continue;
        const l = layout(zi, ei, ezi, wi, tight);
        const c2 = cost + 4 * orphan(l.zhLines) + orphan(l.exLines) + orphan(l.exZhLines);
        if (c2 < best && fits(l)) { L = l; best = c2; }
      }
  if (!L) {
    // too much even at the smallest: the example shortened, then the meaning cut
    L = layout(zhList.length - 1, exList.length - 1, exZhList.length - 1, wordFits.length - 1, true);
    L.exZhLines = [];
    while (!fits(L) && L.exLines.length > 1) L.exLines = wrapText(L.exF, w.example, tw, L.exLines.length - 1);
    while (!fits(L) && L.zhLines.length > 1) L.zhLines = wrapText(L.zhF, senses, tw - posW, L.zhLines.length - 1);
  }
  const { wordF, zhF, exF, exZhF, exLH, exZhLH, zhLines, exLines, exZhLines } = L;

  // the free height shared between the sections
  const sec = heights(L);
  const used = sec.reduce((a, b) => a + b, 0);
  const gaps = sec.filter((h) => h > 0).length + 1;
  const gap = Math.max(minGap, Math.min(large ? 40 : 18, Math.floor((avail - used) / gaps)));
  let y = f.top + gap + Math.max(0, Math.floor((avail - used - gap * gaps) / 2));

  // word, with a short red underline
  y += wordF.ascent;
  print(c, wordF, w.word, x0, y, Ink.Black);
  c.rect(x0 + 2, y - wordF.descent + (large ? 2 : 1), x0 + Math.min(width(wordF, w.word), large ? 90 : 50), y - wordF.descent + (large ? 6 : 3), Ink.Red);
  y += -wordF.descent + gap;

  if (w.ipa) {
    y += ipaF.ascent;
    print(c, ipaF, ipaText, x0, y, Ink.Black);
    y += -ipaF.descent + gap;
  }

  // part of speech (red) + Chinese meaning
  const zLH = L.zhLH;
  y += zhF.ascent;
  if (w.pos) print(c, posF, w.pos, x0, y, Ink.Red);
  zhLines.forEach((l, k) => print(c, zhF, l, x0 + posW, y + k * zLH, Ink.Black));
  y += (zhLines.length - 1) * zLH - zhF.descent + gap;

  if (exLines.length) {
    c.dottedH(x0, x1, y, Ink.Black, 1, 3);
    y += exRule;
    for (const l of exLines) { y += exLH; printHighlighted(c, exF, l, w.word, x0, y - Math.round(exLH - exF.ascent)); }
    for (const l of exZhLines) { y += exZhLH; print(c, exZhF, l, x0, y - Math.round(exZhLH - exZhF.ascent), Ink.Black); }
  }

  // review: the previous words
  if (reviewH) {
    const by = H - (large ? 16 : 7);
    c.dottedH(m, W - m, by - (large ? 26 : 18), Ink.Black, 1, 3);
    const rf = large ? wqy12 : wqy9;
    let rx = print(c, rf, "复习", m, by, Ink.Red) + (large ? 14 : 8);
    for (const k of large ? [1, 2] : [1]) {
      const p = prevWords[k - 1];
      if (!p) break;
      // when the word was new: 昨天, 前天, 4天前… (none for words of today)
      const label = data.labels?.[k - 1] ?? "";
      const item = `${p.word}${large && p.ipa ? (covers(bigRef("inter", 24), p.ipa) ? ` /${p.ipa}/` : ` ${p.ipa}`) : ""}`;
      const zh = shortMeaning(p.zh.replace(/^[a-z]+\.\s*/, ""), 1);
      const need = (label ? width(rf, label) + 8 : 0) + width(fontFor(item, bigRef("inter", 20), bigRef("wenkai", 20)), item) + 8 + width(rf, zh.slice(0, 2));
      if (rx + need > W - m) break;
      if (label) rx = print(c, rf, label, rx, by, Ink.Black) + 8;
      rx = print(c, fontFor(item, bigRef("inter", 20), bigRef("wenkai", 20)), item, rx, by, Ink.Black) + 8;
      rx = print(c, rf, ellipsize(rf, zh, Math.min(W - m - rx, large ? 160 : 120)), rx, by, Ink.Black) + 28;
    }
  }
  return c;
}

export const wordsMode: Screen = {
  name: "外语单词",
  description: "单词卡（英、法、德、西、意、葡、日、韩）：音标、释义、例句和翻译；按课本或考试词库学新词，学过的词按遗忘曲线安排复习。词库和查词接口可换，也可用自己的单词表。",
  config: CONFIG,
  render: renderWords,
  prepare: async (db, now, params) => {
    const cfg = getModeConfig(db, "words", CONFIG) as unknown as StudySettings;
    const card = await studyCard(db, cfg, now, params?.advance === "1");
    return { data: {
      words: [card.card, ...card.reviews.map((r) => r.word)], labels: card.reviews.map((r) => r.label),
      level: `${card.title}  ${card.progress}`, lang: card.lang,
    } satisfies WordsData };
  },
};
