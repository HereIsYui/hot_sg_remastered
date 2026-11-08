import { describe, expect, it, vi } from 'vitest';
import { CityInfoService } from '../city/city-info.service';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { RandomService, ScriptedRandom, sequenceSource } from '../core/random.service';
import { TaskRules } from '../core/task-rules.service';
import { TaskRewards } from '../task/task-rewards.service';
import { FakeDb } from './fake-db.testutil';
import { HonorCommands } from '../honor/honor.commands';
import { UserRules } from '../core/user-rules.service';
import { HeroItemCommands } from './hero-item.commands';
import { HeroExprRewardCommands } from './hero-expr-reward.commands';
import { KingCommands } from './king.commands';

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };
const lang = new LangService({});
function setup() {
  const db = new FakeDb();
  const goods = {
    addGoods: vi.fn(),
    reduceGoods: vi.fn(),
    checkGoodsCount: vi.fn(async () => true),
  };
  const scripted = new ScriptedRandom();
  const random = new RandomService(scripted);
  const info = { heroInfo: vi.fn(async () => ['heroes']) };
  const heroes = { regenerateHeroAttri: vi.fn() };
  const tasks = { completeTaskWithTaskid: vi.fn() };
  const rewards = { addArmor: vi.fn(), addMoney: vi.fn() };
  return {
    db,
    praise: new HonorCommands(
      db.scope,
      lang,
      info as unknown as CityInfoService,
      goods as unknown as GoodsRules,
      heroes as unknown as HeroRules,
      tasks as unknown as TaskRules,
      {} as UserRules,
    ),
    goods,
    random,
    scripted,
    rewards,
    info,
    heroes,
    king: new KingCommands(db.scope, lang, goods as unknown as GoodsRules, random),
    item: new HeroItemCommands(
      db.scope,
      lang,
      info as unknown as CityInfoService,
      goods as unknown as GoodsRules,
      heroes as unknown as HeroRules,
      tasks as unknown as TaskRules,
    ),
    claim: new HeroExprRewardCommands(
      db.scope,
      goods as unknown as GoodsRules,
      rewards as unknown as TaskRewards,
      random,
    ),
  };
}

describe('W6 hero items', () => {
  it('direct largess accepts a king for buffs, uses dummy parameter, and extends a one-hour chibi buff', async () => {
    const s = setup();
    s.db.setRules([
      { match: /select \* from sys_city_hero/, rows: [{ herotype: 1000, state: 7 }] },
      { match: /select count from sys_goods/, rows: [{ count: 1 }] },
    ]);
    expect(await s.item.largessHeroWithGid(ctx, ['ignored', 200, 300, 160023])).toEqual(['heroes']);
    expect(s.goods.addGoods).toHaveBeenCalledWith(1001, 160023, -1, 7);
    const insert = s.db.executed.find((q) => q.sql.includes('insert into mem_hero_buffer'))!;
    expect(insert.parameters).toEqual([300, 160023, 3600, 3600]);
  });

  for (const entry of ['direct', 'praise'] as const) {
    const call = (s: ReturnType<typeof setup>, gid: number) =>
      entry === 'direct'
        ? s.item.largessHeroWithGid(ctx, ['', 200, 300, gid])
        : s.praise.praiseHero(ctx, ['', 200, 300, gid]);
    it(`${entry}: weakest chibi hufu refuses medium/strong buffs in PHP order`, async () => {
      for (const [existing, error] of [
        [160041, 'HeroFunc.hufu2'],
        [160042, 'HeroFunc.hufu3'],
      ] as const) {
        const s = setup();
        s.db.setRules([
          { match: /select \* from sys_city_hero/, rows: [{ state: 0 }] },
          { match: /select count from sys_goods/, rows: [{ count: 1 }] },
          { match: /select 1 from mem_hero_buffer/, params: [300, existing], rows: [{ found: 1 }] },
        ]);
        await expect(call(s, 160040)).rejects.toThrow(error);
        expect(s.goods.addGoods).not.toHaveBeenCalled();
      }
    });
    it(`${entry}: strongest chibi hufu clears weak then medium before consuming`, async () => {
      const s = setup();
      s.db.setRules([
        { match: /select \* from sys_city_hero/, rows: [{ state: 0 }] },
        { match: /select count from sys_goods/, rows: [{ count: 1 }] },
        ...[160040, 160041].map((gid) => ({
          match: /select 1 from mem_hero_buffer/,
          params: [300, gid],
          rows: [{ found: 1 }],
        })),
      ]);
      await call(s, 160042);
      expect(
        s.db.executed
          .filter((q) => q.sql.startsWith('delete from mem_hero_buffer'))
          .map((q) => q.parameters),
      ).toEqual([
        [300, 160040],
        [300, 160041],
      ]);
      expect(s.goods.addGoods).toHaveBeenCalledWith(1001, 160042, -1, 7);
    });
  }

  it('checks inventory before chibi conflicts and does not consume missing items', async () => {
    const s = setup();
    s.db.setRules([{ match: /select \* from sys_city_hero/, rows: [{ state: 0 }] }]);
    await expect(s.item.largessHeroWithGid(ctx, ['', 200, 300, 160028])).rejects.toThrow(
      'not_enough_goods160028',
    );
    expect(s.db.executed.some((q) => q.sql.includes('mem_user_buffer'))).toBe(false);
    expect(s.goods.addGoods).not.toHaveBeenCalled();
  });
});

