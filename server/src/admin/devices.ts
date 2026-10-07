// 概览 (screen cards, quick message, pairing) and the screen page, where everything about
// one screen lives: 播放 (which layouts, in what order, when), 内容 (what each of its
// layouts shows — this screen's own, optionally synced with other screens), 设备 (name,
// font, battery, unbinding). Only the current user's screens.
import type { Context, Hono } from "hono";
import { html, raw } from "hono/html";
import { type Db, type Device, listDevices, getOwnDevice, unbindDevice, approveDevice, telemetry } from "../db.js";
import { SCREENS } from "../frames.js";
import { getSettings, sanitizeSettings, saveSettings, activeItems, pinUntil, type DeviceSettings, type PlaylistItem } from "../data/devices.js";
import { listMessages, messagesFor } from "../data/messages.js";
import { asDevice, syncGroup, setSync, layoutSyncId } from "../data/content.js";
import { getModeConfig } from "../data/modeConfig.js";
import { getPlace, searchPlaces, type Place } from "../data/weather.js";
import { listPhotos, getPlayback, INTERVALS, intervalName } from "../data/photos.js";
import { parseTodo } from "../screens/todo.js";
import { sleepSeconds } from "../schedule.js";
import { batteryLevel } from "../data/calendar.js";
import { panelOf, canvasFor } from "../deviceFrame.js";
import { previewPng } from "../render/pack.js";
import { page, ago, hm, icon } from "./layout.js";
import { userOf } from "./auth.js";
import { DEV_ONLY, modeName, opts, deviceName, macTail, screenChecks, formList, modeForm, safeBack, withFlash } from "./common.js";

export { deviceName };

const ROTATE: [string, string][] = [["refresh", "每次刷新"], ["15", "每 15 分钟"], ["30", "每 30 分钟"], ["60", "每小时"],
  ["120", "每 2 小时"], ["180", "每 3 小时"], ["360", "每 6 小时"], ["720", "每 12 小时"], ["1440", "每天"]];
const ORDER: [string, string][] = [["sequence", "顺序轮播"], ["random", "随机轮播"], ["single", "只显示第一个"]];
const DAYS: [string, string][] = [["all", "每天"], ["workday", "工作日"], ["weekend", "周末"]];
const modeList = () => Object.entries(SCREENS).filter(([id]) => !DEV_ONLY.has(id));
/** Layouts with content to set (and to sync). */
const hasContent = (mode: string) => !!SCREENS[mode]?.config || mode === "weather" || mode === "datecard" || mode === "dashboard";

/** Expected next wake, from the last request and the device's schedule. */
function nextWake(d: Device, s: DeviceSettings): Date | undefined {
  if (!d.last_seen) return undefined;
  const t = new Date(d.last_seen);
  return new Date(t.getTime() + sleepSeconds(t, s.schedule) * 1000);
}

const battery = (v: number | null) => (v === null || v === undefined ? "—" : `${Math.round(batteryLevel(Math.round(v * 1000)))}%`);
const signal = (rssi: number | null) =>
  rssi === null || rssi === undefined ? "—" : rssi >= -55 ? "很好" : rssi >= -67 ? "良好" : rssi >= -75 ? "一般" : "较弱";

function status(d: Device, s: DeviceSettings, now: Date) {
  if (d.status === "pending") return html`<span class="pill warn">待批准</span>`;
  const nw = nextWake(d, s);
  if (!nw) return html`<span class="pill">未连接</span>`;
  return now.getTime() - nw.getTime() > 20 * 60_000 ? html`<span class="pill warn">已错过刷新</span>` : html`<span class="pill ok">在线</span>`;
}

/** SVG line of battery voltage over the last week. */
function batteryChart(points: { ts: string; battery_v: number | null }[], now: Date) {
  const pts = points.filter((p) => p.battery_v !== null && p.battery_v > 2.5) as { ts: string; battery_v: number }[];
  if (pts.length < 2) return html`<p class="muted small">接电池后会显示近 7 天的电量曲线。</p>`;
  const W = 600, H = 110, t0 = now.getTime() - 7 * 86_400_000;
  const vMin = Math.min(3.3, ...pts.map((p) => p.battery_v)), vMax = Math.max(4.25, ...pts.map((p) => p.battery_v));
  const x = (ts: string) => ((new Date(ts).getTime() - t0) / (7 * 86_400_000)) * W;
  const y = (v: number) => H - ((v - vMin) / (vMax - vMin)) * H;
  const d = pts.map((p) => `${x(p.ts).toFixed(1)},${y(p.battery_v).toFixed(1)}`).join(" ");
  return html`<svg viewBox="0 0 ${W} ${H + 18}" style="width:100%;height:auto">
    <line x1="0" x2="${W}" y1="${y(3.7)}" y2="${y(3.7)}" stroke="currentColor" stroke-opacity=".12" stroke-dasharray="4 4"/>
    <polyline points="${d}" fill="none" stroke="#c0392b" stroke-width="2.5" stroke-linejoin="round"/>
    <text x="0" y="${H + 14}" font-size="11" fill="currentColor" opacity=".55">7 天前</text>
    <text x="${W}" y="${H + 14}" font-size="11" fill="currentColor" opacity=".55" text-anchor="end">现在 ${pts[pts.length - 1].battery_v.toFixed(2)} V</text></svg>`;
}

