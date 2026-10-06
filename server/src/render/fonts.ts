// Bundled bitmap fonts.
//  - Fusion Pixel 12/10px (SIL OFL 1.1): test screen.
//  - WenQuanYi Bitmap Song 12/16px (GPLv2 + font embedding exception): body text.
//  - Helvetica Bold 15/20/25px, digits only (Adobe/DEC X11 bitmap licence): bold numbers,
//    decoded from the EPD-nRF5 reference (u8g2 helvB10/helvB14/helvB18_tn).
//  - WenQuanYi Zen Hei 9px, 132 calendar glyphs (GPLv2 + font exception): tiny calendar
//    labels (day stem/branch, solar terms), from the reference's u8g2_font_wqy6_t_lunar.
// CJK fonts are subset to ASCII + GB2312.
import { fileURLToPath } from "node:url";
import { loadBdf, scaleFont, withExtraGlyphs, type BitmapFont } from "./bdf.js";

const dir = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));

export interface Fonts {
  px12: BitmapFont;
  px10: BitmapFont;
  wqy12: BitmapFont;
  wqy16: BitmapFont;
  helv15: BitmapFont;
  helv20: BitmapFont;
  helv25: BitmapFont;
  tiny9: BitmapFont;
}

let cache: Fonts | undefined;

export function fonts(): Fonts {
  cache ??= {
    px12: loadBdf(dir + "fusion-pixel-12px-proportional-zh_hans.subset.bdf"),
    px10: loadBdf(dir + "fusion-pixel-10px-proportional-zh_hans.subset.bdf"),
    wqy12: loadBdf(dir + "wqy-bitmapsong-12px.subset.bdf"),
    wqy16: loadBdf(dir + "wqy-bitmapsong-16px.subset.bdf"),
    helv15: loadBdf(dir + "ref-helvetica-bold-15px.bdf"),
    helv20: loadBdf(dir + "ref-helvetica-bold-20px.bdf"),
    helv25: loadBdf(dir + "ref-helvetica-bold-25px.bdf"),
    tiny9: loadBdf(dir + "ref-wqy-zenhei-9px-lunar.bdf"),
  };
  return cache;
}

// ── Large display fonts, rasterised from TrueType by scripts/make-fonts.py ──
//  - LXGW WenKai Medium 霞鹜文楷 (SIL OFL 1.1): large Chinese. Full GB2312 at 20-40 px, plus
//    Japanese (JIS X 0208) and Korean (KS X 1001 Hangul) in "-extra" files from the full
//    release; 48/56 px hold only the poems' characters ("wenkai-poems").
//  - Inter Medium (SIL OFL 1.1): large Latin and IPA.
//  - Barlow Condensed Bold (SIL OFL 1.1): large numbers (digits and + - . , % : / only).
//  - Noto Sans SC Medium (the 思源黑体 design; SIL OFL 1.1): large Chinese on the 4.2".
export const BIG_SIZES = {
  wenkai: [20, 22, 24, 28, 32, 40],
  // WenQuanYi bitmap fonts doubled (12 -> 24, 16 -> 32): even strokes on the 4.2"
  pixel: [24, 32],
  sans: [20, 22, 24, 28, 32, 40],
  "wenkai-poems": [48, 56],
  inter: [20, 24, 32, 48, 64, 80],
  barlow: [32, 44, 56, 72, 96],
} as const;
export type BigFamily = keyof typeof BIG_SIZES;

const FILES: Record<Exclude<BigFamily, "pixel">, (px: number) => string> = {
  wenkai: (px) => `lxgw-wenkai-${px}px.bdf.gz`,
  "wenkai-poems": (px) => `lxgw-wenkai-${px}px-poems.bdf.gz`,
  inter: (px) => `inter-medium-${px}px.bdf.gz`,
  barlow: (px) => `barlow-condensed-bold-${px}px.bdf.gz`,
  sans: (px) => `noto-sans-sc-medium-${px}px.bdf.gz`,
};
const big = new Map<string, BitmapFont>();

/** A large font at one of its bundled sizes (loaded on first use). */
export function bigFont(family: BigFamily, px: number): BitmapFont {
  if (!(BIG_SIZES[family] as readonly number[]).includes(px)) throw new Error(`${family} has no ${px}px size`);
  const key = `${family}/${px}`;
  let f = big.get(key);
  if (!f) {
    f = family === "pixel" ? scaleFont(px === 24 ? fonts().wqy12 : fonts().wqy16, 2) : loadBdf(dir + FILES[family](px));
    // Japanese (kana, JIS kanji) and Korean (Hangul) glyphs beyond GB2312, from the full
    // WenKai; the sans face borrows them too (it has none of its own)
    if (family === "wenkai" || family === "sans") f = withExtraGlyphs(f, loadBdf(dir + `lxgw-wenkai-${px}px-extra.bdf.gz`));
    big.set(key, f);
  }
  return f;
}
