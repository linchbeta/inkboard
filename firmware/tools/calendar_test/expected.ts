// Server side of the calendar comparison: one line per day and panel with the FNV-1a hash
// of the frame the server sends -- 2bpp, or for B/W panels the 1-bit BMP's pixels as the
// firmware stores them (rows top to bottom, no padding). Run from server/:
//   npx tsx ../firmware/tools/calendar_test/expected.ts 2025 2030 [all|ours] [landscape|portrait|landscape-flip|portrait-flip] > expected.txt
import { PANELS, type Panel, type Orientation } from "../../../server/src/panels.js";
import { buildFrame, genericPanel } from "../../../server/src/frames.js";

const [from, to] = [Number(process.argv[2] ?? 2025), Number(process.argv[3] ?? 2030)];
const all = process.argv[4] === "all";
const orientation = (process.argv[5] ?? "landscape") as Orientation;
const fnv = (b: Uint8Array) => {
  let h = 0xcbf29ce484222325n;
  for (const x of b) h = BigInt.asUintN(64, (h ^ BigInt(x)) * 0x100000001b3n);
  return h.toString(16).padStart(16, "0");
};
// id (as in main.cpp), panel, 2bpp?
const panels: [string, Panel, boolean][] = [["se0398", PANELS.se0398, true], ["hink42_bwr", PANELS.hink42_bwr, true]];
if (all) {
  panels.push(["bwry42", PANELS.bwry42, true], ["bwr583", PANELS.bwr583, true], ["bwr75", PANELS.bwr75, true],
    ["bw42", genericPanel(400, 300), false], ["bw583", genericPanel(648, 480), false], ["bw75", genericPanel(800, 480), false],
    ["color565", PANELS.color565, true], ["bwr75v1", PANELS.bwr75v1, true], ["bwry75", PANELS.bwry75, true],
    ["bw75v1", genericPanel(640, 384), false], ["bwr583v1", PANELS.bwr583v1, true], ["bw583v1", genericPanel(600, 448), false],
    ["bwry583", PANELS.bwry583, true], ["bwr75hd", PANELS.bwr75hd, true], ["bw75hd", genericPanel(880, 528), false],
    ["bwr97", PANELS.bwr97, true]);
}

/** A 1-bit BMP's pixels as the firmware keeps them (network.cpp): top row first, W/8 bytes a row. */
function bmpPixels(bmp: Uint8Array, w: number, h: number): Uint8Array {
  const off = bmp[10] | (bmp[11] << 8), stride = (Math.ceil(w / 8) + 3) & ~3, row = w / 8;
  const out = new Uint8Array(row * h);
  for (let y = 0; y < h; y++) out.set(bmp.subarray(off + (h - 1 - y) * stride, off + (h - 1 - y) * stride + row), y * row);
  return out;
}

const lines: string[] = [];
for (let y = from; y <= to; y++) for (let m = 1; m <= 12; m++) {
  const dim = new Date(y, m, 0).getDate();
  for (let d = 1; d <= dim; d++) for (const [id, p, twoBpp] of panels) {
    // with a battery reading on the 1st, to cover the battery icon too
    const batteryV = d === 1 ? 3.62 + (m % 5) * 0.13 : undefined;
    const f = buildFrame(p, { now: new Date(y, m - 1, d, 9), batteryV }, twoBpp, "calendar", orientation);
    lines.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} ${id} ${fnv(twoBpp ? f.body : bmpPixels(f.body, p.width, p.height))}`);
  }
}
process.stdout.write(lines.join("\n") + "\n");
