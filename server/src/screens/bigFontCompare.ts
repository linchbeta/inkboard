// "大字字体对比": the same sample in every large-font candidate, at the size this panel
// would use (3.98": 40 px, 4.2": 24 px; selectable), to choose fonts on the real panel.
// Candidates are built by scripts/make-bigfont-candidates.py (sample characters only).
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { loadBdf, type BitmapFont } from "../render/bdf.js";
import { refFonts, width, print, bigRef, type RefFont } from "../render/reftext.js";
import { type Panel, Ink } from "../panels.js";
import { getModeConfig, type ConfigField } from "../data/modeConfig.js";
import type { ScreenContext } from "./testPattern.js";
import type { Screen } from "./screen.js";
import { screenWithHeader } from "./common.js";

const dir = fileURLToPath(new URL("../../assets/fonts/candidates/big/", import.meta.url));

const GROUPS: [string, string][][] = [
  [["wenkai", "霞鹜文楷"], ["sans-r", "思源黑体 R"], ["sans-m", "思源黑体 M"], ["sans-b", "思源黑体 B"], ["pixel", "点阵放大"], ["harmony", "鸿蒙黑体"]],
  [["serif-r", "思源宋体 R"], ["serif-b", "思源宋体 B"], ["deng", "等线*"], ["dengb", "等线粗*"], ["yahei", "微软雅黑*"], ["wenkai", "霞鹜文楷"]],
];

const CONFIG: ConfigField[] = [
  { key: "group", label: "候选组", type: "select", default: "0",
    options: [["0", "第 1 组：文楷 / 思源黑体 R M B / 点阵 / 鸿蒙"], ["1", "第 2 组：思源宋体 R B / 等线 / 等线粗 / 微软雅黑 / 文楷"]],
    help: "带 * 的是微软字体，只能在这台电脑上对比，不能放进 NAS 版。" },
  { key: "size", label: "字号", type: "select", default: "auto",
    options: [["auto", "按屏幕（3.98\" 40px，4.2\" 24px）"], ["24", "24px"], ["32", "32px"], ["40", "40px"]] },
];

const cache = new Map<string, BitmapFont | null>();
function candidate(id: string, px: number): RefFont | undefined {
  if (id === "pixel") return bigRef("pixel", px >= 32 ? 32 : 24);
  const key = `${id}-${px}`;
  if (!cache.has(key)) cache.set(key, existsSync(`${dir}${key}.bdf`) ? loadBdf(`${dir}${key}.bdf`) : null);
  const f = cache.get(key);
  return f ? { f, ascent: f.ascent, descent: -f.descent } : undefined;
}

export function renderBigFontCompare(panel: Panel, ctx: ScreenContext) {
  const { wqy9 } = refFonts();
  const cfg = (ctx.data as Record<string, string> | undefined) ?? { group: "0", size: "auto" };
  const large = panel.height >= 400;
  const px = cfg.size === "auto" ? (large ? 40 : 24) : Number(cfg.size);
  const group = GROUPS[Number(cfg.group)] ?? GROUPS[0];
  const f = screenWithHeader(panel, ctx, "大字字体对比", `${px}px · 第 ${Number(cfg.group) + 1} 组`);
  const { c, W, H, m } = f;
  const sample = large ? "白日依山尽，黄河入海流。宝贝放学先写作业" : "白日依山尽，黄河入海流。";
  const labelW = large ? 96 : 66;
  const rows = group.map(([id, label]) => ({ label, rf: candidate(id, px) }));
  const rowH = Math.floor((H - f.top - 8) / rows.length);
  rows.forEach(({ label, rf }, i) => {
    const mid = f.top + 4 + i * rowH + Math.round(rowH / 2);
    print(c, wqy9, label, m, mid + 4, Ink.Red);
    if (!rf) { print(c, wqy9, "（未生成）", m + labelW, mid + 4, Ink.Black); return; }
    // clip the sample to the panel width
    let s = sample;
    while (s.length > 1 && m + labelW + width(rf, s) > W - m) s = s.slice(0, -1);
    print(c, rf, s, m + labelW, mid + Math.round((rf.ascent + rf.descent) / 2), Ink.Black);
    if (i < rows.length - 1) c.dottedH(m, W - m, f.top + 4 + (i + 1) * rowH, Ink.Black, 1, 3);
  });
  return c;
}

export const bigFontCompareMode: Screen = {
  name: "大字字体对比",
  description: "同一段文字用各候选字体显示，在真机上挑大字字体（思源黑体、思源宋体、等线、文楷、点阵……）。",
  config: CONFIG,
  render: renderBigFontCompare,
  prepare: async (db) => ({ data: getModeConfig(db, "bigfont", CONFIG) }),
};
