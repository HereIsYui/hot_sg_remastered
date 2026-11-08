import { describe, expect, it } from 'vitest';
import {
  medalChangeRate,
  parseBattleShopGood,
  parseBattleShopInfo,
  parseMedalExchangeInfo,
  parseMedalRecord,
} from './battleShop';

describe('parseBattleShopInfo', () => {
  const reply = [
    0,
    [{ id: 2001, name: '官渡之战' }],
    0,
    0,
    2,
    5,
    [
      {
        id: 31,
        gid: 139,
        name: '双倍荣誉卡',
        description: '说明',
        image: 0,
        battlegoodstype: 0,
        battleBelong: '1',
        medalName: '汉室勋章',
        creditPrice: 100,
        medalPrice: 5,
        totalCount: 2147483647,
        userbuycnt: 0,
        daybuycnt: 0,
        group: 6,
      },
      {
        id: 121,
        gid: 300,
        name: '名将装备箱',
        description: '',
        image: 7,
        battlegoodstype: 1,
        battleBelong: '1',
        medalName: '汉室勋章',
        creditPrice: 200,
        medalPrice: 10,
        totalCount: 10,
        userbuycnt: 3,
        daybuycnt: 0,
        group: 6,
      },
    ],
    [],
    [],
    5000,
    -1,
    0,
  ];

  it('splits the reply and decorates the goods', () => {
    const shop = parseBattleShopInfo([...reply], true);
    expect(shop.flag).toBe(0);
    expect(shop.battles).toEqual([{ id: 2001, name: '官渡之战' }]);
    expect(shop.todayWarCount).toBe(2);
    expect(shop.maxDayCount).toBe(5);
    expect(shop.honour).toBe(5000);
    expect(shop.goods).toHaveLength(2);
    expect(shop.goods[0]).toMatchObject({
      id: 31,
      imageName: 'item_139',
      limit: '',
      medalPrice: 5,
      creditPrice: 100,
    });
    expect(shop.goods[1]).toMatchObject({
      imageName: 'armor/7',
      limit: '限量销售，剩余10待售。',
    });
  });

  it('reads a shop-less reply as just the hall battles', () => {
    const shop = parseBattleShopInfo([[{ id: 2001 }]], false);
    expect(shop.flag).toBe(0);
    expect(shop.battles).toEqual([{ id: 2001 }]);
    expect(shop.goods).toEqual([]);
  });
});

describe('parseBattleShopGood image naming', () => {
  it('prefixed the group-6 hero rows with battle_item_', () => {
    const good = parseBattleShopGood({
      gid: 500,
      image: 0,
      group: 6,
      battlegoodstype: 2,
      totalCount: 2147483647,
    });
    expect(good.imageName).toBe('battle_item_500');
  });

  it('kept pack_ images for plain goods', () => {
    expect(
      parseBattleShopGood({ gid: 1, image: 9, group: 0, totalCount: 2147483647 }).imageName,
    ).toBe('pack_9');
  });
});

describe('medal dialogs', () => {
  it('maps the exchange rows and their rate line', () => {
    const rows = parseMedalExchangeInfo([
      ['平定黄巾勋章', 30001, 20, 3],
      ['曹军官渡勋章', 30003, 12, 0],
    ]);
    expect(rows).toEqual([
      { name: '平定黄巾勋章', tid: 30001, rate: 20, count: 3 },
      { name: '曹军官渡勋章', tid: 30003, rate: 12, count: 0 },
    ]);
    expect(medalChangeRate(rows[0]!)).toBe('20平定黄巾勋章=1汉室勋章');
  });

  it('maps the record rows', () => {
    expect(
      parseMedalRecord([
        [
          { name: '汉室勋章', count: 7 },
          { name: '袁军官渡勋章', count: 2 },
        ],
      ]),
    ).toEqual([
      { name: '汉室勋章', count: 7 },
      { name: '袁军官渡勋章', count: 2 },
    ]);
  });
});
