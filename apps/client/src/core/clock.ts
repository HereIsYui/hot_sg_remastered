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

/** `Utils.MakeEndTimeString`: unix seconds -> local `MM-DD HH:MM:SS`. */
export function endTimeText(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${timeOfDay(unixSeconds)}`;
}

/** `Utils.MakeTimeLeftString`: `1小时05分09秒`, `05分09秒`, `09秒` (units from the strings). */
export function timeLeftText(seconds: number, unit: (key: string) => string): string {
  const s = Math.trunc(seconds);
  if (s < 0) return unit('_Utils_4');
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s - hours * 3600) / 60);
  let out = hours > 0 ? `${hours}${unit('_Utils_5')}` : '';
  if (minutes > 0 || hours > 0) out += `${pad(minutes)}${unit('_Utils_6')}`;
  return `${out}${pad(s % 60)}${unit('_Utils_7')}`;
}

/** `Utils.MakeHourMinSecColon`: duration in seconds -> `HH:MM:SS`, `---` when not positive. */
export function durationColon(seconds: number): string {
  const s = Math.trunc(seconds);
  if (s <= 0) return '---';
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
