// 一言: one sentence as large as it fits under a red quotation mark, its source right-
// aligned below -- one or two lines however long it is. Short and long sentences alike
// take the largest size that fits; a new one on every refresh.
import { cjkDisplay } from "../render/typography.js";
import { refFonts, width, print, type RefFont } from "../render/reftext.js";
import { type Panel, Ink } from "../panels.js";
import { getModeConfig, type ConfigField } from "../data/modeConfig.js";
import { hitokoto, attribution, TYPES, CATEGORIES, LENGTHS, type Quote } from "../data/hitokoto.js";
import type { ScreenContext } from "./testPattern.js";
import type { Screen } from "./screen.js";
import { screenWithHeader, wrapText, ellipsize, drawQuoteMark, centeredBlockX } from "./common.js";

const CONFIG: ConfigField[] = [
  { key: "categories", label: "类别", type: "select", default: "", options: CATEGORIES },
  { key: "length", label: "长度", type: "select", default: "", options: LENGTHS,
    help: "句子来自一言（hitokoto.cn），每次刷新换一句。" },
];

const lineH = (rf: RefFont) => Math.round((rf.ascent - rf.descent) * 1.45);

export function renderHitokoto(panel: Panel, ctx: ScreenContext) {
  const { wqy12, wqy9 } = refFonts();
  const q = (ctx.data as Quote | undefined) ?? { text: "人生如逆旅，我亦是行人。", from: "临江仙·送钱穆父", who: "苏轼", type: "i" };
  const f = screenWithHeader(panel, ctx, "一言", TYPES[q.type] ?? "");
  const { c, W, H, large, m } = f;

  // source: right-aligned, at most two lines (a long title wraps, then is cut)
  const sf = large ? wqy12 : wqy9;
  const srcW = W - 2 * m - (large ? 60 : 30);
  const src = attribution(q);
  const srcLines = src ? wrapText(sf, src, srcW, 2) : [];
  const srcLH = large ? 24 : 16;
  const bottom = H - (large ? 22 : 10);
  const srcTop = bottom - srcLines.length * srcLH;

  // the sentence: the largest size whose lines fit between the quotation mark and the source
  drawQuoteMark(c, m, f.top + (large ? 16 : 10), large ? 30 : 18, Ink.Red);
  const textX = m + (large ? 50 : 26), textW = W - m - textX;
  const top = f.top + (large ? 24 : 14);
  const area = srcTop - (large ? 20 : 10) - top;
  // (at most 32 px on the 5.83" / 7.5": 40 there comes out 1.7x the 3.98"'s, see Panel.ppi)
  const dense = large && (panel.ppi ?? 130) >= 200;
  const fonts: RefFont[] = [...cjkDisplay(large, dense ? 40 : 32), wqy12, wqy9];
  const font = fonts.find((rf) => wrapText(rf, q.text, textW).length * lineH(rf) <= area) ?? fonts[fonts.length - 1];
  const lh = lineH(font);
  const lines = wrapText(font, q.text, textW, Math.max(1, Math.floor(area / lh)));
  // the block centred on the screen (lines left-aligned in it), clear of the quotation mark
  let y = top + Math.max(0, Math.round((area - lines.length * lh) / 2)) + font.ascent;
  const bx = centeredBlockX(lines.map((l) => width(font, l)), W, m, textX, y - font.ascent, f.top + (large ? 52 : 32));
  for (const l of lines) {
    print(c, font, l, bx, y, Ink.Black);
    y += lh;
  }

  // a short red rule, then the source
  if (srcLines.length) {
    const rw = large ? 40 : 24, ry = srcTop - (large ? 6 : 3);
    c.rect(W - m - rw, ry, W - m, ry + 1, Ink.Red);
    srcLines.forEach((l, i) => {
      const s = ellipsize(sf, l, srcW);
      print(c, sf, s, W - m - width(sf, s), srcTop + (i + 1) * srcLH - (large ? 6 : 4), Ink.Black);
    });
  }
  return c;
}

export const hitokotoMode: Screen = {
  name: "一言",
  description: "一句话：动画、文学、诗词、影视、哲学……（来自一言 hitokoto.cn），长短句都按能放下的最大字号排；每次刷新换一句。",
  config: CONFIG,
  render: renderHitokoto,
  portrait: true,
  prepare: async (db, _now, params) => {
    const cfg = getModeConfig(db, "hitokoto", CONFIG);
    return { data: await hitokoto(db, { categories: cfg.categories, length: cfg.length, advance: params?.advance === "1" }) };
  },
};
