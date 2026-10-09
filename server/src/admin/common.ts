// Pieces shared by the admin pages: device names, the generic mode settings form, select
// options.
import { html, raw } from "hono/html";
import { type Db, type Device, listDevices } from "../db.js";
import { SCREENS } from "../frames.js";
import { getModeConfig } from "../data/modeConfig.js";
import { getSettings } from "../data/devices.js";
import { diagonalOf } from "../panels.js";

/** Developer screens, hidden unless asked for. */
export const DEV_ONLY = new Set(["test", "fontcompare", "bigfont"]);
export const modeName = (id: string) => SCREENS[id]?.name ?? id;

export const opts = (sel: string, list: [string, string][]) =>
  list.map(([v, l]) => html`<option value="${v}" ${v === sel ? raw("selected") : ""}>${l}</option>`);

// its diagonal as the firmware reports it, else the usual one of its resolution -- never the
// panel's name (a B/W panel the server does not know is called "600×448")
const panelSize = (d: Device) => diagonalOf(d);

/** The device's name, or "3.98 寸屏" (numbered when the user has several unnamed ones of that size). */
export function deviceName(db: Db, d: Device, s = getSettings(db, d)): string {
  if (s.name) return s.name;
  const size = panelSize(d);
  const base = size ? `${size} 寸屏` : "墨水屏";
  const same = listDevices(db).filter((x) => panelSize(x) === size && !getSettings(db, x).name)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const k = same.findIndex((x) => x.mac === d.mac);
  return same.length > 1 && k >= 0 ? `${base} ${k + 1}` : base;
}

/** Last two bytes of the MAC, to tell screens apart at a glance. */
export const macTail = (mac: string) => mac.slice(-5);

/**
 * Checkboxes, one per screen of the user (name="<name>", value = MAC), for choosing
 * several screens at once (messages, sync, adding a layout).
 */
export function screenChecks(db: Db, name: string, checked: (mac: string) => boolean, o: { except?: string; onchange?: string } = {}) {
  const devices = listDevices(db).filter((d) => d.mac !== o.except);
  return html`<span class="row" style="gap:6px 14px">${devices.map((d) => html`<label class="check small"><input type="checkbox" name="${name}" value="${d.mac}"
    ${checked(d.mac) ? raw("checked") : ""} ${o.onchange ? raw(`onchange="${o.onchange}"`) : ""}> ${deviceName(db, d)} <span class="muted">${macTail(d.mac)}</span></label>`)}</span>`;
}

/** All values of a (possibly repeated) form field. */
export const formList = (b: Record<string, unknown>, k: string) => ([] as unknown[]).concat(b[k] ?? []).map(String);

/**
 * The settings form of a mode (fields from its schema) for screen `dev` (and the screens
 * synced with it); `back` is where to return. Call it in that screen's scope.
 */
export function modeForm(db: Db, id: string, now: Date, o: { dev: string; back: string; skip?: string[] }) {
  const s = SCREENS[id];
  const fields = (s?.config ?? []).filter((f) => !o.skip?.includes(f.key));
  if (!fields.length) return "";
  const cfg = getModeConfig(db, id, s.config);
  return html`<form method="post" action="/admin/modes/${id}">
    <input type="hidden" name="back" value="${o.back}"><input type="hidden" name="dev" value="${o.dev}">
    ${fields.map((f) => html`<label class="field"><span>${f.label}</span>
      ${f.type === "textarea" ? html`<textarea name="${f.key}" rows="${Math.min(12, Math.max(4, cfg[f.key].split("\n").length + 1))}" placeholder="${f.placeholder ?? ""}">${cfg[f.key]}</textarea>`
        : f.type === "select" ? html`<select name="${f.key}">${opts(cfg[f.key], [...f.options!, ...(f.dynamicOptions?.(cfg, now) ?? [])])}</select>`
        : html`<input type="text" name="${f.key}" value="${cfg[f.key]}" placeholder="${f.placeholder ?? ""}" style="width:100%">`}
      ${f.help ? html`<small>${f.help}</small>` : ""}
      ${f.check && cfg[f.key].trim() ? html`<ul class="checks">${f.check(cfg[f.key], now, cfg).map((r) =>
        html`<li class="${r.ok ? "ok" : "bad"}">${r.ok ? "✓" : "✗"} ${r.text}</li>`)}</ul>` : ""}</label>`)}
    <button class="primary">保存</button></form>`;
}

/** A redirect target from a form: same-site paths only. */
export const safeBack = (v: unknown, fallback: string) => {
  const s = String(v ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
};

export const withFlash = (path: string, msg: string) => {
  const [p, hash] = path.split("#");
  return `${p}${p.includes("?") ? "&" : "?"}flash=${encodeURIComponent(msg)}${hash ? `#${hash}` : ""}`;
};
