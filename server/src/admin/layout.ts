// The admin pages' shell: sidebar (desktop) / bottom tab bar (phone), shared styles
// (light / dark), icons, flash messages, helpers.
import type { Context } from "hono";
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { User } from "../data/users.js";

export type NavId = "home" | "modes" | "photos" | "messages" | "todo" | "settings" | "";
type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

// 24x24 stroke icons
const ICON: Record<string, string> = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1z"/>',
  modes: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  photos: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9.5" r="1.8"/><path d="m4 18 5.5-5.5 4 4 2.5-2.5L21 19"/>',
  messages: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z"/><path d="M8 10h8M8 13h5"/>',
  todo: '<rect x="3" y="4" width="5" height="5" rx="1"/><path d="m4.3 6.5 1.2 1.2L7.4 5.5M11 6.5h10M11 15.5h10"/><rect x="3" y="13" width="5" height="5" rx="1"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l4-4-4-4M14 12H4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
};
export const icon = (name: string, size = 20) =>
  raw(`<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] ?? ""}</svg>`);

const NAV: [NavId, string, string][] = [
  // by how often they are used; the phone tab bar shows the first five
  ["home", "/", "概览"], ["messages", "/messages", "留言"], ["todo", "/todo", "待办"],
  ["photos", "/photos", "相册"], ["modes", "/modes", "布局"], ["settings", "/settings", "设置"],
];

