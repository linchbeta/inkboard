// 留言板 (TRMNL's "Custom Text"): the newest family message as large as it fits, signed
// with sender and time, under a big red quotation mark; older messages small below.
import { cjkDisplay, cjkAt } from "../render/typography.js";
import { refFonts, width, print, bigRef, type RefFont } from "../render/reftext.js";
import { type Panel, Ink } from "../panels.js";
import { messagesFor, type Message } from "../data/messages.js";
import { currentDevice } from "../scope.js";
import type { ScreenContext } from "./testPattern.js";
import type { Screen } from "./screen.js";
import { screenWithHeader, wrapText, ellipsize, emptyNote, drawQuoteMark } from "./common.js";

function when(at: string, now: Date): string {
  const d = new Date(at);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (days === 0) return `今天 ${hm}`;
  if (days === 1) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

export function renderMessages(panel: Panel, ctx: ScreenContext) {
  const { wqy12, wqy9 } = refFonts();
  const msgs = (ctx.data as Message[] | undefined) ?? [];
  const f = screenWithHeader(panel, ctx, "留言板");
  const { c, W, H, large, m } = f;
  if (!msgs.length) { emptyNote(f, "还没有留言。在后台\"留言\"里写一条吧"); return c; }
  const [main, ...older] = msgs;

  // older messages take the bottom (up to 3 on 3.98", 1 on 4.2")
  const olderRows = Math.min(older.length, large ? 3 : 1);
  const rowH = large ? 24 : 18;
  const olderTop = H - (large ? 14 : 8) - olderRows * rowH;
  const mainBottom = olderRows ? olderTop - (large ? 18 : 10) : H - (large ? 16 : 8);

  // the quotation mark, then the text in the largest WenKai size that fits (WenQuanYi
  // 16 / 12 px for very long messages)
  drawQuoteMark(c, m, f.top + (large ? 16 : 10), large ? 30 : 18, Ink.Red);
  const textX = m + (large ? 50 : 26), textW = W - m - textX;
  const sigH = large ? 34 : 22;
  const area = mainBottom - sigH - (f.top + (large ? 24 : 12));
  const fonts: RefFont[] = [...cjkDisplay(large, large ? 40 : 24), wqy12, wqy9];
  const lineH = (rf: RefFont) => Math.round((rf.ascent - rf.descent) * 1.45);
  let font = fonts[fonts.length - 1];
  for (const rf of fonts) {
    if (wrapText(rf, main.text, textW).length * lineH(rf) <= area) { font = rf; break; }
  }
  const lh = lineH(font);
  const lines = wrapText(font, main.text, textW, Math.max(1, Math.floor(area / lh)));
  const blockH = lines.length * lh;
  let y = f.top + (large ? 24 : 12) + Math.max(0, Math.round((area - blockH) / 2)) + font.ascent;
  for (const l of lines) { print(c, font, l, textX, y, Ink.Black); y += lh; }
  // signature, right-aligned under the text
  const sig = `—— ${main.from || "家人"}  ${when(main.at, ctx.now)}`;
  const sf = large ? wqy12 : wqy9;
  print(c, sf, sig, W - m - width(sf, sig), Math.min(mainBottom - 4, y - lh + (large ? 34 : 22)), Ink.Black);

  if (olderRows) {
    c.dottedH(m, W - m, olderTop - (large ? 8 : 5), Ink.Black, 1, 3);
    older.slice(0, olderRows).forEach((o, i) => {
      const base = olderTop + i * rowH + (large ? 17 : 13);
      const meta = `${o.from || "家人"} · ${when(o.at, ctx.now)}`;
      const mw = width(wqy9, meta);
      print(c, wqy9, meta, W - m - mw, base, Ink.Black);
      const font = large ? wqy12 : wqy9;
      print(c, font, ellipsize(font, o.text.replace(/\n/g, " "), W - 2 * m - mw - 16), m, base, Ink.Black);
    });
  }
  return c;
}

export const messagesMode: Screen = {
  name: "留言板",
  description: "给家人留言：最新一条用大字显示，之前的几条列在下面。",
  render: renderMessages,
  prepare: async (db) => ({ data: messagesFor(db, currentDevice()) }), // to all screens, or to this one
};