const greeting = (t: Date) => { const h = t.getHours(); return h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好"; };
const names = (db: Db, macs: string[]) => macs.map((m) => { const d = getOwnDevice(db, m); return d ? deviceName(db, d) : m; }).join("、");

/** Message list rows; `back` returns here after deleting. */
export function messageRows(db: Db, msgs: ReturnType<typeof listMessages>, now: Date, back: string) {
  return msgs.map((m) => html`<div class="msg"><div class="body"><div>${m.text}</div>
      <div class="meta">${m.from || "家人"} · ${ago(m.at, now)} · ${m.to ? `给 ${names(db, m.to)}` : "所有屏"}</div></div>
      <form method="post" action="/admin/messages/${m.id}/delete"><input type="hidden" name="back" value="${back}"><button class="link" title="删除">✕</button></form></div>`);
}

/** The message form: to the screens ticked (`checked`). */
export function messageForm(db: Db, back: string, checked: (mac: string) => boolean, placeholder = "写一句话，显示在墨水屏上…") {
  const several = listDevices(db).length > 1;
  return html`<form method="post" action="/admin/messages"><input type="hidden" name="back" value="${back}">
    <textarea class="text" name="text" rows="3" maxlength="300" placeholder="${placeholder}" required></textarea>
    ${several ? html`<input type="hidden" name="targets" value="1"><div class="row" style="margin-top:10px"><span class="small muted">发给</span>${screenChecks(db, "to", checked)}</div>` : ""}
    <div class="spread" style="margin-top:10px"><div class="row"><input type="text" name="from" placeholder="署名" maxlength="12" style="width:100px">
      <label class="check small"><input type="checkbox" name="push"> 立即显示（3 小时）</label></div><button class="primary">发布</button></div></form>`;
}

export function deviceRoutes(app: Hono, db: Db, now: () => Date): void {
  const own = (c: Context) => getOwnDevice(db, c.req.param("mac") ?? "");

  // ── preview of what a device shows now ──
  app.get("/preview/device/:file", async (c) => {
    const mac = /^([0-9A-Fa-f:]+)\.png$/.exec(c.req.param("file"))?.[1];
    const d = mac ? getOwnDevice(db, mac) : undefined;
    const panel = d && panelOf(d);
    if (!d || !panel) return c.notFound();
    const scale = Math.min(3, Math.max(1, Number(c.req.query("scale") ?? (panel.width < 600 ? 2 : 1)) | 0));
    const { canvas } = await canvasFor(db, d, panel, now());
    return c.body(previewPng(canvas, panel, scale) as Uint8Array<ArrayBuffer>, 200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
  });

  // ── 概览 ──
  app.get("/", (c) => {
    const t = now();
    const devices = listDevices(db);
    const last = listMessages(db)[0];
    const cards = devices.map((d) => {
      const s = getSettings(db, d);
      const panel = panelOf(d);
      const nw = nextWake(d, s);
      const current = s.pin ? `${modeName(s.pin.mode)}（临时）` : activeItems(s, t).map((i) => modeName(i.mode)).join(" · ");
      return html`<section class="card">
        <div class="spread" style="align-items:flex-start"><div><h2 style="margin:0">${deviceName(db, d, s)}</h2>
          <code class="mac" title="MAC 地址">${d.mac}</code></div>${status(d, s, t)}</div>
        <p class="muted small" style="margin:8px 0 12px">正在播放：${current}</p>
        ${panel ? html`<a href="/devices/${d.mac}" class="screen" style="display:block"><img class="preview" loading="lazy" src="/preview/device/${d.mac}.png" alt="当前画面"></a>` : ""}
        <div class="stats"><div class="stat"><small>电量</small><b>${battery(d.battery_v)}</b></div>
          <div class="stat"><small>信号</small><b>${signal(d.rssi)}</b></div>
          <div class="stat"><small>下次刷新</small><b>${nw ? hm(nw) : "—"}</b></div></div>
        <div class="spread" style="margin-top:14px"><span class="muted small">上次刷新 ${ago(d.last_seen, t)}</span>
          <span class="row">${d.status === "pending" ? html`<form method="post" action="/admin/devices/${d.mac}/approve"><button class="primary">批准接入</button></form>` : ""}
          <a class="btn" href="/devices/${d.mac}">播放</a><a class="btn primary" href="/devices/${d.mac}?tab=content">内容</a></span></div></section>`;
    });
    return c.html(page(c, {
      title: "概览", nav: "home",
      body: html`<div class="head"><div><h1>${greeting(t)}，${userOf(c).name}</h1>
          <p class="sub">${t.getMonth() + 1}月${t.getDate()}日 · ${devices.length ? `${devices.length} 块屏` : "还没有设备"}</p></div>
        <a class="btn" href="#pair">${icon("plus", 18)}添加设备</a></div>
      <div class="grid">${cards}
        <section class="card"><h2>留言</h2>${messageForm(db, "/", () => true)}
          ${last ? html`<p class="muted small" style="margin-bottom:0">上一条来自${last.from || "家人"} · <a href="/messages">全部留言</a></p>` : ""}
        </section>
        <section class="card" id="pair"><h2>添加设备</h2>
          <p class="muted small" style="margin-top:-6px">新的墨水屏连上服务器后会显示 6 位配对码，在这里输入即可绑定到你的账号；绑定后只有你能看到和设置它。</p>
          <form method="post" action="/admin/pair" class="row"><input type="text" name="code" inputmode="numeric" pattern="[0-9 ]{4,10}" placeholder="配对码" required style="width:150px;letter-spacing:3px">
            <button class="primary">绑定</button></form>
          <details><summary>屏幕还没联网？</summary><p class="small muted">按 RESET 后马上按住 BOOT 直到 LED 常亮，手机连接热点 <b>InkBoard-XXXX</b>（旧固件为 InkSight-XXXX），打开 192.168.4.1，选择 WiFi 并填写服务器地址 <code>http://${c.req.header("host") ?? "本机IP:8080"}</code>。</p></details>
        </section></div>`,
    }));
  });

  // ── screen page ──
  app.get("/devices/:mac", async (c) => {
    const d = own(c);
    if (!d) return c.notFound();
    const t = now();
    const s = getSettings(db, d);
    const panel = panelOf(d);
    const nw = nextWake(d, s);
    const tab = ["play", "content", "device"].includes(c.req.query("tab") ?? "") ? c.req.query("tab")! : "play";
    const name = deviceName(db, d, s);
    const base = `/devices/${d.mac}`;
    const tabs = html`<nav class="tabs">${([["play", "播放"], ["content", "内容"], ["device", "设备"]] as const)
      .map(([id, label]) => html`<a href="${base}?tab=${id}" class="${id === tab ? "on" : ""}">${label}</a>`)}</nav>`;
    const body = tab === "content" ? await contentTab(db, d, s, t, (c.req.query("city") ?? "").trim().slice(0, 40))
      : tab === "device" ? deviceTab(db, d, s, t) : playTab(db, d, s, panel !== undefined);
    return c.html(page(c, {
      title: name, nav: "home",
      body: html`<p class="small" style="margin:0 0 6px"><a href="/" class="muted" style="text-decoration:none">← 概览</a></p>
      <div class="head"><div><h1>${name}</h1><p class="sub"><code class="mac">${d.mac}</code> · ${panel?.name ?? "未知屏幕"} · 上次刷新 ${ago(d.last_seen, t)}${nw ? html`，下次约 ${hm(nw)}` : ""}</p></div>${status(d, s, t)}</div>
      ${tabs}${body.html}`,
      script: body.script,
    }));
  });

  // 播放: playlist, order, rotation, wake schedule; the playlist optionally to other screens too
  app.post("/admin/devices/:mac", async (c) => {
    const d = own(c);
    if (!d) return c.notFound();
    const b = await c.req.parseBody({ all: true });
    const arr = (k: string) => formList(b, k);
    const modes = arr("mode"), from = arr("from"), to = arr("to"), days = arr("days");
    const playlist = modes.filter((m) => SCREENS[m]).map((mode, i) => ({ mode, from: from[i] || undefined, to: to[i] || undefined, days: days[i] as PlaylistItem["days"] }));
    const one = (k: string) => String(arr(k)[0] ?? "");
    const rotate = one("rotate") === "refresh" ? "refresh" as const : Number(one("rotate"));
    const order = one("order") as DeviceSettings["order"];
    const cur = getSettings(db, d);
    saveSettings(db, d.mac, sanitizeSettings({
      playlist, order, rotate, pin: cur.pin,
      schedule: { dayStartHour: Number(one("dayStartHour")), dayEndHour: Number(one("dayEndHour")), dayMinutes: Number(one("dayMinutes")), nightMinutes: Number(one("nightMinutes")) },
    }, cur));
    const also = arr("also").map((m) => getOwnDevice(db, m)).filter((x): x is Device => !!x && x.mac !== d.mac);
    for (const o of also) { const os = getSettings(db, o); saveSettings(db, o.mac, sanitizeSettings({ playlist, order, rotate, pin: os.pin }, os)); }
    return c.redirect(withFlash(`/devices/${d.mac}`, also.length ? `已保存，并应用到 ${also.length} 块其他屏` : "已保存，屏幕下次刷新时生效"));
  });

  // 设备: name, font, live mode
  app.post("/admin/devices/:mac/display", async (c) => {
    const d = own(c);
    if (!d) return c.notFound();
    const b = await c.req.parseBody();
    const cur = getSettings(db, d);
    saveSettings(db, d.mac, sanitizeSettings({ name: String(b.name ?? ""), font: String(b.font ?? "") as DeviceSettings["font"], live: b.live !== undefined, pin: cur.pin }, cur));
    return c.redirect(withFlash(`/devices/${d.mac}?tab=device`, "已保存"));
  });

  // 内容: the screens this layout's content is synced with
  app.post("/admin/devices/:mac/sync/:mode", async (c) => {
    const d = own(c);
    const mode = c.req.param("mode");
    if (!d || !hasContent(mode)) return c.notFound();
    const b = await c.req.parseBody({ all: true });
    const others = formList(b, "with").filter((m) => m !== d.mac && getOwnDevice(db, m));
    setSync(db, d.mac, mode, others);
    return c.redirect(withFlash(safeBack(formList(b, "back")[0], `/devices/${d.mac}?tab=content#c-${mode}`),
      others.length ? `已与 ${others.length} 块屏同步（它们改为显示本屏的内容）` : "已取消同步，只显示本屏的内容"));
  });

  app.post("/admin/devices/:mac/pin", async (c) => {
    const d = own(c);
    if (!d) return c.notFound();
    const b = await c.req.parseBody();
    const mode = String(b.mode ?? "");
    if (SCREENS[mode]) saveSettings(db, d.mac, { ...getSettings(db, d), pin: { mode, ...pinUntil(String(b.for ?? "once"), now()) } });
    return c.redirect(safeBack(b.back, withFlash(`/devices/${d.mac}`, `下次刷新时显示「${modeName(mode)}」`)));
  });

  app.post("/admin/devices/:mac/unpin", (c) => {
    const d = own(c);
    if (d) saveSettings(db, d.mac, { ...getSettings(db, d), pin: undefined });
    return c.redirect(d ? `/devices/${d.mac}` : "/");
  });

  app.post("/admin/devices/:mac/approve", (c) => {
    const d = own(c);
    if (d) approveDevice(db, d.mac);
    return c.redirect("/");
  });

  // unbind: the device forgets its owner, settings and content, and shows a fresh pairing code
  app.post("/admin/devices/:mac/delete", (c) => {
    const d = own(c);
    if (d) unbindDevice(db, d.mac);
    return c.redirect(withFlash("/", "已解绑"));
  });
}

type Tab = { html: ReturnType<typeof html>; script?: string };

function playTab(db: Db, d: Device, s: DeviceSettings, hasPanel: boolean): Tab {
  const modeOpts = (sel: string) => opts(sel, modeList().map(([id, sc]) => [id, sc.name]));
  // one card per layout: number, layout, move/delete; the time window and days fold away under a summary
  const when = (i: PlaylistItem) => `${i.from || i.to ? `${i.from || "00:00"}–${i.to || "24:00"}` : "全天"} · ${DAYS.find(([k]) => k === (i.days ?? "all"))![1]}`;
  const row = (i: PlaylistItem) => html`<div class="pl-item">
    <div class="pl-top"><select name="mode" class="pl-mode" aria-label="布局">${modeOpts(i.mode)}</select>
      <span class="pl-acts"><button type="button" class="link" data-act="up" title="上移">${icon("up", 18)}</button><button type="button" class="link" data-act="down" title="下移">${icon("down", 18)}</button><button type="button" class="link" data-act="del" title="删除">${icon("x", 18)}</button></span></div>
    <details class="pl-when ${i.from || i.to || (i.days ?? "all") !== "all" ? "timed" : ""}"><summary>${icon("clock", 14)}<span class="pl-sum">${when(i)}</span></summary>
      <div class="pl-fields"><label>时段 <input type="time" name="from" value="${i.from ?? ""}">–<input type="time" name="to" value="${i.to ?? ""}"></label>
        <label>日期 <select name="days">${opts(i.days ?? "all", DAYS)}</select></label></div></details></div>`;
  const hours = (sel: number, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => from + k)
    .map((h) => html`<option value="${h}" ${h === sel ? raw("selected") : ""}>${h}:00</option>`);
  const pinText = s.pin ? `${modeName(s.pin.mode)}${s.pin.once ? "，下次刷新显示一次" : s.pin.until ? `，到 ${new Date(s.pin.until).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "，直到取消"}` : "";
  const several = listDevices(db).length > 1;
  return {
    html: html`<div class="cols">
      <section class="card"><h2>现在显示</h2>
        ${hasPanel ? html`<div class="screen"><img class="preview" src="/preview/device/${d.mac}.png" alt="当前画面"></div>` : html`<p class="muted">设备还没报告屏幕型号。</p>`}
        ${s.pin ? html`<div class="flash spread" style="margin:14px 0 0"><span>临时显示：<b>${pinText}</b></span>
          <form method="post" action="/admin/devices/${d.mac}/unpin"><button>恢复播放列表</button></form></div>` : ""}
        <form method="post" action="/admin/devices/${d.mac}/pin" class="row" style="margin-top:14px">
          <select name="mode">${modeOpts(s.pin?.mode ?? "messages")}</select>
          <select name="for">${opts("once", [["once", "显示一次"], ["1h", "1 小时"], ["3h", "3 小时"], ["today", "到今天结束"], ["forever", "直到取消"]])}</select>
          <button>临时显示</button></form>
        <p class="muted small" style="margin-bottom:0">屏幕在休眠，改动在它下次醒来（定时或按 RESET）时生效。</p>
      </section>
      <form method="post" action="/admin/devices/${d.mac}" class="stack">
        <section class="card"><h2>播放列表</h2>
          <p class="muted small" style="margin-top:-6px">从布局库里选这块屏要显示的布局。设了时间段的只在那段时间显示（优先）；其余时间按播放方式轮流显示。每个布局显示什么，在"内容"里设置。</p>
          <div id="items" class="pl-list">${s.playlist.map(row)}</div>
          <div class="spread" style="margin-top:10px"><span class="row"><button type="button" id="add">${icon("plus", 16)}添加布局</button><a class="small" href="/modes">看布局库预览 →</a></span>
          </div>
          <div class="pl-opts" style="margin-top:12px"><label>播放方式 <select name="order">${opts(s.order, ORDER)}</select></label><label>换一个 <select name="rotate">${opts(String(s.rotate), ROTATE)}</select></label></div>
          ${several ? html`<details style="margin-top:10px"><summary>同时应用到其他屏</summary><div style="margin-top:8px">${screenChecks(db, "also", () => false, { except: d.mac })}
            <p class="muted small" style="margin:6px 0 0">勾选的屏会换成同样的播放列表和播放方式（各屏的内容不受影响）。</p></div></details>` : ""}
        </section>
        <section class="card"><h2>刷新时间</h2>
          <div class="row"><span>白天</span><select name="dayStartHour">${hours(s.schedule.dayStartHour, 0, 23)}</select> 到
            <select name="dayEndHour">${hours(s.schedule.dayEndHour, 1, 24)}</select> 每
            <select name="dayMinutes">${opts(String(s.schedule.dayMinutes), [["10", "10"], ["15", "15"], ["20", "20"], ["30", "30"], ["60", "60"], ["120", "120"]])}</select> 分钟</div>
          <div class="row" style="margin-top:10px"><span>夜间每</span>
            <select name="nightMinutes">${opts(String(s.schedule.nightMinutes), [["30", "30 分钟"], ["60", "1 小时"], ["120", "2 小时"], ["180", "3 小时"], ["360", "6 小时"]])}</select></div>
          <p class="muted small" style="margin-bottom:0">刷新越少越省电。日历、日期牌一天只变一次，夜间间隔可以调长。</p>
        </section>
        <div><button class="primary">保存播放设置</button></div>
      </form>
    </div>
    <template id="tpl">${row({ mode: "datecard" })}</template>`,
    script: `
const items = document.getElementById('items');
const DAYS = ${JSON.stringify(Object.fromEntries(DAYS))};
document.getElementById('add').onclick = () => items.appendChild(document.getElementById('tpl').content.firstElementChild.cloneNode(true));
items.addEventListener('change', (e) => {  // keep the folded summary in step
  const it = e.target.closest('.pl-item'); if (!it || !it.querySelector('.pl-when')) return;
  const v = (n) => it.querySelector('[name=' + n + ']').value, from = v('from'), to = v('to'), days = v('days');
  it.querySelector('.pl-sum').textContent = (from || to ? (from || '00:00') + '–' + (to || '24:00') : '全天') + ' · ' + DAYS[days];
  it.querySelector('.pl-when').classList.toggle('timed', !!(from || to || days !== 'all'));
});
items.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const tr = b.closest('.pl-item');
  if (b.dataset.act === 'del') { if (items.children.length > 1) tr.remove(); }
  else if (b.dataset.act === 'up' && tr.previousElementSibling) items.insertBefore(tr, tr.previousElementSibling);
  else if (b.dataset.act === 'down' && tr.nextElementSibling) items.insertBefore(tr.nextElementSibling, tr);
});`,
  };
}

/** What each layout on this screen shows, editable here (for this screen and those synced with it). */
async function contentTab(db: Db, d: Device, s: DeviceSettings, now: Date, cityQuery: string): Promise<Tab> {
  const panel = panelOf(d);
  const several = listDevices(db).length > 1;
  const shown = [...s.playlist.map((i) => i.mode), ...(s.pin ? [s.pin.mode] : [])];
  const modes = [...new Set([...shown, ...(shown.includes("dashboard") ? ["agenda", "todo"] : [])])].filter((m) => SCREENS[m]);
  const back = (m: string) => `/devices/${d.mac}?tab=content#c-${m}`;
  let found: Place[] = [], searchError = "";
  if (cityQuery) { try { found = await searchPlaces(cityQuery); } catch (e) { searchError = e instanceof Error ? e.message : String(e); } }

  const cards = modes.map((m) => asDevice(d.mac, () => {
    const sc = SCREENS[m];
    const group = syncGroup(db, d.mac, m);
    const synced = group.slice(1);
    // 日程 / 待办 shown only because the 看板 uses them: say so (they are not in the playlist)
    const forDash = !shown.includes(m) ? html`<span class="pill">看板用到，不在播放列表中</span>` : "";
    const pill = forDash ? forDash : !hasContent(m) ? "" : synced.length ? html`<span class="pill acc">与 ${names(db, synced)} 同步</span>` : several ? html`<span class="pill">仅本屏</span>` : "";
    const editor = contentEditor(db, d, m, now, back(m), { cityQuery, found, searchError });
    const sync = hasContent(m) && several ? html`<details style="margin-top:14px"><summary>多屏同步${synced.length ? `（${synced.length} 块）` : ""}</summary>
      <form method="post" action="/admin/devices/${d.mac}/sync/${m}" style="margin-top:10px">
        ${screenChecks(db, "with", (mac) => group.includes(mac), { except: d.mac })}
        <p class="muted small">勾选的屏会和这块屏显示同样的${layoutSyncId(m) === "weather" ? "城市天气" : `「${sc.name}」内容`}（以这块屏现在的内容为准），之后在其中任何一块屏上修改都会同时更新。取消勾选的屏保留当前内容、不再同步。</p>
        <button>保存同步设置</button></form></details>` : "";
    return html`<section class="card" id="c-${m}">
      <div class="spread"><h2 style="margin:0">${sc.name}</h2>${pill}</div>
      <div class="cols" style="margin-top:14px">
        ${panel ? html`<div><div class="screen"><img class="preview" loading="lazy" src="/preview/${panel.id}.png?screen=${m}&dev=${d.mac}" alt="${sc.name} 预览"></div></div>` : ""}
        <div>${editor}</div></div>${sync}</section>`;
  }));
  return {
    html: html`${modes.length > 1 ? html`<div class="row" style="margin:-6px 0 12px">${modes.map((m) => html`<a class="btn ghost" style="padding:4px 10px;font-size:13px" href="#c-${m}">${SCREENS[m].name}</a>`)}</div>` : ""}
      <p class="muted small" style="margin-top:0">这块屏播放列表里每个布局显示的内容，只属于这块屏${several ? "；需要多块屏显示同样的内容时，在卡片下方打开「多屏同步」" : ""}。
      要加别的布局，到<a href="/devices/${d.mac}">播放</a>或<a href="/modes">布局库</a>里添加。</p>
      <div class="stack">${cards}</div>`,
  };
}

