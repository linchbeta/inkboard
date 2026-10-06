import { test } from "node:test";
import assert from "node:assert/strict";
import { Canvas } from "../src/render/canvas.js";
import { pack2bpp, packBmp1 } from "../src/render/pack.js";
import { PANELS, Ink } from "../src/panels.js";

test("pack2bpp: row-major, 4 px/byte, first pixel in bits 7..6, firmware colour codes", () => {
  const p = PANELS.se0398;
  const c = new Canvas(p.width, p.height);
  // First four pixels: black, white, yellow, red -> 00 01 10 11
  c.set(0, 0, Ink.Black); c.set(1, 0, Ink.White); c.set(2, 0, Ink.Yellow); c.set(3, 0, Ink.Red);
  // First pixel of row 1 red -> byte (width/4), bits 7..6
  c.set(0, 1, Ink.Red);
  const b = pack2bpp(c, p);
  assert.equal(b.length, 105984);
  assert.equal(b[0], 0b00_01_10_11);
  assert.equal(b[1], 0b01_01_01_01); // untouched pixels are white
  assert.equal(b[p.width / 4], 0b11_01_01_01);
});

test("pack2bpp: B/W/R panel renders yellow ink as red (never sends code 10)", () => {
  const p = PANELS.hink42_bwr;
  const c = new Canvas(p.width, p.height, Ink.Yellow);
  const b = pack2bpp(c, p);
  assert.equal(b.length, 30000);
  assert.ok(b.every((v) => v === 0b11_11_11_11));
});

test("packBmp1: header, bottom-up rows, white = 1", () => {
  const c = new Canvas(16, 2); // white
  c.set(0, 0, Ink.Black); // top-left black
  c.set(15, 1, Ink.Red);  // non-white ink -> black
  const b = packBmp1(c);
  const dv = new DataView(b.buffer);
  assert.equal(String.fromCharCode(b[0], b[1]), "BM");
  assert.equal(dv.getUint32(10, true), 62); // pixel data offset
  assert.equal(dv.getUint16(28, true), 1); // 1 bpp
  assert.equal(b.length, 62 + 4 * 2); // stride rounded to 4 bytes
  // Bottom-up: file row 0 = image row 1; its last pixel is black
  assert.deepEqual([...b.slice(62, 64)], [0xff, 0xfe]);
  // File row 1 = image row 0; its first pixel is black
  assert.deepEqual([...b.slice(66, 68)], [0x7f, 0xff]);
});

test("Canvas.rect rounds fractional bounds (no stray pixels elsewhere in the buffer)", () => {
  const c = new Canvas(20, 10);
  c.rect(2.4, 3.6, 5.5, 5.2, Ink.Black); // -> x 2..5 (end 6 exclusive), y 4 only (end 5 exclusive)
  const black: string[] = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 20; x++) if (c.get(x, y) === Ink.Black) black.push(`${x},${y}`);
  assert.deepEqual(black, ["2,4", "3,4", "4,4", "5,4"]);
});

test("Bayer dithering hits the requested ink shares exactly over a 4x4 tile", async () => {
  const { ditherInk, TONES } = await import("../src/render/dither.js");
  const count = (tone: Parameters<typeof ditherInk>[0]) => {
    const n: Record<number, number> = {};
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const k = ditherInk(tone, x, y); n[k] = (n[k] ?? 0) + 1; }
    return n;
  };
  assert.deepEqual(count(TONES.orange), { [Ink.Red]: 8, [Ink.Yellow]: 8 });
  assert.deepEqual(count(TONES.grey25), { [Ink.Black]: 4, [Ink.White]: 12 });
  assert.deepEqual(count([]), { [Ink.White]: 16 });
});

test("Floyd–Steinberg tones: right ink shares, only the tone's inks, solid pixels untouched", async () => {
  const { resolveTones, TONES } = await import("../src/render/dither.js");
  for (const panel of [PANELS.se0398, PANELS.hink42_bwr]) {
    const c = new Canvas(64, 64);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) c.setTone(x, y, TONES.grey25, Ink.White);
    for (let y = 32; y < 64; y++) for (let x = 0; x < 64; x++) c.setTone(x, y, TONES.orange, Ink.Red);
    c.rect(30, 0, 34, 64, Ink.Black); // a solid stroke drawn over the tones stays solid
    resolveTones(c, panel);
    const n = (y0: number, y1: number, ink: Ink) => {
      let k = 0;
      for (let y = y0; y < y1; y++) for (let x = 0; x < 64; x++) if (x < 30 || x >= 34) k += c.get(x, y) === ink ? 1 : 0;
      return k / (60 * (y1 - y0));
    };
    assert.ok(Math.abs(n(0, 32, Ink.Black) - 0.25) < 0.04, `${panel.id} grey: ${n(0, 32, Ink.Black)}`);
    assert.equal(n(0, 32, Ink.Red) + n(0, 32, Ink.Yellow), 0);
    assert.equal(n(32, 64, Ink.Black) + n(32, 64, Ink.White), 0);
    if (panel.colors === 4) assert.ok(Math.abs(n(32, 64, Ink.Red) - 0.5) < 0.05, `orange red share ${n(32, 64, Ink.Red)}`);
    for (let y = 0; y < 64; y++) for (let x = 30; x < 34; x++) assert.equal(c.get(x, y), Ink.Black);
    assert.equal(c.toneMask, undefined);
  }
});
