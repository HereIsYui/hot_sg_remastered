import { describe, expect, it } from 'vitest';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityInfoService } from '../city/city-info.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { HonorCommands } from './honor.commands';

const lang = new LangService({
  designation: {
    designation_not_exist: '您的新称号不存在',
    offDesignation_not_exist: '您的称号已经不存在',
  },
  buyGoods: { no_medal: '你的%s数量不够' },
  largessHero: { cant_find_hero: '找不到该将领。' },
  pairse: { cant_largess_out_hero: '不能给不在城池内的将领嘉赏。' },
  useGoods: { king_cannot_use: '君主将不能使用该物品' },
  good: { not_enough_goods83: '没有足够的此商品，请先购买' },
  HeroFunc: {
    hufu1: 'h1',
    hufu4: 'h4',
    mabian: '汗血马鞭后再用马鞭',
    armorType_is_wrong: '坐骑品质不对',
  },
  act: { msg_tip: 'MSG_ACTTIP|%s' },
  useLuBanGoods: { invalid_param: '参数错误', no_enough_goods: '数量不足' },
  enhanceHero: { exceedMaxLimit: '不能再吃了' },
  user_hero: { cannot_use_goods: '该物品不能用在君主将身上。' },
});

const ctx = { uid: 1001, cid: 209355, ip: 0, sip: '' };
const NOW = 2_000_000_000;
const NO = (match: RegExp): Respond => ({ match, rows: [] });
const CATCH_ALL = NO(/.*/);
const CLOCK = { match: /select unix_timestamp\(\)/i, rows: [{ 'unix_timestamp()': NOW }] };

/** `select count from sys_goods where uid = ? and gid = ?` (the praise count and checkGoods). */
const GOODS_COUNT = (rows: Record<string, unknown>[]): Respond => ({
  match: /from sys_goods\s+where uid = \? and gid = \?/i,
  rows,
});
/** The `select 1 from mem_hero_buffer where hid = ? and buftype = ?` repeat-use checks. */
const HERO_BUF = (rows: Record<string, unknown>[], params?: unknown[]): Respond => ({
  match: /mem_hero_buffer\s+where hid = \? and buftype = \?(?! and endtime)/i,
  rows,
  params,
});
/** checkSpecialCondition's stored-buff lookup (`endtime >= ?`). */
const STORED_BUF = (rows: Record<string, unknown>[]): Respond => ({
  match: /mem_hero_buffer\s+where hid = \? and buftype = \? and endtime >= \?/i,
  rows,
});
/** A city hero as `select * from sys_city_hero` returns it. */
const HERO = (over: Record<string, unknown> = {}) => ({
  hid: 80213,
  uid: 1001,
  cid: 209355,
  name: '部将',
  state: 0,
  herotype: 0,
  level: 30,
  ...over,
});
const CITY_HERO = (over: Record<string, unknown> = {}): Respond => ({
  match: /where cid = \? and uid = \? and hid = \?/i,
  rows: [HERO(over)],
});
const REGEN_HERO = (over: Record<string, unknown> = {}): Respond => ({
  match: /select \* from sys_city_hero\s+where hid = \? and uid = \?/i,
  rows: [HERO(over)],
});

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const users = new UserRules(db.scope);
  const cmd = new HonorCommands(
    db.scope,
    lang,
    { heroInfo: async () => [['heroInfo']] } as unknown as CityInfoService,
    new GoodsRules(db.scope),
    new HeroRules(db.scope),
    new TaskRules(db.scope, users),
    users,
  );
  return { cmd, db };
}

async function errorOf(run: () => Promise<unknown>): Promise<GameError> {
  try {
    await run();
  } catch (err) {
    return err as GameError;
  }
  throw new Error('expected the command to fail');
}

describe('HonorCommands.loadUserDetail', () => {
  const DETAIL = /from sys_user u\s+left join sys_union un/i;

  it('replaces nobility with the 推恩令 buffed rank', async () => {
    const { cmd } = build([
      {
        match: DETAIL,
        rows: [{ userid: 1002, name: '李四', nobility: '3', rank: 5, people: 800 }],
      },
      { match: /mem_user_buffer/i, rows: [{ bufparam: 5 }] },
      CATCH_ALL,
    ]);
    expect(await cmd.loadUserDetail(ctx, [1002])).toEqual([
      { userid: 1002, name: '李四', nobility: 8, rank: 5, people: 800 },
    ]);
  });

  it('answers a bare nobility row for a missing player (the auto-vivified false)', async () => {
    const { cmd } = build([
      { match: DETAIL, rows: [] },
      { match: /mem_user_buffer/i, rows: [{ bufparam: 2 }] },
      CATCH_ALL,
    ]);
    expect(await cmd.loadUserDetail(ctx, [9999])).toEqual([{ nobility: 2 }]);
  });
});

