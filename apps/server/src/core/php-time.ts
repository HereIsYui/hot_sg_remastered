/**
 * PHP date functions under the game's `date.timezone = Asia/Shanghai` (fixed UTC+8, no DST),
 * independent of the host timezone.
 */
const OFFSET_SECONDS = 8 * 3600;

/** `time()`. */
export function phpTime(): number {
  return Math.floor(Date.now() / 1000);
}

function shanghai(ts: number): Date {
  return new Date((ts + OFFSET_SECONDS) * 1000);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `date($format, $ts)` for the format characters the game uses: Y m d H i s n j N. */
export function phpDate(format: string, ts: number): string {
  const d = shanghai(Math.trunc(ts));
  let out = '';
  for (const ch of format) {
    switch (ch) {
      case 'Y':
        out += String(d.getUTCFullYear());
        break;
      case 'm':
        out += pad(d.getUTCMonth() + 1);
        break;
      case 'd':
        out += pad(d.getUTCDate());
        break;
      case 'H':
        out += pad(d.getUTCHours());
        break;
      case 'i':
        out += pad(d.getUTCMinutes());
        break;
      case 's':
        out += pad(d.getUTCSeconds());
        break;
      case 'n':
        out += String(d.getUTCMonth() + 1);
        break;
      case 'j':
        out += String(d.getUTCDate());
        break;
      case 'N':
        out += String(d.getUTCDay() === 0 ? 7 : d.getUTCDay());
        break;
      default:
        out += ch;
    }
  }
  return out;
}

/** `mktime($hour, $minute, $second, $month, $day, $year)`; out-of-range parts roll over. */
export function phpMktime(
  hour: number,
  minute: number,
  second: number,
  month: number,
  day: number,
  year: number,
): number {
  return Date.UTC(year, month - 1, day, hour, minute, second) / 1000 - OFFSET_SECONDS;
}
