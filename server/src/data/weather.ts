// Weather from Open-Meteo (open-meteo.com: free, no API key). Forecasts are cached for
// 30 minutes in memory and in the settings table, so restarts and short outages still
// have data; on failure the last good data is used and marked with its fetch time.
import { type Db, getSetting, setSetting } from "../db.js";

export interface Place { name: string; admin1?: string; country?: string; lat: number; lon: number; timezone: string }

export interface WeatherData {
  place: Place;
  fetchedAt: string;  // ISO
  current: { temp: number; feels: number; humidity: number; code: number; isDay: boolean; windKmh: number; windDir: number };
  /** Next 24 hours from the current hour. time = "YYYY-MM-DDTHH:00" local. */
  hourly: { time: string; temp: number; pop: number; code: number }[];
  /** Today + next 3 days. */
  daily: { date: string; code: number; tmax: number; tmin: number; pop: number }[];
}

const TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 8000;

export async function searchPlaces(name: string): Promise<Place[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=8&language=zh&format=json`;
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`geocoding HTTP ${r.status}`);
  const d = (await r.json()) as { results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number; timezone?: string }[] };
  return (d.results ?? []).map((p) => ({
    name: p.name, admin1: p.admin1, country: p.country, lat: p.latitude, lon: p.longitude, timezone: p.timezone ?? "Asia/Shanghai",
  }));
}

export function getPlace(db: Db): Place | undefined {
  const raw = getSetting(db, "weather_place", "");
  return raw ? (JSON.parse(raw) as Place) : undefined;
}

export function setPlace(db: Db, place: Place | undefined): void {
  setSetting(db, "weather_place", place ? JSON.stringify(place) : "");
  setSetting(db, "weather_cache", "");
}

export async function fetchWeather(place: Place, now: Date): Promise<WeatherData> {
  const q = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m",
    hourly: "temperature_2m,precipitation_probability,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: place.timezone,
    forecast_days: "5",
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`forecast HTTP ${r.status}`);
  return parseForecast(place, (await r.json()) as OpenMeteoForecast, now);
}

interface OpenMeteoForecast {
  current: { time: string; temperature_2m: number; relative_humidity_2m: number; apparent_temperature: number;
             is_day: number; weather_code: number; wind_speed_10m: number; wind_direction_10m: number };
  hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: (number | null)[]; weather_code: number[] };
  daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[];
           precipitation_probability_max: (number | null)[] };
}

export function parseForecast(place: Place, d: OpenMeteoForecast, now: Date): WeatherData {
  const cur = d.current;
  const hourStart = cur.time.slice(0, 13) + ":00";
  let i0 = d.hourly.time.indexOf(hourStart);
  if (i0 < 0) i0 = 0;
  const hourly = d.hourly.time.slice(i0, i0 + 24).map((t, k) => ({
    time: t,
    temp: d.hourly.temperature_2m[i0 + k],
    pop: d.hourly.precipitation_probability[i0 + k] ?? 0,
    code: d.hourly.weather_code[i0 + k],
  }));
  const today = cur.time.slice(0, 10);
  let j0 = d.daily.time.indexOf(today);
  if (j0 < 0) j0 = 0;
  const daily = d.daily.time.slice(j0, j0 + 4).map((t, k) => ({
    date: t,
    code: d.daily.weather_code[j0 + k],
    tmax: d.daily.temperature_2m_max[j0 + k],
    tmin: d.daily.temperature_2m_min[j0 + k],
    pop: d.daily.precipitation_probability_max[j0 + k] ?? 0,
  }));
  return {
    place,
    fetchedAt: now.toISOString(),
    current: {
      temp: cur.temperature_2m, feels: cur.apparent_temperature, humidity: cur.relative_humidity_2m,
      code: cur.weather_code, isDay: cur.is_day === 1, windKmh: cur.wind_speed_10m, windDir: cur.wind_direction_10m,
    },
    hourly,
    daily,
  };
}

// per place: users may live in different cities
const memos = new Map<string, WeatherData>();
const inflights = new Map<string, Promise<WeatherData | undefined>>();

/**
 * Weather for the configured place, fetching when the cache is older than 30 minutes.
 * Returns stale data if the fetch fails, undefined if no place is set or nothing is cached.
 */
export async function getWeather(db: Db, now: Date): Promise<WeatherData | undefined> {
  const place = getPlace(db);
  if (!place) return undefined;
  const key = `${place.lat},${place.lon}`;
  let memo = memos.get(key);
  if (!memo) {
    const raw = getSetting(db, "weather_cache", "");
    const saved = raw ? JSON.parse(raw) as WeatherData : undefined;
    if (saved && saved.place.lat === place.lat && saved.place.lon === place.lon) { memo = saved; memos.set(key, saved); }
  }
  if (memo && now.getTime() - Date.parse(memo.fetchedAt) < TTL_MS) return memo;
  let p = inflights.get(key);
  if (!p) {
    p = fetchWeather(place, now)
      .then((w) => { memos.set(key, w); setSetting(db, "weather_cache", JSON.stringify(w)); return w; })
      .catch((e) => { console.warn(`[weather] fetch failed: ${e instanceof Error ? e.message : e}`); return memos.get(key); })
      .finally(() => { inflights.delete(key); });
    inflights.set(key, p);
  }
  return p;
}

// ── Presentation helpers ──

/** WMO weather code -> Chinese description and icon kind. */
export function describeCode(code: number): { text: string; icon: IconKind } {
  if (code === 0) return { text: "晴", icon: "clear" };
  if (code === 1) return { text: "晴间多云", icon: "partly" };
  if (code === 2) return { text: "多云", icon: "partly" };
  if (code === 3) return { text: "阴", icon: "cloudy" };
  if (code === 45 || code === 48) return { text: "雾", icon: "fog" };
  if (code >= 51 && code <= 57) return { text: "毛毛雨", icon: "rain" };
  if (code === 61 || code === 80) return { text: "小雨", icon: "rain" };
  if (code === 63 || code === 81) return { text: "中雨", icon: "rain" };
  if (code === 65 || code === 82) return { text: "大雨", icon: "rain" };
  if (code === 66 || code === 67) return { text: "冻雨", icon: "rain" };
  if (code === 71 || code === 85) return { text: "小雪", icon: "snow" };
  if (code === 73) return { text: "中雪", icon: "snow" };
  if (code === 75 || code === 86) return { text: "大雪", icon: "snow" };
  if (code === 77) return { text: "雪粒", icon: "snow" };
  if (code >= 95) return { text: code === 95 ? "雷阵雨" : "雷阵雨伴冰雹", icon: "thunder" };
  return { text: "未知", icon: "cloudy" };
}

export type IconKind = "clear" | "partly" | "cloudy" | "fog" | "rain" | "snow" | "thunder";

/** 8-point Chinese wind direction (where the wind comes from). */
export function windDirection(deg: number): string {
  const names = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"];
  return names[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

/** Beaufort level from km/h. */
export function windLevel(kmh: number): number {
  const limits = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  const i = limits.findIndex((l) => kmh < l);
  return i < 0 ? 12 : i;
}