/** The editor of one layout's content. In the screen's scope. */
function contentEditor(db: Db, d: Device, m: string, now: Date, back: string, city: { cityQuery: string; found: Place[]; searchError: string }) {
  const sc = SCREENS[m];
  if (m === "messages") {
    const msgs = messagesFor(db, d.mac).slice(0, 5);
    return html`${messageForm(db, back, (mac) => mac === d.mac, "写给这块屏…")}
      <div style="margin-top:10px">${msgs.length ? messageRows(db, msgs, now, back) : html`<p class="muted small">这块屏还没有留言。</p>`}</div>
      <p class="small" style="margin-bottom:0"><a href="/messages">全部留言 →</a></p>`;
  }
  if (m === "todo") {
    const cfg = getModeConfig(db, "todo", sc.config);
    const groups = parseTodo(cfg.list);
    const n = groups.reduce((k, g) => k + g.items.length, 0), done = groups.reduce((k, g) => k + g.items.filter((i) => i.done).length, 0);
    return html`<p style="margin:0 0 4px"><b>${cfg.title || "待办"}</b> · ${groups.length} 个分组，${n} 项（已完成 ${done}）</p>
      <p class="muted small" style="margin:0 0 12px">${groups.map((g) => g.name || "未分组").join("、") || "空"}</p>
      <a class="btn primary" href="/todo?dev=${d.mac}">编辑清单</a>`;
  }
  if (m === "photo") return photoEditor(db, d, back);
  if (m === "weather" || m === "datecard" || m === "dashboard") {
    const p = getPlace(db);
    const label = (x: Place) => [x.name, x.admin1, x.country].filter(Boolean).join("，");
    return html`<p style="margin-top:0">天气城市：<b>${p ? label(p) : "未设置"}</b></p>
      <form method="get" action="/devices/${d.mac}#c-${m}" class="row"><input type="hidden" name="tab" value="content">
        <input type="search" name="city" value="${city.cityQuery}" placeholder="城市名，如 上海、杭州"><button>搜索</button></form>
      ${city.cityQuery ? html`<div class="row" style="margin-top:8px">${city.found.length ? city.found.map((x) => html`<form method="post" action="/admin/place" class="inline">
          <input type="hidden" name="dev" value="${d.mac}"><input type="hidden" name="back" value="${back}"><input type="hidden" name="place" value="${JSON.stringify(x)}">
          <button>${label(x)}</button></form>`)
        : html`<p class="muted small">${city.searchError ? `搜索失败：${city.searchError}` : "没有找到，换个写法试试（如去掉“市”）。"}</p>`}</div>` : ""}
      <p class="muted small">天气来自 Open-Meteo，30 分钟更新一次。${m === "weather" ? "" : "日期牌、天气和看板共用这块屏的城市。"}</p>
      ${m === "dashboard" ? html`<p class="muted small" style="margin-bottom:0">看板右侧的留言、日程和待办，就是这块屏的<a href="/messages">留言</a>、<a href="#c-agenda">日程</a>和<a href="#c-todo">待办作业</a>内容（日程和待办在下方卡片里设置）。</p>` : ""}`;
  }
  const form = modeForm(db, m, now, { dev: d.mac, back });
  const actions = sc.actions?.length ? html`<div class="row" style="margin-top:12px">${sc.actions.map((a) => html`<form method="post" action="/admin/modes/${m}/action/${a.id}" class="inline">
    <input type="hidden" name="dev" value="${d.mac}"><input type="hidden" name="back" value="${back}"><button>${a.label}</button></form>`)}</div>` : "";
  return form || actions ? html`${form}${actions}` : html`<p class="muted small">这个布局不需要设置，按日期自动显示。</p>`;
}

