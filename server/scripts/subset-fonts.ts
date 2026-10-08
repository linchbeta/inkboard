// Subset BDF fonts to ASCII + GB2312 (+ a few extras, and the poems' characters) so the
// repo stays small. (The WenQuanYi sources: the BDF release, or the PCF files of Debian's
// xfonts-wqy 1.0.0~rc1 through pcf2bdf -- the same glyphs.)
// Usage:  npm run fonts:subset -- <source dir>
// Source dir may contain (any subset of):
//   fusion-pixel-{10,12}px-proportional-zh_hans.bdf   (Fusion Pixel, OFL)
//   wqy-bitmapsong/wenquanyi_9pt.bdf  -> 12px,  wenquanyi_12pt.bdf -> 16px  (WenQuanYi, GPLv2 + font exception)
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const srcDir = process.argv[2];
if (!srcDir) {
  console.error("usage: npm run fonts:subset -- <source dir>");
  process.exit(1);
}
const outDir = join(import.meta.dirname, "..", "assets", "fonts");

function charset(): Set<number> {
  const set = new Set<number>();
  for (let c = 0x20; c <= 0x7e; c++) set.add(c);
  // Every GB2312 code point (rows A1..F7, cells A1..FE), decoded through the GBK decoder.
  const gbk = new TextDecoder("gbk");
  for (let hi = 0xa1; hi <= 0xf7; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      const s = gbk.decode(new Uint8Array([hi, lo]));
      const cp = s.codePointAt(0)!;
      if (s.length === 1 && cp !== 0xfffd) set.add(cp);
    }
  }
  for (const ch of "℃°·—…「」『』【】〔〕・♀♂★☆○●◎◇◆□■△▲※→←↑↓〒々〆〇") set.add(ch.codePointAt(0)!);
  // the poems' characters: their poets' names and titles are set in these fonts too, and
  // some are outside GB2312 (as in make-fonts.py)
  const poems = readFileSync(join(import.meta.dirname, "..", "src", "data", "poems.ts"), "utf8");
  for (const ch of poems) if (ch.codePointAt(0)! > 0x2e7f) set.add(ch.codePointAt(0)!);
  set.add(0xfffe); // font's DEFAULT_CHAR
  return set;
}

function subset(file: string, keep: Set<number>): { text: string; kept: number } {
  const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf("\nSTARTCHAR ");
  const header = src.slice(0, start + 1);
  const body = src.slice(start + 1, src.lastIndexOf("ENDFONT"));
  const chars = body.split(/(?=^STARTCHAR )/m).filter((c) => c.startsWith("STARTCHAR"));
  const kept = chars.filter((c) => {
    // [ \t]* not \s*: \s would also eat the newline in multiline mode.
    const m = /^ENCODING (-?\d+)[ \t]*$/m.exec(c);
    return m !== null && keep.has(Number(m[1]));
  });
  const newHeader = header.replace(/^CHARS \d+[ \t]*$/m, `CHARS ${kept.length}`);
  return { text: newHeader + kept.join("") + "ENDFONT\n", kept: kept.length };
}

mkdirSync(join(outDir, "LICENSES"), { recursive: true });
const keep = charset();
const jobs: [string, string][] = [
  ...readdirSync(srcDir)
    .filter((f) => /^fusion-pixel-\d+px-proportional-zh_hans\.bdf$/.test(f))
    .map((f): [string, string] => [f, f.replace(".bdf", ".subset.bdf")]),
  ["wqy-bitmapsong/wenquanyi_9pt.bdf", "wqy-bitmapsong-12px.subset.bdf"],
  ["wqy-bitmapsong/wenquanyi_12pt.bdf", "wqy-bitmapsong-16px.subset.bdf"],
];
for (const [src, dst] of jobs) {
  if (!existsSync(join(srcDir, src))) continue;
  const { text, kept } = subset(join(srcDir, src), keep);
  const out = join(outDir, dst);
  writeFileSync(out, text);
  console.log(`${src}: kept ${kept} glyphs -> ${out} (${(text.length / 1024).toFixed(0)} KB)`);
}

// Licenses: all component fonts are SIL OFL 1.1.
for (const sub of readdirSync(srcDir).filter((d) => d.startsWith("license-"))) {
  const walk = (dir: string, rel = ""): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      const r = rel ? `${rel}-${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r === "LICENSES" ? "" : r);
      else {
        const dest = join(outDir, "LICENSES", r === "OFL.txt" ? "fusion-pixel-OFL.txt" : r);
        if (!existsSync(dest)) {
          mkdirSync(dirname(dest), { recursive: true });
          copyFileSync(p, dest);
        }
      }
    }
  };
  walk(join(srcDir, sub));
}
console.log(`charset: ${keep.size} code points`);
