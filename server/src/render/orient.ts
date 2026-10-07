// An upright (oriented) canvas turned into the panel's own orientation, the one the device
// and its frame buffer use. See Orientation in panels.ts.
import { Canvas } from "./canvas.js";
import type { Orientation } from "../panels.js";

/**
 * Native pixel (x, y) of a W x H panel shows upright pixel:
 *   landscape        (x, y)
 *   landscape-flip   (W-1-x, H-1-y)
 *   portrait         (y, W-1-x)      the panel turned a quarter counter-clockwise
 *   portrait-flip    (H-1-y, x)      a quarter clockwise
 */
export function toNative(c: Canvas, o: Orientation | undefined): Canvas {
  if (!o || o === "landscape") return c;
  const portrait = o === "portrait" || o === "portrait-flip";
  const W = portrait ? c.height : c.width, H = portrait ? c.width : c.height;
  const out = new Canvas(W, H);
  const src = c.px, dst = out.px, cw = c.width;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = o === "portrait" ? y : o === "portrait-flip" ? H - 1 - y : W - 1 - x;
      const v = o === "portrait" ? W - 1 - x : o === "portrait-flip" ? x : H - 1 - y;
      dst[y * W + x] = src[v * cw + u];
    }
  }
  return out;
}
