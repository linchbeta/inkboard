// Accounts in the admin: first-run setup, login / logout, the session middleware (every
// admin request then runs as its user, see scope.ts), account and user management, and
// pairing a device to the current account.
import type { Context, Hono, Next } from "hono";
import { html, raw } from "hono/html";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Db } from "../db.js";
import { runAs } from "../scope.js";
import {
  type User, userCount, createUser, verifyUser, createSession, sessionUser, endSession, listUsers,
  deleteUser, setPassword, claimDevice, SESSION_DAYS_MAX_AGE,
} from "../data/users.js";
import { CSS } from "./layout.js";

const COOKIE = "inkboard_session";
const PUBLIC = /^\/(api\/|healthz$|login$|setup$|favicon)/;

export const userOf = (c: Context): User => c.get("user" as never) as User;

function bare(title: string, body: ReturnType<typeof html>) {
  return html`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · InkBoard</title><style>${raw(CSS)}</style></head><body class="bare">
<div class="auth"><div class="auth-card"><div class="brand big"><span class="logo"></span>Ink<b>Board</b></div>${body}</div></div></body></html>`;
}

/** Session check for admin pages; tests may pass a user to act as (no cookie needed). */
export function authMiddleware(db: Db, testUser?: () => User) {
  return async (c: Context, next: Next) => {
    const url = new URL(c.req.url), path = url.pathname;
    if (PUBLIC.test(path)) return next();
    let user = testUser?.();
    if (!user) {
      if (userCount(db) === 0) return c.redirect("/setup");
      user = sessionUser(db, getCookie(c, COOKIE));
      if (!user) return c.req.method === "GET" ? c.redirect(`/login?next=${encodeURIComponent(path + url.search)}`) : c.text("请先登录", 401);
    }
    c.set("user" as never, user as never);
    return runAs(user.id, () => next());
  };
}

export function authRoutes(app: Hono, db: Db): void {
  const login = (c: Context, user: User) => {
    setCookie(c, COOKIE, createSession(db, user.id), { httpOnly: true, sameSite: "Lax", path: "/", maxAge: SESSION_DAYS_MAX_AGE });
  };

  app.get("/setup", (c) => {
    if (userCount(db) > 0) return c.redirect("/login");
    const err = c.req.query("err");
    return c.html(bare("创建管理员", html`<h1>欢迎使用 InkBoard</h1>
      <p class="sub">先创建管理员账号。之前的设备和内容会归到这个账号下；之后可以在"设置 → 用户"里给家人添加账号。</p>
      ${err ? html`<p class="flash err">${err}</p>` : ""}
      <form method="post" action="/setup">
        <label class="field"><span>用户名</span><input type="text" name="name" required maxlength="24" autofocus autocomplete="username"></label>
        <label class="field"><span>密码（至少 6 位）</span><input type="password" name="password" required minlength="6" autocomplete="new-password"></label>
        <button class="primary wide">创建并登录</button></form>`));
  });
  app.post("/setup", async (c) => {
    if (userCount(db) > 0) return c.redirect("/login");
    const b = await c.req.parseBody();
    try {
      login(c, createUser(db, String(b.name ?? ""), String(b.password ?? "")));
      return c.redirect("/");
    } catch (e) { return c.redirect(`/setup?err=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`); }
  });

  app.get("/login", (c) => {
    if (userCount(db) === 0) return c.redirect("/setup");
    const next = c.req.query("next") ?? "/";
    return c.html(bare("登录", html`<h1>登录</h1>
      ${c.req.query("err") ? html`<p class="flash err">用户名或密码不对</p>` : ""}
      <form method="post" action="/login"><input type="hidden" name="next" value="${next}">
        <label class="field"><span>用户名</span><input type="text" name="name" required autofocus autocomplete="username"></label>
        <label class="field"><span>密码</span><input type="password" name="password" required autocomplete="current-password"></label>
        <button class="primary wide">登录</button></form>`));
  });
  app.post("/login", async (c) => {
    const b = await c.req.parseBody();
    const user = verifyUser(db, String(b.name ?? ""), String(b.password ?? ""));
    const next = String(b.next ?? "/");
    if (!user) return c.redirect(`/login?err=1&next=${encodeURIComponent(next)}`);
    login(c, user);
    return c.redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
  });

  app.post("/logout", (c) => {
    endSession(db, getCookie(c, COOKIE));
    deleteCookie(c, COOKIE, { path: "/" });
    return c.redirect("/login");
  });

  // ── pairing a device to this account ──
  app.post("/admin/pair", async (c) => {
    const code = String((await c.req.parseBody()).code ?? "").replace(/\s/g, "");
    const mac = /^\d{4,8}$/.test(code) ? claimDevice(db, code, userOf(c).id) : undefined;
    return c.redirect(mac ? `/devices/${mac}?flash=${encodeURIComponent("绑定成功，给它起个名字吧")}` : `/?flash=${encodeURIComponent("配对码不对，或这块屏已经被绑定")}#pair`);
  });

  // ── own account / user management (administrator) ──
  app.post("/admin/account/password", async (c) => {
    const b = await c.req.parseBody();
    const u = userOf(c);
    if (!verifyUser(db, u.name, String(b.old ?? ""))) return c.redirect(`/settings?flash=${encodeURIComponent("原密码不对")}#account`);
    try { setPassword(db, u.id, String(b.password ?? "")); } catch (e) { return c.redirect(`/settings?flash=${encodeURIComponent(e instanceof Error ? e.message : String(e))}#account`); }
    login(c, u);
    return c.redirect(`/settings?flash=${encodeURIComponent("密码已修改")}#account`);
  });
  app.post("/admin/users", async (c) => {
    if (!userOf(c).admin) return c.text("只有管理员可以添加用户", 403);
    const b = await c.req.parseBody();
    let msg = "已添加用户";
    try { createUser(db, String(b.name ?? ""), String(b.password ?? "")); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    return c.redirect(`/settings?flash=${encodeURIComponent(msg)}#users`);
  });
  app.post("/admin/users/:id/delete", (c) => {
    const me = userOf(c), id = Number(c.req.param("id"));
    if (!me.admin || id === me.id) return c.text("不能删除", 403);
    deleteUser(db, id);
    return c.redirect(`/settings?flash=${encodeURIComponent("已删除用户，它的设备需要重新配对")}#users`);
  });
  app.post("/admin/users/:id/password", async (c) => {
    if (!userOf(c).admin) return c.text("只有管理员可以重置密码", 403);
    let msg = "密码已重置";
    try { setPassword(db, Number(c.req.param("id")), String((await c.req.parseBody()).password ?? "")); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    return c.redirect(`/settings?flash=${encodeURIComponent(msg)}#users`);
  });
}

export { listUsers };
