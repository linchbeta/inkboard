// Family messages ("留言板"): short notes with a sender, newest first. A message goes to
// all of the user's screens, or to the screens listed in `to` (MACs).
import { type Db, getSetting, setSetting, normalizeMac } from "../db.js";

export interface Message { id: number; from: string; text: string; at: string; to?: string[] }

const MAX = 50;

export function listMessages(db: Db): Message[] {
  try {
    const v = JSON.parse(getSetting(db, "messages", "[]")) as (Omit<Message, "to"> & { to?: string | string[] })[];
    // (a single MAC in earlier versions)
    return Array.isArray(v) ? v.map((m) => (typeof m.to === "string" ? { ...m, to: [m.to] } : m as Message)) : [];
  } catch { return []; }
}

/** The messages a screen shows: those to every screen and those to it. */
export function messagesFor(db: Db, mac: string | undefined): Message[] {
  return listMessages(db).filter((m) => !m.to || (mac !== undefined && m.to.includes(mac)));
}

/** `to`: the screens (MACs) it is for; undefined or empty: every screen. */
export function addMessage(db: Db, from: string, text: string, now = new Date(), to?: string[]): Message | undefined {
  text = text.replace(/\r\n/g, "\n").trim().slice(0, 300);
  if (!text) return undefined;
  const list = listMessages(db);
  const msg: Message = { id: Math.max(0, ...list.map((m) => m.id)) + 1, from: from.trim().slice(0, 12), text, at: now.toISOString() };
  if (to?.length) msg.to = [...new Set(to.map(normalizeMac))];
  setSetting(db, "messages", JSON.stringify([msg, ...list].slice(0, MAX)));
  return msg;
}

export function deleteMessage(db: Db, id: number): void {
  setSetting(db, "messages", JSON.stringify(listMessages(db).filter((m) => m.id !== id)));
}
