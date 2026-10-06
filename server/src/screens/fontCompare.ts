// Font comparison sheet (temporary, to choose the fonts for P2). Every candidate is a
// bitmap font drawn pixel-exact at its native size. Candidates live in
// assets/fonts/candidates/ (subset to the characters used here).
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { Canvas, measure, lineHeight } from "../render/canvas.js";
import { loadBdf, type BitmapFont } from "../render/bdf.js";
import { fonts } from "../render/fonts.js";
import { type Panel, Ink } from "../panels.js";
import type { ScreenContext } from "./testPattern.js";

const dir = fileURLToPath(new URL("../../assets/fonts/candidates/", import.meta.url));

type CandidateId =
  | "wqy12" | "wqy16" | "ref9" | "helv20" | "helv25"
  | "barlow36" | "barlow48" | "barlow80" | "wenkai24" | "wenkai32";

const FILES: Record<CandidateId, string> = {
  wqy12: "wqy-bitmapsong-12px.bdf",
  wqy16: "wqy-bitmapsong-16px.bdf",
  ref9: "ref-wqy-zenhei-9px.bdf",
  helv20: "ref-helvetica-bold-20px.bdf",
  helv25: "ref-helvetica-bold-25px.bdf",
  barlow36: "barlow-condensed-semibold-36px.bdf",
  barlow48: "barlow-condensed-semibold-48px.bdf",
  barlow80: "barlow-condensed-bold-80px.bdf",
  wenkai24: "lxgw-wenkai-medium-24px.bdf",
  wenkai32: "lxgw-wenkai-medium-32px.bdf",
};

let cache: Partial<Record<CandidateId, BitmapFont>> | undefined;
function candidates(): Partial<Record<CandidateId, BitmapFont>> {
  if (!cache) {
    cache = {};
    for (const [id, file] of Object.entries(FILES) as [CandidateId, string][]) {
      if (existsSync(dir + file)) cache[id] = loadBdf(dir + file);
    }
  }
  return cache;
}

// Text shared with scripts/make-font-candidates.py (it subsets fonts to these characters).
export const SAMPLE_BODY = "农历八月十一 丙午年【马】 第40周 宜：祭祀 祈福 出行 忌：动土";
export const SAMPLE_BODY_SHORT = "农历八月十一 丙午年【马】 宜：祭祀 祈福";
export const SAMPLE_SMALL = "甲子 乙丑 丙寅 丁卯 清明 谷雨 立夏 小满 休 班 初一 十五 廿三";
export const SAMPLE_POEM_1 = "床前明月光，疑是地上霜。";
export const SAMPLE_POEM_2 = "举头望明月，低头思故乡。";
export const SAMPLE_DIGITS = "2026-10-02 18:44";
export const CAL_LUNAR = ["初九", "初十", "十一", "十二", "十三", "十四", "寒露"];

