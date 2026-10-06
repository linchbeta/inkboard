// Compatibility layer: the endpoints the current InkSight firmware calls, so devices
// work against InkBoard without a firmware change. See docs/项目梳理与新后端设计.md §3.6.
import { Hono } from "hono";
import { type Db, getDevice, registerDevice, touchDevice } from "../db.js";
import { matchPanel } from "../panels.js";
import { genericPanel } from "../frames.js";
import { refreshMinutes, nextWakeUnix } from "../schedule.js";
import { frameFor } from "../deviceFrame.js";
import { getSettings } from "../data/devices.js";
import { holidayOf, loadedHolidayYears } from "../data/calendar.js";
import type { AppOptions } from "../app.js";

export function compatRoutes(db: Db, opts: AppOptions): Hono {
  const app = new Hono();

  const authorized = (mac: string, token: string | undefined): boolean => {
    const d = getDevice(db, mac);
    return !!d && !!token && d.key === token && d.status === "active";
  };

  // Registration: firmware calls this when it has no token.
  app.post("/api/device/:mac/token", (c) => {
    const d = registerDevice(db, c.req.param("mac"), opts.autoApprove ? "active" : "pending");
    touchDevice(db, d.mac);
    return c.json({ token: d.key });
  });

  // Pairing: the firmware re-sends its pending pair code on every WiFi connect until
  // the server echoes the same code back (otherwise 3 retries per wake).
  app.post("/api/device/:mac/claim-token", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const code = String((body as { pair_code?: unknown }).pair_code ?? "");
    const mac = c.req.param("mac");
    // keep the code it shows (an empty report must not clear it: it is our pairing code too)
    if (getDevice(db, mac) && /^\d{4,8}$/.test(code)) touchDevice(db, mac, { pair_code: code });
    return c.json({ ok: true, pair_code: code });
  });

  app.post("/api/device/:mac/heartbeat", async (c) => {
    const mac = c.req.param("mac");
    if (!authorized(mac, c.req.header("X-Device-Token"))) return c.json({ error: "unauthorized" }, 401);
    const hb = (await c.req.json().catch(() => ({}))) as { battery_voltage?: number; wifi_rssi?: number };
    touchDevice(db, mac, { battery_v: num(hb.battery_voltage), rssi: num(hb.wifi_rssi) });
    return c.json({ ok: true });
  });

  // A year's official holidays for the device's offline calendar, fetched once a year:
  // lines "YYYYMMDD 1" (day off) / "YYYYMMDD 2" (make-up work day), for the year and the
  // December before it (a schedule can start a block there, e.g. 元旦 from Dec 31);
  // 404 until published. The device's side: firmware/src/holiday_table.h.
  app.get("/api/holidays/:year", (c) => {
    const year = Number(c.req.param("year"));
    if (!Number.isInteger(year) || !loadedHolidayYears().includes(year)) return c.text("not published", 404);
    const lines: string[] = [];
    for (let dt = new Date(year - 1, 11, 1); dt.getFullYear() <= year; dt.setDate(dt.getDate() + 1)) {
      const y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate();
      const h = holidayOf(y, m, d);
      if (h) lines.push(`${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")} ${h === "off" ? 1 : 2}`);
    }
    return c.text(lines.join("\n") + "\n");
  });

  // Flags read at boot: "always active" is the device's live mode (admin toggle).
  app.get("/api/config/:mac", (c) => {
    const d = getDevice(db, c.req.param("mac"));
    return c.json({ is_focus_listening: false, is_always_active: d ? getSettings(db, d).live : false });
  });

  app.get("/api/device/:mac/state", (c) =>
    c.json({ runtime_mode: "interval", pending_refresh: false, pending_mode: "" }));

  // Accepted and ignored: runtime mode reports, portal config upload.
  app.post("/api/device/:mac/runtime", (c) => c.json({ ok: true }));
  app.post("/api/config", (c) => c.json({ ok: true }));

  app.get("/api/render", async (c) => {
    const q = c.req.query();
    const mac = q.mac ?? "";
    if (!authorized(mac, c.req.header("X-Device-Token"))) return c.json({ error: "unauthorized" }, 401);
    const w = int(q.w) ?? 400;
    const h = int(q.h) ?? 300;
    const colors = int(q.colors) ?? 2;
    const bpp = int(q.bpp) ?? 1;
    const panel = matchPanel(w, h, colors) ?? genericPanel(w, h);
    const batteryV = num(q.v);
    const rssi = int(q.rssi);
    touchDevice(db, mac, { panel: panel.id, width: w, height: h, colors, battery_v: batteryV, rssi,
                           boot: q.boot }, true);
    const device = getDevice(db, mac)!;
    const now = opts.now();
    const { frame, settings } = await frameFor(db, device, panel, now, {
      advance: true, prefer2bpp: bpp >= 2, ctx: { mac: device.mac, batteryV, rssi, requestNo: device.requests },
    });
    const schedule = settings?.schedule ?? opts.schedule;
    const headers = {
      "Content-Type": frame.contentType,
      // minutes until the next wake, for InkSight firmware (it sleeps that long)
      "X-Refresh-Minutes": String(refreshMinutes(now, schedule)),
      // the same wake as a point in time (Unix s), for ours: it sleeps until then, so the
      // time spent downloading and refreshing does not push it late
      "X-Next-Wake": String(nextWakeUnix(now, schedule)),
      "X-Mode-Id": frame.modeId,
      // The frame's fingerprint, before the body: the device skips an unchanged frame
      // (304, no download / refresh) and knows whether a message frame is new.
      ETag: `"${frame.etag}"`,
    };
    if (c.req.header("If-None-Match") === headers.ETag) return c.body(null, 304, headers);
    return c.body(frame.body as Uint8Array<ArrayBuffer>, 200, headers);
  });

  return app;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function int(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : Math.trunc(n);
}
