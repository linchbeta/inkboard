// When should a device wake next? Daytime: every `dayMinutes`, aligned to clock
// boundaries (e.g. :00 :15 :30 :45); night: every `nightMinutes`, never sleeping past
// the start of the day window.

export interface Schedule {
  dayStartHour: number;   // inclusive, local time
  dayEndHour: number;     // exclusive
  dayMinutes: number;
  nightMinutes: number;
}

export const DEFAULT_SCHEDULE: Schedule = { dayStartHour: 7, dayEndHour: 22, dayMinutes: 15, nightMinutes: 120 };

/** A few seconds past the boundary so the device lands after it, not just before. */
const LANDING_MARGIN_S = 5;

/** The next boundary after `now`, in minutes of the day (may be past 24*60). */
function nextBoundary(now: Date, s: Schedule): { minutesOfDay: number; next: number } {
  const minutesOfDay = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const dayStart = s.dayStartHour * 60;
  const dayEnd = s.dayEndHour * 60;
  const isDay = minutesOfDay >= dayStart && minutesOfDay < dayEnd;
  const step = isDay ? s.dayMinutes : s.nightMinutes;
  let next = (Math.floor(minutesOfDay / step) + 1) * step;
  if (!isDay) {
    // Next day-window start, today or tomorrow.
    const nextDayStart = minutesOfDay < dayStart ? dayStart : dayStart + 24 * 60;
    next = Math.min(next, nextDayStart);
  } else if (next > dayEnd) {
    next = dayEnd;
  }
  return { minutesOfDay, next };
}

export function sleepSeconds(now: Date, s: Schedule = DEFAULT_SCHEDULE): number {
  const { minutesOfDay, next } = nextBoundary(now, s);
  return Math.max(60, Math.round((next - minutesOfDay) * 60) + LANDING_MARGIN_S);
}

/** The next boundary as Unix seconds, for X-Next-Wake: the firmware sleeps until then
 *  (plus its own margin) however long the download and the refresh took. */
export function nextWakeUnix(now: Date, s: Schedule = DEFAULT_SCHEDULE): number {
  const { minutesOfDay, next } = nextBoundary(now, s);
  return Math.round(now.getTime() / 1000 + (next - minutesOfDay) * 60);
}

/** For InkSight firmware (X-Refresh-Minutes): it only accepts 10..1440. */
export function refreshMinutes(now: Date, s: Schedule = DEFAULT_SCHEDULE): number {
  return Math.min(1440, Math.max(10, Math.ceil(sleepSeconds(now, s) / 60)));
}
