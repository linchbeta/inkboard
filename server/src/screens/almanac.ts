// 月相·黄历 (TRMNL's "Lunar Calendar", no. 7, plus the Chinese almanac): today's moon drawn
// with its lit part (dithered yellow, craters; white on B/W/R), moon age, illumination and
// the next full / new moon; next to it the almanac: lunar date, stems and branches, 宜/忌,
// clash, Peng Zu taboos, lucky directions, day officer, lunar mansion, na yin.
import { cjkDisplay, cjkAt } from "../render/typography.js";
import lunarPkg from "lunar-javascript";
import { refFonts, width, print, centeredX, centeredAt, bigRef, type RefFont } from "../render/reftext.js";
import type { Canvas } from "../render/canvas.js";
import { fillCircle } from "../render/gfx.js";
import { paintPixel, type Tone } from "../render/dither.js";
import { type Panel, Ink } from "../panels.js";
import { LUNAR_MONTH, LUNAR_DATE, lunarOf, almanacOf, WEEKDAY } from "../data/calendar.js";
import type { ScreenContext } from "./testPattern.js";
import type { Screen } from "./screen.js";
import { screenWithHeader, wrapText, wrapItems } from "./common.js";

const SYNODIC = 29.530588853;
const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14); // a known new moon

/** Moon age in days (0 = new, ~14.8 = full) and lit fraction at `t`. */
export function moonPhase(t: Date): { age: number; lit: number; waxing: boolean } {
  const age = ((((t.getTime() - NEW_MOON_REF) / 86_400_000) % SYNODIC) + SYNODIC) % SYNODIC;
  return { age, lit: (1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2, waxing: age < SYNODIC / 2 };
}

export function phaseName(age: number): string {
  const p = age / SYNODIC;
  if (p < 0.03 || p > 0.97) return "新月";
  if (p < 0.22) return "蛾眉月";
  if (p < 0.28) return "上弦月";
  if (p < 0.47) return "盈凸月";
  if (p < 0.53) return "满月";
  if (p < 0.72) return "亏凸月";
  if (p < 0.78) return "下弦月";
  return "残月";
}

/** Next time the age reaches `target` days, from `t`. */
function next(t: Date, target: number): Date {
  const { age } = moonPhase(t);
  let d = target - age;
  if (d <= 0.3) d += SYNODIC;
  return new Date(t.getTime() + d * 86_400_000);
}

function drawMoon(c: Canvas, cx: number, cy: number, r: number, age: number, color: boolean): void {
  const phase = (2 * Math.PI * age) / SYNODIC;
  const k = Math.cos(phase);
  const waxing = age < SYNODIC / 2;
  const dark: Tone = [[Ink.Black, 0.72]];
  const craters: [number, number, number][] = [[-0.35, -0.3, 0.18], [0.25, 0.1, 0.22], [-0.1, 0.45, 0.14], [0.45, -0.4, 0.1], [-0.5, 0.2, 0.09]];
  for (let y = -r; y <= r; y++) {
    const w = Math.sqrt(Math.max(0, r * r - y * y));
    for (let x = -Math.ceil(w); x <= w; x++) {
      if (x * x + y * y > r * r) continue;
      // terminator: an ellipse with semi-axis w*cos(phase)
      const lit = waxing ? x > w * k : x < -w * k;
      let tone: Tone;
      if (!lit) tone = dark;
      else {
        const inCrater = craters.some(([a, b, cr]) => (x / r - a) ** 2 + (y / r - b) ** 2 < cr * cr);
        // lit: yellow with orange-ish craters on 4-colour panels; paper white with grey craters on B/W/R
        tone = color ? (inCrater ? [[Ink.Yellow, 0.55]] : [[Ink.Yellow, 0.9]]) : (inCrater ? [[Ink.Black, 0.15]] : []);
      }
      paintPixel(c, () => tone, cx + x, cy + y);
    }
  }
  // outline
  for (let a = 0; a < 720; a++) {
    const t = (a / 720) * 2 * Math.PI;
    c.set(Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), Ink.Black);
  }
}

