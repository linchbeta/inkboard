// Node entry point. Env: PORT (8080), DATA_DIR (./data), TZ (e.g. Asia/Shanghai).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { fonts } from "./render/fonts.js";
import { startHolidaySync } from "./data/holidaySync.js";

const port = Number(process.env.PORT ?? 8080);
const dataDir = process.env.DATA_DIR ?? "data";
mkdirSync(dataDir, { recursive: true });

const db = openDb(join(dataDir, "inkboard.db"));
fonts(); // load fonts at startup, not on the first device request
const app = createApp(db);
startHolidaySync(db); // official holiday schedules: saved copies now, updates daily

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`InkBoard listening on http://0.0.0.0:${info.port}  (data: ${dataDir}, TZ: ${process.env.TZ ?? "system"})`);
});
