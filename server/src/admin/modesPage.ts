// 布局库: every layout with a preview, to add to one or more screens' playlists or show
// on them for a while. What a layout shows is set per screen (屏幕 → 内容); the settings
// and action routes here serve that page and always name the screen (`dev`).
import type { Hono } from "hono";
import { html } from "hono/html";
import { type Db, type Device, listDevices, getOwnDevice } from "../db.js";
import { SCREENS } from "../frames.js";
import { setModeConfig } from "../data/modeConfig.js";
import { getSettings, saveSettings, sanitizeSettings, pinUntil } from "../data/devices.js";
import { asDevice } from "../data/content.js";
import { panelOf } from "../deviceFrame.js";
import { page } from "./layout.js";
import { DEV_ONLY, deviceName, opts, screenChecks, formList, safeBack, withFlash } from "./common.js";

export function modesRoutes(app: Hono, db: Db, now: () => Date): void {
  /** The user's screens named in a form field. */
  const screens = (b: Record<string, unknown>, k: string) => formList(b, k).map((m) => getOwnDevice(db, m)).filter((d): d is Device => !!d);

  // a layout's content on a screen (and the screens synced with it)
  app.post("/admin/modes/:id", async (c) => {
    const id = c.req.param("id");
    const s = SCREENS[id];
    const b = await c.req.parseBody() as Record<string, unknown>;
    const d = getOwnDevice(db, String(b.dev ?? ""));
    if (!s?.config || !d) return c.notFound();
    for (const f of s.config) if (f.normalize && typeof b[f.key] === "string") b[f.key] = f.normalize(b[f.key] as string, now());
    asDevice(d.mac, () => setModeConfig(db, id, s.config!, b));
    return c.redirect(withFlash(safeBack(b.back, `/devices/${d.mac}?tab=content#c-${id}`), "已保存，屏幕下次刷新时更新"));
  });

  app.post("/admin/modes/:id/action/:action", async (c) => {
    const id = c.req.param("id");
    const a = SCREENS[id]?.actions?.find((x) => x.id === c.req.param("action"));
    const b = await c.req.parseBody();
    const d = getOwnDevice(db, String(b.dev ?? ""));
    if (!a || !d) return c.notFound();
    asDevice(d.mac, () => a.run(db, now()));
    return c.redirect(safeBack(b.back, `/devices/${d.mac}?tab=content#c-${id}`));
  });

  // show this layout on the chosen screens for a while
  app.post("/admin/modes/:id/push", async (c) => {
    const id = c.req.param("id");
    if (!SCREENS[id]) return c.notFound();
    const b = await c.req.parseBody({ all: true });
    const devices = screens(b, "mac");
    const kind = formList(b, "for")[0] ?? "once";
    for (const d of devices) saveSettings(db, d.mac, { ...getSettings(db, d), pin: { mode: id, ...pinUntil(kind, now()) } });
    return c.redirect(withFlash(`/modes#${id}`, devices.length ? `已推送到 ${devices.length} 块屏，下次刷新时显示` : "请选择屏幕"));
  });

  // add this layout to the chosen screens' playlists
  app.post("/admin/modes/:id/add", async (c) => {
    const id = c.req.param("id");
    if (!SCREENS[id]) return c.notFound();
    const devices = screens(await c.req.parseBody({ all: true }), "mac");
    for (const d of devices) {
      const s = getSettings(db, d);
      if (!s.playlist.some((i) => i.mode === id)) saveSettings(db, d.mac, sanitizeSettings({ playlist: [...s.playlist, { mode: id }], pin: s.pin }, s));
    }
    if (devices.length === 1) return c.redirect(withFlash(`/devices/${devices[0].mac}?tab=content#c-${id}`, `已加入「${deviceName(db, devices[0])}」，在这里设置它显示的内容`));
    return c.redirect(withFlash(`/modes#${id}`, devices.length ? `已加入 ${devices.length} 块屏的播放列表` : "请选择屏幕"));
  });

  app.get("/modes", (c) => {
    const devices = listDevices(db);
    const dev = c.req.query("dev") === "1";
    const panelIds = [...new Set(devices.map((d) => panelOf(d)?.id).filter(Boolean))] as string[];
    const previewPanel = panelIds.includes("se0398") || !panelIds.length ? "se0398" : panelIds[0];
    const cards = Object.entries(SCREENS).filter(([id]) => dev || !DEV_ONLY.has(id)).map(([id, s]) => {
      const on = devices.filter((d) => getSettings(db, d).playlist.some((i) => i.mode === id));
      const pick = (checked: (mac: string) => boolean) => devices.length > 1 ? html`<div style="margin-bottom:8px">${screenChecks(db, "mac", checked)}</div>`
        : html`<input type="hidden" name="mac" value="${devices[0].mac}">`;
      return html`<section class="card" id="${id}">
        <div class="spread"><h2 style="margin:0">${s.name}</h2>${on.length ? html`<span class="pill ok">${on.map((d) => deviceName(db, d)).join("、")}</span>` : ""}</div>
        ${s.description ? html`<p class="muted small" style="margin:2px 0 12px">${s.description}</p>` : ""}
        <a href="/preview/${previewPanel}.png?screen=${id}" target="_blank" class="screen" style="display:block"><img class="preview" loading="lazy" src="/preview/${previewPanel}.png?screen=${id}" alt="${s.name} 预览"></a>
        ${devices.length ? html`<details style="margin-top:12px"><summary>加入屏幕的播放列表</summary>
            <form method="post" action="/admin/modes/${id}/add" style="margin-top:8px">${pick((m) => !on.some((d) => d.mac === m))}<button class="primary">加入</button></form></details>
          <details><summary>临时显示一下</summary><form method="post" action="/admin/modes/${id}/push" style="margin-top:8px">${pick(() => false)}
            <div class="row"><select name="for">${opts("once", [["once", "显示一次"], ["1h", "1 小时"], ["3h", "3 小时"], ["today", "到今天结束"], ["forever", "直到取消"]])}</select>
            <button>显示</button></div></form></details>` : ""}</section>`;
    });
    return c.html(page(c, {
      title: "布局库", nav: "modes",
      body: html`<div class="head"><div><h1>布局库</h1><p class="sub">可以显示的各种布局（预览为示例内容）。加入某块屏的播放列表后，在那块屏的"内容"里设置它显示什么——每块屏的内容各自独立，也可以设置多屏同步。</p></div>
        ${dev ? "" : html`<a href="/modes?dev=1" class="btn ghost small">开发用画面</a>`}</div>
      <div class="grid">${cards}</div>`,
    }));
  });
}