export function renderFontCompare(panel: Panel, ctx: ScreenContext): Canvas {
  const { px12, px10 } = fonts();
  const f = candidates();
  const W = panel.width;
  const H = panel.height;
  const big = W >= 600;
  const m = big ? 12 : 6;
  const c = new Canvas(W, H);
  let y = m;

  // Label in the left column, sample to its right.
  const labelW = big ? 150 : 64;
  const row = (label: string, font: BitmapFont | undefined, text: string, ink: Ink = Ink.Black, gapAfter = 6) => {
    if (!font) return;
    const lh = lineHeight(font);
    c.text(px10, label, m, y + Math.max(0, Math.floor((lh - lineHeight(px10)) / 2)), Ink.Red);
    c.text(font, text, m + labelW, y, ink);
    y += lh + gapAfter;
  };
  // 3.98": rule + section title; 4.2": just a rule (no room for titles).
  const section = (title: string) => {
    c.rect(m, y, W - m, y + 1, Ink.Black);
    y += 3;
    if (!big) return;
    c.text(px10, title, m, y, Ink.Black);
    y += lineHeight(px10) + 2;
  };
  const L = (long: string, short: string) => (big ? long : short);

  c.text(px12, `字体对比 · ${panel.name} ${W}×${H}`, m, y, Ink.Black);
  c.textRight(px10, big ? "红字=字体名，右侧=原始像素，未缩放" : "*=当前字体", W - m, y + 2, Ink.Black);
  y += lineHeight(px12) + 4;

  section("① 正文");
  row(L("Fusion 12px（当前）", "Fusion12*"), px12, big ? SAMPLE_BODY : SAMPLE_BODY_SHORT);
  row(L("文泉驿点阵宋 12px", "文泉驿12"), f.wqy12, big ? SAMPLE_BODY : SAMPLE_BODY_SHORT);
  row(L("文泉驿点阵宋 16px", "文泉驿16"), f.wqy16, big ? SAMPLE_BODY : SAMPLE_BODY_SHORT);

  section("② 小字");
  row(L("Fusion 10px（当前）", "Fusion10*"), px10, big ? SAMPLE_SMALL : SAMPLE_SMALL.slice(0, 23));
  row(L("参考 9px（缺字不显示）", "参考9px"), f.ref9, big ? SAMPLE_SMALL : SAMPLE_SMALL.slice(0, 23));

  section("③ 大号数字");
  const digitRow = (label: string, draw: () => number) => {
    const top = y;
    const h = draw();
    c.text(px10, label, m, top + Math.max(0, Math.floor((h - lineHeight(px10)) / 2)), Ink.Red);
    y = top + h + 6;
  };
  if (big) {
    digitRow("12px×4（当前）", () => {
      c.textScaled(px12, "18:44", m + labelW, y - 8, 4, Ink.Black);
      return lineHeight(px12) * 4 - 12;
    });
  }
  if (f.helv25 && f.helv20) {
    digitRow(L("Helvetica 粗 25/20px（参考）", "Helvetica"), () => {
      const x = c.text(f.helv25!, "2026", m + labelW, y, Ink.Red);
      c.text(f.helv20!, " 10 02  18:44", x, y + lineHeight(f.helv25!) - lineHeight(f.helv20!), Ink.Black);
      return lineHeight(f.helv25!);
    });
  }
  // Barlow: big time with a smaller date beside it, sharing one row (bottoms aligned).
  const barlowBig = big ? f.barlow80 : f.barlow48;
  const barlowMid = big ? f.barlow48 : f.barlow36;
  if (barlowBig && barlowMid) {
    digitRow(L("Barlow 窄体 80/48px", "Barlow"), () => {
      // Trim the font's generous line box so the row is only as tall as the digits.
      const top = y - Math.round(barlowBig.ascent * 0.25);
      const x = c.text(barlowBig, "18:44", m + labelW, top, Ink.Black);
      c.text(barlowMid, big ? "  10-02" : " 10-02", x, top + barlowBig.ascent - barlowMid.ascent, Ink.Red);
      return Math.round(barlowBig.ascent * 0.8);
    });
  }

  section("④ 大号中文");
  row(L("霞鹜文楷 24px", "文楷24"), f.wenkai24, SAMPLE_POEM_1);
  if (big) row("霞鹜文楷 32px", f.wenkai32, SAMPLE_POEM_2, Ink.Black, 4);

  // ⑤ Calendar cells in the reference's style: Helvetica date + 16px lunar (3.98" only)
  if (big && f.helv25 && f.wqy16 && y + 70 < H) {
    section("⑤ 参考项目日历格子样式：Helvetica 粗体日期 + 文泉驿 16px 农历（周末红、今天红圈）");
    const cellW = Math.floor((W - 2 * m) / 7);
    const cellH = Math.min(H - y - m, 64);
    for (let i = 0; i < 7; i++) {
      const x0 = m + i * cellW;
      if (i > 0) c.dottedV(x0, y, y + cellH, Ink.Black, 1, 4);
      const day = String(1 + i);
      const today = i === 3;
      const weekend = i >= 5;
      const cx = x0 + Math.floor(cellW / 2);
      if (today) c.fillCircle(cx, y + 15, 15, Ink.Red);
      const dayW = measure(f.helv25, day);
      c.text(f.helv25, day, cx - Math.floor(dayW / 2), y + 3, today ? Ink.White : weekend ? Ink.Red : Ink.Black);
      const lunar = CAL_LUNAR[i];
      c.text(f.wqy16, lunar, cx - Math.floor(measure(f.wqy16, lunar) / 2), y + 34,
             i === 6 ? Ink.Red : weekend ? Ink.Red : Ink.Black);
    }
  }
  void ctx;
  c.frame(0, 0, W, H, Ink.Black);
  return c;
}
