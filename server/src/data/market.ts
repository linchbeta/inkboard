// Quotes for the market screen from free public endpoints (no key): Tencent (qt.gtimg.cn)
// for A-shares, Hong Kong, US stocks and FX; Sina (hq.sinajs.cn) for gold. Responses are
// GBK text. Cached for 5 minutes; stale data is served when offline.
export interface Quote { code: string; name: string; price: number; prev: number; change: number; pct: number; time: string; decimals: number }

/** Config line: "代码 [显示名]". Gold: AU9999 (沪金, 元/克), XAU (伦敦金), GC (纽约金). */
export function parseCodes(text: string): { code: string; name?: string }[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
    const [code, ...rest] = l.split(/\s+/);
    return { code, name: rest.join(" ") || undefined };
  });
}

const SINA: Record<string, string> = { AU9999: "gds_AU9999", AG9999: "gds_AG9999", XAU: "hf_XAU", GC: "hf_GC", XAG: "hf_XAG", CL: "hf_CL" };
const isSina = (c: string) => c.toUpperCase() in SINA;
const decimalsOf = (s: string) => (s.includes(".") ? Math.min(4, s.split(".")[1].replace(/0+$/, "").length || 2) : 2);

async function getText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new TextDecoder("gbk").decode(await r.arrayBuffer());
}

export function parseTencent(text: string): Map<string, Quote> {
  const out = new Map<string, Quote>();
  for (const m of text.matchAll(/v_([a-zA-Z0-9_.]+)="([^"]*)"/g)) {
    const f = m[2].split("~");
    if (f.length < 5) continue;
    const code = m[1];
    const fx = code.startsWith("wh") || code.startsWith("fx");
    const price = +f[3];
    const prev = fx ? price - +f[12] : +f[4];
    if (!Number.isFinite(price) || price === 0) continue;
    out.set(code.toLowerCase(), {
      code, name: f[1], price, prev,
      change: fx ? +f[12] : +f[31], pct: fx ? +f[13] : +f[32],
      time: fx ? f[5] : f[30] ?? "", decimals: fx ? 4 : decimalsOf(f[3]),
    });
  }
  return out;
}

export function parseSina(text: string): Map<string, Quote> {
  const out = new Map<string, Quote>();
  for (const m of text.matchAll(/hq_str_([a-zA-Z0-9_]+)="([^"]*)"/g)) {
    const f = m[2].split(",");
    const price = +f[0], prev = +f[7];
    if (!Number.isFinite(price) || price === 0 || !Number.isFinite(prev) || prev === 0) continue;
    out.set(m[1].toLowerCase(), {
      code: m[1], name: f[13] ?? m[1], price, prev, change: price - prev, pct: ((price - prev) / prev) * 100,
      time: `${f[12] ?? ""} ${f[6] ?? ""}`.trim(), decimals: 2,
    });
  }
  return out;
}

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  try {
    const value = await load();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    if (hit) return hit.value as T;
    throw e;
  }
}

export async function fetchQuotes(codes: { code: string; name?: string }[]): Promise<Quote[]> {
  // Tencent wants the market prefix in lower case and US tickers / FX pairs in upper case
  const tc = codes.filter((c) => !isSina(c.code)).map((c) => c.code.toLowerCase().replace(/^(us|wh|fx)(.*)$/, (_, a: string, b: string) => a + b.toUpperCase()));
  const sc = codes.filter((c) => isSina(c.code)).map((c) => SINA[c.code.toUpperCase()]);
  const [t, s] = await Promise.all([
    tc.length ? cached(`t:${tc}`, 5 * 60_000, async () => [...parseTencent(await getText(`https://qt.gtimg.cn/q=${tc.join(",")}`))]) : [],
    sc.length ? cached(`s:${sc}`, 5 * 60_000, async () => [...parseSina(await getText(`https://hq.sinajs.cn/list=${sc.join(",")}`, { Referer: "https://finance.sina.com.cn" }))]) : [],
  ]);
  const all = new Map([...t, ...s]);
  return codes.flatMap((c) => {
    const key = isSina(c.code) ? SINA[c.code.toUpperCase()].toLowerCase() : c.code.toLowerCase();
    const q = all.get(key);
    return q ? [{ ...q, name: c.name ?? q.name }] : [];
  });
}

/** Today's minute prices for A-share / HK codes (for the sparkline); [] when unavailable. */
export async function fetchMinutes(code: string): Promise<number[]> {
  if (!/^(sh|sz|bj|hk)/i.test(code)) return [];
  try {
    return await cached(`m:${code}`, 5 * 60_000, async () => {
      const r = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${code.toLowerCase()}`, { signal: AbortSignal.timeout(8000) });
      const j = await r.json() as { data?: Record<string, { data?: { data?: string[] } }> };
      const rows = j.data?.[code.toLowerCase()]?.data?.data ?? [];
      return rows.map((row) => +row.split(" ")[1]).filter((v) => Number.isFinite(v) && v > 0);
    });
  } catch { return []; }
}
