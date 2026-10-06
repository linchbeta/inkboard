// 行情 (TRMNL's "Stock Price", no. 4): the first symbol featured (big price, change, today's
// minute chart against the previous close), the rest as a table. Chinese convention: up in
// red; down in black (no green ink). Data: Tencent / Sina public quotes, 5-minute cache.
import { refFonts, width, print, bigRef } from "../render/reftext.js";
import type { Canvas } from "../render/canvas.js";
import { paintPixel } from "../render/dither.js";
import { type Panel, Ink } from "../panels.js";
import { parseCodes, fetchQuotes, fetchMinutes, type Quote } from "../data/market.js";
import { getModeConfig, type ConfigField } from "../data/modeConfig.js";
import type { ScreenContext } from "./testPattern.js";
import type { Screen } from "./screen.js";
import { screenWithHeader, ellipsize, emptyNote } from "./common.js";

const CONFIG: ConfigField[] = [{
  key: "codes", label: "代码（每行一个，可加显示名）", type: "textarea",
  default: "sh000001 上证指数\nsz399001 深证成指\nsh600519 贵州茅台\nhk00700 腾讯控股\nusAAPL 苹果\nAU9999 黄金(元/克)\nwhUSDCNY 美元/人民币",
  help: "A股 sh600519 / sz000001，港股 hk00700，美股 usAAPL，汇率 whUSDCNY，黄金 AU9999（上海金，元/克）、XAU（伦敦金）、GC（纽约金）。第一行显示走势图。",
}];

interface MarketData { quotes: Quote[]; minutes: number[]; error?: string; configured: boolean }

const fmt = (v: number, d: number) => v.toFixed(d);
const signed = (v: number, d: number) => (v > 0 ? "+" : "") + v.toFixed(d);

function triangle(c: Canvas, x: number, base: number, size: number, up: boolean, ink: Ink): void {
  for (let r = 0; r < size; r++) {
    const half = Math.round(((up ? r : size - 1 - r) * size) / (2 * size));
    const yy = base - size + r;
    c.rect(x + Math.floor(size / 2) - half, yy, x + Math.floor(size / 2) + half + 1, yy + 1, ink);
  }
}

function sparkline(c: Canvas, pts: number[], prev: number, x0: number, y0: number, x1: number, y1: number, thick: number, fourColor: boolean): void {
  if (pts.length < 2) return;
  const lo = Math.min(prev, ...pts), hi = Math.max(prev, ...pts);
  const span = Math.max(hi - lo, prev * 0.002);
  const n = 241; // A-share session minutes; HK is longer but the shape is what matters
  const px = (i: number) => Math.round(x0 + ((x1 - x0) * i) / Math.max(n - 1, pts.length - 1));
  const py = (v: number) => Math.round(y1 - ((v - lo) / span) * (y1 - y0));
  const base = py(prev);
  // area between the line and the previous close: red above, grey below
  for (let i = 0; i + 1 < pts.length; i++) {
    for (let x = px(i); x < px(i + 1); x++) {
      const t = (x - px(i)) / Math.max(1, px(i + 1) - px(i));
      const y = Math.round(py(pts[i]) + (py(pts[i + 1]) - py(pts[i])) * t);
      const [a, b] = y < base ? [y, base] : [base, y];
      // 4-colour panels: solid yellow (lone coloured dots show dark there); B/W/R: light red dots
      for (let yy = a; yy < b; yy++) {
        if (fourColor && y < base) c.set(x, yy, Ink.Yellow);
        else paintPixel(c, () => (y < base ? [[Ink.Red, 0.22]] : [[Ink.Black, 0.22]]), x, yy);
      }
    }
  }
  c.dottedH(x0, x1, base, Ink.Black, 2, 3);
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = px(i), ay = py(pts[i]), bx = px(i + 1), by = py(pts[i + 1]);
    const k = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
    for (let s = 0; s <= k; s++) {
      const x = Math.round(ax + ((bx - ax) * s) / k), y = Math.round(ay + ((by - ay) * s) / k);
      c.rect(x, y, x + thick, y + thick, Ink.Black);
    }
  }
}