describe('W6 king study', () => {
  it('checks all requested books before checking the maximum level', async () => {
    const s = setup();
    s.goods.checkGoodsCount.mockResolvedValue(false);
    await expect(s.king.addUserLevelTimes(ctx, [3])).rejects.toThrow('good.not_enough_goods83');
    expect(s.db.executed).toHaveLength(0);
  });

  it('consumes RNG even when the guarantee succeeds and adds level-one command', async () => {
    const s = setup();
    s.db.setRules([
      { match: /select level, count from sys_user_level/, rows: [{ level: 0, count: 0 }] },
      { match: /select level from sys_city_hero/, rows: [{ level: 1 }] },
    ]);
    const draw = vi.spyOn(s.random, 'randRange');
    await s.scripted.run(sequenceSource([9999]), () => s.king.addUserLevelTimes(ctx, [1]));
    expect(draw).toHaveBeenCalledWith(1, 10000);
    expect(s.goods.reduceGoods).toHaveBeenCalledWith(1001, 10961, 1);
    expect(s.db.executed.find((q) => q.sql.startsWith('update sys_city_hero'))?.parameters).toEqual(
      [10, 0, 0, 0, 1001],
    );
  });

  it('returns a level-limit message without consuming a book or RNG', async () => {
    const s = setup();
    s.db.setRules([{ match: /select level, count/, rows: [{ level: 1, count: 4 }] }]);
    const draw = vi.spyOn(s.random, 'randRange');
    const result = await s.king.addUserLevelTimes(ctx, [2]);
    expect(result[2]).toBe('user_hero.limit_level');
    expect(draw).not.toHaveBeenCalled();
    expect(s.goods.reduceGoods).not.toHaveBeenCalled();
  });
});

