import type { CommandArg } from '@hot/shared';
import { timeLeftText } from '../core/clock';
import { i18n } from '../i18n';
import { cityDistance } from './world';
import { marketResourceName } from './market';

export const OFFICIAL_PRICES = [0.1, 0.1, 0.2, 0.25] as const;

export interface UserBuyRow extends Record<string, unknown> {
  id: number;
  resname: string;
  count: number;
  price: number;
  gold: number;
  sellername: string;
  unionname: string;
  needtime: string;
}

export interface UserBuyList {
  used: number;
  total: number;
  pageCount: number;
  page: number;
  rows: UserBuyRow[];
}

const int = (value: unknown): number => parseInt(String(value), 10) || 0;
const num = (value: unknown): number => parseFloat(String(value)) || 0;

export function playerPrice(count: number, gold: number): number {
  return count === 0 ? 0 : Math.round((gold / count) * 100) / 100;
}

export function playerPriceRange(resType: number): [number, number] {
  const price = OFFICIAL_PRICES[resType] ?? 0;
  return [Math.round(price * 80) / 100, Math.round(price * 120) / 100];
}

export function playerSellError(
  resType: number,
  count: number,
  gold: number,
  hour: number,
  unionOnly: boolean,
  unionid: number,
): string | null {
  if (count <= 0) return 'Market_MarketUserSellDialogSrc_1';
  return playerSellPriceError(resType, playerPrice(count, gold), hour, unionOnly, unionid);
}

export function playerSellPriceError(
  resType: number,
  price: number,
  hour: number,
  unionOnly: boolean,
  unionid: number,
): string | null {
  const [min, max] = playerPriceRange(resType);
  if (price < min || price > max) return 'Market_MarketUserSellDialogSrc_1';
  if (unionOnly && unionid <= 0) return 'Market_MarketUserSellDialogSrc_2';
  if (hour < 1) return 'Market_MarketUserSellDialogSrc_3';
  return null;
}

export function playerSellArgs(
  resType: number,
  count: number,
  gold: number,
  hour: number,
  unionOnly: boolean,
): CommandArg[] {
  return [resType, count, gold, hour, unionOnly ? 1 : 0];
}

export function playerTravelSeconds(fromcid: number, tocid: number): number {
  return (cityDistance(fromcid, tocid) * 60000) / 360;
}

export function parseUserBuyList(data: unknown, cid: number): UserBuyList {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const used = int(d.shift());
  const total = int(d.shift());
  const pageCount = int(d.shift());
  const page = int(d.shift());
  const raw = d.shift();
  const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  return {
    used,
    total,
    pageCount,
    page,
    rows: rows.map((row) => ({
      ...row,
      id: int(row.id),
      resname: marketResourceName(int(row.restype)),
      count: int(row.count),
      price: num(row.price),
      gold: num(row.gold),
      sellername: String(row.sellername ?? ''),
      unionname: String(row.unionname ?? ''),
      needtime: timeLeftText(playerTravelSeconds(int(row.cid), cid), i18n),
    })),
  };
}

export function parseUserSellData(data: unknown): {
  used: number;
  total: number;
  prices: number[];
} {
  const d = Array.isArray(data) ? data : [];
  return {
    used: int(d[0]),
    total: int(d[1]),
    prices: [num(d[2]), num(d[3]), num(d[4]), num(d[5])],
  };
}
