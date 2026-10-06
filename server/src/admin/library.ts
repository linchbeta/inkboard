// 相册 (the user's photo library; each screen picks its photos in its 内容), 留言 (to
// any screens) and 设置 (account, users, holidays, test date) pages and their handlers.
import type { Hono } from "hono";
import { html, raw } from "hono/html";
import { type Db, type Device, getSetting, setSetting, listDevices, getOwnDevice } from "../db.js";
import {
  listPhotos, addPhoto, deletePhoto, getPlayback, setPlayback, MAX_PHOTO_BYTES, intervalName,
  type PhotoStyle, type PhotoMode, type Playback,
} from "../data/photos.js";
import { listMessages, messagesFor, addMessage, deleteMessage } from "../data/messages.js";
import { getSettings, saveSettings, pinUntil } from "../data/devices.js";
import { asDevice, syncGroup } from "../data/content.js";
import { setPlace, type Place } from "../data/weather.js";
import { loadedHolidayYears } from "../data/calendar.js";
import { deviceName, formList, safeBack, withFlash } from "./common.js";
import { messageRows, messageForm } from "./devices.js";
import { page, ago, icon } from "./layout.js";
import { userOf, listUsers } from "./auth.js";

const UPLOAD_JS = `
document.getElementById('upload').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target, status = document.getElementById('upload-status');
  const files = [...form.file.files];
  for (const [i, file] of files.entries()) {
    status.textContent = '处理中 ' + (i + 1) + '/' + files.length + '…';
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      const g = cv.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, 0, 0, cv.width, cv.height);
      const png = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
      const fd = new FormData();
      fd.append('file', png, 'photo.png');
      fd.append('title', form.title.value || (files.length > 1 ? file.name.replace(/[.][^.]+$/, '') : ''));
      const r = await fetch('/admin/photos', { method: 'POST', body: fd });
      if (!r.ok) throw new Error((await r.json()).error || r.status);
    } catch (e) {
      status.textContent = file.name + ' 上传失败：' + e.message;
      return;
    }
  }
  location.reload();
});`;

