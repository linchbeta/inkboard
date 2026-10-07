// Per-mode settings (one JSON object per mode in the setting table), described by a small
// field schema so the admin page can render the forms generically.
import { type Db, getSetting, setSetting } from "../db.js";

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "textarea" | "select";
  placeholder?: string;
  help?: string;
  options?: [string, string][]; // select: [value, label]
  /** select: more options computed from the current settings (e.g. the events listed). */
  dynamicOptions?: (values: Record<string, string>, now: Date) => [string, string][];
  default?: string;
  /** textarea: rewrites the value on save (e.g. 明天 -> a date). */
  normalize?: (value: string, now: Date) => string;
  /** textarea: how each line was understood, shown under the field ("ok: false" in red). */
  check?: (value: string, now: Date, values: Record<string, string>) => { ok: boolean; text: string }[];
}

export function getModeConfig(db: Db, mode: string, fields: ConfigField[] = []): Record<string, string> {
  let saved: Record<string, unknown> = {};
  try { saved = JSON.parse(getSetting(db, `mode:${mode}`, "{}")) as Record<string, unknown>; } catch { /* reset */ }
  const out: Record<string, string> = {};
  for (const f of fields) out[f.key] = typeof saved[f.key] === "string" ? (saved[f.key] as string) : f.default ?? "";
  return out;
}

export function setModeConfig(db: Db, mode: string, fields: ConfigField[], values: Record<string, unknown>): void {
  const out: Record<string, string> = {};
  for (const f of fields) {
    let v = typeof values[f.key] === "string" ? (values[f.key] as string) : f.default ?? "";
    v = v.replace(/\r\n/g, "\n").slice(0, f.type === "textarea" ? 8000 : 500);
    if (f.type === "select" && f.options && !f.dynamicOptions && !f.options.some(([o]) => o === v)) v = f.default ?? f.options[0][0];
    out[f.key] = v;
  }
  setSetting(db, `mode:${mode}`, JSON.stringify(out));
}
