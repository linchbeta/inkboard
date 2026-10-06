// Keeps the official holiday schedules current: loads the ones saved earlier, then checks
// holiday-cn for this year and next once a day (next year's appears each autumn).
import { type Db, getSetting, setSetting } from "../db.js";
import { useHolidayData, fetchHolidayData } from "./calendar.js";

export function loadSavedHolidays(db: Db): void {
  for (const y of [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1]) {
    try { useHolidayData(y, JSON.parse(getSetting(db, `holidays:${y}`, "{}"))); } catch { /* ignore */ }
  }
}

export async function syncHolidays(db: Db): Promise<void> {
  const y = new Date().getFullYear();
  setSetting(db, "holidays:synced", new Date().toISOString());
  for (const year of [y, y + 1]) {
    try {
      const data = await fetchHolidayData(year);
      if (data && useHolidayData(year, data)) setSetting(db, `holidays:${year}`, JSON.stringify(data));
    } catch (e) {
      console.warn(`[holidays] ${year}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

export function startHolidaySync(db: Db): void {
  loadSavedHolidays(db);
  void syncHolidays(db);
  setInterval(() => void syncHolidays(db), 24 * 3600_000).unref();
}
