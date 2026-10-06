// 待办 / 作业 (TRMNL's Google Tasks / Todoist): checklists grouped by person, e.g. each
// child's homework. Done items are ticked and struck through; each group shows its count.
import { refFonts, width, print, centeredAt, bigRef, type RefFont } from "../render/reftext.js";
import type { Canvas } from "../render/canvas.js";
import { type Panel, Ink } from "../panels.js";
import { getModeConfig, type ConfigField } from "../data/modeConfig.js";
import type { ScreenContext } from "./testPattern.js";
import type { Screen } from "./screen.js";
import { screenWithHeader, wrapText, emptyNote } from "./common.js";

const CONFIG: ConfigField[] = [{
  key: "title", label: "标题", type: "text", default: "待办", placeholder: "待办",
}, {
  key: "list", label: "清单", type: "textarea",
  default: "## 小明\n- [ ] 数学练习册 第12-13页\n- [x] 背诵《静夜思》\n- [ ] 英语听写 Unit 3 单词\n## 小红\n- [ ] 读绘本 20 分钟\n- [x] 练琴 30 分钟\n## 家务\n- [ ] 周六大扫除\n- [ ] 交物业费",
  help: "## 开头为分组（如孩子的名字），- [ ] 为未完成，- [x] 为已完成；直接写一行也算一项未完成。",
}];

export interface TodoGroup { name: string; items: { text: string; done: boolean }[] }

export function parseTodo(text: string): TodoGroup[] {
  const groups: TodoGroup[] = [];
  let g: TodoGroup | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^(?:#{1,6}\s*|【)(.+?)】?$/);
    if (h) { g = { name: h[1].trim(), items: [] }; groups.push(g); continue; }
    const it = line.match(/^[-*]?\s*\[( |x|X|√|✓)?\]\s*(.*)$/) ?? line.match(/^[-*]\s+(.*)$/);
    const done = !!it && it.length === 3 && !!it[1] && it[1] !== " ";
    const t = it ? (it.length === 3 ? it[2] : it[1]) : line;
    if (!g) { g = { name: "", items: [] }; groups.push(g); }
    if (t.trim()) g.items.push({ text: t.trim(), done });
  }
  return groups.filter((x) => x.items.length || x.name);
}

