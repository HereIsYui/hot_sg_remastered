import type { CommandArg } from '@hot/shared';
import { endTimeText } from '../core/clock';
import { i18n } from '../i18n';

export type MarketSend = (cmd: string, args: CommandArg[], ttype?: number) => void;

export interface AutoTransRow extends Record<string, unknown> {
  id: number;
  resname: string;
  count: number;
  fromcity: string;
  fromcid: string;
  tocity: string;
  tocid: string;
  start_time: string;
}

export interface AutoTransForm {
  fromcid: number;
  tocid: number;
  resType: number;
  count: string;
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  daily: boolean;
}

export interface MarketTradeRow extends Record<string, unknown> {
  id: number;
  resname: string;
  count: number;
  price: number;
  gold: number;
  endtime: string;
  statename: string;
  state: number;
  labelText: string;
}

const int = (value: unknown): number => parseInt(String(value), 10) || 0;
const num = (value: unknown): number => parseFloat(String(value)) || 0;
const pad = (value: number): string => String(value).padStart(2, '0');

export function marketResourceName(type: number): string {
  return type >= 0 && type < 5 ? i18n(`Market_AutoTransDialogSrc_${type + 1}`) : '';
}

export function marketCarryCap(level: number): number {
  return Math.max(0, int(level)) * 100000;
}

export function cityCoordinate(cid: number): string {
  return `(${cid % 1000},${Math.floor(cid / 1000)})`;
}

/** AutoTransDialog.onLoadData: the scheduled-transport grid rows. */
export function parseAutoTrans(data: unknown): AutoTransRow[] {
  if (!Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((row) => {
    const fromcid = int(row.fromcid);
    const tocid = int(row.tocid);
    const start = int(row.start_time);
    const date = new Date(start * 1000);
    return {
      ...row,
      id: int(row.id),
      resname: marketResourceName(int(row.res_type)),
      count: int(row.count),
      fromcity: String(row.fromcity ?? ''),
      fromcid: cityCoordinate(fromcid),
      tocity: String(row.tocity ?? ''),
      tocid: cityCoordinate(tocid),
      start_time: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    };
  });
}

/** MarketPanel.onLoadInfo: a read-only view of caravans already moving. */
export function parseMarketTrades(data: unknown): MarketTradeRow[] {
  if (!Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((row) => {
    const state = int(row.state);
    const statename =
      state === 2
        ? i18n('Market_MarketPanelSrc_6')
        : state === 0
          ? i18n('Market_MarketPanelSrc_8')
          : state === 1
            ? i18n('Market_MarketPanelSrc_11')
            : i18n('Market_MarketPanelSrc_13');
    return {
      ...row,
      id: int(row.id),
      resname: marketResourceName(int(row.restype)),
      count: int(row.count),
      price: num(row.price),
      gold: int(row.gold),
      endtime: state === 0 ? i18n('Market_MarketPanelSrc_9') : endTimeText(int(row.endtime)),
      statename,
      state,
      labelText:
        state === 0
          ? i18n('Market_MarketPanelSrc_10')
          : state === 2
            ? i18n('Market_MarketPanelSrc_10')
            : i18n('Market_MarketPanelSrc_12'),
    };
  });
}

/** AddAutoTransDialog.onShow: one hour from now, broken into the original six inputs. */
export function defaultAutoTransClock(
  nowMs: number,
): Pick<AutoTransForm, 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second'> {
  const date = new Date(nowMs + 3600000);
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1),
    day: String(date.getDate()),
    hour: String(date.getHours()),
    minute: String(date.getMinutes()),
    second: String(date.getSeconds()),
  };
}

/** AddAutoTransDialog.addAutoTrans: returns the original error key, or null when valid. */
export function autoTransError(form: AutoTransForm, nowMs: number): string | null {
  const now = new Date(nowMs);
  const year = int(form.year);
  if (year < now.getFullYear()) return 'Market_AddAutoTransDialogSrc_6';
  const month = int(form.month);
  if (month > 12 || month < 0) return 'Market_AddAutoTransDialogSrc_7';
  const day = int(form.day);
  if ([1, 3, 5, 7, 10, 12].includes(month)) {
    if (day < 0 || day > 31) return 'Market_AddAutoTransDialogSrc_8';
  } else if ([4, 6, 8, 9, 11].includes(month)) {
    if (day < 0 || day > 31) return 'Market_AddAutoTransDialogSrc_9';
  } else if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    if (day < 0 || day > (leap ? 29 : 28)) {
      return `Market_AddAutoTransDialogSrc_${leap ? 10 : 11}`;
    }
  }
  const hour = int(form.hour);
  if (hour < 0 || hour > 23) return 'Market_AddAutoTransDialogSrc_12';
  const minute = int(form.minute);
  if (minute < 0 || minute > 59) return 'Market_AddAutoTransDialogSrc_13';
  const second = int(form.second);
  if (second < 0 || second > 59) return 'Market_AddAutoTransDialogSrc_14';
  if (form.fromcid === form.tocid) return 'Market_AddAutoTransDialogSrc_15';
  const start = new Date();
  start.setFullYear(year, month - 1, day);
  start.setHours(hour, minute, second);
  if (start.valueOf() <= nowMs) return 'Market_AddAutoTransDialogSrc_16';
  if (int(form.count) <= 0) return 'Market_AddAutoTransDialogSrc_17';
  return null;
}

/** doAddConfirm: `[fromcid, tocid, resType, count, transType, startTimeMs]`. */
export function autoTransArgs(form: AutoTransForm): CommandArg[] {
  const start = new Date();
  start.setFullYear(int(form.year), int(form.month) - 1, int(form.day));
  start.setHours(int(form.hour), int(form.minute), int(form.second));
  start.setMilliseconds(0);
  return [
    form.fromcid,
    form.tocid,
    form.resType,
    int(form.count),
    form.daily ? 1 : 0,
    start.valueOf(),
  ];
}
