import { describe, expect, it } from 'vitest';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { RandomService } from '../core/random.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { HeroExprCommands } from './hero-expr.commands';
import { FakeDb, type Respond } from './fake-db.testutil';

const lang = new LangService({
  heroexpr: {
    hero_expr_hero_not_kong: '该将领不是空闲状态',
    hero_expr_count_reach_max: '本城同时进行历练的将领数已达到最大人数5名',
    hero_expr_not_enough_gold: '本城拥有的黄金数不够',
    hero_expr_not_enough_money: '你的元宝数目不够',
    hero_expr_time_error: '请设置历练时间,“%s”时间在“%s”到“%s”之间',
    toomany_hero_expr: '同时进行历练的将领数为2名…',
  },
  user_hero: { cannot_expr: '君主将不能历练' },
  waigua: { invalid: '非法操作' },
});

const ctx = { uid: 1001, cid: 209355, ip: 0, sip: '' };

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const goods = {
    checkGoods: async () => true,
    reduceGoods: async () => {},
  } as unknown as GoodsRules;
  const tasks = { completeTaskWithTaskid: async () => {} } as unknown as TaskRules;
  const random = new RandomService();
  const users = {
    logUserAction: async () => {},
    logActionCountback: async () => {},
  } as unknown as UserRules;
  const cmd = new HeroExprCommands(db.scope, lang, goods, tasks, random, users);
  return { cmd, db };
}

const NOW = (ts: number): Respond => ({
  match: /select unix_timestamp\(\)/i,
  rows: [{ 'unix_timestamp()': ts }],
});
const NO = (match: RegExp): Respond => ({ match, rows: [] });

