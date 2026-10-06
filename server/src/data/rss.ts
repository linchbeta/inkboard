// RSS 2.0 / Atom headlines for the news screen. Small regex parser (feeds are simple), HTML
// entities and CDATA handled; 30-minute cache that also serves stale data when offline.
export interface NewsItem { title: string; summary: string; date?: Date; source: string; link: string }

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENT[e.toLowerCase()] ?? all;
  });
}

function text(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return "";
  let v = m[1].trim();
  const cd = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cd) v = cd[1];
  return v;
}

// entity-escaped HTML is common in descriptions: decode, strip tags, decode again
const plain = (html: string) => decodeEntities(decodeEntities(html.replace(/<!\[CDATA\[|\]\]>/g, "")).replace(/<[^>]+>/g, " "))
  .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200B}-\u{200D}]/gu, "") // emoji: no glyphs on the panel
  .replace(/\s+/g, " ").trim();

export function parseFeed(xml: string, source = ""): NewsItem[] {
  const channelTitle = plain(text(xml.replace(/<(item|entry)[\s>][\s\S]*$/i, ""), "title"));
  const src = source || channelTitle;
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  return blocks.map((b) => {
    const when = text(b, "pubDate") || text(b, "published") || text(b, "updated") || text(b, "dc:date");
    const d = when ? new Date(when) : undefined;
    const link = text(b, "link") || (b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "");
    return {
      title: plain(text(b, "title")),
      summary: plain(text(b, "description") || text(b, "summary") || text(b, "content")).slice(0, 200),
      date: d && !Number.isNaN(d.getTime()) ? d : undefined,
      source: src,
      link: plain(link),
    };
  }).filter((i) => i.title);
}

const cache = new Map<string, { at: number; xml: string }>();

export async function fetchFeed(url: string): Promise<string> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.xml;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (InkBoard e-paper display)" }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const xml = await r.text();
    if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) throw new Error("不是 RSS/Atom");
    cache.set(url, { at: Date.now(), xml });
    return xml;
  } catch (e) {
    if (hit) return hit.xml;
    throw e;
  }
}

/** "刚刚" / "12分钟前" / "3小时前" / "10月2日". */
export function ago(d: Date | undefined, now: Date): string {
  if (!d) return "";
  const min = Math.round((now.getTime() - d.getTime()) / 60_000);
  if (min < 2) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  if (min < 24 * 60) return `${Math.round(min / 60)}小时前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
