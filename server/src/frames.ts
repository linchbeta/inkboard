// Turns "what should this device show now" into device bytes.
// P1: a fixed set of screens chosen globally; playlists and plugins come in P2/P3.
import { Canvas } from "./render/canvas.js";
import { pack2bpp, packBmp1, frameEtag } from "./render/pack.js";
import { renderTestPattern, type ScreenContext } from "./screens/testPattern.js";
import { renderFontCompare } from "./screens/fontCompare.js";
import { renderCalendar } from "./screens/calendar.js";
import { renderDateCard } from "./screens/dateCard.js";
import { renderWeather } from "./screens/weather.js";
import { renderPhoto } from "./screens/photo.js";
import { renderPairing } from "./screens/pairing.js";
import { currentPhotoId, loadPhoto, getPlayback, sanitizeEdits, PHOTO_CONFIG } from "./data/photos.js";
import type { Panel } from "./panels.js";
import { resolveTones } from "./render/dither.js";
import { type Db, getSetting } from "./db.js";
import { setFont } from "./render/typography.js";
import { getWeather, getPlace, describeCode } from "./data/weather.js";

import type { Screen } from "./screens/screen.js";
import { yearProgressMode } from "./screens/yearProgress.js";
import { countdownMode } from "./screens/countdown.js";
import { messagesMode } from "./screens/messages.js";
import { todoMode } from "./screens/todo.js";
import { poetryMode } from "./screens/poetry.js";
import { wordsMode } from "./screens/words.js";
import { almanacMode } from "./screens/almanac.js";
import { agendaMode } from "./screens/agenda.js";
import { marketMode } from "./screens/market.js";
import { newsMode } from "./screens/news.js";
import { timetableMode } from "./screens/timetable.js";
import { dashboardMode } from "./screens/dashboard.js";
import { hitokotoMode } from "./screens/hitokoto.js";
import { bigFontCompareMode } from "./screens/bigFontCompare.js";
export type { Screen };

async function weatherContext(db: Db, now: Date): Promise<Partial<ScreenContext>> {
  const weather = await getWeather(db, now);
  if (weather) {
    const line = `${Math.round(weather.current.temp)}℃ ${describeCode(weather.current.code).text}`;
    return { weather, weatherLine: line };
  }
  return { weatherNote: getPlace(db) ? "天气数据暂时无法获取" : "请在后台这块屏的“内容”里设置城市" };
}

/**
 * params.photo: show that photo instead of the current one; params.edits (JSON) and
 * params.style: unsaved editor settings (photo editor live preview).
 */
async function photoContext(db: Db, now: Date, params?: Record<string, string>): Promise<Partial<ScreenContext>> {
  const id = Number(params?.photo) || currentPhotoId(db, now);
  const p = id ? loadPhoto(db, id) : undefined;
  if (!p) return {};
  let edits = p.info.edits;
  if (params?.edits) { try { edits = sanitizeEdits(JSON.parse(params.edits)); } catch { /* keep saved */ } }
  const pb = getPlayback(db);
  const style = params?.style === "full" || params?.style === "frame" ? params.style : pb.style;
  const corner = params?.corner === "none" || params?.corner === "s" || params?.corner === "m" || params?.corner === "l" ? params.corner : pb.corner;
  return { photo: { title: params?.title ?? p.info.title, date: new Date(p.info.created_at), image: p.image, style, edits, corner } };
}

export const SCREENS: Record<string, Screen> = {
  test: { name: "测试画面", render: renderTestPattern },
  calendar: { name: "日历", render: (p, ctx) => renderCalendar(p, ctx) },
  datecard: { name: "日期牌", render: (p, ctx) => renderDateCard(p, ctx), prepare: weatherContext },
  weather: { name: "天气", render: renderWeather, prepare: weatherContext },
  photo: { name: "相框", description: "相册里的照片，按屏幕颜色抖动；每块屏可以播放不同的照片。", config: PHOTO_CONFIG, render: renderPhoto, prepare: photoContext },
  yearprogress: yearProgressMode,
  countdown: countdownMode,
  messages: messagesMode,
  todo: todoMode,
  poetry: poetryMode,
  words: wordsMode,
  almanac: almanacMode,
  agenda: agendaMode,
  timetable: timetableMode,
  dashboard: dashboardMode,
  hitokoto: hitokotoMode,
  market: marketMode,
  news: newsMode,
  bigfont: bigFontCompareMode,
  fontcompare: { name: "字体对比", render: renderFontCompare },
};
export const DEFAULT_SCREEN = "test";

export interface Frame {
  body: Uint8Array;
  etag: string;
  contentType: string;
  kind: "2bpp" | "bmp1";
  modeId: string;
}

/** Fetches whatever async data the screen needs; never throws. */
export async function prepareScreen(db: Db, screenId: string, now: Date, params?: Record<string, string>): Promise<Partial<ScreenContext>> {
  try {
    return (await (SCREENS[screenId] ?? SCREENS[DEFAULT_SCREEN]).prepare?.(db, now, params)) ?? {};
  } catch (e) {
    console.warn(`[screen ${screenId}] prepare failed: ${e instanceof Error ? e.message : e}`);
    return {};
  }
}

export function renderScreen(panel: Panel, ctx: ScreenContext, screenId = DEFAULT_SCREEN): Canvas {
  setFont(ctx.font); // synchronous from here: concurrent requests cannot swap it
  const c = (SCREENS[screenId] ?? SCREENS[DEFAULT_SCREEN]).render(panel, ctx);
  resolveTones(c, panel);
  return c;
}

/** The pairing screen for a device nobody owns yet, as device bytes. */
export function pairingFrame(panel: Panel, ctx: ScreenContext & { pairCode?: string; noUsers?: boolean }, prefer2bpp: boolean): Frame {
  setFont(undefined);
  const canvas = renderPairing(panel, ctx);
  const body = prefer2bpp && panel.colors >= 3 ? pack2bpp(canvas, panel) : packBmp1(canvas);
  return { body, etag: frameEtag(body), contentType: "application/octet-stream", kind: body.length === (panel.width * panel.height) / 4 ? "2bpp" : "bmp1", modeId: "PAIR" };
}

/** 2bpp for colour panels, 1-bit BMP otherwise (InkSight firmware accepts both). */
export function buildFrame(panel: Panel, ctx: ScreenContext, prefer2bpp: boolean, screenId = DEFAULT_SCREEN): Frame {
  const canvas = renderScreen(panel, ctx, screenId);
  const body = prefer2bpp && panel.colors >= 3 ? pack2bpp(canvas, panel) : packBmp1(canvas);
  return {
    body,
    etag: frameEtag(body),
    contentType: "application/octet-stream",
    kind: body.length === (panel.width * panel.height) / 4 ? "2bpp" : "bmp1",
    modeId: (SCREENS[screenId] ? screenId : DEFAULT_SCREEN).toUpperCase(),
  };
}

/** Generic B/W panel for unknown resolutions, so any InkSight device still gets a frame. */
export function genericPanel(width: number, height: number): Panel {
  return {
    id: `generic_${width}x${height}`,
    name: `${width}×${height}`,
    width,
    height,
    colors: 2,
    codes: [0b00, 0b01, 0b00, 0b00],
    cornerRadius: 0,
    measured: { black: [30, 30, 30], white: [220, 215, 205], yellow: [30, 30, 30], red: [30, 30, 30] },
  };
}