/** The photo frame on this screen: which photos, in what order and style. In the screen's scope. */
function photoEditor(db: Db, d: Device, back: string) {
  const mac = d.mac, panel = panelOf(d);
  const photos = listPhotos(db);
  if (!photos.length) return html`<p class="muted small">相册里还没有照片。</p><a class="btn primary" href="/photos">上传照片</a>`;
  const pb = getPlayback(db);
  const sel = new Set(pb.photos ?? []);
  return html`<form method="post" action="/admin/photo-settings">
    <input type="hidden" name="dev" value="${mac}"><input type="hidden" name="back" value="${back}">
    <div class="row"><select name="style">${opts(pb.style, [["frame", "画框（留白 + 标题）"], ["full", "满屏"]])}</select>
      <select name="order">${opts(pb.mode, [["sequence", "顺序播放"], ["random", "随机播放"], ["fixed", "固定一张"]])}</select>
      <select name="interval">${opts(String(pb.intervalMin), INTERVALS.map((n): [string, string] => [String(n), `每 ${intervalName(n)}换一张`]))}</select>
      ${panel && panel.cornerRadius === 0 ? html`<label class="row small"><span class="muted">圆角</span><select name="corner">${opts(pb.corner, [["none", "直角"], ["s", "小"], ["m", "中"], ["l", "大"]])}</select></label>` : ""}</div>
    ${panel && panel.cornerRadius > 0 ? html`<p class="muted small" style="margin:6px 0 0">这块屏本身是圆角，照片的圆角跟随屏幕。</p>` : ""}
    <label class="field"><span>固定一张时显示</span><select name="current">${opts(String(pb.current ?? ""), [["", "（未选）"], ...photos.map((p): [string, string] => [String(p.id), p.title || `照片 ${p.id}`])])}</select></label>
    <label class="check"><input type="radio" name="sel" value="all" ${pb.photos ? "" : raw("checked")}> 播放相册里的全部照片（${photos.length} 张）</label>
    <label class="check" style="margin-top:6px"><input type="radio" name="sel" value="some" ${pb.photos ? raw("checked") : ""}> 只播放下面勾选的照片</label>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px;margin:10px 0 14px">${photos.map((p) => html`<label style="position:relative;cursor:pointer">
      <img src="/photos/${p.id}/source.png?thumb=1" loading="lazy" alt="${p.title}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;display:block">
      <input type="checkbox" name="pick" value="${p.id}" ${sel.has(p.id) ? raw("checked") : ""} style="position:absolute;top:6px;left:6px;width:18px;height:18px"
        onchange="this.form.sel.value='some'">
      <span class="small muted" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.title || `照片 ${p.id}`}</span></label>`)}</div>
    <div class="spread"><button class="primary">保存</button><a class="small" href="/photos">管理相册 →</a></div></form>`;
}