describe('HeroExprCommands.beginExprHero', () => {
  it('rejects a hero that is not idle', async () => {
    const { cmd } = build([
      NOW(2_000_000_000),
      NO(/from sys_user_state/i),
      {
        match: /select state, level, herotype from sys_city_hero/i,
        rows: [{ state: 10, level: 5, herotype: 0 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.beginExprHero(ctx, [80213, 209355, 1, 2, 0])).rejects.toThrow(
      'heroexpr.hero_expr_hero_not_kong',
    );
  });

  it('rejects the 君主将', async () => {
    const { cmd } = build([
      NOW(2_000_000_000),
      NO(/from sys_user_state/i),
      {
        match: /select state, level, herotype from sys_city_hero/i,
        rows: [{ state: 0, level: 5, herotype: 1000 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.beginExprHero(ctx, [80213, 209355, 1, 2, 0])).rejects.toThrow(
      'user_hero.cannot_expr',
    );
  });

  it('returns a soft-cap prompt at the 2-slot limit', async () => {
    const { cmd } = build([
      NOW(2_000_000_000),
      NO(/from sys_user_state/i),
      {
        match: /select state, level, herotype from sys_city_hero/i,
        rows: [{ state: 0, level: 5, herotype: 0 }],
      },
      { match: /from mem_user_buffer/i, rows: [] },
      { match: /count\(1\) from sys_hero_expr/i, rows: [{ 'count(1)': 2 }] },
      NO(/.*/),
    ]);
    const res = await cmd.beginExprHero(ctx, [80213, 209355, 1, 2, 0]);
    expect(res[0]).toBe(1);
    expect(String(res[1])).toContain('同时进行历练');
  });

  it('rejects a time outside the type band', async () => {
    const { cmd } = build([
      NOW(2_000_000_000),
      NO(/from sys_user_state/i),
      {
        match: /select state, level, herotype from sys_city_hero/i,
        rows: [{ state: 0, level: 5, herotype: 0 }],
      },
      { match: /from mem_user_buffer/i, rows: [] },
      { match: /count\(1\) from sys_hero_expr/i, rows: [{ 'count(1)': 0 }] },
      {
        match: /from cfg_hero_expr_types[\s\S]*type =/i,
        rows: [{ name: '修身养性', hour_money: 0, hour_gold: 10, min_hour: 1, max_hour: 8 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.beginExprHero(ctx, [80213, 209355, 1, 99, 0])).rejects.toThrow(
      /hero_expr_time_error/,
    );
  });

  it('pays gold and money, queues the expr, and marks the hero state 10 on success', async () => {
    const { cmd, db } = build([
      NOW(2_000_000_000),
      NO(/from sys_user_state/i),
      {
        match: /select state, level, herotype from sys_city_hero/i,
        rows: [{ state: 0, level: 5, herotype: 0 }],
      },
      { match: /from mem_user_buffer/i, rows: [] },
      { match: /count\(1\) from sys_hero_expr/i, rows: [{ 'count(1)': 0 }] },
      {
        match: /from cfg_hero_expr_types[\s\S]*type =/i,
        rows: [{ name: '修身养性', hour_money: 100, hour_gold: 10, min_hour: 1, max_hour: 8 }],
      },
      { match: /select gold from mem_city_resource/i, rows: [{ gold: 100000 }] },
      { match: /select money from sys_user/i, rows: [{ money: 100000 }] },
      NO(/.*/),
    ]);
    const res = await cmd.beginExprHero(ctx, [80213, 209355, 1, 2, 50]);
    expect(res).toEqual([0]);
    // gold cost = level 5 * hours 2 * hour_gold 10 = 100
    expect(
      db.executed.some((q) => /set gold = gold - /i.test(q.sql) && q.parameters.includes(100)),
    ).toBe(true);
    // money cost = carry 50 + hours 2 * hour_money 100 = 250, logged as -250
    expect(
      db.executed.some((q) => /insert into log_money/i.test(q.sql) && q.parameters.includes(-250)),
    ).toBe(true);
    expect(db.executed.some((q) => /insert into sys_hero_expr/i.test(q.sql))).toBe(true);
    expect(
      db.executed.some((q) => /set state = \?/i.test(q.sql) && q.parameters.includes(10)),
    ).toBe(true);
  });
});

describe('HeroExprCommands.fasterHeroExpr', () => {
  it('急召令: ends a cancelled expr, refunds gold and grants experience', async () => {
    const { cmd, db } = build([
      {
        match: /select \* from sys_hero_expr where hid/i,
        rows: [{ state: 1, carrymoney: 40, hours: 2, exp_add: 10 }],
      },
      NOW(1_000),
      NO(/.*/),
    ]);
    await cmd.fasterHeroExpr(ctx, [80213]);
    // carried 40 refunded
    expect(
      db.executed.some((q) => /insert into log_money/i.test(q.sql) && q.parameters.includes(40)),
    ).toBe(true);
    // expr deleted and hero freed with exp bonus
    expect(db.executed.some((q) => /delete from sys_hero_expr where hid/i.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /set state = 0, exp = exp \+/i.test(q.sql))).toBe(true);
  });

  it('通关文书: shortens a running expr by at least the 30-minute floor', async () => {
    const curTime = 1_000_000;
    const endtime = curTime + 1000; // only 1000s left -> 30% = 300 < 1800 floor
    const { cmd, db } = build([
      { match: /select \* from sys_hero_expr where hid/i, rows: [{ state: 0, endtime }] },
      NOW(curTime),
      NO(/.*/),
    ]);
    await cmd.fasterHeroExpr(ctx, [80213]);
    const upd = db.executed.find((q) => /set endtime = .*accTimes = accTimes \+ 1/is.test(q.sql));
    // newEndTime = cur + (end - cur - reduce) with reduce floored to 1800
    expect(upd?.parameters).toContain(curTime + (endtime - curTime - 1800));
  });

  it('raises not_enough_goods when the item is missing', async () => {
    const db = new FakeDb([
      {
        match: /select \* from sys_hero_expr where hid/i,
        rows: [{ state: 1, carrymoney: 0, hours: 1, exp_add: 0 }],
      },
      NO(/.*/),
    ]);
    const goods = {
      checkGoods: async () => false,
      reduceGoods: async () => {},
    } as unknown as GoodsRules;
    const tasks = { completeTaskWithTaskid: async () => {} } as unknown as TaskRules;
    const users = {
      logUserAction: async () => {},
      logActionCountback: async () => {},
    } as unknown as UserRules;
    const cmd = new HeroExprCommands(db.scope, lang, goods, tasks, new RandomService(), users);
    await expect(cmd.fasterHeroExpr(ctx, [80213])).rejects.toBeInstanceOf(GameError);
  });
});
