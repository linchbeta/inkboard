// 每日诗词 (TRMNL's "Motivational Quote" / "Poem of the day", no. 8): one classical poem a
// day, set like a poetry card: red title, "朝代 · 作者", the poem, a red seal with the
// author's name. LXGW WenKai, the title as large as the text. The layout is chosen so the
// whole poem always shows, preferring (in order): one 句 per line in one or two columns,
// two 句 per line with punctuation, then running text. Seasonal choice; festivals get theirs.
import { cjkDisplay, cjkAt, getFont } from "../render/typography.js";
import { refFonts, width, print, bigRef, centeredAt, type RefFont } from "../render/reftext.js";
import type { Canvas } from "../render/canvas.js";
import { type Panel, Ink } from "../panels.js";
import { festivalOf, lunarOf } from "../data/calendar.js";
import { poemOfDay, poemAt, POEMS, type Poem } from "../data/poems.js";
import { counter } from "../data/rotation.js";
import { getModeConfig, setModeConfig, type ConfigField } from "../data/modeConfig.js";
import { getSetting, setSetting } from "../db.js";
import type { ScreenContext } from "./testPattern.js";
import type { Screen } from "./screen.js";
import { screenWithHeader, wrapText } from "./common.js";

const CONFIG: ConfigField[] = [{
  key: "pick", label: "显示哪一首", type: "select", default: "auto",
  // auto / all: a new poem on every refresh (the names of earlier versions' daily choices)
  options: [["auto", "每次刷新换一首（应季，节日显示应景诗）"], ["all", "每次刷新换一首（全部诗词）"],
    ["daily", "每天一首（应季，节日显示应景诗）"], ["daily-all", "每天一首（全部诗词）"]],
  dynamicOptions: () => POEMS.map((p) => [`poem:${p.title}|${p.author}`, `固定：${p.title}（${p.author}）`] as [string, string]),
}];

export interface Layout {
  kind: "lines" | "couplets" | "prose";
  body: RefFont; title: RefFont; cols: 1 | 2;
  /** The text lines to draw (句, couplets or wrapped running text). */
  lines: string[];
  lineH: number; w: number; h: number; colW: number; colGap: number; fits: boolean;
}

const fh = (rf: RefFont) => rf.ascent - rf.descent;

/** Body font candidates, largest first (the poems' own 48/56 px subsets, then full sets). */
function bodyFonts(large: boolean): RefFont[] {
  const { wqy12, wqy9 } = refFonts();
  if (large && getFont() === "wenkai") return [bigRef("wenkai-poems", 56), bigRef("wenkai-poems", 48), ...cjkDisplay(true), wqy12];
  return [...cjkDisplay(large), wqy12, wqy9];
}

/** The title at the body's size (largest WenKai not above it that fits the width). */
function titleFont(poem: Poem, body: RefFont, large: boolean, maxW: number): RefFont {
  if (!large || getFont() !== "wenkai") { // the device's display fonts, not above the body
    const f = cjkDisplay(false).find((x) => fh(x) <= fh(body) + 4 && width(x, poem.title) <= maxW);
    return f ?? refFonts().wqy12;
  }
  const sizes: [string, number][] = [["wenkai-poems", 56], ["wenkai-poems", 48], ["wenkai", 40], ["wenkai", 32], ["wenkai", 28], ["wenkai", 24]];
  for (const [fam, px] of sizes) {
    if (px > fh(body) + 4 || (!large && px > 32)) continue;
    const f = bigRef(fam as "wenkai" | "wenkai-poems", px);
    if (width(f, poem.title) <= maxW) return f;
  }
  return refFonts().wqy12;
}

/** 句 joined in pairs with punctuation: "床前明月光，疑是地上霜。" */
function couplets(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 2) out.push(lines[i + 1] ? `${lines[i]}，${lines[i + 1]}。` : `${lines[i]}。`);
  return out;
}

