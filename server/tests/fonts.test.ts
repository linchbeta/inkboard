// Pixel-exact text rendering (design doc §3.13): what the canvas draws must be exactly
// the glyph bitmaps in the BDF file. The reference below re-reads the BDF independently
// (plain string parsing, no shared code with src/render/bdf.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Canvas } from "../src/render/canvas.js";
import { fonts } from "../src/render/fonts.js";
import { parseBdf } from "../src/render/bdf.js";
import { Ink } from "../src/panels.js";

const FONT_DIR = fileURLToPath(new URL("../assets/fonts/", import.meta.url));

interface RefGlyph { dw: number; w: number; h: number; xo: number; yo: number; bits: string[] }

function referenceFont(file: string): { ascent: number; glyphs: Map<number, RefGlyph> } {
  const text = readFileSync(FONT_DIR + file, "utf8").replace(/\r\n/g, "\n");
  const ascent = Number(/^FONT_ASCENT (\d+)$/m.exec(text)![1]);
  const glyphs = new Map<number, RefGlyph>();
  for (const block of text.split("STARTCHAR ").slice(1)) {
    const enc = Number(/^ENCODING (-?\d+)$/m.exec(block)![1]);
    const dw = Number(/^DWIDTH (-?\d+)/m.exec(block)![1]);
    const [w, h, xo, yo] = /^BBX (.+)$/m.exec(block)![1].split(" ").map(Number);
    const hex = block.split("BITMAP\n")[1].split("ENDCHAR")[0].trim().split("\n").filter(Boolean);
    const bits = hex.map((hx) =>
      [...hx].map((d) => parseInt(d, 16).toString(2).padStart(4, "0")).join("").slice(0, w));
    glyphs.set(enc, { dw, w, h, xo, yo, bits });
  }
  return { ascent, glyphs };
}

function expectedPixels(ref: ReturnType<typeof referenceFont>, s: string, x0: number, top: number): Set<string> {
  const out = new Set<string>();
  let x = x0;
  for (const ch of s) {
    const g = ref.glyphs.get(ch.codePointAt(0)!)!;
    assert.ok(g, `glyph missing for ${ch}`);
    const gy = top + ref.ascent - g.yo - g.h;
    g.bits.forEach((row, r) => {
      [...row].forEach((bit, cIdx) => { if (bit === "1") out.add(`${x + g.xo + cIdx},${gy + r}`); });
    });
    x += g.dw;
  }
  return out;
}

function drawnPixels(c: Canvas): Set<string> {
  const out = new Set<string>();
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const v = c.get(x, y);
    assert.ok(v === Ink.Black || v === Ink.White, "only pure black/white pixels (no anti-aliasing)");
    if (v === Ink.Black) out.add(`${x},${y}`);
  }
  return out;
}

const SAMPLES = [
  "永和九年，岁在癸丑，暮春之初",
  "农历八月十一 丙午年[马] 第40周 休 班",
  "宜：祭祀 祈福 出行  忌：动土",
  "The quick brown fox 0123456789 ℃",
];

for (const [label, file, key] of [
  ["12px", "fusion-pixel-12px-proportional-zh_hans.subset.bdf", "px12"],
  ["10px", "fusion-pixel-10px-proportional-zh_hans.subset.bdf", "px10"],
] as const) {
  test(`${label} text is pixel-identical to the BDF glyphs`, () => {
    const ref = referenceFont(file);
    const font = fonts()[key];
    for (const s of SAMPLES) {
      const c = new Canvas(400, 40);
      c.text(font, s, 3, 5, Ink.Black);
      assert.deepEqual(drawnPixels(c), expectedPixels(ref, s, 3, 5), `mismatch drawing "${s}"`);
    }
  });
}

test("parseBdf tolerates trailing whitespace (WenQuanYi writes 'BITMAP ')", () => {
  const bdf = "STARTFONT 2.1 \nFONT_ASCENT 2\nFONT_DESCENT 0\nCHARS 1\n" +
    "STARTCHAR A \nENCODING 65 \nDWIDTH 3 0 \nBBX 2 2 0 0\nBITMAP \n80 \nC0\nENDCHAR \nENDFONT\n";
  const f = parseBdf(bdf);
  const g = f.glyphs.get(65)!;
  assert.equal(g.advance, 3);
  assert.deepEqual(g.rows, [0b10n, 0b11n]);
});

test("1px strokes stay 1px: '一' is a single-pixel-high horizontal run", () => {
  const c = new Canvas(40, 20);
  c.text(fonts().px12, "一", 0, 0, Ink.Black);
  const rows = new Set([...drawnPixels(c)].map((p) => p.split(",")[1]));
  assert.equal(rows.size, 1);
});

test("subset covers the characters the calendar needs", () => {
  const { px12, px10 } = fonts();
  const needed = "正二三四五六七八九十冬腊初廿卅闰甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥鼠牛虎兔龙蛇马羊猴鸡狗猪"
    + "立春雨水惊蛰春分清明谷雨夏小满芒种至暑大秋处白露寒霜降冬雪年月日周星期一休班宜忌℃";
  for (const ch of needed) {
    assert.ok(px12.glyphs.has(ch.codePointAt(0)!), `12px missing ${ch}`);
    assert.ok(px10.glyphs.has(ch.codePointAt(0)!), `10px missing ${ch}`);
  }
});
