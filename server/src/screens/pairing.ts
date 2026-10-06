// Shown by a device nobody has paired yet: the pairing code, large, and what to do with it.
import { refFonts, width, print, bigRef } from "../render/reftext.js";
import { type Panel, Ink } from "../panels.js";
import type { ScreenContext } from "./testPattern.js";
import { screenWithHeader, wrapText } from "./common.js";

export function renderPairing(panel: Panel, ctx: ScreenContext & { pairCode?: string; noUsers?: boolean }) {
  const { wqy12, wqy9 } = refFonts();
  const f = screenWithHeader(panel, ctx, "绑定设备");
  const { c, W, H, large } = f;
  const code = (ctx.pairCode ?? "------").split("").join(" ");
  const num = bigRef("barlow", large ? 96 : 56);
  const lines = ctx.noUsers
    ? ["请先在电脑或手机上打开 InkBoard 后台，创建账号。", "第一个账号会自动绑定这块屏。"]
    : ["在 InkBoard 后台 → 概览 → 添加设备，", "输入上面的配对码，这块屏就会显示你的内容。"];
  const font = large ? wqy12 : wqy9;
  const lh = large ? 28 : 18;
  const blockH = (large ? 30 : 18) + 16 + num.ascent + (large ? 40 : 22) + lines.length * lh;
  let y = Math.round(f.top + (H - f.top - blockH) / 2);
  const label = ctx.noUsers ? "还没有账号" : "配对码";
  y += large ? 30 : 18;
  print(c, font, label, Math.round((W - width(font, label)) / 2), y, Ink.Black);
  y += 16 + num.ascent;
  if (!ctx.noUsers) print(c, num, code, Math.round((W - width(num, code)) / 2), y, Ink.Red);
  y += large ? 40 : 22;
  for (const l of lines.flatMap((x) => wrapText(font, x, W - 40))) {
    print(c, font, l, Math.round((W - width(font, l)) / 2), y, Ink.Black);
    y += lh;
  }
  return c;
}
