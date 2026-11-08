import { beforeAll, describe, expect, it } from 'vitest';
import {
  battleShopGoodTip,
  groupBattleShopGoods,
  medalChangeRate,
  parseBattleShopGood,
  parseBattleShopGroups,
  parseBattleShopInfo,
  parseMedalExchangeInfo,
  parseMedalRecord,
  type BattleShopState,
} from './battleShop';
import { setStrings } from '../i18n';

beforeAll(() => {
  setStrings({
    Battle_BattleChoiceDialog_4_2: '战场道具',
    Battle_BattleChoiceDialog_ChibiBattle: '赤壁之战',
    Battle_BattleChoiceDialog_ChibiBattleCross: '赤壁之战(跨服)',
    Battle_BattleChoiceDialog_ChibiShop: '赤壁商城',
    Battle_BattleChoiceDialog_MenhuoShop: '孟获商城',
    Tooltip_BattleShopGoodsTip_1_1: '统率',
    Tooltip_BattleShopGoodsTip_9_1: '防御',
    Tooltip_BattleShopGoodsTip_15_1: '等级 \n初始属性 ',
    Tooltip_BattleShopGoodsTip_17_1: '统率 ',
    Tooltip_BattleShopGoodsTip_18_1: '内政 ',
    Tooltip_BattleShopGoodsTip_19_1: '勇武 ',
    Tooltip_BattleShopGoodsTip_20_1: '智谋 ',
    Tooltip_ArmorTooltip_28_1: '需要等级: ',
    Tooltip_BattleShopGoodsTip_26_1: ' 荣誉',
    Shop_ShopDialog_9_2: '功勋',
    Shop_ShopDialog_9_3: '赤壁功勋',
    Battle_BattleShopGoodsTip_1: '战场成就要求 : ',
    Battle_BattleShopGoodsTip_2: '勋绩',
    Tooltip_ArmorTooltip_32_1: '战场等级要求：',
    Battle_BattleChoiceDialogSrc_31_1: '初入不毛',
    Battle_BattleChoiceDialogSrc_31_2: '平蛮有功',
    Battle_BattleChoiceDialogSrc_31_3: '威震南蛮',
  });
});

describe('parseBattleShopInfo', () => {
  const armorRow = { id: 300, name: '名将装备', attribute: '2,1,15,9,20', hero_level: 12 };
  const heroRow = { id: 500, name: '黄金将领', level: 33, command_base: 75 };
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
    [armorRow],
    [heroRow],
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

  it('keeps the armor / hero rows and the tail tallies of the reply', () => {
    const shop = parseBattleShopInfo([...reply], true);
    expect(shop.armorAry).toEqual([armorRow]); // initArmorAndHeroGoods' mArmorMap source
    expect(shop.heroAry).toEqual([heroRow]); // mHeroMap
    expect(shop.battleArea).toBe(0); // mUserBattleArea
    expect(shop.pveLevel).toBe(-1); // mMenghuoAchievementLevel
    expect(shop.shachangScore).toBe(0);
  });

  it('reads a shop-less reply as just the hall battles', () => {
    const shop = parseBattleShopInfo([[{ id: 2001 }]], false);
    expect(shop.flag).toBe(0);
    expect(shop.battles).toEqual([{ id: 2001 }]);
    expect(shop.goods).toEqual([]);
    expect(shop.armorAry).toEqual([]);
    expect(shop.heroAry).toEqual([]);
  });
});

describe('parseBattleShopGroups', () => {
  it('lists 战场道具, one entry per battle, then the 赤壁 / 孟获商城 tabs', () => {
    expect(
      parseBattleShopGroups([
        { id: 2001, name: '官渡之战', type: 0 },
        { id: 11000, name: '赤壁之战', type: 5 },
        { id: 9001, name: '七擒孟获', type: 5 },
      ]),
    ).toEqual([
      { name: '战场道具', battleId: 1, type: 0 },
      { name: '官渡之战', battleId: 2001, type: 0 },
      { name: '赤壁之战(跨服)', battleId: 11000, type: 5 },
      { name: '七擒孟获', battleId: 9001, type: 5 },
      { name: '赤壁商城', battleId: 2, type: 1 },
      { name: '孟获商城', battleId: 3, type: 1 },
    ]);
  });

  it('keeps just 战场道具 and the battles when 11000 / 9001 are closed', () => {
    expect(parseBattleShopGroups([{ id: 2001, name: '官渡之战', type: 0 }])).toEqual([
      { name: '战场道具', battleId: 1, type: 0 },
      { name: '官渡之战', battleId: 2001, type: 0 },
    ]);
  });
});