export function libraryRoutes(app: Hono, db: Db, now: () => Date): void {
  const screen = (v: unknown) => getOwnDevice(db, String(v ?? ""));

  // ── 相册 ──
  app.get("/photos", (c) => {
    const photos = listPhotos(db);
    // the screens showing photos, and what each plays
    const frames = listDevices(db).filter((d) => { const s = getSettings(db, d); return s.pin?.mode === "photo" || s.playlist.some((i) => i.mode === "photo"); }).map((d) => {
      const p = asDevice(d.mac, () => getPlayback(db));
      const pool = p.mode === "fixed" && p.current ? [p.current] : p.photos ?? photos.map((x) => x.id);
      return { d, p, pool, synced: syncGroup(db, d.mac, "photo").length > 1 };
    });
    const describe = (p: ReturnType<typeof getPlayback>) => p.mode === "fixed" ? "固定一张"
      : `${p.mode === "random" ? "随机" : "顺序"}播放${p.photos ? `选中的 ${p.photos.length} 张` : "全部照片"}，每 ${intervalName(p.intervalMin)}换一张，${p.style === "full" ? "满屏" : "画框"}`;
    return c.html(page(c, {
      title: "相册", nav: "photos",
      body: html`<div class="head"><div><h1>相册</h1><p class="sub">${photos.length ? `${photos.length} 张照片。` : "还没有照片。"}每块屏播放哪些照片、怎么播放，在那块屏的"内容 → 相框"里设置。</p></div></div>
      <div class="cols">
      <section class="card">
        <h2>上传照片</h2><p class="muted small" style="margin-top:-6px">照片在浏览器里缩小后上传，服务器按每块屏的颜色做抖动。</p>
        <form id="upload" class="row"><input type="file" name="file" accept="image/*" multiple required>
          <input type="text" name="title" placeholder="标题（可选）" maxlength="40"><button class="primary">上传</button><span id="upload-status" class="muted"></span></form>
      </section>
      <section class="card"><h2>各屏播放</h2>
        ${frames.length ? html`<div>${frames.map((f) => html`<div class="msg"><div class="body"><b>${deviceName(db, f.d)}</b>${f.synced ? html` <span class="pill acc">多屏同步</span>` : ""}
            <div class="meta">${describe(f.p)}</div></div><a class="btn" href="/devices/${f.d.mac}?tab=content#c-photo">设置</a></div>`)}</div>`
          : html`<p class="muted small">还没有屏在播放照片。到<a href="/modes#photo">布局库</a>里把"相框"加入某块屏的播放列表。</p>`}
      </section></div>
      <div class="grid" style="margin-top:18px">${photos.map((p) => {
        const on = frames.filter((f) => f.pool.includes(p.id));
        return html`<section class="card">
        <a href="/photos/${p.id}/edit" class="screen" style="display:block"><img class="preview" loading="lazy" src="/preview/se0398.png?screen=photo&photo=${p.id}" alt="${p.title}"></a>
        <div class="spread" style="margin-top:12px"><b>${p.title || "（无标题）"}</b><span class="muted small">${p.width}×${p.height}</span></div>
        <p class="small muted" style="margin:4px 0 0">${on.length ? `在 ${on.map((f) => deviceName(db, f.d)).join("、")} 播放` : "没有屏在播放"}</p>
        <div class="row" style="margin-top:8px"><a class="btn" href="/photos/${p.id}/edit">编辑</a>
          <form method="post" action="/admin/photos/${p.id}/delete" class="inline" onsubmit="return confirm('删除这张照片？')"><button class="link">删除</button></form></div>
      </section>`;
      })}</div>`,
      script: UPLOAD_JS,
    }));
  });

  app.post("/admin/photos", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "没有文件" }, 400);
    if (file.size > MAX_PHOTO_BYTES) return c.json({ error: "图片太大" }, 413);
    try {
      const p = addPhoto(db, new Uint8Array(await file.arrayBuffer()), String(body.title ?? "").trim());
      return c.json({ id: p.id });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });
  app.post("/admin/photos/:id/delete", (c) => { deletePhoto(db, Number(c.req.param("id"))); return c.redirect("/photos"); });

  // a screen's photo frame (and the screens synced with it)
  app.post("/admin/photo-settings", async (c) => {
    const b = await c.req.parseBody({ all: true });
    const one = (k: string) => formList(b, k)[0] ?? "";
    const d = screen(one("dev"));
    if (!d) return c.notFound();
    asDevice(d.mac, () => setPlayback(db, {
      style: one("style") as PhotoStyle, mode: one("order") as PhotoMode, intervalMin: Number(one("interval")),
      corner: (one("corner") || undefined) as Playback["corner"] | undefined,
      current: Number(one("current")) || 0, photos: one("sel") === "some" ? formList(b, "pick").map(Number) : undefined,
    }));
    return c.redirect(withFlash(safeBack(one("back"), `/devices/${d.mac}?tab=content#c-photo`), "已保存，屏幕下次刷新时更新"));
  });

  // ── 留言 ──
  app.get("/messages", (c) => {
    const t = now();
    const devices = listDevices(db);
    const only = devices.find((d) => d.mac === c.req.query("to"));
    const msgs = only ? messagesFor(db, only.mac) : listMessages(db);
    const chip = (href: string, label: string, on: boolean) => html`<a href="${href}" class="btn ${on ? "primary" : "ghost"}" style="padding:5px 12px;font-size:13px">${label}</a>`;
    const back = only ? `/messages?to=${encodeURIComponent(only.mac)}` : "/messages";
    return c.html(page(c, {
      title: "留言", nav: "messages",
      body: html`<div class="head"><div><h1>留言</h1><p class="sub">留言发给勾选的屏；每块屏的"留言板"大字显示发给它的最新一条。</p></div></div>
      <div class="stack" style="max-width:760px">
      <section class="card">${messageForm(db, back, (m) => !only || m === only.mac, "写一句话给家人…")}</section>
      ${devices.length > 1 ? html`<div class="row">${chip("/messages", "全部", !only)}${devices.map((d) => chip(`/messages?to=${encodeURIComponent(d.mac)}`, `${deviceName(db, d)} 的留言`, only?.mac === d.mac))}</div>` : ""}
      <section class="card">${msgs.length ? messageRows(db, msgs, t, back)
        : html`<div class="empty">${icon("messages", 32)}还没有留言</div>`}</section></div>`,
    }));
  });
  app.post("/admin/messages", async (c) => {
    const b = await c.req.parseBody({ all: true });
    const one = (k: string) => formList(b, k)[0] ?? "";
    const all = listDevices(db);
    const to = formList(b, "to").map(screen).filter((d): d is Device => !!d);
    if (one("targets") && !to.length) return c.redirect(withFlash(safeBack(one("back"), "/messages"), "请至少选择一块屏"));
    // every screen ticked: to all (also screens added later)
    const m = addMessage(db, one("from"), one("text"), now(), to.length && to.length < all.length ? to.map((d) => d.mac) : undefined);
    if (m && b.push) {
      for (const d of to.length ? to : all) saveSettings(db, d.mac, { ...getSettings(db, d), pin: { mode: "messages", ...pinUntil("3h", now()) } });
    }
    const msg = !m ? "留言是空的" : b.push ? "已发布，屏幕下次刷新时显示" : "已发布";
    return c.redirect(withFlash(safeBack(one("back"), "/messages"), msg));
  });
  app.post("/admin/messages/:id/delete", async (c) => {
    deleteMessage(db, Number(c.req.param("id")));
    return c.redirect(safeBack((await c.req.parseBody()).back, "/messages"));
  });

  // a screen's weather city (日期牌 / 天气)
  app.post("/admin/place", async (c) => {
    const b = await c.req.parseBody();
    const d = screen(b.dev);
    if (!d) return c.notFound();
    const rawv = String(b.place ?? "");
    let place: Place | undefined;
    try {
      const p = rawv ? (JSON.parse(rawv) as Place) : undefined;
      if (p && typeof p.name === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lon) && typeof p.timezone === "string") {
        place = { name: p.name, admin1: p.admin1, country: p.country, lat: p.lat, lon: p.lon, timezone: p.timezone };
      }
    } catch { /* ignore malformed input */ }
    if (place || !rawv) asDevice(d.mac, () => setPlace(db, place));
    return c.redirect(withFlash(safeBack(b.back, `/devices/${d.mac}?tab=content`), place ? `城市已设为 ${place.name}` : "已清除城市"));
  });

  // ── 设置 ──
  app.get("/settings", (c) => {
    const t = now();
    const testDate = getSetting(db, "test_date", "");
    const presets: [string, string][] = [["2026-02-16", "2/16 除夕"], ["2026-02-28", "2/28 班"], ["2026-10-01", "10/1 国庆"],
      ["2026-10-18", "10/18 重阳"], ["2026-12-31", "12/31"]];
    const years = loadedHolidayYears().sort();
    const synced = getSetting(db, "holidays:synced", "");
    const me = userOf(c);
    const users = me.admin ? listUsers(db) : [];
    return c.html(page(c, {
      title: "设置", nav: "settings",
      body: html`<div class="head"><div><h1>设置</h1><p class="sub">账号和系统设置。每块屏显示什么，在概览里进入那块屏设置。</p></div></div>
      <div class="cols"><div class="stack">
      <section class="card" id="account"><h2>我的账号</h2>
        <p class="muted small" style="margin-top:-6px">${me.name} · ${me.admin ? "管理员" : "成员"}</p>
        <form method="post" action="/admin/account/password">
          <label class="field"><span>原密码</span><input type="password" name="old" required autocomplete="current-password"></label>
          <label class="field"><span>新密码（至少 6 位）</span><input type="password" name="password" required minlength="6" autocomplete="new-password"></label>
          <button>修改密码</button></form>
        <form method="post" action="/logout" style="margin-top:12px"><button class="ghost">${icon("logout", 16)}退出登录</button></form></section>
      ${me.admin ? html`<section class="card" id="users"><h2>用户</h2>
        <p class="muted small" style="margin-top:-6px">每个用户有自己的屏、照片和留言，互相看不到。新屏用配对码绑定到自己的账号。</p>
        <table>${users.map((u) => html`<tr><td><b>${u.name}</b>${u.admin ? html` <span class="pill acc">管理员</span>` : ""}${u.id === me.id ? html` <span class="muted small">（我）</span>` : ""}</td>
          <td style="text-align:right">${u.id === me.id ? "" : html`<details style="display:inline-block;text-align:left"><summary class="small">管理</summary>
            <form method="post" action="/admin/users/${u.id}/password" class="row" style="margin-top:8px"><input type="password" name="password" placeholder="新密码" minlength="6" required autocomplete="new-password" style="width:130px"><button>重置密码</button></form>
            <form method="post" action="/admin/users/${u.id}/delete" onsubmit="return confirm('删除这个用户？它的照片和设置会删除，它的屏需要重新配对。')" style="margin-top:8px"><button>删除用户</button></form></details>`}</td></tr>`)}</table>
        <form method="post" action="/admin/users" class="row" style="margin-top:14px">
          <input type="text" name="name" placeholder="用户名" required maxlength="24" style="width:130px" autocomplete="off">
          <input type="password" name="password" placeholder="初始密码" required minlength="6" style="width:130px" autocomplete="new-password">
          <button class="primary">${icon("plus", 16)}添加用户</button></form></section>` : ""}
      </div><div class="stack">
      <section class="card"><h2>节假日数据</h2>
        <p>已有放假安排：${years.length ? years.join("、") : "无"} 年。<span class="muted small">每天自动从 holiday-cn 检查新公布的安排${synced ? `，上次检查 ${ago(synced, t)}` : ""}。</span></p></section>
      <section class="card"><h2>测试日期</h2>
        <p>${testDate ? html`当前按 <b>${testDate}</b> 当作"今天"显示（只用于测试）。` : "当前使用真实日期。"}</p>
        <div class="row">${presets.map(([d, name]) => html`<form method="post" action="/admin/test-date" class="inline"><input type="hidden" name="date" value="${d}"><button ${d === testDate ? raw("disabled") : ""}>${name}</button></form>`)}
          <form method="post" action="/admin/test-date" class="row"><input type="date" name="date" value="${testDate}"><button>设置</button></form>
          <form method="post" action="/admin/test-date" class="inline"><input type="hidden" name="date" value=""><button ${testDate ? "" : raw("disabled")}>恢复真实日期</button></form></div></section>
      <section class="card"><h2>关于</h2><dl class="kv">
        <dt>服务器时间</dt><dd>${new Date().toLocaleString("zh-CN")}</dd>
        <dt>我的屏</dt><dd>${listDevices(db).length} 块</dd>
        <dt>服务器地址</dt><dd><code>http://${c.req.header("host") ?? "本机IP:8080"}</code><br><span class="muted small">填在墨水屏配网页的服务器地址里</span></dd></dl></section>
      </div></div>`,
    }));
  });
  app.post("/admin/test-date", async (c) => {
    const v = String((await c.req.parseBody()).date ?? "");
    setSetting(db, "test_date", /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
    return c.redirect("/settings");
  });
}
