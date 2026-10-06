// 资讯 (TRMNL's Hacker News / RSS Feed / Wikipedia, nos. 10, 13, 15): the newest headlines
// from RSS / Atom feeds, newest first, with source and age; the top story gets a summary.
import { refFonts, width, print, centeredAt } from "../render/reftext.js";
import { type Panel, Ink } from "../panels.js";
import { parseFeed, fetchFeed, ago, type NewsItem } from "../data/rss.js";
import { getModeConfig, type ConfigField } from "../data/modeConfig.js";
import type { ScreenContext } from "./testPattern.js";
import type { Screen } from "./screen.js";
import { screenWithHeader, wrapText, ellipsize, emptyNote } from "./common.js";

const CONFIG: ConfigField[] = [{
  key: "feeds", label: "RSS 订阅（每行一个，可加\"名称|\"前缀）", type: "textarea",
  default: "IT之家|https://www.ithome.com/rss/\n少数派|https://sspai.com/feed\nSolidot|https://www.solidot.org/index.rss",
  help: "任何 RSS / Atom 链接都可以，例如博客、新闻网站，或用 RSSHub 生成的知乎热榜、微博热搜等。",
}];

interface NewsData { items: NewsItem[]; errors: string[] }

export function renderNews(panel: Panel, ctx: ScreenContext) {
  const { wqy12, wqy9 } = refFonts();
  const data = (ctx.data as NewsData | undefined) ?? { items: [], errors: [] };
  const f = screenWithHeader(panel, ctx, "资讯", data.items.length ? [...new Set(data.items.map((i) => i.source))].slice(0, 3).join(" · ") : "");
  const { c, W, H, large, m } = f;
  if (!data.items.length) { emptyNote(f, data.errors.length ? `获取失败：${data.errors[0]}` : "在\"显示模式\"页面添加 RSS 订阅"); return c; }

  const font = large ? wqy12 : wqy9;
  const lh = large ? 22 : 16, sumLH = 17;
  const numW = large ? 30 : 18;
  const x0 = m + numW, x1 = W - m;
  const top = f.top + (large ? 12 : 6), bottom = H - (large ? 8 : 4);
  const minGap = large ? 20 : 10; // between items (dotted rule in the middle)

  // ── plan: how many items, which get a summary, then the spare height shared out ──
  type Item = { it: NewsItem; title: string[]; summary: string[] };
  const items: Item[] = data.items.map((it) => ({ it, title: wrapText(font, it.title, x1 - x0, large ? 2 : 1), summary: [] }));
  const hOf = (x: Item) => x.title.length * lh + (large ? 18 : 0) + x.summary.length * sumLH;
  const total = (xs: Item[]) => xs.reduce((a, x) => a + hOf(x), 0) + minGap * Math.max(0, xs.length - 1);
  // the top story always gets its summary on the 3.98"
  if (large && items[0]?.it.summary) items[0].summary = wrapText(wqy9, items[0].it.summary, x1 - x0, 2);
  const shown: Item[] = [];
  for (const x of items) { if (total([...shown, x]) > bottom - top) break; shown.push(x); }
  if (large) {
    // summaries for the top stories while they still fit (the first one always tries)
    for (const x of shown.slice(1)) {
      if (!x.it.summary) continue;
      const lines = wrapText(wqy9, x.it.summary, x1 - x0, 2);
      x.summary = lines;
      if (total(shown) > bottom - top) { x.summary = []; break; }
    }
  }
  const gap = shown.length > 1 ? Math.min(large ? 44 : 26, Math.floor((bottom - top - total(shown)) / (shown.length - 1)) + minGap) : minGap;

  let y = top;
  shown.forEach((x, i) => {
    const { it } = x;
    const meta = large ? [it.source, ago(it.date, ctx.now)].filter(Boolean).join(" · ") : ago(it.date, ctx.now);
    // number: red square for the top story, plain red digits after
    const nb = y + (large ? 17 : 12);
    if (i === 0) {
      const s = large ? 20 : 14;
      c.rect(m, nb - s + 3, m + s, nb + 3, Ink.Red);
      const p = centeredAt(wqy9, "1", m + s / 2, nb - s / 2 + 3);
      print(c, wqy9, "1", p.x, p.baseline, Ink.White);
    } else print(c, wqy9, String(i + 1), m + (large ? 4 : 2), nb, Ink.Red);
    if (large) {
      x.title.forEach((l, k) => print(c, font, l, x0, nb + k * lh, Ink.Black));
      let yy = nb + (x.title.length - 1) * lh + 18;
      print(c, wqy9, meta, x0, yy, Ink.Black);
      for (const s of x.summary) { yy += sumLH; print(c, wqy9, s, x0, yy, Ink.Black); }
    } else {
      // 4.2": one line, the age right-aligned
      const mw = width(wqy9, meta);
      print(c, font, ellipsize(font, it.title, x1 - x0 - mw - 12), x0, nb, Ink.Black);
      print(c, wqy9, meta, x1 - mw, nb, Ink.Black);
    }
    y += hOf(x);
    if (i < shown.length - 1) c.dottedH(x0, x1, y + Math.round(gap / 2) - (large ? 2 : 1), Ink.Black, 1, 3);
    y += gap;
  });
  return c;
}

export const newsMode: Screen = {
  name: "资讯",
  description: "订阅的 RSS 资讯标题，最新的在前；第一条带摘要。",
  config: CONFIG,
  render: renderNews,
  prepare: async (db) => {
    const lines = getModeConfig(db, "news", CONFIG).feeds.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    const items: NewsItem[] = [], errors: string[] = [];
    await Promise.all(lines.map(async (line) => {
      const [name, url] = line.includes("|") ? line.split("|", 2).map((s) => s.trim()) : ["", line];
      try { items.push(...parseFeed(await fetchFeed(url), name).slice(0, 20)); }
      catch (e) { errors.push(`${name || url.slice(0, 30)}：${e instanceof Error ? e.message : e}`); }
    }));
    // newest first within each source, sources taking turns (a busy feed would fill the screen)
    const bySource = new Map<string, NewsItem[]>();
    for (const it of items) bySource.set(it.source, [...(bySource.get(it.source) ?? []), it]);
    const queues = [...bySource.values()].map((q) => q.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)))
      .sort((a, b) => (b[0].date?.getTime() ?? 0) - (a[0].date?.getTime() ?? 0));
    const mixed: NewsItem[] = [];
    for (let k = 0; mixed.length < 30 && queues.some((q) => q.length > k); k++) for (const q of queues) if (q[k]) mixed.push(q[k]);
    return { data: { items: mixed.slice(0, 30), errors } satisfies NewsData };
  },
};
