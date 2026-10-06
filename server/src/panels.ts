// Panel definitions. A frame is drawn with "inks"; each panel maps inks to its
// hardware 2bpp colour codes (row-major, top to bottom, 4 px/byte, MSB first).

export const Ink = { Black: 0, White: 1, Yellow: 2, Red: 3 } as const;
export type Ink = (typeof Ink)[keyof typeof Ink];

export interface Panel {
  id: string;
  name: string;
  width: number;
  height: number;
  /** 2 = B/W, 3 = B/W/R, 4 = B/W/Y/R (value the firmware sends as `colors`). */
  colors: 2 | 3 | 4;
  /** Hardware 2bpp code for each ink (index = Ink value). */
  codes: [number, number, number, number];
  /**
   * Smallest block (px) in which coloured ink shows reliably: lone red or yellow pixels on
   * the 3.98" render dark, so colourful dithering there uses 2x2 blocks. Default 1.
   */
  colorDot?: number;
  /**
   * Pixels per inch, about. The large layouts are drawn for the 3.98" (238); on the 5.83"
   * and 7.5" (~130) the same pixel sizes come out 1.7x as large, so type that would look
   * oversized there (the word card's) steps down. Unknown panels: 130.
   */
  ppi?: number;
  /** Radius (px) of the visible area's rounded corners, 0 for square panels. */
  cornerRadius: number;
  /** How the colours actually look on the panel, for previews and photo dithering. */
  measured: Record<"black" | "white" | "yellow" | "red", [number, number, number]>;
}

// Measured colours: starting values from the EPD-nRF5 reference (black 30,30,30 /
// white 220,215,205 / red 180,50,50 / yellow 200,195,60); calibrate with photos later.
const MEASURED = {
  black: [30, 30, 30],
  white: [220, 215, 205],
  yellow: [200, 195, 60],
  red: [180, 50, 50],
} satisfies Panel["measured"];

export const PANELS: Record<string, Panel> = {
  // 3.98" SE0398NZ07 A0 (JD79660) / A1 (JD79661): same data format, the firmware differs.
  se0398: {
    id: "se0398",
    name: '3.98" B/W/Y/R',
    width: 768,
    height: 552,
    colors: 4,
    codes: [0b00, 0b01, 0b10, 0b11],
    colorDot: 2,
    ppi: 238,
    cornerRadius: 36, // estimated from the panel (~3.9 mm at ~0.107 mm/px); adjust if it differs
    measured: MEASURED,
  },
  // 4.2" HINK SSD1683 B/W/R. Its driver renders codes 10 and 11 as red; yellow ink is
  // mapped to red here so previews match the panel.
  hink42_bwr: {
    id: "hink42_bwr",
    name: '4.2" B/W/R',
    width: 400,
    height: 300,
    colors: 3,
    codes: [0b00, 0b01, 0b11, 0b11],
    ppi: 119,
    cornerRadius: 0,
    measured: { ...MEASURED, yellow: MEASURED.red },
  },
  // Panels of the upstream InkSight firmware (firmware/boards/other_panels.ini), not yet
  // checked on hardware here. Their drivers take the same 2bpp codes as the two above.
  // 4.2" B/W/Y/R: GDEM042F52 (JD79668) and DKE DEPG0420RY683.
  bwry42: {
    id: "bwry42",
    name: '4.2" B/W/Y/R',
    width: 400,
    height: 300,
    colors: 4,
    codes: [0b00, 0b01, 0b10, 0b11],
    ppi: 119,
    cornerRadius: 0,
    measured: MEASURED,
  },
  // 5.83" B/W/R (UC8179, Waveshare V2): codes 10 and 11 show red, like the HINK.
  bwr583: {
    id: "bwr583",
    name: '5.83" B/W/R',
    width: 648,
    height: 480,
    colors: 3,
    codes: [0b00, 0b01, 0b11, 0b11],
    ppi: 138,
    cornerRadius: 0,
    measured: { ...MEASURED, yellow: MEASURED.red },
  },
  // 7.5" B/W/R (UC8179, GDEY075Z08).
  bwr75: {
    id: "bwr75",
    name: '7.5" B/W/R',
    width: 800,
    height: 480,
    colors: 3,
    codes: [0b00, 0b01, 0b11, 0b11],
    ppi: 124,
    cornerRadius: 0,
    measured: { ...MEASURED, yellow: MEASURED.red },
  },
};

/**
 * Find the panel matching what an InkSight-firmware device reports: same size and the
 * same number of colours (a colour panel of that size otherwise). B/W panels get none:
 * the caller uses a generic B/W panel.
 */
export function matchPanel(width: number, height: number, colors: number): Panel | undefined {
  const same = Object.values(PANELS).filter((p) => p.width === width && p.height === height);
  return same.find((p) => p.colors === colors) ?? (colors >= 3 ? same.find((p) => p.colors >= 3) : undefined);
}

/** The ink actually shown by `panel` for `ink` (yellow becomes red on B/W/R panels). */
export function effectiveInk(panel: Panel, ink: Ink): Ink {
  if (ink === Ink.Yellow && panel.colors === 3) return Ink.Red;
  if (panel.colors === 2 && (ink === Ink.Yellow || ink === Ink.Red)) return Ink.Black;
  return ink;
}