describe('HonorCommands.loadUserDetailInfo', () => {
  it('answers the panel cells and the city list of the session user', async () => {
    const { cmd } = build([
      { match: /sum\(m\.people\)/i, rows: [{ 'sum(m.people)': 1234 }] },
      { match: /count\(\*\) from sys_city_hero where uid/i, rows: [{ 'count(*)': 2 }] },
      { match: /select state from sys_user/i, rows: [{ state: 0 }] },
      { match: /endtime from mem_user_buffer/i, rows: [] },
      {
        match: /from sys_city c, mem_city_resource m/i,
        rows: [{ cid: 209355, name: '长乐宫', people: 100, level: 5, heroes: 2 }],
      },
      CATCH_ALL,
    ]);
    expect(await cmd.loadUserDetailInfo(ctx)).toEqual([
      1234,
      2,
      0,
      false,
      [{ cid: 209355, name: '长乐宫', people: 100, level: 5, heroes: 2 }],
    ]);
  });
});

describe('HonorCommands.changeUserDesignation', () => {
  const DESIGNATION = (rows: Record<string, unknown>[]): Respond => ({
    match: /from sys_user_designation/i,
    rows,
  });

  it('wears a designation the player owns and answers its name', async () => {
    const { cmd, db } = build([
      DESIGNATION([{ uid: 1001, did: 5, ison: 0, state: 1 }]),
      { match: /from cfg_designation/i, rows: [{ name: '破虏将军' }] },
      CATCH_ALL,
    ]);
    expect(await cmd.changeUserDesignation(ctx, [5, 0])).toEqual(['破虏将军', 5]);
    const updates = db.executed.filter((e) => /update sys_user_designation/i.test(e.sql));
    expect(updates.map((u) => u.parameters)).toEqual([[1001], [1001, 5]]);
  });

  it('refuses a designation the player does not own', async () => {
    const { cmd } = build([DESIGNATION([]), CATCH_ALL]);
    await expect(cmd.changeUserDesignation(ctx, [5, 0])).rejects.toThrow(
      'designation.designation_not_exist',
    );
  });

  it('takes the current designation off and answers ["", 0]', async () => {
    const { cmd, db } = build([DESIGNATION([{ uid: 1001, did: 5, ison: 1, state: 1 }]), CATCH_ALL]);
    expect(await cmd.changeUserDesignation(ctx, [-1, 5])).toEqual(['', 0]);
    const updates = db.executed.filter((e) => /update sys_user_designation/i.test(e.sql));
    expect(updates).toHaveLength(1);
  });

  it('refuses to take off a designation that is gone', async () => {
    const { cmd } = build([DESIGNATION([]), CATCH_ALL]);
    await expect(cmd.changeUserDesignation(ctx, [-1, 5])).rejects.toThrow(
      'designation.offDesignation_not_exist',
    );
  });
});

