// How long each layout takes on the server: preparing its data (the first time and from
// the caches), drawing (the first time, which loads fonts, and the average after), and
// packing the frame for the device. npx tsx scripts/bench-render.ts [runs]
// Uses a throwaway in-memory database with a weather city, some content, and the network.
import { openDb, setSetting } from "../src/db.js";
import { setPlace } from "../src/data/weather.js";
import { setModeConfig } from "../src/data/modeConfig.js";
import { addMessage } from "../src/data/messages.js";
import { PANELS } from "../src/panels.js";
import { SCREENS, prepareScreen, renderScreen } from "../src/frames.js";
import { pack2bpp, packBmp1 } from "../src/render/pack.js";
import { DEV_ONLY } from "../src/admin/common.js";

const RUNS = Number(process.argv[2] ?? 20);
const db = openDb(":memory:");
setPlace(db, { name: "重庆", lat: 29.56, lon: 106.55, timezone: "Asia/Shanghai" });
addMessage(db, "妈妈", "晚上加班，冰箱里有饺子，记得热一下再吃。作业写完早点睡！");
setModeConfig(db, "agenda", SCREENS.agenda.config!, { local: "2026-10-06 16:00 家长会 @学校\n每周一 07:50 升旗仪式" });
setModeConfig(db, "words", SCREENS.words.config!, { level: "pep7a" });  // (a bundled book)
setSetting(db, "test_date", "");

const ms = (t0: bigint) => Number(process.hrtime.bigint() - t0) / 1e6;
const f1 = (n: number) => (n < 10 ? n.toFixed(1) : n.toFixed(0)).padStart(6);
const panels = [PANELS.se0398, PANELS.hink42_bwr, PANELS.bwr75];
const now = new Date();

console.log(`layout        prepare first / cached (ms)   ${panels.map((p) => `${p.id}: draw first / avg, pack`.padEnd(34)).join("")}`);
for (const id of Object.keys(SCREENS).filter((k) => !DEV_ONLY.has(k))) {
  let t0 = process.hrtime.bigint();
  const ctx = await prepareScreen(db, id, now, { advance: "1" });
  const prepFirst = ms(t0);
  t0 = process.hrtime.bigint();
  await prepareScreen(db, id, now);
  const prepCached = ms(t0);
  const cells: string[] = [];
  for (const p of panels) {
    t0 = process.hrtime.bigint();
    renderScreen(p, { ...ctx, now }, id);
    const first = ms(t0);
    t0 = process.hrtime.bigint();
    let c = renderScreen(p, { ...ctx, now }, id);
    for (let i = 1; i < RUNS; i++) c = renderScreen(p, { ...ctx, now }, id);
    const avg = ms(t0) / RUNS;
    t0 = process.hrtime.bigint();
    for (let i = 0; i < RUNS; i++) (p.colors >= 3 ? pack2bpp(c, p) : packBmp1(c));
    const pack = ms(t0) / RUNS;
    cells.push(`${f1(first)} / ${f1(avg)}, ${f1(pack)}`.padEnd(34));
  }
  console.log(`${(SCREENS[id].name + " " + id).padEnd(16)}${f1(prepFirst)} / ${f1(prepCached)}`.padEnd(46) + cells.join(""));
}