export const CSS = `
  :root { color-scheme: light dark;
    --fg:#1c1c1e; --fg2:#3a3a3c; --mute:#8a8a8e; --bg:#f4f3ef; --card:#ffffff; --line:#e7e5df; --soft:#f0eee8;
    --acc:#c0392b; --acc2:#a93226; --acc-bg:#c0392b12; --ok:#2e7d32; --ok-bg:#2e7d3214; --warn:#b26a00; --warn-bg:#b26a0014;
    --shadow:0 1px 2px #0000000a, 0 4px 16px #0000000a; --radius:14px; --side:228px }
  @media (prefers-color-scheme: dark) { :root {
    --fg:#f2f2f0; --fg2:#d6d6d2; --mute:#8e8e93; --bg:#111113; --card:#1c1c1f; --line:#2c2c30; --soft:#232327;
    --acc-bg:#c0392b2a; --ok-bg:#2e7d322a; --warn-bg:#b26a002a; --shadow:0 1px 2px #0006, 0 4px 18px #0005 } }
  * { box-sizing:border-box }
  html { -webkit-text-size-adjust:100% }
  body { margin:0; font:15px/1.6 "Inter","PingFang SC","Microsoft YaHei",system-ui,-apple-system,sans-serif; color:var(--fg); background:var(--bg); -webkit-font-smoothing:antialiased }
  a { color:inherit } img { max-width:100% } .ico { flex:none; display:block }
  /* long names, e-mail addresses and links must wrap, never widen the page (phones) */
  body { overflow-wrap:anywhere } .head > *, .spread > *, .row > * { min-width:0 } code { word-break:break-all }
  /* shell */
  .side { position:fixed; inset:0 auto 0 0; width:var(--side); background:var(--card); border-right:1px solid var(--line); display:flex; flex-direction:column; padding:18px 12px; z-index:10 }
  .brand { display:flex; align-items:center; gap:10px; font-weight:700; font-size:18px; letter-spacing:.2px; padding:4px 10px 18px }
  .brand b { color:var(--acc) } .brand .logo { width:26px; height:26px; border-radius:8px; background:linear-gradient(135deg,var(--acc),#e8a33d); box-shadow:inset 0 0 0 4px #ffffff55 }
  .brand.big { font-size:24px; justify-content:center; padding-bottom:22px } .brand.big .logo { width:32px; height:32px }
  .side nav { display:flex; flex-direction:column; gap:2px }
  .side nav a { display:flex; align-items:center; gap:12px; padding:9px 12px; border-radius:10px; text-decoration:none; color:var(--fg2) }
  .side nav a:hover { background:var(--soft) }
  .side nav a.on { background:var(--acc-bg); color:var(--acc); font-weight:600 }
  .side .me { margin-top:auto; display:flex; align-items:center; gap:10px; padding:10px; border-top:1px solid var(--line) }
  .avatar { width:32px; height:32px; border-radius:50%; background:var(--soft); display:grid; place-items:center; font-weight:600; color:var(--fg2); flex:none }
  .me .who { flex:1; min-width:0; font-size:14px; line-height:1.3 } .me .who small { color:var(--mute); display:block }
  .topbar, .tabbar { display:none }
  main { margin-left:var(--side); padding:28px 32px 64px; max-width:calc(1180px + var(--side)) }
  @media (max-width: 860px) {
    .side { display:none }
    main { margin:0; padding:16px 16px 92px }
    .topbar { display:flex; position:sticky; top:0; z-index:10; align-items:center; justify-content:space-between; padding:10px 16px; background:color-mix(in srgb, var(--card) 88%, transparent); backdrop-filter:blur(10px); border-bottom:1px solid var(--line) }
    .topbar .brand { padding:0; font-size:17px }
    .tabbar { display:grid; grid-template-columns:repeat(5,1fr); position:fixed; inset:auto 0 0 0; z-index:10; background:color-mix(in srgb, var(--card) 92%, transparent); backdrop-filter:blur(10px); border-top:1px solid var(--line); padding:6px 4px calc(6px + env(safe-area-inset-bottom)) }
    .tabbar a { display:flex; flex-direction:column; align-items:center; gap:2px; font-size:11px; text-decoration:none; color:var(--mute); padding:4px 0 }
    .tabbar a.on { color:var(--acc) }
  }
  /* page parts */
  .head { display:flex; justify-content:space-between; align-items:flex-end; gap:12px; flex-wrap:wrap; margin-bottom:20px }
  h1 { font-size:26px; line-height:1.25; margin:0; letter-spacing:-.2px } h2 { font-size:17px; margin:0 0 12px } h3 { font-size:15px; margin:0 0 8px }
  .sub { color:var(--mute); margin:4px 0 0; font-size:14px }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 330px), 1fr)); gap:18px; align-items:start }
  .cols { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:18px; align-items:start } @media (max-width: 1100px) { .cols { grid-template-columns:minmax(0,1fr) } }
  .cols > *, .grid > *, .stack > * { min-width:0 }
  .stack > * + * { margin-top:18px }
  .card { background:var(--card); border:1px solid var(--line); border-radius:var(--radius); padding:18px; box-shadow:var(--shadow) }
  a.card { display:block; text-decoration:none; transition:transform .12s, box-shadow .12s } a.card:hover { transform:translateY(-2px); box-shadow:0 2px 4px #0000000d, 0 10px 28px #00000014 }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center }
  .spread { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap }
  .muted { color:var(--mute) } .small { font-size:13px }
  .pill { display:inline-flex; align-items:center; gap:5px; padding:2px 10px; border-radius:99px; font-size:12px; font-weight:500; background:var(--soft); color:var(--fg2); white-space:nowrap }
  .pill::before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor; opacity:.8 }
  .pill.ok { background:var(--ok-bg); color:var(--ok) } .pill.warn { background:var(--warn-bg); color:var(--warn) } .pill.acc { background:var(--acc-bg); color:var(--acc) }
  button, .btn { font:inherit; font-size:14px; font-weight:500; padding:8px 16px; border-radius:10px; border:1px solid var(--line); background:var(--card); color:var(--fg); cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; gap:6px; transition:background .12s, border-color .12s }
  button:hover, .btn:hover { background:var(--soft) }
  button.primary, .btn.primary { background:var(--acc); border-color:var(--acc); color:#fff } button.primary:hover, .btn.primary:hover { background:var(--acc2) }
  button.wide { width:100%; justify-content:center; padding:10px }
  button.ghost, .btn.ghost { border-color:transparent; background:transparent; color:var(--fg2) } button.ghost:hover { background:var(--soft) }
  button.link { border:0; background:none; padding:4px 6px; color:var(--mute) } button.link:hover { color:var(--acc) }
  button:disabled { opacity:.5; cursor:default }
  form.inline { display:inline }
  input[type=text], input[type=password], input[type=search], input[type=date], input[type=time], input[type=number], select, textarea {
    font:inherit; font-size:14px; padding:8px 11px; border-radius:10px; border:1px solid var(--line); background:var(--bg); color:var(--fg); max-width:100%; outline:none; transition:border-color .12s, box-shadow .12s }
  input:focus, select:focus, textarea:focus { border-color:var(--acc); box-shadow:0 0 0 3px var(--acc-bg) }
  input[type=time] { width:7.4em; padding:7px 8px }
  /* playlist: one small card per layout; the time window and days fold away under a summary */
  .pl-list { display:grid; gap:8px; counter-reset:pl }
  .pl-item { border:1px solid var(--line); border-radius:12px; padding:8px 8px 6px 10px; background:var(--bg); counter-increment:pl }
  .pl-top { display:flex; align-items:center; gap:8px }
  .pl-top::before { content:counter(pl); flex:none; width:22px; height:22px; border-radius:50%; background:var(--soft); color:var(--fg2); font-size:12px; font-weight:600; display:grid; place-items:center }
  .pl-mode { flex:1; min-width:0; background:var(--card) }
  .pl-acts { display:flex; flex:none } .pl-acts button.link { padding:6px 5px; display:grid; place-items:center }
  .pl-acts button.link[data-act=del]:hover { color:#c0392b }
  .pl-when summary { list-style:none; cursor:pointer; display:inline-flex; align-items:center; gap:5px; margin:6px 0 0 30px; padding:2px 8px; border-radius:99px; font-size:12px; color:var(--mute) }
  .pl-when summary::-webkit-details-marker { display:none }
  .pl-when summary:hover, .pl-when[open] summary { background:var(--soft); color:var(--fg2) }
  .pl-when.timed summary { color:var(--acc) }
  .pl-fields { display:flex; flex-wrap:wrap; align-items:center; gap:8px 14px; margin:8px 0 4px 30px; font-size:13px; color:var(--fg2) }
  .pl-fields label { display:inline-flex; align-items:center; gap:6px; white-space:nowrap } .pl-fields input[type=time] { width:6.6em }
  .pl-opts { display:flex; flex-wrap:wrap; gap:8px 16px; font-size:13px; color:var(--fg2) } .pl-opts label { display:inline-flex; align-items:center; gap:6px; white-space:nowrap }
  textarea { width:100%; font-family:ui-monospace,Consolas,"Microsoft YaHei",monospace; font-size:13px; line-height:1.5 }
  textarea.text { font-family:inherit; font-size:15px }
  ul.checks { list-style:none; margin:6px 0 0; padding:0; font-size:13px; line-height:1.6 }
  ul.checks li.ok { color:var(--ok) } ul.checks li.bad { color:var(--acc) }
  label.field { display:block; margin:12px 0 } label.field > span { display:block; font-size:13px; font-weight:500; color:var(--fg2); margin-bottom:5px }
  label.field input[type=text], label.field input[type=password] { width:100% }
  label.field small { display:block; color:var(--mute); font-size:12px; margin-top:4px }
  label.check { display:flex; align-items:center; gap:8px; font-size:14px; cursor:pointer }
  table { border-collapse:collapse; width:100% } th, td { text-align:left; padding:8px; border-bottom:1px solid var(--line) } th { color:var(--mute); font-weight:500; font-size:12px; text-transform:uppercase; letter-spacing:.3px }
  .preview { border-radius:10px; display:block; width:100%; height:auto; background:#dcd7cb; box-shadow:inset 0 0 0 1px #0000000f }
  .screen { padding:10px; border-radius:16px; background:linear-gradient(145deg,#3a3a3e,#1f1f22); box-shadow:0 6px 18px #00000026 }
  .screen .preview { border-radius:4px; box-shadow:none }
  .kv { display:grid; grid-template-columns:auto 1fr; gap:6px 16px; font-size:14px; margin:0 } .kv dt { color:var(--mute) } .kv dd { margin:0 }
  .stats { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:14px }
  .stat { background:var(--soft); border-radius:10px; padding:8px 10px } .stat small { display:block; color:var(--mute); font-size:11px } .stat b { font-size:15px }
  details > summary { cursor:pointer; color:var(--mute); margin-top:6px; list-style:none } details > summary::before { content:"▸ " } details[open] > summary::before { content:"▾ " }
  .flash { padding:11px 16px; border-radius:12px; background:var(--acc-bg); color:var(--fg); margin-bottom:18px; font-size:14px }
  .flash.err { background:var(--warn-bg) }
  .toast { position:fixed; left:50%; top:18px; transform:translateX(-50%); z-index:50; background:var(--fg); color:var(--bg); padding:10px 18px; border-radius:12px; box-shadow:var(--shadow); font-size:14px; animation:toast 3.2s forwards }
  @keyframes toast { 0%,85% { opacity:1 } 100% { opacity:0; visibility:hidden } }
  .empty { text-align:center; padding:36px 18px; color:var(--mute) } .empty .ico { margin:0 auto 10px; opacity:.6 }
  .tabs { display:flex; gap:4px; border-bottom:1px solid var(--line); margin:-4px 0 20px; overflow-x:auto; overflow-y:hidden; scrollbar-width:none }
  .tabs a { padding:10px 14px; text-decoration:none; color:var(--mute); font-weight:500; border-bottom:2px solid transparent; margin-bottom:-1px; white-space:nowrap }
  .tabs a.on { color:var(--acc); border-bottom-color:var(--acc) } .tabs a:hover { color:var(--fg) }
  .seg { display:inline-flex; background:var(--soft); border-radius:10px; padding:3px; gap:2px }
  .seg button { border:0; background:transparent; padding:5px 12px; font-size:13px; border-radius:8px; color:var(--mute) }
  .seg button.on { background:var(--card); color:var(--fg); box-shadow:0 1px 3px #00000014; cursor:default }
  code.mac { font-size:12px; color:var(--mute); background:var(--soft); padding:1px 6px; border-radius:6px; letter-spacing:.3px }
  .msg { display:flex; gap:12px; padding:10px 0; border-top:1px solid var(--line) } .msg:first-child { border-top:0 }
  .msg .body { flex:1; min-width:0 } .msg .meta { font-size:12px; color:var(--mute) }
  .section-title { font-size:13px; font-weight:600; color:var(--mute); text-transform:uppercase; letter-spacing:.4px; margin:26px 0 10px }
  /* login */
  body.bare { display:grid; place-items:center; min-height:100vh; background:radial-gradient(1200px 600px at 10% -10%, var(--acc-bg), transparent), var(--bg) }
  .auth { width:100%; max-width:400px; padding:20px } .auth-card { background:var(--card); border:1px solid var(--line); border-radius:20px; padding:28px; box-shadow:var(--shadow) }
  .auth h1 { font-size:22px; text-align:center } .auth .sub { text-align:center; margin-bottom:12px }
`;

