/** RewardFunc / CityFunc payloads; the server date is authoritative. */
export type SignState = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  history: { day: string; state: number }[];
};
export type SignDay = {
  key: string;
  day: number;
  currentMonth: boolean;
  today: boolean;
  state: number;
};
export type Activity = { content: string; link: string; interval: number };
export type ProgressRow = {
  tid: number;
  name: string;
  maxvalue: number;
  curvalue: number;
  remainvalue: number;
  percent: string;
};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pad = (v: number) => String(v).padStart(2, '0');
export function parseSignState(value: unknown): SignState | null {
  const [date, history] = list(value);
  const fields = list(date);
  if (
    fields.length !== 4 ||
    fields.some((v) => (typeof v !== 'string' && typeof v !== 'number') || String(v).trim() === '')
  )
    return null;
  const [yy, month, day, weekday] = fields.map(Number);
  if (
    yy === undefined ||
    month === undefined ||
    day === undefined ||
    weekday === undefined ||
    ![yy, month, day, weekday].every(Number.isInteger) ||
    yy < 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    weekday < 0 ||
    weekday > 6
  )
    return null;
  const year = yy < 100 ? 2000 + yy : yy;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return {
    year,
    month,
    day,
    weekday,
    history: list(history).map((v) => {
      const row = record(v);
      return { day: String(row.day ?? '').padStart(4, '0'), state: num(row.state) };
    }),
  };
}
export function parseLoginInfo(value: unknown) {
  const rows = list(value);
  return { announcement: record(rows[0]), sign: parseSignState(rows.at(-1)) };
}
/** Original 35-day rolling calendar: three prior weeks, current week, next week. */
export function signCalendar(sign: SignState): SignDay[] {
  const today = Date.UTC(sign.year, sign.month - 1, sign.day);
  return Array.from({ length: 35 }, (_, i) => {
    const offset = i - 21 - sign.weekday;
    const date = new Date(today + offset * 86400000);
    const key = `${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
    const signed = sign.history.find((row) => row.day === key);
    return {
      key: `${date.getUTCFullYear()}${key}`,
      day: date.getUTCDate(),
      currentMonth: date.getUTCMonth() === sign.month - 1,
      today: offset === 0,
      state: offset > 0 ? -1 : (signed?.state ?? (offset === 0 ? 99 : -1)),
    };
  });
}
export function safeActivityLink(value: unknown): string {
  const link = String(value ?? '').trim();
  return /^https?:\/\//i.test(link) ? link : '';
}
export function parseActivities(value: unknown): Activity[] {
  return list(value).map((v) => {
    const row = record(v);
    return {
      content: String(row.content ?? ''),
      link: safeActivityLink(row.link),
      interval: Math.max(1, num(row.interval)),
    };
  });
}
/** Up to six entries; the last entry determines the display interval. */
export function activityPage(rows: Activity[], page: number): Activity[] {
  if (!rows.length) return [];
  return Array.from(
    { length: Math.min(6, rows.length) },
    (_, i) => rows[(page * 6 + i) % rows.length]!,
  );
}
export function parseProgress(value: unknown): ProgressRow[] {
  return list(value).map((v) => {
    const row = record(v),
      maxvalue = num(row.maxvalue),
      curvalue = num(row.curvalue);
    return {
      tid: num(row.tid),
      name: String(row.name ?? ''),
      maxvalue,
      curvalue,
      remainvalue: row.remainvalue == null ? maxvalue - curvalue : num(row.remainvalue),
      percent: `${(maxvalue > 0 ? (curvalue * 100) / maxvalue : 0).toFixed(2)}%`,
    };
  });
}
export const PROGRESS_COMMANDS = {
  huangjin: {
    action: 'rank3',
    command: 'getHuangJinProgress',
    locale: 'Rank_HuangJinProgressDlg',
    tabs: [2, 3, 4, 5],
  },
  dongzhuo: {
    action: 'rank4',
    command: 'getDongZhuoProgress',
    locale: 'Rank_DongZhuoProgressDlg',
    tabs: [2, 3, 4, 5, 12, 13],
  },
} as const;

/** BloodWar announcement entry completes task 292 when opened, not when it closes. */
export function openAnnouncement(autoOpen: boolean, isNewRole: boolean): boolean {
  return autoOpen && !isNewRole;
}
export function announcementOpenCommands(manual: boolean): string[] {
  return manual ? ['getLoginInfo', 'finishOpenAnnounce'] : ['getLoginInfo'];
}
