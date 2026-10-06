// Encoders: device frame formats and a browser preview.
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { type Panel, Ink, effectiveInk } from "../panels.js";
import type { Canvas } from "./canvas.js";

/**
 * Raw 2bpp frame as the firmware expects it: row-major, top to bottom, 4 pixels per
 * byte, first pixel in bits 7..6. Length = width * height / 4.
 */
export function pack2bpp(canvas: Canvas, panel: Panel): Uint8Array {
  const n = canvas.width * canvas.height;
  if (n % 4 !== 0) throw new Error("width*height must be a multiple of 4");
  const code = panel.codes;
  const out = new Uint8Array(n / 4);
  const px = canvas.px;
  for (let i = 0, o = 0; i < n; i += 4, o++) {
    out[o] = (code[px[i]] << 6) | (code[px[i + 1]] << 4) | (code[px[i + 2]] << 2) | code[px[i + 3]];
  }
  return out;
}

/** 1-bit BMP (bottom-up, white = 1) for black/white firmware. Any non-white ink is black. */
export function packBmp1(canvas: Canvas): Uint8Array {
  const { width: w, height: h } = canvas;
  const stride = (Math.ceil(w / 8) + 3) & ~3;
  const headerSize = 14 + 40 + 8;
  const out = new Uint8Array(headerSize + stride * h);
  const dv = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d; // "BM"
  dv.setUint32(2, out.length, true);
  dv.setUint32(10, headerSize, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 1, true);
  dv.setUint32(34, stride * h, true);
  dv.setUint32(46, 2, true);
  out.set([0, 0, 0, 0, 255, 255, 255, 0], 54); // palette: 0 = black, 1 = white
  for (let y = 0; y < h; y++) {
    const row = headerSize + (h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      if (canvas.px[y * w + x] === Ink.White) out[row + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

/** Short content hash, used as the ETag. */
export function frameEtag(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex").slice(0, 16);
}

/** PNG preview using the panel's measured colours (what the panel will look like). */
export function previewPng(canvas: Canvas, panel: Panel, scale = 1): Uint8Array {
  const pal: Record<number, [number, number, number]> = {
    [Ink.Black]: panel.measured.black,
    [Ink.White]: panel.measured.white,
    [Ink.Yellow]: panel.measured.yellow,
    [Ink.Red]: panel.measured.red,
  };
  const w = canvas.width * scale;
  const h = canvas.height * scale;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const rowStart = y * (w * 3 + 1);
    raw[rowStart] = 0; // filter: none
    const sy = Math.floor(y / scale);
    for (let x = 0; x < w; x++) {
      const ink = effectiveInk(panel, canvas.px[sy * canvas.width + Math.floor(x / scale)] as Ink);
      const [r, g, b] = pal[ink];
      const o = rowStart + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  return encodePng(w, h, raw);
}

function encodePng(w: number, h: number, rawRgbRows: Buffer): Uint8Array {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rawRgbRows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG of an RGB image (photo editor source view). */
export function rgbPng(img: { width: number; height: number; rgb: Uint8Array }): Uint8Array {
  const { width: w, height: h } = img;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(img.rgb.buffer, img.rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  return encodePng(w, h, raw);
}
