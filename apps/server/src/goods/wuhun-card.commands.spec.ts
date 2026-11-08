import { describe, expect, it, vi } from 'vitest';
import { LangService } from '../common/lang.service';
import { HotelRules } from '../city/hotel-rules.service';
import { CityRules } from '../core/city-rules.service';
import { AchievementRules } from '../core/achievement-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { RandomService, ScriptedRandom, sequenceSource } from '../core/random.service';
import { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { TaskRewards } from '../task/task-rewards.service';
import { CommittedMessage, DefaultBoxService } from './default-box.service';
import { cardQuality, WuhunCardCommands, wuhunGid } from './wuhun-card.commands';
const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };
function build(rules: Respond[] = []) {
  const db = new FakeDb(rules),
    scripted = new ScriptedRandom(),
    random = new RandomService(scripted);
  const lang = new LangService({
    useGoods: { genWuHunByRumor_getsuipian: 'fragment', genWuHunBySuipian_succ: 'success' },
    goods: { get_hero: 'hero %s' },
    recruitHero: { hotel_level_low: 'full' },
  });
  const users = new UserRules(db.scope),
    achievements = { finishAchievement: vi.fn() } as unknown as AchievementRules;
  const goods = new GoodsRules(db.scope, achievements),
    heroes = {
      regenerateHeroAttri: vi.fn(),
      updateCityHeroChange: vi.fn(),
    } as unknown as HeroRules;
  const hotel = new HotelRules(db.scope, random);
  const cmd = new WuhunCardCommands(
    db.scope,
    lang,
    goods,
    heroes,
    users,
    random,
    hotel,
    new CityRules(db.scope),
  );
  const box = new DefaultBoxService(
    db.scope,
    lang,
    goods,
    {} as TaskRewards,
    users,
    random,
    hotel,
    heroes,
  );
  return { db, cmd, box, goods, scripted, achievements, heroes };
}
describe('W5 PHP compatibility without a database', () => {
  it('keeps every inclusive quality boundary', () => {
    expect([1, 60, 61, 90, 91, 97, 98, 99, 100].map((n) => wuhunGid(123, n))).toEqual([
      110123, 110123, 120123, 120123, 130123, 130123, 140123, 140123, 150123,
    ]);
    expect([888, 889, 989, 990, 999, 1000, 1005].map(cardQuality)).toEqual([4, 3, 3, 2, 2, 1, 1]);
  });
  it('keeps the portrait and null reply gid', async () => {
    const { db, cmd, scripted } = build([
      { match: /select count from sys_goods/, rows: [{ count: 1 }] },
      { match: /select count from sys_things/, rows: [{ count: 1 }] },
    ]);
    expect(
      await scripted.run(sequenceSource([0]), () => cmd.genWuHunByRumor(ctx, [20123])),
    ).toEqual([null, 0, 'fragment']);
    expect(db.executed.some((q) => /update sys_things|insert into log_things/.test(q.sql))).toBe(
      false,
    );
    expect(db.executed.find((q) => /insert into sys_goods/.test(q.sql))?.parameters).toEqual([
      1001, 100123, 1, 1,
    ]);
  });
  it('consumes one fragment with banner and still draws the guaranteed-success roll', async () => {
    const { db, cmd, scripted } = build([
      { match: /select count from sys_goods/, rows: [{ count: 1 }] },
    ]);
    expect(
      await scripted.run(sequenceSource([99, 60]), () => cmd.genWuHunBySuipian(ctx, [100123, '1'])),
    ).toEqual([100123, 0, 'success']);
    expect(db.executed.find((q) => /insert into sys_goods/.test(q.sql))?.parameters[1]).toBe(
      120123,
    );
    const logs = db.executed.filter((q) => /insert into .?log_goods/.test(q.sql));
    expect(logs.map((q) => q.parameters.slice(0, 3))).toContainEqual([1001, 100123, -1]);
    expect(logs.map((q) => q.parameters.slice(0, 3))).toContainEqual([1001, 148, -1]);
  });
  it('rejects closed cards before inspecting inputs or inventory', async () => {
    const { db, cmd } = build();
    await expect(cmd.mixCard(ctx, [])).rejects.toMatchObject({ key: 'goods.not_available' });
    await expect(cmd.multiUseCard(ctx, [])).rejects.toMatchObject({ key: 'goods.not_available' });
    expect(db.executed).toHaveLength(2);
    expect(db.executed.every((q) => /state = 197/.test(q.sql))).toBe(true);
  });
  it('uses a strict synthesis threshold and retains the original card on failure', async () => {
    const { db, cmd, scripted } = build([
      { match: /select value from mem_state/, rows: [{ value: 60 }] },
      { match: /select count from sys_goods/, rows: [{ count: 1 }] },
    ]);
    await scripted.run(sequenceSource([3]), () => cmd.mixCard(ctx, [240123, 240124]));
    const logs = db.executed.filter((q) => /insert into .?log_goods/.test(q.sql));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.parameters.slice(0, 3)).toEqual([1001, 240124, -1]);
    expect(logs[0]!.parameters.at(-1)).toBe(251);
    expect(db.executed.some((q) => /insert into sys_goods/.test(q.sql))).toBe(false);
  });
  it.each([false, true])(
    'commits earlier mix materials before a missing %s original/later material error',
    async (missingOriginal) => {
      const { db, cmd, scripted } = build([
        { match: /select value from mem_state/, rows: [{ value: 60 }] },
        { match: /select count from sys_goods/, params: [1001, 240124], rows: [{ count: 1 }] },
      ]);
      const transaction = db.scope.transaction.bind(db.scope);
      let committed = false;
      vi.spyOn(db.scope, 'transaction').mockImplementation(async (fn) => {
        const result = await transaction(fn);
        committed = true;
        return result;
      });
      await expect(
        scripted.run(sequenceSource([0]), () =>
          cmd.mixCard(ctx, missingOriginal ? [240123, 240124] : [240123, 240124, 240125]),
        ),
      ).rejects.toMatchObject({ key: 'useGoods.no_this_good' });
      expect(committed).toBe(true);
      const logs = db.executed.filter((q) => /insert into .?log_goods/.test(q.sql));
      expect(logs).toHaveLength(1);
      expect(logs[0]!.parameters.slice(0, 3)).toEqual([1001, 240124, -1]);
    },
  );
  it('summons card heroes with escaped force column and PHP deterministic stats', async () => {
    const { db, cmd, scripted, heroes } = build([
      { match: /select value from mem_state/, rows: [{ value: 60 }] },
      { match: /select level from sys_building/, rows: [{ level: 10 }] },
      { match: /select count/, rows: [{ count: 1 }] },
      {
        match: /select \* from cfg_npc_hero/,
        rows: [
          { name: 'A', sex: 1, face: 1049, affairs_base: 60, bravery_base: 80, wisdom_base: 62 },
        ],
      },
      { match: /select command_base/, rows: [{ command_base: 100 }] },
      { match: /insert into sys_city_hero/, insertId: 42 },
    ]);
    await scripted.run(sequenceSource([5, 5, 5, 0]), () =>
      cmd.generateHero4Card(1001, 2001, 240123),
    );
    const blood = db.executed.find((q) => /insert into mem_hero_blood/.test(q.sql))!;
    expect(blood.sql).toContain('`force`');
    expect(blood.parameters).toEqual([42, 117, 117, 113, 113]);
    expect(heroes.regenerateHeroAttri).toHaveBeenCalledWith(1001, 42);
    expect(heroes.updateCityHeroChange).toHaveBeenCalledWith(1001, 2001);
  });
  it('extends an existing wuhun buffer even on a busy hero and skips regeneration', async () => {
    const { db, cmd } = build([
      { match: /select count from sys_goods/, rows: [{ count: 1 }] },
      { match: /select \* from sys_city_hero/, rows: [{ cid: 2001, state: 1 }] },
      { match: /select \* from mem_hero_buffer/, rows: [{ endtime: 1 }] },
    ]);
    await cmd.useWuHun(1001, 42, 110123);
    expect(db.executed.some((q) => /endtime = endtime \+ 86400/.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /insert into sys_city_hero_base_add/.test(q.sql))).toBe(false);
  });
  it('counts all negative wuhun reasons but only type zero for gid 158', async () => {
    const { db, goods, achievements } = build([{ match: /select -sum/, rows: [{ used: 30 }] }]);
    await goods.reduceGoods(1001, 110123, 1, 9);
    await goods.reduceGoods(1001, 158, 1, 9);
    expect(achievements.finishAchievement).toHaveBeenNthCalledWith(1, 1001, 30);
    expect(achievements.finishAchievement).toHaveBeenNthCalledWith(2, 1001, 70016);
    const sums = db.executed.filter((q) => /select -sum/.test(q.sql));
    expect(sums[0]!.sql).not.toContain('type = 0');
    expect(sums[1]!.sql).toContain('type = 0');
  });
  it('allows answer rewards without a prior question and preserves literal message', async () => {
    const { db, cmd } = build();
    expect(await cmd.afterUseShenMiChuanYinFu(ctx, ["a'b\\c"])).toEqual([]);
    expect(db.executed.some((q) => /select.*sys_goods/.test(q.sql))).toBe(false);
    expect(db.executed.find((q) => /insert into `?sys_inform/.test(q.sql))?.parameters).toContain(
      "a'b\\c",
    );
    expect(db.executed.find((q) => /insert into .?log_goods/.test(q.sql))?.parameters.at(-1)).toBe(
      9,
    );
  });
  it('consumes an already opened hero box even when the hotel is full', async () => {
    const { db, box } = build([
      { match: /select count from sys_goods/, rows: [{ count: 1 }] },
      { match: /select \* from cfg_box_details/, rows: [{ sort: 7, type: 1, rate: 1, count: 99 }] },
    ]);
    expect(await box.open(1001, 2001, 12345)).toEqual(new CommittedMessage('full'));
    expect(db.executed.some((q) => /update sys_goods/.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /insert into sys_city_hero/.test(q.sql))).toBe(false);
  });
  it('draws discarded loyalty, gives one hero and starts blood at 100', async () => {
    const { db, box, scripted } = build([
      { match: /select level from sys_building/, rows: [{ level: 10 }] },
      { match: /select count\(\*\)/, rows: [{ count: 0 }] },
      {
        match: /select \* from cfg_recruit_hero/,
        rows: [
          {
            heroname: 'A',
            herotype: 7,
            sex: 0,
            level: 10,
            min_affairs_base: 30,
            max_affairs_base: 30,
            min_bravery_base: 60,
            max_bravery_base: 60,
            min_wisdom_base: 30,
            max_wisdom_base: 30,
            min_loyalty: 5,
            max_loyalty: 10,
          },
        ],
      },
      { match: /insert into sys_city_hero/, insertId: 42 },
      { match: /select total_exp/, rows: [{ total_exp: 1000 }] },
    ]);
    expect(
      await scripted.run(sequenceSource([0, 0, 0, 5, 8]), () =>
        box.openDefaultHeroBox(1001, 2001, 0, 1),
      ),
    ).toEqual(new CommittedMessage('hero A'));
    const hero = db.executed.find((q) => /insert into sys_city_hero/.test(q.sql))!;
    expect(hero.parameters.slice(0, 5)).toEqual([1001, 'A', 0, 9, 2001]);
    expect(hero.sql).toContain('70');
    expect(db.executed.find((q) => /insert into mem_hero_blood/.test(q.sql))?.parameters[0]).toBe(
      42,
    );
    expect(db.executed.find((q) => /insert into mem_hero_blood/.test(q.sql))?.sql).toContain(
      '`force`',
    );
    expect(db.executed.some((q) => /insert into log_act/.test(q.sql))).toBe(false);
  });
});