describe('groupBattleShopGoods', () => {
  it('buckets the goods by battleBelong in the tab order, dropping strays', () => {
    const groups = parseBattleShopGroups([{ id: 2001, name: '官渡之战', type: 0 }]);
    const general = parseBattleShopGood({ id: 31, gid: 139, battleBelong: '1', group: 6 });
    const battle = parseBattleShopGood({ id: 32, gid: 140, battleBelong: '2001', group: 6 });
    const stray = parseBattleShopGood({ id: 33, gid: 141, battleBelong: '7777', group: 6 });
    expect(groupBattleShopGoods([general, stray, battle], groups)).toEqual([[general], [battle]]);
  });
});

describe('battleShopGoodTip', () => {
  const shop = (): BattleShopState => ({
    flag: 0,
    battles: [],
    gongxun: 40,
    battleArea: 3,
    todayWarCount: 0,
    maxDayCount: 5,
    goods: [],
    armorAry: [{ id: 300, attribute: '2,1,15,9,20', hero_level: 12 }],
    heroAry: [
      { id: 500, level: 33, command_base: 75, affairs_base: 61, bravery_base: 88, wisdom_base: 70 },
    ],
    honour: 5000,
    pveLevel: 4,
    shachangScore: 0,
  });

  it('prices a plain good and appends the armor attribute row of a type-1 good', () => {
    const good = parseBattleShopGood({
      id: 121,
      gid: 300,
      name: '名将装备箱',
      description: '说明',
      battlegoodstype: 1,
      battleBelong: '1',
      medalName: '汉室勋章',
      creditPrice: 200,
      medalPrice: 10,
      totalCount: 2147483647,
      group: 6,
    });
    expect(battleShopGoodTip(good, shop())).toEqual({
      title: '名将装备箱',
      text:
        '200 荣誉\n10 汉室勋章\n说明\n' +
        "<font color='#00FF00'>+15 统率 +20 防御 \n 需要等级: 12</font>",
    });
  });

  it('appends the hero stats of a type-2 good', () => {
    const good = parseBattleShopGood({
      id: 41,
      gid: 500,
      name: '黄金将领',
      description: '',
      battlegoodstype: 2,
      battleBelong: '1',
      medalName: '汉室勋章',
      creditPrice: 50,
      medalPrice: 2,
      totalCount: 2147483647,
      group: 6,
    });
    expect(battleShopGoodTip(good, shop()).text).toBe(
      '50 荣誉\n2 汉室勋章\n\n' +
        "<font color='#00FF00'>33等级 \n初始属性 75统率 61内政 88勇武 70智谋 </font>",
    );
  });

  it('prices a 赤壁 armor in 赤壁功勋 and a group-7 armor in 功勋', () => {
    const chibi = parseBattleShopGood({
      gid: 300,
      battlegoodstype: 1,
      battleBelong: '11000',
      medalName: '赤壁勋章',
      creditPrice: 9,
      medalPrice: 3,
      group: 6,
    });
    expect(battleShopGoodTip(chibi, shop()).text.startsWith('9赤壁功勋\n3 赤壁勋章')).toBe(true);
    const cross = parseBattleShopGood({
      gid: 300,
      battlegoodstype: 1,
      battleBelong: '1',
      medalName: '汉室勋章',
      creditPrice: 9,
      medalPrice: 3,
      group: 7,
    });
    expect(battleShopGoodTip(cross, shop()).text.startsWith(' \n3 功勋')).toBe(true);
  });

  it('paints the group-7 requirement red when the level gate is unmet', () => {
    const cross = parseBattleShopGood({
      gid: 300,
      battlegoodstype: 1,
      battleBelong: '1',
      creditPrice: 20,
      group: 7,
    });
    expect(
      battleShopGoodTip(cross, shop()).text.endsWith(
        "战场等级要求：<font color='#FF0000'>20</font></font>",
      ),
    ).toBe(true);
    const menghuo = parseBattleShopGood({
      gid: 300,
      battlegoodstype: 1,
      battleBelong: '9001',
      creditPrice: 3,
      group: 7,
    });
    // credit 3 ≤ pveLevel 4 → the achievement name stays unpainted
    expect(
      battleShopGoodTip(menghuo, shop()).text.endsWith(
        " \n <font color='#00FF00'>战场成就要求 : 平蛮有功</font>",
      ),
    ).toBe(true);
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
