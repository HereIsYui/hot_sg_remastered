import { beforeAll, describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  parseUserBuyList,
  parseUserSellData,
  playerPrice,
  playerPriceRange,
  playerSellArgs,
  playerSellPriceError,
} from './market-trade';

beforeAll(() => {
  setStrings({
    Market_AutoTransDialogSrc_1: '粮食',
    Market_AutoTransDialogSrc_2: '木材',
    Market_AutoTransDialogSrc_3: '石料',
    Market_AutoTransDialogSrc_4: '铁锭',
    Market_AutoTransDialogSrc_5: '黄金',
    Market_MarketUserSellDialogSrc_1: '价格错误',
    Market_MarketUserSellDialogSrc_2: '没有联盟',
    Market_MarketUserSellDialogSrc_3: '时间错误',
    _Utils_5: '小时',
    _Utils_6: '分',
    _Utils_7: '秒',
  });
});

describe('player trades', () => {
  it('computes prices and validates the original boundaries', () => {
    expect(playerPrice(100, 10)).toBe(0.1);
    expect(playerPriceRange(2)).toEqual([0.16, 0.24]);
    expect(playerSellPriceError(0, 0.08, 1, false, 0)).toBeNull();
    expect(playerSellPriceError(0, 0.07, 1, false, 0)).toBe('Market_MarketUserSellDialogSrc_1');
    expect(playerSellPriceError(0, 0.1, 1, true, 0)).toBe('Market_MarketUserSellDialogSrc_2');
    expect(playerSellPriceError(0, 0.1, 0, false, 0)).toBe('Market_MarketUserSellDialogSrc_3');
    expect(playerSellArgs(0, 100, 10, 2, true)).toEqual([0, 100, 10, 2, 1]);
  });

  it('parses sell data and the buy list with travel time', () => {
    expect(parseUserSellData([2, 15, 0.1, 0.1, 0.2, 0.25])).toEqual({
      used: 2,
      total: 15,
      prices: [0.1, 0.1, 0.2, 0.25],
    });
    const ret = parseUserBuyList(
      [1, 15, 1, 0, [{ id: 7, cid: 209355, restype: 0, count: 100 }]],
      209355,
    );
    expect(ret.rows[0]).toMatchObject({ id: 7, resname: '粮食', needtime: '00秒' });
  });
});