function deviceTab(db: Db, d: Device, s: DeviceSettings, now: Date): Tab {
  const panel = panelOf(d);
  const fontOpts: [string, string][] = panel && panel.height < 400
    ? [["wenkai", "霞鹜文楷（默认）"], ["sans", "思源黑体 Medium"], ["pixel", "点阵放大（文泉驿 ×2）"]]
    : [["wenkai", "霞鹜文楷（默认）"], ["sans", "思源黑体 Medium"]];
  return {
    html: html`<div class="cols">
      <form method="post" action="/admin/devices/${d.mac}/display" class="card"><h2>名称与显示</h2>
        <label class="field"><span>名称</span><input type="text" name="name" value="${s.name}" placeholder="例如 客厅、书房" maxlength="24">
          <small>不填时显示为"${deviceName(db, d, { ...s, name: "" })}"。</small></label>
        <label class="field"><span>大字字体</span><select name="font">${opts(s.font, fontOpts)}</select>
          <small>留言、诗词、倒数日等页面的大号中文。</small></label>
        <label class="check"><input type="checkbox" name="live" ${s.live ? raw("checked") : ""}> 实时模式（常亮不休眠，适合插 USB 电源时）</label>
        <div style="margin-top:14px"><button class="primary">保存</button></div></form>
      <div class="stack">
        <section class="card"><h2>电量与连接</h2>${batteryChart(telemetry(db, d.mac, new Date(now.getTime() - 7 * 86_400_000).toISOString()), now)}
          <dl class="kv" style="margin-top:8px"><dt>电量</dt><dd>${battery(d.battery_v)}${d.battery_v ? ` · ${d.battery_v.toFixed(2)} V` : ""}</dd>
          <dt>信号</dt><dd>${signal(d.rssi)}${d.rssi ? ` · ${d.rssi} dBm` : ""}</dd><dt>MAC 地址</dt><dd><code>${d.mac}</code>（${macTail(d.mac)}）</dd>
          <dt>屏幕</dt><dd>${panel?.name ?? "—"}</dd><dt>请求次数</dt><dd>${d.requests}</dd><dt>上次启动</dt><dd class="small">${d.boot ?? "—"}</dd></dl></section>
        <section class="card"><h2>解绑</h2><p class="muted small" style="margin-top:-6px">解绑后这块屏会显示新的配对码，可以重新绑定到任何账号；它的播放设置和内容会清除。</p>
          <form method="post" action="/admin/devices/${d.mac}/delete" onsubmit="return confirm('解绑这块屏？')"><button>解绑设备</button></form></section>
      </div></div>`,
  };
}
