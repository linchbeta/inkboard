// Downloads the bundled word books of the catalog (src/data/vocab/catalog.ts, "bundled":
// kajweb/dict and mahavivo/english-wordlists) into assets/words/<id>.json.gz, so they work
// offline. Each file holds the parsed entries ({ word, zh, ipa, pos, example, exampleZh },
// empty fields left out). npx tsx scripts/fetch-wordbooks.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { BOOKS } from "../src/data/vocab/catalog.js";
import { download } from "../src/data/vocab/books.js";

const out = join(import.meta.dirname, "..", "assets", "words");
mkdirSync(out, { recursive: true });

for (const book of BOOKS) {
  if (!book.bundled || book.source === "builtin") continue;
  let entries;
  for (let attempt = 1; ; attempt++) {
    try { entries = await download(book.source); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  const gz = gzipSync(JSON.stringify(entries), { level: 9 });
  writeFileSync(join(out, `${book.id}.json.gz`), gz);
  console.log(`${book.id.padEnd(10)} ${String(entries.length).padStart(6)} words  ${(gz.length / 1024).toFixed(0).padStart(5)} KB  ${book.name}`);
}
