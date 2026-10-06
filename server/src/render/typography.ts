// Per-device typography for large text. Each device picks a face ("wenkai" 霞鹜文楷, the
// default; "sans" Noto Sans SC Medium 思源黑体; "pixel" doubled WenQuanYi bitmaps, 4.2"
// only). Sizes depend on the panel: the 3.98" (~237 dpi) uses 24-40 px; the 4.2"
// (~119 dpi) about 85 % of the asked size, 24 px at most (larger looked oversized there).
// The face is set by renderScreen right before a (synchronous) render, from the context.
import { bigRef, type RefFont } from "./reftext.js";

export type FontChoice = "wenkai" | "sans" | "pixel";
export const FONT_DEFAULT: FontChoice = "wenkai";
let face: FontChoice = FONT_DEFAULT;

export const setFont = (v: string | undefined) => { face = v === "sans" || v === "pixel" ? v : "wenkai"; };
export const getFont = (): FontChoice => face;

/** Large Chinese display fonts not above maxPx, largest first. */
export function cjkDisplay(large: boolean, maxPx = 99): RefFont[] {
  if (large) {
    const fam = face === "sans" ? "sans" : "wenkai"; // no pixel face on the 3.98"
    return [40, 32, 28, 24].filter((px) => px <= maxPx).map((px) => bigRef(fam, px));
  }
  if (face === "pixel") return [32, 24].filter((px) => px <= Math.round(maxPx * 0.85)).map((px) => bigRef("pixel", px));
  return [24, 22, 20].filter((px) => px <= Math.round(maxPx * 0.85)).map((px) => bigRef(face === "sans" ? "sans" : "wenkai", px));
}

/** The large Chinese font closest to (not above) px; the smallest one if none is. */
export function cjkAt(large: boolean, px: number): RefFont {
  const list = cjkDisplay(large, px);
  return list[0] ?? cjkDisplay(large).slice(-1)[0];
}
