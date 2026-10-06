// Device protocol v1 (for the planned C3 lite firmware): one request per wake,
// ETag/304 when nothing changed, server-computed sleep time. Design doc §3.5.
import { Hono } from "hono";
import { type Db, getDevice, registerDevice, touchDevice } from "../db.js";
import { sleepSeconds } from "../schedule.js";
import { frameFor, panelOf } from "../deviceFrame.js";
import { getSettings } from "../data/devices.js";
import type { AppOptions } from "../app.js";

export function v1Routes(db: Db, opts: AppOptions): Hono {
  const app = new Hono();

  app.post("/api/v1/register", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { mac?: string; panel?: string; fw?: string };
    if (!body.mac) return c.json({ error: "mac required" }, 400);
    const d = registerDevice(db, body.mac, opts.autoApprove ? "active" : "pending");
    touchDevice(db, d.mac, { panel: body.panel ?? null, fw: body.fw ?? null });
    return c.json({ device_key: d.key, status: d.status });
  });

  app.get("/api/v1/frame", async (c) => {
    const mac = c.req.header("X-Device-Id") ?? "";
    const key = c.req.header("X-Device-Key");
    const device = mac ? getDevice(db, mac) : undefined;
    if (!device || !key || device.key !== key) return c.json({ error: "unauthorized" }, 401);

    const now = opts.now();
    const sleep = String(sleepSeconds(now, getSettings(db, device).schedule));
    const panelId = c.req.header("X-Panel") ?? device.panel ?? "";
    const mv = Number(c.req.header("X-Battery-mV"));
    const rssi = Number(c.req.header("X-RSSI"));
    touchDevice(db, mac, {
      panel: panelId || null,
      battery_v: Number.isFinite(mv) && mv > 0 ? mv / 1000 : undefined,
      rssi: Number.isFinite(rssi) && c.req.header("X-RSSI") ? rssi : undefined,
      fw: c.req.header("X-FW") ?? undefined,
    }, true);

    if (device.status !== "active") {
      return c.body(null, 202, { "X-Sleep-Seconds": "300" });
    }
    const panel = panelOf({ panel: panelId });
    if (!panel) return c.json({ error: `unknown panel '${panelId}'` }, 400);

    // No request counter / seconds on screen here, so identical content keeps its ETag.
    const { frame } = await frameFor(db, getDevice(db, mac)!, panel, now, { advance: true, prefer2bpp: true, ctx: { mac: device.mac } });
    const headers = { ETag: `"${frame.etag}"`, "X-Sleep-Seconds": sleep, "X-Mode-Id": frame.modeId };
    if (c.req.header("If-None-Match") === `"${frame.etag}"`) return c.body(null, 304, headers);
    return c.body(frame.body as Uint8Array<ArrayBuffer>, 200, { ...headers, "Content-Type": frame.contentType });
  });

  return app;
}
