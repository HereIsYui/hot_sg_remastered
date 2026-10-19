/** Server clock (`Global.timeoffset` / `Global.getServerTime`), in unix seconds. */

let offset = 0;

/** Synchronizes with a server timestamp (seconds), as on loadGlobalData / getCityInfo. */
export function syncServerTime(serverSeconds: number, nowMs = Date.now()): void {
  offset = Math.trunc(serverSeconds - nowMs / 1000);
}

export function serverTime(nowMs = Date.now()): number {
  return Math.trunc(nowMs / 1000 + offset);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `Utils.MakeHourMinSec`: unix seconds -> local time of day `HH:MM:SS`. */
export function timeOfDay(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** `Utils.MakeHourMinSecColon`: duration in seconds -> `HH:MM:SS`, `---` when not positive. */
export function durationColon(seconds: number): string {
  const s = Math.trunc(seconds);
  if (s <= 0) return '---';
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