describe('HonorCommands.medalChange', () => {
  const JOIN = /from cfg_things a, cfg_battle_field b/i;
  const MEDAL = /from sys_things\s+where tid = \? and uid = \?/i;
  const HS = /from sys_things\s+where uid = \? and tid = 30000/i;

  it('exchanges 平定黄巾勋章 at 20 per 汉室勋章', async () => {
    const { cmd, db } = build([
      { match: JOIN, rows: [{ name: '平定黄巾勋章', type: 0 }] },
      { match: MEDAL, rows: [{ uid: 1001, tid: 30001, count: 25 }] },
      { match: HS, rows: [{ uid: 1001, tid: 30000, count: 3 }] },
      CATCH_ALL,
    ]);
    expect(await cmd.medalChange(ctx, ['1', '30001'])).toEqual([]);
    const updates = db.executed.filter((e) => /update sys_things/i.test(e.sql));
    // 汉室勋章 3 + 1, then 平定黄巾勋章 25 - 20
    expect(updates[0]!.parameters).toEqual(['1', 1001]);
    expect(updates[1]!.parameters).toEqual([20, 1001, '30001']);
  });

  it('inserts the 汉室勋章 row the first time', async () => {
    const { cmd, db } = build([
      { match: JOIN, rows: [{ name: '袁军官渡勋章', type: 1 }] },
      { match: MEDAL, rows: [{ uid: 1001, tid: 30002, count: 10 }] },
      { match: HS, rows: [] },
      CATCH_ALL,
    ]);
    await cmd.medalChange(ctx, ['1', '30002']);
    expect(db.executed.some((e) => /insert into sys_things/i.test(e.sql))).toBe(true);
  });

  it('exchanges 曹军官渡勋章 at the special 12 rate', async () => {
    const { cmd, db } = build([
      { match: JOIN, rows: [{ name: '曹军官渡勋章', type: 1 }] },
      { match: MEDAL, rows: [{ uid: 1001, tid: 30003, count: 12 }] },
      { match: HS, rows: [{ uid: 1001, tid: 30000, count: 0 }] },
      CATCH_ALL,
    ]);
    await cmd.medalChange(ctx, ['1', '30003']);
    const updates = db.executed.filter((e) => /update sys_things/i.test(e.sql));
    expect(updates[1]!.parameters).toEqual([12, 1001, '30003']);
  });

  it('refuses when the stock is short and names the medal', async () => {
    const { cmd } = build([
      { match: JOIN, rows: [{ name: '平定黄巾勋章', type: 0 }] },
      { match: MEDAL, rows: [{ uid: 1001, tid: 30001, count: 15 }] },
      CATCH_ALL,
    ]);
    const err = await errorOf(() => cmd.medalChange(ctx, ['1', '30001']));
    expect(err).toBeInstanceOf(GameError);
    expect(lang.messageOf(err)).toBe('你的平定黄巾勋章数量不够');
  });

  it('refuses when the player owns no such medal', async () => {
    const { cmd } = build([
      { match: JOIN, rows: [{ name: '平定黄巾勋章', type: 0 }] },
      { match: MEDAL, rows: [] },
      CATCH_ALL,
    ]);
    await expect(cmd.medalChange(ctx, ['1', '30001'])).rejects.toBeInstanceOf(GameError);
  });
});

describe('HonorCommands.getMedalRecord', () => {
  it('returns the joined medal stock rows as they are', async () => {
    const { cmd } = build([
      {
        match: /from sys_things as A, cfg_things as B/i,
        rows: [{ uid: 1001, tid: 30000, count: 3, name: '汉室勋章' }],
      },
      CATCH_ALL,
    ]);
    expect(await cmd.getMedalRecord(ctx)).toEqual([
      { uid: 1001, tid: 30000, count: 3, name: '汉室勋章' },
    ]);
  });
});

