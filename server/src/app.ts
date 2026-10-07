// HTTP app, independent of the runtime (server.ts wires it to Node).
import { Hono } from "hono";
import type { Db } from "./db.js";
import { getSetting, getOwnDevice } from "./db.js";
import { asDevice } from "./data/content.js";
import { withTestDate } from "./scope.js";
import { panelById } from "./deviceFrame.js";
import { orientedPanel, isOrientation } from "./panels.js";
import { compatRoutes } from "./api/compat.js";
import { v1Routes } from "./api/v1.js";
import { renderScreen, prepareScreen, SCREENS } from "./frames.js";
import { previewPng } from "./render/pack.js";
import { photoEditorRoutes } from "./admin/photoEditor.js";
import { modesRoutes } from "./admin/modesPage.js";
import { todoRoutes } from "./admin/todoPage.js";
import { deviceRoutes } from "./admin/devices.js";
import { libraryRoutes } from "./admin/library.js";
import { authMiddleware, authRoutes } from "./admin/auth.js";
import { type User, listUsers, createUser } from "./data/users.js";
import { DEFAULT_MODE, getSettings } from "./data/devices.js";
import { DEFAULT_SCHEDULE, type Schedule } from "./schedule.js";

export interface AppOptions {
  /** Clock, injectable for tests. */
  now: () => Date;
  /** Wake-up schedule for devices without their own (devices normally have one). */
  schedule: Schedule;
  /** New devices start active (true) or wait for approval in the admin UI (false). */
  autoApprove: boolean;
  /** Tests: skip the login and act as the administrator (created if there is none). */
  testUser?: boolean;
}

export function createApp(db: Db, partial: Partial<AppOptions> = {}): Hono {
  const realNow = partial.now ?? (() => new Date());
  const opts: AppOptions = { schedule: DEFAULT_SCHEDULE, autoApprove: true, ...partial, now: realNow };
  // Test date (设置 page): screens draw that day as "today", keeping the real time of day.
  // (per user: read in the request's user scope)
  opts.now = () => withTestDate(realNow(), () => getSetting(db, "test_date", ""));
  const app = new Hono();

  // device protocols
  app.route("/", compatRoutes(db, opts));
  app.route("/", v1Routes(db, opts));

  app.get("/healthz", (c) => c.json({ ok: true }));

  // everything below runs as the logged-in user (see scope.ts)
  const tester: User | undefined = opts.testUser
    ? listUsers(db).find((u) => u.admin) ?? createUser(db, "tester", "tester-password") : undefined;
  app.use("*", authMiddleware(db, tester && (() => tester)));
  authRoutes(app, db);               // setup, login, pairing, users

  // Preview of a mode on a panel type, in the panel's measured colours (admin pages).
  // ?screen= mode, ?font= large-text face, ?o= orientation (else the screen's, with ?dev=),
  // plus the photo editor's unsaved edits. Drawn upright, as the screen is seen.
  app.get("/preview/:file", async (c) => {
    const m = /^([a-z0-9_]+)\.png$/.exec(c.req.param("file"));
    const panel = m ? panelById(m[1]) : undefined;
    if (!panel) return c.notFound();
    const scale = Math.min(4, Math.max(1, Number(c.req.query("scale") ?? 1) | 0));
    const q = c.req.query("screen") ?? "";
    const screen = SCREENS[q] ? q : DEFAULT_MODE;
    const now = opts.now();
    const params: Record<string, string> = {};
    for (const k of ["photo", "edits", "style", "title", "corner"]) { const v = c.req.query(k); if (v !== undefined) params[k] = v; }
    // ?dev=<mac>: with that screen's content and font
    const dev = c.req.query("dev") ? getOwnDevice(db, c.req.query("dev")!) : undefined;
    const draw = async () => {
      const extra = await prepareScreen(db, screen, now, params);
      const o = c.req.query("o") ?? (dev && getSettings(db, dev).orientation);
      return renderScreen(orientedPanel(panel, isOrientation(o) ? o : undefined), { ...extra, now, font: c.req.query("font") ?? (dev && getSettings(db, dev).font) }, screen);
    };
    const png = previewPng(dev ? await asDevice(dev.mac, draw) : await draw(), panel, scale);
    return c.body(png as Uint8Array<ArrayBuffer>, 200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
  });

  // admin pages
  deviceRoutes(app, db, opts.now);   // 概览, device pages, device previews
  modesRoutes(app, db, opts.now);    // 内容
  libraryRoutes(app, db, opts.now);  // 相册, 留言, 设置
  todoRoutes(app, db);               // 待办
  photoEditorRoutes(app, db);        // photo editor

  return app;
}
