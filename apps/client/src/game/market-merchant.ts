import type { CommandArg } from '@hot/shared';

export const MERCHANT_PRICES = [0.1, 0.1, 0.2, 0.25] as const;
export type MerchantKind = 'buy' | 'sell';
export type MerchantAmounts = [number, number, number, number];

const int = (value: unknown): number => parseInt(String(value), 10) || 0;

export function merchantAmounts(values: unknown[]): MerchantAmounts {
  return [int(values[0]), int(values[1]), int(values[2]), int(values[3])];
}

/** The original client ceils each buy row and floors each sell row, then floors the total. */
export function merchantGold(amounts: MerchantAmounts, kind: MerchantKind): number {
  const round = kind === 'buy' ? Math.ceil : Math.floor;
  return Math.floor(
    amounts.reduce((sum, count, index) => sum + round(count * MERCHANT_PRICES[index]!), 0),
  );
}

export function merchantSingleGold(amounts: MerchantAmounts): number {
  return amounts.reduce((sum, count, index) => sum + count * MERCHANT_PRICES[index]!, 0);
}

export function merchantAfterGold(current: number, total: number, kind: MerchantKind): number {
  return kind === 'buy' ? current - total : current + total;
}

export function merchantError(
  amounts: MerchantAmounts,
  times: number,
  level: number,
): 'amount' | 'times' | 'limit' | null {
  if (amounts.some((n) => n < 0) || amounts.every((n) => n === 0)) return 'amount';
  if (times < 1) return 'times';
  if (merchantSingleGold(amounts) > level * 100000) return 'limit';
  return null;
}

export function merchantArgs(
  amounts: MerchantAmounts,
  times: number,
  paytype: number,
): CommandArg[] {
  return [...amounts, times, paytype];
}

export function maxMerchantAmount(
  index: number,
  amounts: MerchantAmounts,
  available: number,
  level: number,
  kind: MerchantKind,
): number {
  const cap = Math.min(available, level * 100000);
  const other = amounts.reduce((sum, count, i) => {
    if (i === index) return sum;
    const round = kind === 'buy' ? Math.ceil : Math.floor;
    return sum + round(count * MERCHANT_PRICES[i]!);
  }, 0);
  return Math.max(0, Math.floor((cap - other) / MERCHANT_PRICES[index]!));
}