describe('HonorCommands.praiseHero', () => {
  it('answers null for a gid outside every praise family', async () => {
    const { cmd } = build([CATCH_ALL]);
    expect(await cmd.praiseHero(ctx, ['praiseHero', 209355, 80213, 160052])).toBeUndefined();
  });

  it('newPraiseHero: a 赤壁虎符 becomes a one-hour buffer named by the gid', async () => {
    const { cmd, db } = build([
      CITY_HERO(),
      REGEN_HERO(),
      HERO_BUF([]),
      GOODS_COUNT([{ count: 2 }]),
      CLOCK,
      CATCH_ALL,
    ]);
    expect(await cmd.praiseHero(ctx, ['praiseHero', 209355, 80213, '160040'])).toEqual([
      ['heroInfo'],
    ]);
    const buffer = db.executed.find((e) => /insert into mem_hero_buffer/i.test(e.sql))!;
    expect(buffer.parameters).toEqual([80213, 160040]);
    expect(buffer.sql).toContain('unix_timestamp() + 3600');
    const goods = db.executed.find((e) => /insert into sys_goods/i.test(e.sql))!;
    expect(goods.parameters).toEqual([1001, 160040, -1, -1]);
    const log = db.executed.find((e) => /log_goods/i.test(e.sql))!;
    expect(log.parameters).toEqual([1001, 160040, -1, 7]);
  });

  it('newPraiseHero: the old-style 虎符 buff blocks the whole family', async () => {
    const { cmd } = build([CITY_HERO(), HERO_BUF([{ buftype: 1 }], [80213, 1]), CATCH_ALL]);
    await expect(cmd.praiseHero(ctx, ['praiseHero', 209355, 80213, '160041'])).rejects.toThrow(
      'HeroFunc.hufu1',
    );
  });

  it('newPraiseHero: refuses the lord hero and an out-of-city hero', async () => {
    const lord = build([CITY_HERO({ herotype: 1000 }), CATCH_ALL]);
    await expect(lord.cmd.praiseHero(ctx, ['praiseHero', 209355, 80213, '160040'])).rejects.toThrow(
      'useGoods.king_cannot_use',
    );
    const away = build([CITY_HERO({ state: 10 }), CATCH_ALL]);
    await expect(away.cmd.praiseHero(ctx, ['praiseHero', 209355, 80213, '160040'])).rejects.toThrow(
      'pairse.cant_largess_out_hero',
    );
  });

  it('newPraiseHero: refuses when the item is missing', async () => {
    const { cmd } = build([CITY_HERO(), HERO_BUF([]), GOODS_COUNT([]), CATCH_ALL]);
    await expect(cmd.praiseHero(ctx, ['praiseHero', 209355, 80213, '160026'])).rejects.toThrow(
      'not_enough_goods160026',
    );
  });

  it('oldPraiseHero: the old 虎符 clears the 赤壁 ones and grants the one-day buff', async () => {
    const { cmd, db } = build([
      CITY_HERO(),
      REGEN_HERO(),
      GOODS_COUNT([{ count: 2 }]),
      { match: /mem_hero_buffer\s+where buftype in/i, rows: [{ buftype: 160040 }] },
      HERO_BUF([]),
      { match: /chiefhid from sys_city/i, rows: [{ chiefhid: 80213 }] },
      CATCH_ALL,
    ]);
    await cmd.praiseHero(ctx, ['praiseHero', 209355, 80213, '26']);
    const deletes = db.executed.filter((e) => /delete from mem_hero_buffer/i.test(e.sql));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.parameters).toEqual([160040, 160041, 160042, 80213]);
    const buffer = db.executed.find((e) => /insert into mem_hero_buffer/i.test(e.sql))!;
    expect(buffer.parameters).toEqual([80213, 1]);
    expect(buffer.sql).toContain('unix_timestamp() + 86400');
    const goods = db.executed.find((e) => /insert into sys_goods/i.test(e.sql))!;
    expect(goods.parameters).toEqual([1001, 26, -1, -1]);
    // the hero is the city chief, so the resource add-ons are marked for recalculation
    expect(db.executed.some((e) => /update sys_city_res_add/i.test(e.sql))).toBe(true);
  });

  it('oldPraiseHero: 武曲星符 (28) and 文曲星符 (27) complete their growth tasks', async () => {
    const rules = [
      CITY_HERO(),
      REGEN_HERO(),
      GOODS_COUNT([{ count: 2 }]),
      { match: /mem_hero_buffer\s+where buftype in/i, rows: [] },
      HERO_BUF([]),
      { match: /chiefhid from sys_city/i, rows: [{ chiefhid: 80213 }] },
      { match: /cfg_task_goal/i, rows: [{ id: 9001 }] },
      CATCH_ALL,
    ];
    const wuqu = build(rules);
    await wuqu.cmd.praiseHero(ctx, ['praiseHero', 209355, 80213, '28']);
    expect(wuqu.db.executed.find((e) => /cfg_task_goal/i.test(e.sql))!.parameters).toEqual([300]);
    expect(
      wuqu.db.executed.find((e) => /replace into sys_user_goal/i.test(e.sql))!.parameters,
    ).toEqual([1001, 9001]);
    const wenqu = build(rules);
    await wenqu.cmd.praiseHero(ctx, ['praiseHero', 209355, 80213, '27']);
    expect(wenqu.db.executed.find((e) => /cfg_task_goal/i.test(e.sql))!.parameters).toEqual([301]);
  });

  it('oldPraiseHero: 马鞭 needs a grade-4/5 mount and grants a one-hour 19057 buff', async () => {
    const { cmd, db } = build([
      CITY_HERO(),
      REGEN_HERO(),
      GOODS_COUNT([{ count: 1 }]),
      { match: /from cfg_armor c/i, rows: [{ type: 4 }] },
      STORED_BUF([]),
      CLOCK,
      CATCH_ALL,
    ]);
    await cmd.praiseHero(ctx, ['praiseHero', 209355, 80213, '19082']);
    const buffer = db.executed.find((e) => /insert into mem_hero_buffer/i.test(e.sql))!;
    expect(buffer.parameters).toEqual([80213, 19057]);
    expect(buffer.sql).toContain('unix_timestamp() + 3600');
    const goods = db.executed.find((e) => /insert into sys_goods/i.test(e.sql))!;
    expect(goods.parameters).toEqual([1001, 19082, -1, -1]);
  });

  it('oldPraiseHero: 马鞭 without a proper mount is refused', async () => {
    const { cmd } = build([
      CITY_HERO(),
      GOODS_COUNT([{ count: 1 }]),
      { match: /from cfg_armor c/i, rows: [] },
      CATCH_ALL,
    ]);
    await expect(cmd.praiseHero(ctx, ['praiseHero', 209355, 80213, '19082'])).rejects.toThrow(
      'HeroFunc.armorType_is_wrong',
    );
  });

  it('oldPraiseHero: 马鞭 is refused while a 汗血马鞭 buff is on', async () => {
    const { cmd } = build([
      CITY_HERO(),
      GOODS_COUNT([{ count: 1 }]),
      { match: /from cfg_armor c/i, rows: [{ type: 5 }] },
      STORED_BUF([{ buftype: 19058, endtime: NOW + 100 }]),
      CLOCK,
      CATCH_ALL,
    ]);
    await expect(cmd.praiseHero(ctx, ['praiseHero', 209355, 80213, '19082'])).rejects.toThrow(
      'HeroFunc.mabian',
    );
  });

  it('oldPraiseHero: the 一级 command pill raises the base attribute and logs the use', async () => {
    const { cmd, db } = build([
      CITY_HERO(),
      REGEN_HERO(),
      GOODS_COUNT([{ count: 5 }]),
      { match: /select herotype from sys_city_hero/i, rows: [{ herotype: 0 }] },
      { match: /select max\(time\) from log_act/i, rows: [] },
      { match: /select sum\(count\) from log_act/i, rows: [{ 'sum(count)': 10 }] },
      CATCH_ALL,
    ]);
    expect(await cmd.praiseHero(ctx, ['praiseHero', 209355, 80213, '10152'])).toEqual([
      ['heroInfo'],
    ]);
    const baseAdd = db.executed.find((e) => /insert into sys_city_hero_base_add/i.test(e.sql))!;
    expect(baseAdd.parameters).toEqual([1001, 80213, 0, 0, 0, 1, 4]);
    const hero = db.executed.find((e) => /update sys_city_hero set bravery_base/i.test(e.sql))!;
    expect(hero.parameters).toEqual([0, 0, 0, 1, 80213]);
    const act = db.executed.find((e) => /insert into log_act/i.test(e.sql))!;
    expect(act.parameters).toEqual([1001, 80213, 10152, 4]);
  });

  it('oldPraiseHero: a pill past its lifetime cap spends nothing and appends the tip', async () => {
    const { cmd, db } = build([
      CITY_HERO(),
      REGEN_HERO(),
      GOODS_COUNT([{ count: 5 }]),
      { match: /select herotype from sys_city_hero/i, rows: [{ herotype: 0 }] },
      { match: /select max\(time\) from log_act/i, rows: [] },
      { match: /select sum\(count\) from log_act/i, rows: [{ 'sum(count)': 50 }] },
      CATCH_ALL,
    ]);
    const ret = (await cmd.praiseHero(ctx, ['praiseHero', 209355, 80213, '10152'])) as unknown[];
    expect(ret).toEqual([['heroInfo'], 'MSG_ACTTIP|不能再吃了']);
    expect(db.executed.some((e) => /insert into log_act/i.test(e.sql))).toBe(false);
  });

  it('oldPraiseHero: the 二级 pill adds two points per copy', async () => {
    const { cmd, db } = build([
      CITY_HERO(),
      REGEN_HERO(),
      GOODS_COUNT([{ count: 5 }]),
      { match: /select herotype from sys_city_hero/i, rows: [{ herotype: 0 }] },
      { match: /select max\(time\) from log_act/i, rows: [] },
      { match: /select sum\(count\) from log_act/i, rows: [{ 'sum(count)': 0 }] },
      CATCH_ALL,
    ]);
    await cmd.praiseHero(ctx, ['praiseHero', 209355, 80213, '19204']);
    const baseAdd = db.executed.find((e) => /insert into sys_city_hero_base_add/i.test(e.sql))!;
    expect(baseAdd.parameters).toEqual([1001, 80213, 0, 0, 0, 2, 4]);
  });

  it('oldPraiseHero: refuses the lord hero before spending anything', async () => {
    const { cmd, db } = build([CITY_HERO({ herotype: 1000 }), CATCH_ALL]);
    await expect(cmd.praiseHero(ctx, ['praiseHero', 209355, 80213, '10152'])).rejects.toThrow(
      'useGoods.king_cannot_use',
    );
    expect(db.executed.some((e) => /insert into/i.test(e.sql))).toBe(false);
  });
});