export function plan(poem: Poem, large: boolean, maxW: number, maxH: number, maxBody = Infinity): Layout {
  const metaH = refFonts().wqy12.ascent + 4;
  const all = bodyFonts(large);
  const capped = all.filter((f) => fh(f) <= maxBody);
  const fonts = capped.length ? capped : all.slice(-1);
  const comfortable = fonts.filter((f) => fh(f) >= (large ? 28 : 20)); // below this, try another layout first
  const attempt = (kind: Layout["kind"], body: RefFont, cols: 1 | 2): Layout | undefined => {
    const title = titleFont(poem, body, large, maxW);
    const lineH = Math.round(fh(body) * (kind === "prose" ? 1.35 : large ? 1.45 : 1.3));
    const head = fh(title) + 10 + metaH + Math.round(fh(body) * (large ? 0.6 : 0.35));
    const colGap = Math.round(fh(body) * 1.6);
    const lines = kind === "prose" ? wrapText(body, couplets(poem.lines).join(""), maxW)
      : kind === "couplets" ? couplets(poem.lines) : poem.lines;
    const colW = Math.max(...lines.map((l) => width(body, l)));
    const rows = Math.ceil(lines.length / cols);
    const w = Math.max(width(title, poem.title), cols * colW + (cols - 1) * colGap);
    const h = head + rows * lineH;
    return w <= maxW && h <= maxH ? { kind, body, title, cols, lines, lineH, w, h, colW, colGap, fits: true } : undefined;
  };
  const largest = (kind: Layout["kind"], cols: 1 | 2, list: RefFont[]) => {
    for (const body of list) { const l = attempt(kind, body, cols); if (l) return l; }
    return undefined;
  };
  // one 句 per line, one or two columns, whichever allows the larger comfortable size
  const one = largest("lines", 1, comfortable);
  const two = poem.lines.length >= 6 ? largest("lines", 2, comfortable) : undefined;
  const lines = one && two ? (fh(two.body) > fh(one.body) ? two : one) : one ?? two;
  return lines
    ?? largest("couplets", 1, comfortable)
    ?? largest("prose", 1, comfortable)
    // small sizes only: whichever layout keeps the largest font (ties: the earlier one)
    ?? [largest("lines", poem.lines.length >= 6 ? 2 : 1, fonts), largest("couplets", 1, fonts), largest("prose", 1, fonts)]
      .reduce<Layout | undefined>((best, l) => (l && (!best || fh(l.body) > fh(best.body)) ? l : best), undefined)
    ?? (() => {
      const body = fonts[fonts.length - 1];
      const ls = wrapText(body, couplets(poem.lines).join(""), maxW);
      return { kind: "prose", body, title: refFonts().wqy12, cols: 1, lines: ls, lineH: fh(body) + 4, w: maxW, h: maxH, colW: maxW, colGap: 0, fits: false } as Layout;
    })();
}

/** The author's name stacked in a red square seal (white characters). */
function seal(c: Canvas, name: string, right: number, bottom: number, large: boolean): void {
  const { wqy12, wqy9 } = refFonts();
  const f = large ? wqy12 : wqy9;
  const chars = [...name].slice(0, 4);
  const cellH = f.ascent + (large ? 4 : 3);
  const w = width(f, "国") + (large ? 12 : 8), h = chars.length * cellH + (large ? 10 : 6);
  const x0 = right - w, y0 = bottom - h;
  c.rect(x0, y0, right, bottom, Ink.Red);
  c.frame(x0 + 2, y0 + 2, right - 2, bottom - 2, Ink.White);
  chars.forEach((ch, i) => {
    const p = centeredAt(f, ch, x0 + w / 2, y0 + (large ? 5 : 3) + i * cellH + cellH / 2);
    print(c, f, ch, p.x, p.baseline, Ink.White);
  });
}