export function renderMarket(panel: Panel, ctx: ScreenContext) {
  const { wqy12, wqy9, helvB14 } = refFonts();
  const data = (ctx.data as MarketData | undefined) ?? { quotes: [], minutes: [], configured: false };
  const q0 = data.quotes[0];
  const f = screenWithHeader(panel, ctx, "行情", q0 ? `更新于 ${q0.time.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2}).*/, "$2-$3 $4:$5").replace(/^\d{4}[-/]/, "").slice(0, 11)}` : "");
  const { c, W, H, large, m } = f;
  if (!data.configured) { emptyNote(f, "在\"显示模式\"页面填写股票、黄金或汇率代码"); return c; }
  if (!q0) { emptyNote(f, data.error ? `行情获取失败：${data.error}` : "没有取到行情"); return c; }
  const inkOf = (q: Quote) => (q.change > 0 ? Ink.Red : Ink.Black);

  // ── featured ──
  let y = f.top + (large ? 40 : 24);
  print(c, wqy12, q0.name, m, y, Ink.Black);
  const ps = fmt(q0.price, q0.decimals);
  const priceBase = y + (large ? 84 : 50); // name baseline + gap + Barlow ascent
  const pe = print(c, bigRef("barlow", large ? 72 : 44), ps, m - 2, priceBase, inkOf(q0));
  const tri = large ? 14 : 10;
  triangle(c, pe + 12, priceBase - (large ? 18 : 8), tri, q0.change >= 0, inkOf(q0));
  // Helvetica has no "%": the sign is set in the body font
  const chg = `${signed(q0.change, q0.decimals)}  ${signed(q0.pct, 2)}`;
  const cx = print(c, helvB14, chg, pe + 12 + tri + 8, priceBase - (large ? 16 : 6), inkOf(q0));
  print(c, large ? wqy12 : wqy9, "%", cx + 1, priceBase - (large ? 16 : 6), inkOf(q0));
  if (large) print(c, wqy9, `昨收 ${fmt(q0.prev, q0.decimals)}`, pe + 12, priceBase + 4, Ink.Black);

  // minute chart (right of the price on 3.98", full width below on 4.2")
  const chart = large
    ? { x0: 420, y0: f.top + 22, x1: W - m, y1: priceBase + 6 }
    : { x0: m, y0: priceBase + 10, x1: W - m, y1: priceBase + 46 };
  if (data.minutes.length > 1) sparkline(c, data.minutes, q0.prev, chart.x0, chart.y0, chart.x1, chart.y1, large ? 2 : 1, panel.colors >= 4);

  // ── the rest as a table ──
  const rest = data.quotes.slice(1);
  const tTop = (large ? priceBase : chart.y1) + (large ? 30 : 12);
  c.rect(m, tTop, W - m, tTop + 1, Ink.Black);
  // rows share the free height (within limits); a second column only when one is not enough
  const avail = H - tTop - 6;
  const minRow = large ? 36 : 22;
  const cols = large && rest.length > Math.floor(avail / minRow) ? 2 : 1;
  const perCol = Math.max(1, Math.ceil(rest.length / cols));
  const rowH = Math.max(minRow, Math.min(large ? 64 : 30, Math.floor(avail / perCol)));
  const colW = Math.floor((W - 2 * m - (cols - 1) * 30) / cols);
  const rows = Math.max(1, Math.floor(avail / rowH));
  rest.slice(0, rows * cols).forEach((q, i) => {
    const col = Math.floor(i / rows), row = i % rows;
    const x0 = m + col * (colW + 30), x1 = x0 + colW;
    const base = tTop + row * rowH + Math.round(rowH / 2) + (large ? 8 : 5);
    const pf = large ? helvB14 : wqy12;
    const pctS = large ? signed(q.pct, 2) : `${signed(q.pct, 2)}%`; // helvetica: "%" from the body font
    const pctR = large ? x1 - width(wqy12, "%") - 1 : x1;
    const pctW = width(pf, "+10.00") + (large ? width(wqy12, "%") + 1 : width(pf, "%"));
    print(c, pf, pctS, pctR - width(pf, pctS), base, inkOf(q));
    if (large) print(c, wqy12, "%", pctR + 1, base, inkOf(q));
    const tri2 = large ? 10 : 7;
    triangle(c, x1 - pctW - tri2 - 6, base - (large ? 2 : 1), tri2, q.change >= 0, inkOf(q));
    const price = fmt(q.price, q.decimals);
    const priceR = x1 - pctW - tri2 - (large ? 22 : 14);
    print(c, pf, price, priceR - width(pf, price), base, Ink.Black);
    const nameF = large ? wqy12 : wqy9;
    print(c, nameF, ellipsize(nameF, q.name, priceR - width(pf, "00000.00") - x0 - 8), x0, base, Ink.Black);
    if (row < rows - 1 && i < rest.length - 1) c.dottedH(x0, x1, tTop + (row + 1) * rowH, Ink.Black, 1, 3);
  });
  return c;
}

export const marketMode: Screen = {
  name: "行情",
  description: "股票、指数、黄金、汇率：第一项大字加当天走势，其余列表（红涨黑跌）。",
  config: CONFIG,
  render: renderMarket,
  prepare: async (db) => {
    const codes = parseCodes(getModeConfig(db, "market", CONFIG).codes);
    if (!codes.length) return { data: { quotes: [], minutes: [], configured: false } satisfies MarketData };
    try {
      const quotes = await fetchQuotes(codes);
      const minutes = quotes[0] ? await fetchMinutes(codes[0].code) : [];
      return { data: { quotes, minutes, configured: true } satisfies MarketData };
    } catch (e) {
      return { data: { quotes: [], minutes: [], configured: true, error: e instanceof Error ? e.message : String(e) } satisfies MarketData };
    }
  },
};
