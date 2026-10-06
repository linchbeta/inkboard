// 待办: the checklist editor. Screen title, groups (e.g. each child) with their names, items
// (tick, edit, reorder, delete) — no markdown needed. Every change saves itself; the
// e-paper picks it up on its next refresh. Stored as the todo mode's text, see todo.ts.
// Each screen has its own list (?dev=<mac>); synced screens share one (see content.ts).
import type { Hono } from "hono";
import { html, raw } from "hono/html";
import { type Db, listDevices, getOwnDevice } from "../db.js";
import { asDevice, syncGroup } from "../data/content.js";
import { deviceName } from "./common.js";
import { getModeConfig, setModeConfig } from "../data/modeConfig.js";
import { SCREENS } from "../frames.js";
import { parseTodo, serializeTodo, type TodoGroup } from "../screens/todo.js";
import { panelOf } from "../deviceFrame.js";
import { getSettings } from "../data/devices.js";
import { page, icon } from "./layout.js";

const MAX_GROUPS = 20, MAX_ITEMS = 60;

/** Untrusted JSON from the editor → groups. */
export function cleanTodo(v: unknown): TodoGroup[] {
  if (!Array.isArray(v)) return [];
  const str = (x: unknown, n: number) => (typeof x === "string" ? x.replace(/[\r\n]+/g, " ").trim().slice(0, n) : "");
  return v.slice(0, MAX_GROUPS).map((g) => {
    const o = (g ?? {}) as { name?: unknown; items?: unknown };
    const items = Array.isArray(o.items) ? o.items : [];
    return {
      // a "## " or "- [" prefix would change the meaning of the stored text
      name: str(o.name, 30).replace(/^#+\s*|^【|】$/g, ""),
      items: items.slice(0, MAX_ITEMS).map((i) => {
        const it = (i ?? {}) as { text?: unknown; done?: unknown };
        return { text: str(it.text, 100).replace(/^#+\s*/, ""), done: it.done === true };
      }).filter((i) => i.text),
    };
  }).filter((g) => g.name || g.items.length);
}

const EDITOR_JS = `
const state = JSON.parse(document.getElementById('data').textContent);
const root = document.getElementById('groups'), status = document.getElementById('status');
const prev = document.getElementById('prev');
let timer, seq = 0;
function save(now) {
  clearTimeout(timer);
  status.textContent = '编辑中…';
  timer = setTimeout(async () => {
    const my = ++seq;
    status.textContent = '保存中…';
    try {
      const r = await fetch('/admin/todo', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dev: root.dataset.dev || undefined, title: document.getElementById('title').value, groups: state }) });
      if (!r.ok) throw new Error(r.status);
      if (my === seq) { status.textContent = '已保存'; if (prev) prev.src = prev.dataset.src + '&t=' + Date.now(); }
    } catch (e) { status.textContent = '保存失败，请检查网络'; }
  }, now ? 0 : 600);
}
const el = (tag, cls, props) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, props || {});
function iconBtn(label, title, fn) { const b = el('button', 'link', { type: 'button', textContent: label, title }); b.onclick = fn; return b; }
function render(focus) {
  root.textContent = '';
  state.forEach((g, gi) => {
    const card = el('section', 'card tgroup');
    const head = el('div', 'thead');
    const name = el('input', 'gname', { type: 'text', value: g.name, placeholder: '分组名称（如 小明、家务，可空）', maxLength: 30 });
    name.oninput = () => { g.name = name.value; save(); };
    const done = g.items.filter((i) => i.done).length;
    head.append(name, el('span', 'muted small', { textContent: g.items.length ? done + '/' + g.items.length : '' }),
      iconBtn('↑', '上移分组', () => { if (gi) { state.splice(gi - 1, 0, state.splice(gi, 1)[0]); render(); save(true); } }),
      iconBtn('↓', '下移分组', () => { if (gi < state.length - 1) { state.splice(gi + 1, 0, state.splice(gi, 1)[0]); render(); save(true); } }),
      iconBtn('✕', '删除分组', () => { if (!g.items.length || confirm('删除分组「' + (g.name || '未命名') + '」和其中 ' + g.items.length + ' 项？')) { state.splice(gi, 1); render(); save(true); } }));
    card.append(head);
    const list = el('ul', 'titems');
    g.items.forEach((it, ii) => {
      const li = el('li', it.done ? 'done' : '');
      const box = el('button', 'tbox', { type: 'button', title: it.done ? '标为未完成' : '标为完成', innerHTML: it.done ? '&#10003;' : '' });
      box.onclick = () => { it.done = !it.done; render(); save(true); };
      const text = el('input', 'ttext', { type: 'text', value: it.text, maxLength: 100 });
      text.oninput = () => { it.text = text.value; save(); };
      text.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); g.items.splice(ii + 1, 0, { text: '', done: false }); render([gi, ii + 1]); }
        else if (e.key === 'Backspace' && !text.value) { e.preventDefault(); g.items.splice(ii, 1); render(ii ? [gi, ii - 1] : null); save(true); }
      };
      text.onblur = () => { if (!it.text.trim() && g.items.includes(it)) { g.items.splice(g.items.indexOf(it), 1); render(); save(true); } };
      li.append(box, text,
        iconBtn('↑', '上移', () => { if (ii) { g.items.splice(ii - 1, 0, g.items.splice(ii, 1)[0]); render([gi, ii - 1]); save(true); } }),
        iconBtn('↓', '下移', () => { if (ii < g.items.length - 1) { g.items.splice(ii + 1, 0, g.items.splice(ii, 1)[0]); render([gi, ii + 1]); save(true); } }),
        iconBtn('✕', '删除', () => { g.items.splice(ii, 1); render(); save(true); }));
      list.append(li);
      if (focus && focus[0] === gi && focus[1] === ii) setTimeout(() => text.focus());
    });
    card.append(list);
    const add = el('form', 'tadd');
    const input = el('input', '', { type: 'text', placeholder: '添加一项，回车确认', maxLength: 100 });
    add.append(input, el('button', '', { textContent: '添加' }));
    add.onsubmit = (e) => { e.preventDefault(); const v = input.value.trim(); if (!v) return; g.items.push({ text: v, done: false }); render([gi, 'add']); save(true); };
    card.append(add);
    root.append(card);
    if (focus && focus[0] === gi && focus[1] === 'add') setTimeout(() => input.focus());
  });
  if (!state.length) root.append(el('div', 'card empty', { textContent: '还没有清单，先添加一个分组吧。' }));
}
document.getElementById('title').oninput = () => save();
document.getElementById('addgroup').onclick = () => { state.push({ name: '', items: [] }); render(); root.lastChild.querySelector('.gname').focus(); };
document.getElementById('cleardone').onclick = () => {
  const n = state.reduce((s, g) => s + g.items.filter((i) => i.done).length, 0);
  if (!n || !confirm('删除 ' + n + ' 个已完成的项目？')) return;
  state.forEach((g) => { g.items = g.items.filter((i) => !i.done); }); render(); save(true);
};
document.getElementById('resetdone').onclick = () => { state.forEach((g) => g.items.forEach((i) => { i.done = false; })); render(); save(true); };
render();`;

const CSS = `
  .tgroup { padding:14px 16px }
  .thead { display:flex; align-items:center; gap:6px }
  .gname { flex:1; min-width:0; font-weight:600; font-size:16px !important; border-color:transparent !important; background:transparent !important; padding:6px 8px !important }
  .gname:hover, .gname:focus { border-color:var(--line) !important; background:var(--bg) !important }
  .titems { list-style:none; margin:6px 0 0; padding:0 }
  .titems li { display:flex; align-items:center; gap:4px; border-top:1px solid var(--line); padding:4px 0 }
  .titems li .link { opacity:0; transition:opacity .12s } .titems li:hover .link, .titems li:focus-within .link { opacity:1 }
  @media (hover:none) { .titems li .link { opacity:.6 } }
  .tbox { all:unset; cursor:pointer; width:22px; height:22px; border:2px solid var(--fg2); border-radius:6px; flex:none; display:grid; place-items:center; font-size:14px; margin:0 6px 0 4px }
  .done .tbox { background:var(--acc); border-color:var(--acc); color:#fff }
  .ttext { flex:1; min-width:0; border-color:transparent !important; background:transparent !important; padding:8px 6px !important; font-size:15px !important }
  .ttext:focus { border-color:var(--line) !important; background:var(--bg) !important }
  .done .ttext { text-decoration:line-through; color:var(--mute) }
  .tadd { display:flex; gap:8px; margin-top:8px } .tadd input { flex:1; min-width:0 }
`;

export function todoRoutes(app: Hono, db: Db): void {
  const fields = () => SCREENS.todo.config!;
  const load = () => getModeConfig(db, "todo", fields());

  // a screen's list (and the screens synced with it)
  app.post("/admin/todo", async (c) => {
    let body: { dev?: unknown; title?: unknown; groups?: unknown };
    try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
    const d = getOwnDevice(db, String(body.dev ?? ""));
    if (!d) return c.json({ error: "no such screen" }, 404);
    asDevice(d.mac, () => {
      const title = typeof body.title === "string" ? body.title.trim().slice(0, 12) : load().title;
      setModeConfig(db, "todo", fields(), { title, list: serializeTodo(cleanTodo(body.groups)) });
    });
    return c.json({ ok: true });
  });

  app.get("/todo", (c) => {
    const devices = listDevices(db);
    const playing = (mac: string) => devices.some((d) => d.mac === mac && getSettings(db, d).playlist.some((i) => i.mode === "todo"));
    // the screen asked for, else the first one showing a todo list, else the first one
    const dev = (c.req.query("dev") ? getOwnDevice(db, c.req.query("dev")!) : undefined)
      ?? devices.find((d) => playing(d.mac)) ?? devices[0];
    const chip = (href: string, label: string, on: boolean) => html`<a href="${href}" class="btn ${on ? "primary" : "ghost"}" style="padding:5px 12px;font-size:13px">${label}</a>`;
    if (!dev) {
      return c.html(page(c, { title: "待办", nav: "todo",
        body: html`<div class="head"><div><h1>待办</h1></div></div><div class="card empty">每块屏有自己的待办清单。先在概览里添加一块屏。</div>` }));
    }
    const cfg = asDevice(dev.mac, load);
    const groups = parseTodo(cfg.list);
    const synced = syncGroup(db, dev.mac, "todo").slice(1).map((m) => devices.find((d) => d.mac === m)).filter((d) => !!d);
    const panel = panelOf(dev)?.id ?? "se0398";
    const src = `/preview/${panel}.png?screen=todo&dev=${dev.mac}`;
    return c.html(page(c, {
      title: "待办", nav: "todo",
      body: html`<style>${raw(CSS)}</style>
      <div class="head"><div><h1>待办</h1><p class="sub">正在编辑「${deviceName(db, dev)}」的清单${synced.length ? `（与 ${synced.map((d) => deviceName(db, d!)).join("、")} 同步，会一起更新）` : ""}。改动自动保存，屏幕下次刷新时更新。</p></div>
        <span class="pill" id="status">已保存</span></div>
      ${devices.length > 1 ? html`<div class="row" style="margin-bottom:16px">${devices.map((d) => chip(`/todo?dev=${encodeURIComponent(d.mac)}`, deviceName(db, d), d.mac === dev.mac))}</div>` : ""}
      ${playing(dev.mac) ? "" : html`<div class="flash">这块屏的播放列表里还没有"待办作业"，<a href="/devices/${dev.mac}">到播放里添加</a>后才会显示。</div>`}
      <div class="cols">
        <div class="stack">
          <section class="card"><label class="field" style="margin:0"><span>屏幕标题</span>
            <input type="text" id="title" value="${cfg.title}" placeholder="待办" maxlength="12"></label></section>
          <div id="groups" class="stack" data-dev="${dev.mac}"></div>
          <div class="row"><button type="button" class="primary" id="addgroup">${icon("plus", 16)}添加分组</button>
            <button type="button" id="resetdone">全部标为未完成</button>
            <button type="button" id="cleardone">清除已完成</button></div>
        </div>
        <section class="card"><h2>屏幕预览</h2>
          <div class="screen"><img class="preview" id="prev" data-src="${src}" src="${src}" alt="待办预览"></div>
          <p class="muted small" style="margin-bottom:0">提示：在事项里按回车新增下一项，清空后按退格删除。几块屏要显示同一份清单时，在屏幕的"内容 → 待办作业 → 多屏同步"里设置。</p></section>
      </div>
      <script type="application/json" id="data">${raw(JSON.stringify(groups).replace(/</g, "\\u003c"))}</script>`,
      script: EDITOR_JS,
    }));
  });
}
