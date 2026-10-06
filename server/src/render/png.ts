// Minimal PNG decoder (node:zlib only) for uploaded photos: 8-bit greyscale, grey+alpha,
// RGB, RGBA and palette images, non-interlaced, which covers what browsers' canvas.toBlob
// produces. Alpha is composited onto white.
import { inflateSync } from "node:zlib";

export interface RgbImage { width: number; height: number; rgb: Uint8Array }

export function decodePng(buf: Uint8Array): RgbImage {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length < 8 || b.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  let palette: Buffer | undefined, trns: Buffer | undefined;
  const idat: Buffer[] = [];
  while (pos + 8 <= b.length) {
    const len = b.readUInt32BE(pos);
    const kind = b.toString("ascii", pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (kind === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; type = data[9]; interlace = data[12];
    } else if (kind === "PLTE") palette = data;
    else if (kind === "tRNS") trns = data;
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`unsupported PNG (bit depth ${depth}, interlace ${interlace})`);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels) throw new Error(`unsupported PNG colour type ${type}`);
  if (width * height > 25_000_000) throw new Error("PNG too large");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0;
      const up = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      out[i] = v & 0xff;
    }
    prev = out;
  }
  const rgb = new Uint8Array(width * height * 3);
  const over = (v: number, alpha: number) => Math.round((v * alpha + 255 * (255 - alpha)) / 255);
  for (let i = 0; i < width * height; i++) {
    let r: number, g: number, bl: number, al = 255;
    if (type === 0) { r = g = bl = px[i]; }
    else if (type === 4) { r = g = bl = px[i * 2]; al = px[i * 2 + 1]; }
    else if (type === 2) { r = px[i * 3]; g = px[i * 3 + 1]; bl = px[i * 3 + 2]; }
    else if (type === 6) { r = px[i * 4]; g = px[i * 4 + 1]; bl = px[i * 4 + 2]; al = px[i * 4 + 3]; }
    else {
      const k = px[i];
      if (!palette || k * 3 + 2 >= palette.length) throw new Error("bad PNG palette");
      r = palette[k * 3]; g = palette[k * 3 + 1]; bl = palette[k * 3 + 2];
      if (trns && k < trns.length) al = trns[k];
    }
    rgb[i * 3] = over(r, al); rgb[i * 3 + 1] = over(g, al); rgb[i * 3 + 2] = over(bl, al);
  }
  return { width, height, rgb };
}