describe('W6 deferred expr rewards', () => {
  it('claims trailing-comma goods, logs/deletes them, commits before success exception', async () => {
    const s = setup();
    s.db.setRules([
      {
        match: /from sys_hero_expr_reward/,
        rows: [
          {
            uid: 1001,
            cid: 200,
            hid: 300,
            type: 1,
            sort: 1,
            money: 2,
            details: '30,31,',
            endtime: 9999999999,
          },
        ],
      },
      { match: /select money/, rows: [{ money: 2 }] },
    ]);
    const transaction = s.db.scope.transaction.bind(s.db.scope);
    let committed = false;
    vi.spyOn(s.db.scope, 'transaction').mockImplementation(async (fn) => {
      const result = await transaction(fn);
      committed = true;
      return result;
    });
    await expect(s.claim.finishCommonExpr(ctx, [9])).rejects.toThrow('heroexpr.get_reward_success');
    expect(committed).toBe(true);
    expect(s.goods.addGoods.mock.calls).toEqual([
      [1001, 30, 1, 10],
      [1001, 31, 1, 10],
    ]);
    expect(s.rewards.addMoney).toHaveBeenCalledWith(1001, -2, 121);
    expect(s.db.executed.at(-1)?.sql).toContain('delete from sys_hero_expr_reward');
  });

  it('rejects expired rewards before reading balance', async () => {
    const s = setup();
    s.db.setRules([{ match: /from sys_hero_expr_reward/, rows: [{ endtime: 1 }] }]);
    await expect(s.claim.finishCommonExpr(ctx, [9])).rejects.toThrow('heroexpr.reward_timeout');
    expect(s.db.executed).toHaveLength(1);
  });

  it('uses TaskRewards for equipment with the expr log reason', async () => {
    const s = setup();
    s.db.setRules([
      {
        match: /from sys_hero_expr_reward/,
        rows: [{ uid: 1001, sort: 3, money: 0, details: '100', endtime: 9999999999 }],
      },
    ]);
    await expect(s.claim.finishCommonExpr(ctx, [9])).rejects.toThrow('heroexpr.get_reward_success');
    expect(s.rewards.addArmor).toHaveBeenCalledWith(1001, 100, 1, 10);
  });

  it('adds repeated base attributes without clamping or regenerating the hero', async () => {
    const s = setup();
    s.db.setRules([
      {
        match: /from sys_hero_expr_reward/,
        rows: [
          {
            uid: 1001,
            hid: 300,
            sort: 4,
            money: 0,
            details: '3,1,-5,1,2,5,9',
            endtime: 9999999999,
          },
        ],
      },
    ]);
    await expect(s.claim.finishCommonExpr(ctx, [9])).rejects.toThrow('heroexpr.get_reward_success');
    const update = s.db.executed.find((q) => q.sql.startsWith('update sys_city_hero'))!;
    expect(update.parameters).toEqual([-3, 0, 0, 0, 9, 0, 300]);
    expect(update.sql).not.toContain('greatest');
    expect(s.heroes.regenerateHeroAttri).not.toHaveBeenCalled();
  });

  it('recognizes a zero-strength armor through its encoded level and caps upgrades at ten', async () => {
    const s = setup();
    s.db.setRules([
      {
        match: /from sys_hero_expr_reward/,
        rows: [{ uid: 1001, sort: 6, money: 0, details: '99', endtime: 9999999999 }],
      },
      { match: /select strong_level/, rows: [{ level: 10 }] },
      { match: /from cfg_strong_probability/, rows: [{ level: 1, strong_value: 5 }] },
    ]);
    await expect(s.claim.finishCommonExpr(ctx, [9])).rejects.toThrow('heroexpr.get_reward_success');
    expect(
      s.db.executed.find((q) => q.sql.includes('from cfg_strong_probability'))?.parameters,
    ).toEqual([0]);
    expect(
      s.db.executed.find((q) => q.sql.startsWith('update sys_user_armor'))?.parameters,
    ).toEqual([5, 1, 1001, '99']);
  });

  it('rejects a missing draft queue without charging or deleting the claim', async () => {
    const s = setup();
    s.db.setRules([
      {
        match: /from sys_hero_expr_reward/,
        rows: [{ uid: 1001, sort: 8, money: 0, details: '20', endtime: 9999999999 }],
      },
    ]);
    await expect(s.claim.finishCommonExpr(ctx, [9])).rejects.toThrow('heroexpr.no_draftqueue');
    expect(s.rewards.addMoney).not.toHaveBeenCalled();
    expect(s.db.executed.some((q) => q.sql.startsWith('delete'))).toBe(false);
  });

  it('reduces the selected active queue and derives its end time from its start', async () => {
    const s = setup();
    s.db.setRules([
      {
        match: /from sys_hero_expr_reward/,
        rows: [{ uid: 1001, cid: 200, sort: 8, money: 0, details: '25', endtime: 9999999999 }],
      },
      {
        match: /from sys_city_draftqueue/,
        rows: [{ id: 10, needtime: 101, state: 1, state_starttime: 1000 }],
      },
    ]);
    await expect(s.claim.finishCommonExpr(ctx, [9])).rejects.toThrow('heroexpr.get_reward_success');
    expect(
      s.db.executed.find((q) => q.sql.startsWith('update sys_city_draftqueue'))?.parameters,
    ).toEqual([75, 10]);
    expect(
      s.db.executed.find((q) => q.sql.startsWith('update mem_city_draft'))?.parameters,
    ).toEqual([1000, 75, 10]);
  });
});