const md = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
const daysUntil = (a: Date, b: Date) => Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 86_400_000);

export function renderAlmanac(panel: Panel, ctx: ScreenContext) {
  const { wqy12, wqy9 } = refFonts();
  const now = ctx.now;
  const y = now.getFullYear(), mo = now.getMonth() + 1, d = now.getDate();
  const lunar = lunarOf(y, mo, d);
  const alm = almanacOf(y, mo, d);
  const L = lunarPkg.Solar.fromYmd(y, mo, d).getLunar();
  const f = screenWithHeader(panel, ctx, "月相·黄历");
  const { c, W, H, large, m } = f;
  // the moon at local noon (the day's representative phase)
  const ph = moonPhase(new Date(y, mo - 1, d, 12));

  // ── moon (left): as large as the column allows, the block centred vertically ──
  const split = large ? 330 : 150;
  const font = large ? wqy12 : wqy9;
  const full = next(new Date(y, mo - 1, d, 12), SYNODIC / 2), nw = next(new Date(y, mo - 1, d, 12), 0);
  const upcoming = ([["满月", full], ["新月", nw]] as const).slice().sort((a, b) => a[1].getTime() - b[1].getTime());
  const textLH = large ? 30 : 16;
  const textH = (large ? 40 : 22) + textLH * (1 + upcoming.length);
  const availH = H - f.top - (large ? 24 : 10);
  const r = Math.floor(Math.min((split - m) / 2 - (large ? 12 : 4), (availH - textH - (large ? 20 : 8)) / 2));
  const top = f.top + Math.round((availH - (2 * r + textH)) / 2) + (large ? 12 : 5);
  const mcx = Math.round((m + split) / 2), mcy = top + r;
  drawMoon(c, mcx, mcy, r, ph.age, panel.colors >= 4);
  let ty = mcy + r + (large ? 40 : 22);
  const name = phaseName(ph.age);
  const nameF = large ? bigRef("wenkai", 28) : wqy12;
  print(c, nameF, name, centeredX(nameF, name, mcx), ty, Ink.Red);
  ty += textLH;
  const stat = `月龄 ${ph.age.toFixed(1)} 天 · 照亮 ${Math.round(ph.lit * 100)}%`;
  print(c, font, stat, centeredX(font, stat, mcx), ty, Ink.Black);
  for (const [label, dt] of upcoming) {
    ty += textLH;
    const s = `${label} ${md(dt)}（${daysUntil(now, dt)}天后）`;
    print(c, font, s, centeredX(font, s, mcx), ty, Ink.Black);
  }

  // ── almanac (right): measure with the largest fonts that fit, then share the slack ──
  c.dottedV(split + (large ? 10 : 4), f.top + 14, H - 14, Ink.Black, 1, 3);
  const x0 = split + (large ? 30 : 12), x1 = W - m, cw = x1 - x0;
  const rows: [string, string][] = [
    ["冲煞", `冲${L.getDayChongDesc()} 煞${L.getDaySha()}`],
    ["吉神", `喜神${L.getDayPositionXiDesc()} 福神${L.getDayPositionFuDesc()} 财神${L.getDayPositionCaiDesc()}`],
    ["值神", `${L.getDayTianShen()}（${L.getDayTianShenLuck()}） 建除 ${L.getZhiXing()} 星宿 ${L.getXiu()}（${L.getXiuLuck()}）`],
    ["纳音", L.getDayNaYin()],
    ["彭祖", `${L.getPengZuGan()} ${L.getPengZuZhi()}`],
  ];
  const lunarStr = `${lunar.leap ? "闰" : ""}${LUNAR_MONTH[lunar.month]}${LUNAR_DATE[lunar.day]}`;
  const gz = `${lunar.yearGanZhi}年 ${alm.monthGanZhi}月 ${alm.dayGanZhi}日 · 属${lunar.zodiac}`;
  const sets: { head: RefFont; body: RefFont }[] = large
    ? [{ head: bigRef("wenkai", 32), body: bigRef("wenkai", 24) }, { head: bigRef("wenkai", 28), body: wqy12 }, { head: wqy12, body: wqy12 }, { head: wqy12, body: wqy9 }]
    : [{ head: cjkAt(false, 24), body: wqy9 }, { head: wqy12, body: wqy9 }];
  const top2 = f.top + (large ? 10 : 6), bottom2 = H - (large ? 10 : 6);
  type Block = { h: number; draw: (yy: number) => void };
  const build = (head: RefFont, body: RefFont): Block[] => {
    const lh = Math.round((body.ascent - body.descent) * 1.3);
    const br = Math.ceil(width(body, "宜") * 0.62) + 1; // the badge must hold the whole character
    const blocks: Block[] = [];
    blocks.push({ h: head.ascent - head.descent, draw: (yy) => {
      const b = yy + head.ascent;
      let x = print(c, body, "农历", x0, b, Ink.Black) + 8;
      x = print(c, head, lunarStr, x, b, Ink.Red) + 12;
      print(c, body, `星期${WEEKDAY[now.getDay()]}`, x, b, Ink.Black);
    } });
    const gzLines = wrapText(wqy9 === body ? wqy9 : body, gz, cw);
    blocks.push({ h: gzLines.length * lh, draw: (yy) => gzLines.forEach((s, i) => print(c, body, s, x0, yy + body.ascent + i * lh, Ink.Black)) });
    for (const [label, items, fill] of [["宜", alm.yi, Ink.Red], ["忌", alm.ji, Ink.Black]] as const) {
      const textX = x0 + 2 * br + (large ? 12 : 6);
      const lines = wrapItems(body, items.length ? [...items] : ["—"], x1 - textX, 4);
      blocks.push({ h: Math.max(2 * br, (lines.length - 1) * lh + (body.ascent - body.descent)), draw: (yy) => {
        const cy = yy + br;
        fillCircle(c, x0 + br, cy, br, fill);
        const p = centeredAt(body, label, x0 + br, cy);
        print(c, body, label, p.x, p.baseline, Ink.White);
        const first = centeredAt(body, "宜", 0, cy).baseline;
        lines.forEach((s, i) => print(c, body, s, textX, first + i * lh, Ink.Black));
      } });
    }
    const labW = width(body, "冲煞") + (large ? 14 : 6);
    for (const [k, v] of rows) {
      const vl = wrapText(body, v, cw - labW, 3);
      blocks.push({ h: vl.length * lh - (lh - (body.ascent - body.descent)), draw: (yy) => {
        print(c, body, k, x0, yy + body.ascent, Ink.Red);
        vl.forEach((s, i) => print(c, body, s, x0 + labW, yy + body.ascent + i * lh, Ink.Black));
      } });
    }
    return blocks;
  };
  const minGap = large ? 10 : 4;
  let blocks: Block[] = [];
  for (const s of sets) {
    blocks = build(s.head, s.body);
    if (blocks.reduce((a, b) => a + b.h, 0) + minGap * (blocks.length + 1) <= bottom2 - top2) break;
  }
  const used = blocks.reduce((a, b) => a + b.h, 0);
  const gap = Math.max(minGap, Math.min(large ? 30 : 12, Math.floor((bottom2 - top2 - used) / (blocks.length + 1))));
  let ay = top2 + Math.max(0, Math.floor((bottom2 - top2 - used - gap * (blocks.length - 1)) / 2));
  blocks.forEach((b, i) => {
    b.draw(ay);
    ay += b.h + gap;
    if (i === 3) c.dottedH(x0, x1, ay - Math.round(gap / 2), Ink.Black, 1, 3); // after 宜/忌
  });
  return c;
}

export const almanacMode: Screen = {
  name: "月相黄历",
  description: "今天的月相（月龄、照亮比例、下次满月/新月）和老黄历（宜忌、冲煞、吉神方位等）。",
  render: renderAlmanac,
};