/** The page shell. `c` provides the user (sidebar) and a ?flash= message (toast). */
export function page(c: Context, o: { title: string; nav: NavId; body: Html; script?: string }): Html {
  const user = c.get("user" as never) as User | undefined;
  const flash = c.req.query("flash");
  const initial = user ? [...user.name][0].toUpperCase() : "";
  return html`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#c0392b"><title>${o.title} · InkBoard</title><style>${raw(CSS)}</style></head><body>
<aside class="side"><div class="brand"><span class="logo"></span>Ink<b>Board</b></div>
  <nav>${NAV.map(([id, href, label]) => html`<a href="${href}" class="${id === o.nav ? "on" : ""}">${icon(id)}${label}</a>`)}</nav>
  ${user ? html`<div class="me"><span class="avatar">${initial}</span><span class="who">${user.name}<small>${user.admin ? "管理员" : "成员"}</small></span>
    <form method="post" action="/logout"><button class="link" title="退出登录">${icon("logout", 18)}</button></form></div>` : ""}
</aside>
<header class="topbar"><div class="brand"><span class="logo"></span>Ink<b>Board</b></div>
  <a href="/settings" class="btn ghost" aria-label="设置">${icon("settings")}</a></header>
<main>${flash ? html`<div class="toast" role="status">${flash}</div>` : ""}${o.body}</main>
<nav class="tabbar">${NAV.slice(0, 5).map(([id, href, label]) => html`<a href="${href}" class="${id === o.nav ? "on" : ""}">${icon(id, 22)}${label}</a>`)}</nav>
${o.script ? raw(`<script>${o.script}</script>`) : ""}
</body></html>`;
}

/** "刚刚" / "5 分钟前" / "3 小时前" / "10月2日 08:15". */
export function ago(iso: string | null | undefined, now: Date): string {
  if (!iso) return "从未";
  const t = new Date(iso), min = Math.round((now.getTime() - t.getTime()) / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  if (min < 24 * 60) return `${Math.round(min / 60)} 小时前`;
  return `${t.getMonth() + 1}月${t.getDate()}日 ${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")}`;
}

export const hm = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
