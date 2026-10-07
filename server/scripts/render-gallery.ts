// Renders every layout with made-up demo content into ../pic/<layout>-398.png and -42.png,
// for the README, and the 3.98" upright into ../pic/portrait/<layout>-398.png.
// npx tsx scripts/render-gallery.ts
// Uses a throwaway in-memory database; weather, market, news and dictionary lookups come
// from the network (public data), the photo is drawn here. Existing photo-*.png files are
// left alone, so a real preview put there by hand survives a re-run.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { runAs } from "../src/scope.js";
import { setPlace } from "../src/data/weather.js";
import { setModeConfig } from "../src/data/modeConfig.js";
import { addMessage } from "../src/data/messages.js";
import { addPhoto } from "../src/data/photos.js";
import { PANELS, orientedPanel } from "../src/panels.js";
import { SCREENS, prepareScreen, renderScreen } from "../src/frames.js";
import { previewPng, rgbPng } from "../src/render/pack.js";
import { DEV_ONLY } from "../src/admin/common.js";

const out = join(import.meta.dirname, "..", "..", "pic");
mkdirSync(join(out, "portrait"), { recursive: true });
const now = new Date(2026, 9, 9, 10, 15);  // a Friday morning, during the third lesson
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);

/** A small landscape: sky, sun, hills and a field, to show the dithering. */
function landscape(): Uint8Array {
  const w = 800, h = 600, rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    let c: [number, number, number] = [90 + y / 6, 150 + y / 8, 230];                 // sky
    if ((x - 600) ** 2 + (y - 150) ** 2 < 60 ** 2) c = [250, 200, 60];                  // sun
    const hill = 380 + 50 * Math.sin(x / 120) + 20 * Math.sin(x / 37);
    if (y > hill) c = [60 + (y - hill) / 4, 140 - (y - hill) / 6, 70];                 // hills
    if (y > 480 + 10 * Math.sin(x / 80)) c = [230, 190 + (x % 40 < 20 ? 20 : 0), 60]; // field
    rgb.set(c.map((v) => Math.max(0, Math.min(255, Math.round(v)))), i);
  }
  return rgbPng({ width: w, height: h, rgb });
}

const db = openDb(":memory:");
db.prepare("INSERT INTO user (id, name, pass, admin, created_at) VALUES (1, 'demo', '', 1, '2026-01-01T00:00:00Z')").run();
await runAs(1, async () => {
  setPlace(db, { name: "北京", lat: 39.9, lon: 116.4, timezone: "Asia/Shanghai" });
  // newest last: the list keeps insertion order, newest first
  addMessage(db, "爸爸", "周六去爬山，记得把运动鞋找出来。", at(8, 20, 5));
  addMessage(db, "妈妈", "晚上加班，冰箱里有饺子，热一下再吃。作业写完早点睡！", at(9, 8, 30));
  setModeConfig(db, "agenda", SCREENS.agenda.config!, {
    local: "2026-10-09 16:00-17:00 家长会 @学校\n2026-10-09 牙医复诊 @口腔医院\n2026-10-10 09:00 爬山 @香山\n2026-10-12 19:30 钢琴课\n每周一 07:50 升旗仪式",
  });
  setModeConfig(db, "words", SCREENS.words.config!, { level: "pep7a" });
  addPhoto(db, landscape(), "秋天的山");

  // landscape, and the 3.98" upright (pic/portrait)
  const panels: [string, typeof PANELS.se0398][] = [["", PANELS.se0398], ["", PANELS.hink42_bwr],
    ["portrait", orientedPanel(PANELS.se0398, "portrait")]];
  for (const id of Object.keys(SCREENS).filter((k) => !DEV_ONLY.has(k))) {
    const ctx = await prepareScreen(db, id, now, { advance: "1" });
    for (const [dir, p] of panels) {
      const file = join(out, dir, `${id}-${p.id === "se0398" ? "398" : "42"}.png`);
      if (id === "photo" && existsSync(file)) continue;
      writeFileSync(file, previewPng(renderScreen(p, { ...ctx, now, batteryV: 4.05 }, id), p));
    }
    console.log(`${id.padEnd(14)} ${SCREENS[id].name}`);
  }
});