/** Back to the text form (what the modes page edits). */
export function serializeTodo(groups: TodoGroup[]): string {
  return groups.map((g) => [g.name ? `## ${g.name}` : "", ...g.items.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`)]
    .filter(Boolean).join("\n")).join("\n");
}

function checkbox(c: Canvas, x: number, y: number, s: number, done: boolean): void {
  if (!done) { c.frame(x, y, x + s, y + s, Ink.Black); return; }
  c.rect(x, y, x + s, y + s, Ink.Black);
  // white tick
  const pts: [number, number][] = [[0.2, 0.52], [0.42, 0.74], [0.8, 0.28]];
  const t = Math.max(1, Math.round(s / 8));
  for (let k = 0; k < 2; k++) {
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
    const n = Math.ceil(s);
    for (let i = 0; i <= n; i++) {
      const px = x + (ax + (bx - ax) * (i / n)) * s, py = y + (ay + (by - ay) * (i / n)) * s;
      c.rect(Math.round(px - t / 2), Math.round(py - t / 2), Math.round(px - t / 2) + t + 1, Math.round(py - t / 2) + t + 1, Ink.White);
    }
  }
}

export function renderTodo(panel: Panel, ctx: ScreenContext) {
  const { wqy12, wqy9 } = refFonts();
  const data = ctx.data as { title?: string; groups: TodoGroup[] } | undefined;
  const groups = data?.groups ?? parseTodo(CONFIG[1].default!);
  const all = groups.flatMap((g) => g.items);
  const doneN = all.filter((i) => i.done).length;
  const f = screenWithHeader(panel, ctx, data?.title?.trim() || "待办", all.length ? `完成 ${doneN}/${all.length}` : "");
  const { c, W, H, large, m } = f;
  if (!all.length) { emptyNote(f, "在后台\"待办\"页面添加要做的事"); return c; }

  // 3.98": WenKai 28 / 24 px when the whole list fits that way, else WenQuanYi 16 px
  const draw = (font: RefFont, paint: boolean): number => {
    const fh = font.ascent - font.descent;
    const lineH = Math.round(fh * 1.35), itemGap = Math.round(fh * 0.35);
    const box = Math.round(font.ascent * 0.95);
    const cols = large && groups.length > 1 ? 2 : 1;
    const gap = 28;
    const colW = Math.floor((W - 2 * m - (cols - 1) * gap) / cols);
    const tx0 = box + Math.round(fh * 0.6);
    const th = Math.round(fh * 1.3), headH = th + Math.round(fh * 0.6);
    // each whole group goes to the currently shorter column (in order), so columns balance
    const colY = Array.from({ length: cols }, () => f.top + (large ? 18 : 10));
    const bottom = H - (large ? 10 : 4);
    let hidden = 0;
    for (const g of groups) {
      const col = colY.indexOf(Math.min(...colY));
      const x0 = m + col * (colW + gap), x1 = x0 + colW;
      let y = colY[col];
      const gDone = g.items.filter((i) => i.done).length;
      if (g.name) {
        if (y + headH + lineH > bottom) { hidden += g.items.length; continue; }
        if (paint) { // red name tag + count
          const tw = width(font, g.name) + Math.round(fh * 1.2);
          c.rect(x0, y, x0 + tw, y + th, Ink.Red);
          const p = centeredAt(font, g.name, x0 + tw / 2, y + th / 2);
          print(c, font, g.name, p.x, p.baseline, Ink.White);
          const cnt = `${gDone}/${g.items.length}`;
          const cb = centeredAt(wqy12, cnt, 0, y + th / 2).baseline;
          print(c, wqy12, cnt, x0 + tw + 8, cb, Ink.Black);
          c.dottedH(x0 + tw + 8 + width(wqy12, cnt) + 8, x1, y + th / 2, Ink.Black, 1, 3);
        }
        y += headH;
      }
      // open items first, done ones after
      for (const it of [...g.items.filter((i) => !i.done), ...g.items.filter((i) => i.done)]) {
        const lines = wrapText(font, it.text, x1 - x0 - tx0, 2);
        const h = lines.length * lineH;
        if (y + h > bottom) { hidden++; continue; }
        if (paint) {
          checkbox(c, x0, y + Math.round((lineH - box) / 2), box, it.done);
          lines.forEach((l, n) => {
            const base = y + n * lineH + Math.round((lineH + font.ascent) / 2) - 1;
            const ex = print(c, font, l, x0 + tx0, base, Ink.Black);
            const sy = base - Math.round(font.ascent * 0.4);
            if (it.done) c.rect(x0 + tx0, sy, ex, sy + Math.max(1, Math.round(fh / 14)), Ink.Black);
          });
        }
        y += h + itemGap;
      }
      colY[col] = y + Math.round(fh * 0.6);
    }
    return hidden;
  };
  const candidates: RefFont[] = large ? [bigRef("wenkai", 28), bigRef("wenkai", 24), wqy12] : [wqy9];
  const font = candidates.find((rf) => draw(rf, false) === 0) ?? candidates[candidates.length - 1];
  const hidden = draw(font, true);
  if (hidden) {
    const s = `还有 ${hidden} 项未显示`;
    print(c, wqy9, s, W - m - width(wqy9, s), H - 4, Ink.Black);
  }
  return c;
}

export const todoMode: Screen = {
  name: "待办作业",
  description: "按人分组的清单，比如孩子的作业、家务；完成的打勾划掉。",
  config: CONFIG,
  render: renderTodo,
  prepare: async (db) => {
    const cfg = getModeConfig(db, "todo", CONFIG);
    return { data: { title: cfg.title, groups: parseTodo(cfg.list) } };
  },
};
