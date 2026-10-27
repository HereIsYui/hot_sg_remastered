import { describe, expect, it } from 'vitest';
import {
  maxMerchantAmount,
  merchantAfterGold,
  merchantArgs,
  merchantError,
  merchantGold,
} from './market-merchant';

describe('merchant trades', () => {
  it('rounds buy rows up and sell rows down', () => {
    expect(merchantGold([15, 15, 15, 15], 'buy')).toBe(11);
    expect(merchantGold([15, 15, 15, 15], 'sell')).toBe(8);
  });

  it('checks amounts, times and the single-trade cap', () => {
    expect(merchantError([0, 0, 0, 0], 1, 15)).toBe('amount');
    expect(merchantError([1, 0, 0, 0], 0, 15)).toBe('times');
    expect(merchantError([15000001, 0, 0, 0], 1, 15)).toBe('limit');
    expect(merchantError([100, 0, 0, 0], 1, 15)).toBeNull();
  });

  it('computes after-gold, max amounts and command args', () => {
    expect(merchantAfterGold(100, 10, 'buy')).toBe(90);
    expect(merchantAfterGold(100, 10, 'sell')).toBe(110);
    expect(maxMerchantAmount(0, [0, 0, 0, 0], 1000, 1, 'buy')).toBe(10000);
    expect(merchantArgs([1, 2, 3, 4], 2, 1)).toEqual([1, 2, 3, 4, 2, 1]);
  });
});
