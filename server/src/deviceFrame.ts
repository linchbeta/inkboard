// Frames for a particular device: its playlist decides the mode, its settings the font.
// Used by both device protocols and by the admin previews (which never advance rotation).
import { type Db, type Device, getDevice } from "./db.js";
import { runAs, withTestDate } from "./scope.js";
import { asDevice } from "./data/content.js";
import { getSetting } from "./db.js";
import { deviceOwner, pairCode, userCount } from "./data/users.js";
import { PANELS, type Panel } from "./panels.js";
import { SCREENS, prepareScreen, buildFrame, renderScreen, pairingFrame, genericPanel, type Frame } from "./frames.js";
import { getSettings, pickMode, DEFAULT_MODE, type DeviceSettings } from "./data/devices.js";
import type { ScreenContext } from "./screens/testPattern.js";
import type { Canvas } from "./render/canvas.js";

/** Panel ids devices report (InkSight firmware: our ids; v1 firmware: X-Panel), mapped to panels. */
export const PANEL_ALIASES: Record<string, string> = {
  se0398_a0: "se0398", se0398_a1: "se0398", se0398: "se0398", hink42_bwr: "hink42_bwr",
};

export function panelOf(device: Pick<Device, "panel">): Panel | undefined {
  return panelById(PANEL_ALIASES[device.panel ?? ""] ?? device.panel ?? "");
}

/** A panel by id, including the generic B/W ones ("generic_WxH") unknown panels get. */
export function panelById(id: string): Panel | undefined {
  const g = /^generic_(\d{2,4})x(\d{2,4})$/.exec(id);
  return g ? genericPanel(Number(g[1]), Number(g[2])) : PANELS[id];
}

interface Picked { mode: string; pinned: boolean; settings: DeviceSettings }

async function pick(db: Db, device: Device, now: Date, advance: boolean): Promise<Picked & { extra: Partial<ScreenContext> }> {
  const settings = getSettings(db, device);
  const p = pickMode(db, device, now, advance);
  const mode = SCREENS[p.mode] ? p.mode : DEFAULT_MODE;
  return { mode, pinned: p.pinned, settings, extra: await prepareScreen(db, mode, now, advance ? { advance: "1" } : undefined) };
}

/**
 * The device's frame now, rendered with its owner's content. `advance`: a real device
 * request (moves the rotation on). A device nobody has paired yet gets the pairing screen.
 */
export async function frameFor(db: Db, device: Device, panel: Panel, now: Date,
                               o: { advance: boolean; prefer2bpp: boolean; ctx?: Partial<ScreenContext> }): Promise<Picked & { frame: Frame }> {
  const owner = deviceOwner(db, device.mac);
  if (owner === undefined) {
    const frame = pairingFrame(panel, { ...o.ctx, now, pairCode: pairCode(db, device.mac), noUsers: userCount(db) === 0 }, o.prefer2bpp);
    return { mode: "pairing", pinned: false, settings: undefined as unknown as DeviceSettings, frame };
  }
  return runAs(owner, async () => {
    now = withTestDate(now, () => getSetting(db, "test_date", "")); // the owner's test date
    const d = getDevice(db, device.mac)!;
    const p = await pick(db, d, now, o.advance);
    const frame = buildFrame(panel, { ...p.extra, ...o.ctx, now, font: p.settings.font }, o.prefer2bpp, p.mode);
    return { ...p, frame };
  }, device.mac); // the device's own content where it has some
}

/** What the device would show now (admin preview; rotation untouched). */
export async function canvasFor(db: Db, device: Device, panel: Panel, now: Date): Promise<Picked & { canvas: Canvas }> {
  return asDevice(device.mac, async () => {
    const p = await pick(db, device, now, false);
    const canvas = renderScreen(panel, { ...p.extra, now, font: p.settings.font, batteryV: device.battery_v ?? undefined }, p.mode);
    return { ...p, canvas };
  });
}
