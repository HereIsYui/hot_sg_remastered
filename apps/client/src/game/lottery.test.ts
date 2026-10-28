import { describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  findWinItemIndex,
  flattenGoods,
  lotteryItemImage,
  lotteryWinFailText,
  parseAutoGetReward,
  parseLotteryRound,
  parseWinReply,
} from './lottery';

setStrings({
  Lottery_NoMoney: '你的元宝不足，请充值',
  Lottery_FullPlayCount: '已经玩过了,等待下次。',
});

const roundReply = [[[{ gid: 13, count: 1 }], [{ id: 9001, count: 1 }]], 0, 13, 1, 0, 2];

describe('parseLotteryRound', () => {
  it('splits the grade arrays and the win fields', () => {
    const round = parseLotteryRound(roundReply);
    expect(round).toEqual({
      levels: [[{ gid: 13, count: 1 }], [{ id: 9001, count: 1 }]],
      winType: 0,
      winId: 13,
      winCnt: 1,
      restartCount: 0,
      todayCount: 2,
    });
  });
});

describe('flattenGoods', () => {
  it('keeps every good exactly once and honors a fixed rng', () => {
    const round = parseLotteryRound(roundReply);
    const goods = flattenGoods(round, () => 0);
    expect(goods).toHaveLength(2);
    expect(goods).toContainEqual({ gid: 13, count: 1 });
    expect(goods).toContainEqual({ id: 9001, count: 1 });
  });
});

describe('findWinItemIndex', () => {
  it('matches gid or id with the count', () => {
    const goods = [
      { gid: 20, count: 1 },
      { gid: 13, count: 1 },
      { id: 9001, count: 2 },
    ];
    expect(findWinItemIndex(goods, 13, 1)).toBe(1);
    expect(findWinItemIndex(goods, 9001, 2)).toBe(2);
    expect(findWinItemIndex(goods, 9001, 1)).toBe(-1);
  });
});

describe('lotteryItemImage', () => {
  it('goods rows use item_/pack_, armor rows armor/', () => {
    expect(lotteryItemImage({ gid: 13, image: 0 })).toBe('images/item_13.png');
    expect(lotteryItemImage({ gid: 13, image: 7 })).toBe('images/pack_7.png');
    expect(lotteryItemImage({ id: 9001, image: 0 })).toBe('images/armor/9001.png');
    expect(lotteryItemImage(null)).toBe('');
  });
});

describe('parseAutoGetReward', () => {
  // autoGetReward replies [winObj, records, win0, win1, win2, restartCount, todayCount] — the
  // fresh round's getGoodsBase output flattened behind the win row.
  it('splits the win row and the fresh round, gtype per gid', () => {
    const result = parseAutoGetReward([{ gid: 13, count: 1 }, ...roundReply]);
    expect(result.gtype).toBe(0);
    expect(result.win).toEqual({ gid: 13, count: 1 });
    expect(result.round.winId).toBe(13);
    const armor = parseAutoGetReward([{ id: 9001, count: 1 }, ...roundReply]);
    expect(armor.gtype).toBe(1);
  });
});

describe('parseWinReply / lotteryWinFailText', () => {
  it('parses the startLottery reply (with the count) and restart (without)', () => {
    expect(parseWinReply([0, 13, 1, 3])).toEqual({
      winType: 0,
      winId: 13,
      winCnt: 1,
      todayCount: 3,
    });
    expect(parseWinReply([0, 13, 1])).toEqual({
      winType: 0,
      winId: 13,
      winCnt: 1,
      todayCount: null,
    });
  });

  it('maps the -1/-2 fail ids to the texts', () => {
    expect(lotteryWinFailText(-1)).toBe('你的元宝不足，请充值');
    expect(lotteryWinFailText(-2)).toBe('已经玩过了,等待下次。');
    expect(lotteryWinFailText(13)).toBe('');
  });
});
