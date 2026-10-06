// What a screen shows is its own. Each layout's content (todo list, events, weather city,
// photo selection…) is stored per screen; editing it on one screen changes no other.
// Screens can be synced per layout: a sync group shares the content, and an edit on any
// of them is written to all (see setSetting in db.ts). Messages are addressed to screens
// instead (messages.ts).
import { type Db, rawSetting, setRawSetting, deleteRawSettings, getSetting, syncMembers } from "../db.js";
import { currentUser, runAs, userKey, deviceKey } from "../scope.js";

/** The sync unit of a layout: 日期牌 and 天气 share the screen's city. */
export const layoutSyncId = (mode: string) => (mode === "datecard" || mode === "dashboard" ? "weather" : mode);

/** The stored keys of a sync unit. */
const contentKeys = (id: string) =>
  id === "weather" ? ["weather_place", "weather_cache"] : id === "poetry" ? ["mode:poetry", "poetry:skip", "counter:poetry"] : [`mode:${id}`, `counter:${id}`];

/** Runs `fn` as screen `mac` of the current user: reads and edits that screen's content. */
export function asDevice<T>(mac: string, fn: () => T): T {
  const u = currentUser();
  return u === undefined ? fn() : runAs(u, fn, mac);
}

/** The screens synced with `mac` for this layout (itself first). */
export function syncGroup(db: Db, mac: string, mode: string): string[] {
  const u = currentUser();
  return u === undefined ? [mac] : syncMembers(db, u, layoutSyncId(mode), mac);
}

/**
 * Makes `mac` and `others` one sync group for this layout. The others take `mac`'s
 * current content; screens that leave the group keep a copy of what they showed.
 */
export function setSync(db: Db, mac: string, mode: string, others: string[]): void {
  const u = currentUser();
  if (u === undefined) throw new Error("no user scope");
  const id = layoutSyncId(mode);
  const key = userKey(u, `sync:${id}`);
  let groups: string[][] = [];
  try { groups = JSON.parse(rawSetting(db, key) ?? "[]") as string[][]; } catch { /* none */ }
  const group = [...new Set([mac, ...others.filter((m) => m !== mac)])];
  groups = groups.filter(Array.isArray).map((g) => g.filter((m) => m !== mac && !group.includes(m))).filter((g) => g.length > 1);
  if (group.length > 1) groups.push(group);
  setRawSetting(db, key, JSON.stringify(groups));
  // the others now show this screen's content
  for (const k of contentKeys(id)) {
    const v = asDevice(mac, () => getSetting(db, k, "\u0000"));
    for (const o of group.slice(1)) {
      if (v === "\u0000") deleteRawSettings(db, deviceKey(o, k));
      else setRawSetting(db, deviceKey(o, k), v);
    }
  }
}