export function renderPoetry(panel: Panel, ctx: ScreenContext) {
  const { wqy12, wqy9 } = refFonts();
  const now = ctx.now;
  const y0 = now.getFullYear(), m0 = now.getMonth() + 1, d0 = now.getDate();
  const fest = festivalOf(y0, m0, d0, lunarOf(y0, m0, d0));
  const poem = (ctx.data as Poem | undefined) ?? poemOfDay(now, fest);
  const f = screenWithHeader(panel, ctx, "古诗词", fest && poem.festival ? fest : "");
  const { c, W, H, large, m } = f;
  const pad = large ? 24 : 6;
  const maxW = W - 2 * m - 2 * pad, maxH = H - f.top - 2 * pad;
  // upright: no larger than the same poem on the screen lying down (the long side would
  // otherwise make it much larger)
  const flat = H > W ? plan(poem, large, H - 2 * m - 2 * pad, W - f.top - 2 * pad) : undefined;
  const L = plan(poem, large, maxW, maxH, flat ? fh(flat.body) : Infinity);
  const cx = Math.round(W / 2);
  // upright: the whole block (title, author, poem) centred under the header bar
  const tall = H > W;
  const visibleH = L.h - (L.lineH - fh(L.body));  // (no leading under the last line)
  let y = tall ? f.top + Math.max(pad, Math.round((H - f.top - visibleH) / 2))
    : f.top + pad + Math.max(0, Math.round((maxH - L.h) / 3));

  // title (red) and "朝代 · 作者" with short red rules either side
  y += L.title.ascent;
  print(c, L.title, poem.title, Math.round(cx - width(L.title, poem.title) / 2), y, Ink.Red);
  y += -L.title.descent + 10 + wqy12.ascent;
  const meta = `${poem.dynasty} · ${poem.author}`;
  const mw = width(wqy12, meta), mx = Math.round(cx - mw / 2);
  print(c, wqy12, meta, mx, y, Ink.Black);
  const ruleW = large ? 36 : 20, my = y - Math.round(wqy12.ascent / 2) + 1;
  c.rect(mx - 12 - ruleW, my, mx - 12, my + 1, Ink.Red);
  c.rect(mx + mw + 12, my, mx + mw + 12 + ruleW, my + 1, Ink.Red);
  y += 4 + Math.round(fh(L.body) * (large ? 0.6 : 0.35));

  // the text: centred lines per column, or a left-aligned block of running text
  const rows = Math.ceil(L.lines.length / L.cols);
  const blockW = L.cols * L.colW + (L.cols - 1) * L.colGap;
  const bx = Math.round(cx - blockW / 2);
  L.lines.forEach((line, i) => {
    const col = Math.floor(i / rows), row = i % rows;
    const lx = L.kind === "prose" ? bx : Math.round(bx + col * (L.colW + L.colGap) + L.colW / 2 - width(L.body, line) / 2);
    print(c, L.body, line, lx, y + L.body.ascent + row * L.lineH, Ink.Black);
  });
  if (L.cols === 2) c.dottedV(bx + L.colW + Math.round(L.colGap / 2), y + 4, y + rows * L.lineH - 8, Ink.Red, 1, 3);

  // seal at the lower right of the text block, or beside the author line when the block
  // is too wide for it
  const blockBottom = y + rows * L.lineH - Math.round(L.lineH - fh(L.body)) + 2;
  const sealW = width(large ? wqy12 : wqy9, "国") + (large ? 12 : 8);
  const sealRight = bx + blockW + (large ? 20 : 12) + sealW;
  if (sealRight <= W - m) seal(c, poem.author, sealRight, Math.min(H - (large ? 12 : 6), blockBottom), large);
  else {
    const sf = large ? wqy12 : wqy9;
    const sealH = Math.min(4, [...poem.author].length) * (sf.ascent + (large ? 4 : 3)) + (large ? 10 : 6);
    // centred on the author line, but never down into the text
    seal(c, poem.author, mx + mw + 12 + ruleW + (large ? 18 : 10) + sealW, Math.min(my + Math.round(sealH / 2), y - 3), large);
  }
  return c;
}

export const poetryMode: Screen = {
  name: "古诗词",
  description: "古诗词卡片，每次刷新换一首（也可每天一首）；按季节挑选，春节、元宵、清明、中秋、重阳等节日穿插应景的诗。",
  config: CONFIG,
  actions: [{
    id: "next", label: "换一首",
    // a fixed poem turns back into the automatic choice, moved on by one
    run: (db) => {
      const cfg = getModeConfig(db, "poetry", CONFIG);
      if (cfg.pick.startsWith("poem:")) setModeConfig(db, "poetry", CONFIG, { pick: "auto" });
      setSetting(db, "poetry:skip", String(Number(getSetting(db, "poetry:skip", "0")) + 1));
      counter(db, "poetry", true);
    },
  }],
  render: renderPoetry,
  portrait: true,
  prepare: async (db, now, params) => {
    const pick = getModeConfig(db, "poetry", CONFIG).pick;
    if (pick.startsWith("poem:")) {
      const [title, author] = pick.slice(5).split("|");
      const p = POEMS.find((x) => x.title === title && x.author === author);
      if (p) return { data: p };
    }
    const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
    const festival = festivalOf(y, m, d, lunarOf(y, m, d));
    if (pick === "daily" || pick === "daily-all") {
      const skip = Number(getSetting(db, "poetry:skip", "0")) || 0;
      return { data: poemOfDay(now, festival, skip, pick === "daily-all") };
    }
    // a new poem on every refresh
    return { data: poemAt(counter(db, "poetry", params?.advance === "1"), now, festival, pick === "all") };
  },
};
