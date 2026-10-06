// What a display mode is: a name, an optional description and settings schema (rendered
// generically on the modes page), async data loading, and a synchronous render.
import type { Canvas } from "../render/canvas.js";
import type { Panel } from "../panels.js";
import type { Db } from "../db.js";
import type { ConfigField } from "../data/modeConfig.js";
import type { ScreenContext } from "./testPattern.js";

export interface Screen {
  name: string;
  /** One line for the modes page. */
  description?: string;
  /** Settings, edited on the modes page and stored per mode. */
  config?: ConfigField[];
  /** Buttons on the modes page, e.g. "换一首"; run changes stored state. */
  actions?: { id: string; label: string; run: (db: Db, now: Date) => void }[];
  render: (p: Panel, ctx: ScreenContext) => Canvas;
  /**
   * Async data the screen needs (e.g. weather), fetched before the synchronous render.
   * params.advance = "1": a device's refresh (not a preview), e.g. time for the next poem.
   */
  prepare?: (db: Db, now: Date, params?: Record<string, string>) => Promise<Partial<ScreenContext>>;
}
