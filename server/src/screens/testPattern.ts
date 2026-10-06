// Backend test screen: shows that the server -> device path is pixel-exact, with
// live data (time, request count, battery, RSSI) so every refresh visibly changes.
import { Canvas, measure, lineHeight } from "../render/canvas.js";
import { fonts } from "../render/fonts.js";
import { type Panel, Ink } from "../panels.js";
import type { WeatherData } from "../data/weather.js";

export interface ScreenContext {
  now: Date;
  mac?: string;
  batteryV?: number;
  rssi?: number;
  requestNo?: number;
  /** Short current-weather summary (e.g. "23℃ 多云") for screens that show one. */
  weatherLine?: string;
  /** Weather data for the weather screen, and a note to show when there is none. */
  weather?: WeatherData;
  weatherNote?: string;
  /** Photo-frame screen: the photo to show (the test chart if absent). */
  photo?: import("./photo.js").PhotoContext;
  /** Large-text font of the device ("wenkai" / "sans" / "pixel"). */
  font?: string;
  /** Mode-specific data loaded by the screen's prepare (shape defined by each screen). */
  data?: unknown;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const SAMPLE = "永和九年，岁在癸丑，暮春之初，会于会稽山阴之兰亭，修禊事也。";
const SAMPLE_EN = "The quick brown fox jumps over the lazy dog 0123456789";

const pad2 = (n: number): string => String(n).padStart(2, "0");

export function renderTestPattern(panel: Panel, ctx: ScreenContext): Canvas {
  const { px12, px10 } = fonts();
  const W = panel.width;
  const H = panel.height;
  const big = W >= 600;
  const m = big ? 16 : 8; // margin
  const c = new Canvas(W, H);
  const lh12 = lineHeight(px12);
  const lh10 = lineHeight(px10);

  // Header bar
  const barH = lh12 + 8;
  c.rect(0, 0, W, barH, Ink.Black);
  c.text(px12, "InkBoard 测试画面", m, 4, Ink.White);
  c.textRight(px10, `${panel.name}  ${W}×${H}`, W - m, 4 + (lh12 - lh10), Ink.White);

  // Time (12px font at integer scale) + date
  let y = barH + (big ? 14 : 8);
  const t = ctx.now;
  const scale = big ? 5 : 3;
  const timeEnd = c.textScaled(px12, `${pad2(t.getHours())}:${pad2(t.getMinutes())}`, m, y - (big ? 10 : 6), scale, Ink.Black);
  const dateX = timeEnd + (big ? 24 : 12);
  c.text(px12, `${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日`, dateX, y, Ink.Red);
  // Seconds and the request counter change on every request; only show them when asked
  // (compat/testing), so v1 frames keep the same ETag while nothing meaningful changed.
  const live = ctx.requestNo !== undefined;
  c.text(px12, `星期${WEEKDAYS[t.getDay()]}` + (live ? `  ${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}` : ""),
    dateX, y + lh12 + 2, Ink.Black);
  if (live) {
    c.text(px10, `第 ${ctx.requestNo} 次请求`, dateX, y + 2 * lh12 + 6, Ink.Black);
  }
  y += lh12 * scale - (big ? 6 : 4);

  // Device info
  const info = [
    ctx.mac ? `设备 ${ctx.mac}` : "设备 —",
    `电池 ${ctx.batteryV !== undefined ? ctx.batteryV.toFixed(2) + " V" : "—"}`,
    `信号 ${ctx.rssi !== undefined ? ctx.rssi + " dBm" : "—"}`,
  ].join("    ");
  c.text(px10, info, m, y, Ink.Black);
  y += lh10 + (big ? 10 : 6);
  c.dottedH(m, W - m, y, Ink.Black, 1, 3);
  y += big ? 10 : 6;

  // Font samples: 12px and 10px pixel fonts, never scaled or dithered
  c.text(px12, "12px：" + SAMPLE, m, y, Ink.Black);
  y += lh12 + 4;
  c.text(px12, "12px 红：" + SAMPLE.slice(0, big ? 30 : 14), m, y, Ink.Red);
  y += lh12 + 4;
  c.text(px10, "10px：" + SAMPLE + (big ? " " + SAMPLE_EN : ""), m, y, Ink.Black);
  y += lh10 + 4;
  c.text(px12, SAMPLE_EN, m, y, Ink.Black);
  y += lh12 + (big ? 10 : 6);

  // Yellow text needs a dark background to be readable (B/W/R panels show it red)
  const stripH = lh12 + 8;
  c.rect(m, y, W - m, y + stripH, Ink.Black);
  c.text(px12, panel.colors >= 4 ? "黄色文字（黑底）" : "黄色墨水在三色屏上显示为红色", m + 6, y + 4, Ink.Yellow);
  y += stripH + (big ? 12 : 6);

  // 1px detail strip: vertical lines, checkerboard, horizontal lines
  const stripTop = y;
  const detailH = big ? 28 : 16;
  const segW = Math.floor((W - 2 * m) / 3);
  for (let yy = stripTop; yy < stripTop + detailH; yy++) {
    for (let x = m; x < W - m; x++) {
      const seg = Math.min(2, Math.floor((x - m) / segW));
      const on = seg === 0 ? x % 2 === 0 : seg === 1 ? (x + yy) % 2 === 0 : yy % 2 === 0;
      if (on) c.set(x, yy, Ink.Black);
    }
  }
  y = stripTop + detailH + (big ? 12 : 6);

  // Colour swatches with labels
  const swH = H - y - m;
  if (swH > lh10 + 6) {
    const labels: [string, Ink][] = [["黑", Ink.Black], ["白", Ink.White], ["黄", Ink.Yellow], ["红", Ink.Red]];
    const gap = big ? 8 : 4;
    const sw = Math.floor((W - 2 * m - 3 * gap) / 4);
    labels.forEach(([name, ink], i) => {
      const x0 = m + i * (sw + gap);
      c.rect(x0, y, x0 + sw, y + swH, ink);
      c.frame(x0, y, x0 + sw, y + swH, Ink.Black);
      const label = panel.colors === 3 && ink === Ink.Yellow ? "黄→红" : name;
      const fg = ink === Ink.Black || ink === Ink.Red ? Ink.White : Ink.Black;
      c.text(px10, label, x0 + Math.floor((sw - measure(px10, label)) / 2), y + 3, fg);
    });
  }
  c.frame(0, 0, W, H, Ink.Black);
  return c;
}
