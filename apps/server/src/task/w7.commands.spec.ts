import { describe, expect, it, vi } from 'vitest';
import { LangService } from '../common/lang.service';
import type { CommandContext } from '../gateway/decorators';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { HotelCommands } from '../hero/hotel.commands';
import { TaskCommands } from './task.commands';

const ctx = { uid: 1001, cid: 1002 } as CommandContext;
const lang = new LangService({});

function fixture(rules: Respond[] = []) {
  const db = new FakeDb(rules);
  const rewards = {
    giveResource: vi.fn(),
    giveReward: vi.fn(),
    reduceGoal: vi.fn(),
    finishAchievement: vi.fn(),
    deleteHeroBaseAdd: vi.fn(),
  };
  const report = { sendReport: vi.fn() };
  const goals = {
    goalsOf: vi.fn().mockResolvedValue([]),
    isGoalComplete: vi.fn().mockResolvedValue(true),
  };
  // ConstructorParameters preserves the production dependency order while lightweight stubs avoid DB access.
  const task = new TaskCommands(
    ...([db.scope, lang, {}, goals, rewards, {}, {}, report] as unknown as ConstructorParameters<
      typeof TaskCommands
    >),
  );
  const random = { mtRand: vi.fn().mockReturnValue(100) };
  const goods = { addGoods: vi.fn() };
  const users = { logUserAction: vi.fn(), sendSysInform: vi.fn() };
  const heroes = { regenerateHeroAttri: vi.fn(), updateCityHeroChange: vi.fn() };
  const mail = { send: vi.fn() };
  const armor = { armorListReply: vi.fn().mockResolvedValue(['armor-reply']) };
  const hotel = new HotelCommands(
    ...([
      db.scope,
      lang,
      {},
      { cityHasHeroPosition: vi.fn().mockResolvedValue(true) },
      {},
      goods,
      heroes,
      {},
      rewards,
      {},
      users,
      report,
      random,
      mail,
      armor,
    ] as unknown as ConstructorParameters<typeof HotelCommands>),
  );
  return { db, task, hotel, rewards, report, random, goods, users, armor, heroes, mail };
}

describe('W7 task compatibility', () => {
  it('pays a commission at 90%, deletes every receiver row, and reports the full posted reward', async () => {
    const f = fixture([
      {
        match: /select \* from sys_user_reward_task/,
        rows: [{ tid: 200001, state: '-1', targetcid: 12003 }],
      },
      {
        match: /select uid, todo, money, targetcid/,
        rows: [{ uid: 1002, todo: 'commission', money: '101' }],
      },
    ]);
    expect(await f.task.getReward(ctx, [200001])).toEqual([1]);
    expect(f.rewards.giveResource).toHaveBeenCalledWith(1001, -1, 20, 90.9);
    const deletion = f.db.executed.find((q) =>
      q.sql.startsWith('delete from sys_user_reward_task'),
    )!;
    expect(deletion.sql).not.toContain('uid');
    expect(f.report.sendReport).toHaveBeenCalledWith(1002, 34, 12003, 12003, 'recordTask.report');
  });

  it('rejects an unfinished commission before granting anything', async () => {
    const f = fixture([{ match: /select \* from sys_user_reward_task/, rows: [{ state: 0 }] }]);
    await expect(f.task.getReward(ctx, [200001])).rejects.toMatchObject({
      key: 'getReward.task_not_finished',
    });
    expect(f.rewards.giveResource).not.toHaveBeenCalled();
  });

  it('rejects equality at the Huangjin batch cap but accepts equality for Dongzhuo', async () => {
    const rules: Respond[] = [
      { match: /select maxvalue, curvalue from/, rows: [{ maxvalue: 10, curvalue: 8 }] },
      { match: /select count\(\*\) from dongzhuo_progress/, rows: [{ count: 1 }] },
    ];
    const f = fixture(rules);
    await expect(f.task.getMultiReward(ctx, [11001, 2])).rejects.toMatchObject({
      key: 'getReward.not_enough_remain',
    });
    expect(await f.task.getMultiReward(ctx, [15001, 2])).toEqual([1]);
    expect(f.db.executed.some((q) => q.sql.startsWith('update `dongzhuo_progress`'))).toBe(true);
  });

  it('keeps the disabled Luoyang batch reward branch while reducing scaled goals', async () => {
    const f = fixture([
      { match: /select `default` from cfg_task/, rows: [{ default: 100 }] },
      { match: /select \* from cfg_task_goal/, rows: [{ sort: 5, type: 1, count: 3, reduce: 1 }] },
    ]);
    expect(await f.task.getMultiReward(ctx, [112001, 2])).toEqual([1]);
    expect(f.rewards.giveReward).not.toHaveBeenCalled();
    expect(f.rewards.reduceGoal).toHaveBeenCalledWith(
      1001,
      false,
      expect.objectContaining({ count: 6 }),
    );
  });

  it('grants public hero friendship once and never passes it to ordinary rewards', async () => {
    const f = fixture([
      { match: /select 1 from sys_user_task where uid/, rows: [{ value: 1 }] },
      { match: /select \* from cfg_task where id/, rows: [{ id: 401, inform: 0 }] },
      { match: /select \* from cfg_task_reward/, rows: [{ sort: 1, count: 5 }] },
    ]);
    expect(await f.task.getReward(ctx, [401, 20101])).toEqual([1]);
    expect(f.rewards.giveReward).not.toHaveBeenCalled();
    expect(
      f.db.executed.find((q) => q.sql.startsWith('update sys_lionize set friend = friend +'))
        ?.parameters,
    ).toEqual([5, 1001, 10]);
  });

  it.each([false, 0, '0'])('keeps PHP empty armor offset comparison for %s', async (part) => {
    const f = fixture([{ match: /select b.part, b.type/, rows: [{ part }] }]);
    const chosenFits = (
      f.task as unknown as {
        chosenFits(uid: number, goal: Record<string, unknown>, sid: number): Promise<boolean>;
      }
    ).chosenFits.bind(f.task);
    expect(await chosenFits(1001, { sort: 1, type: 51, count: '0' }, 8)).toBe(false);
    expect(await chosenFits(1001, { sort: 1, type: 51, count: 0 }, 8)).toBe(true);
    expect(await chosenFits(1001, { sort: 1, type: 52, count: '2' }, 8)).toBe(false);
  });

  it('resolves the exclusive hero reward from its supplied group', async () => {
    const f = fixture([
      { match: /select 1 from sys_user_task where uid = \? and tid = \?$/, rows: [{ value: 1 }] },
      { match: /select uid from sys_city_hero where hid/, rows: [{ uid: 1001 }] },
      { match: /select \* from cfg_task where id/, rows: [{ id: 400101, inform: 0 }] },
      { match: /select \* from cfg_task_reward/, rows: [{ sort: 1, count: 99 }] },
    ]);
    expect(await f.task.getReward(ctx, [400101, 20101])).toEqual([1]);
    expect(
      f.db.executed.find((q) => q.sql.startsWith('update sys_lionize set friend = friend +'))
        ?.parameters,
    ).toEqual([1, 1001, 10]);
    expect(f.rewards.giveReward).not.toHaveBeenCalled();
  });

  it('returns hero selection rows without a city or hero-type filter', async () => {
    const f = fixture([{ match: /select hid, name/, rows: [{ hid: 8, name: 'hero' }] }]);
    expect(await f.task.getHerosByLevel(ctx, [9000, 50, '10tail'])).toEqual([
      { hid: 8, name: 'hero' },
    ]);
    expect(f.db.executed[0]?.parameters).toEqual([1001, 10]);
    expect(f.db.executed[0]?.sql).not.toContain('herotype');
  });

  it('reuses the seven-part armor reply without limiting by requested count', async () => {
    const f = fixture();
    expect(await f.hotel.getArmorsByPartOrType(ctx, [1002, 52, 3, 4, 1])).toEqual(['armor-reply']);
    expect(f.db.executed[0]?.sql).toContain('part = ? order by value');
    expect(f.db.executed[0]?.sql).not.toContain('limit');
  });

  it('accepts a hero task without requiring an affected row and preserves its response tuple', async () => {
    const f = fixture([
      { match: /select level from sys_building/, rows: [{ level: 5 }] },
      { match: /select state from sys_lionize/, rows: [{ state: 2 }] },
    ]);
    expect(await f.hotel.getTheTask(ctx, [401, 20101])).toEqual([
      401,
      20101,
      'getTheTask.get_succ',
    ]);
    expect(f.db.executed.some((q) => q.sql.includes('endtime = unix_timestamp() + 86400'))).toBe(
      true,
    );
  });

  it('resets a troop-rumor target each time it is read', async () => {
    const f = fixture([
      { match: /select \* from sys_city_rumor/, rows: [{ type: 2, typeid: 77 }] },
      { match: /select f\.\*, r\.type/, rows: [{ tid: 77, name: 'troop' }] },
      { match: /select tid from cfg_task_goal/, rows: [{ tid: 400001 }] },
    ]);
    f.random.mtRand.mockReturnValueOnce(12).mockReturnValueOnce(34);
    const reply = await f.hotel.getRumor(ctx, [1]);
    expect(reply.slice(3)).toEqual([false, false]);
    expect(
      f.db.executed.find((q) => q.sql.startsWith('insert into sys_attack_position'))?.parameters,
    ).toEqual([1001, 34012, '400001', 34012]);
  });

  it('validates item rumor recording without actually inserting a task', async () => {
    const f = fixture([
      { match: /select \* from sys_city_rumor/, rows: [{ type: 1, typeid: 11 }] },
      { match: /select taskid from cfg_thing_task/, rows: [{ taskid: 123 }] },
    ]);
    await expect(f.hotel.recordTask(ctx, [1])).rejects.toMatchObject({
      key: 'recordTask.task_record_succ',
    });
    expect(f.users.logUserAction).toHaveBeenCalledWith(1001, 8);
    expect(f.db.executed.some((q) => q.sql.startsWith('insert'))).toBe(false);
  });

  it('consumes the persuade attempt and cooldown even on a failed roll', async () => {
    const f = fixture([
      {
        match: /select \* from sys_city_hero where npcid/,
        rows: [{ uid: 2000, loyalty: 100, state: 0 }],
      },
      { match: /select friend from sys_lionize/, rows: [{ friend: 100 }] },
      { match: /select state from sys_lionize/, rows: [{ state: 1 }] },
      { match: /select unix_timestamp\(\)/, rows: [{ now: 1000000 }] },
      { match: /select sum\(count\) from sys_goods/, rows: [{ count: 15 }] },
    ]);
    expect(await f.hotel.persuadeHero(ctx, [10])).toEqual(['persuadeHero.persuade_err']);
    expect(f.goods.addGoods).toHaveBeenCalledWith(1001, 13, -15, 0);
    expect(f.db.executed.some((q) => q.sql.startsWith('insert into mem_user_schedule'))).toBe(true);
  });
  it('moves a successfully persuaded hero and clears the former owner task range globally', async () => {
    const f = fixture([
      {
        match: /select \* from sys_city_hero where npcid/,
        rows: [{ uid: 2000, cid: 3004, name: 'hero', loyalty: 100, state: 0 }],
      },
      { match: /select friend from sys_lionize/, rows: [{ friend: 100 }] },
      { match: /select state from sys_lionize/, rows: [{ state: 1 }] },
      { match: /select unix_timestamp\(\)/, rows: [{ now: 1000000 }] },
      { match: /select sum\(count\) from sys_goods/, rows: [{ count: 15 }] },
    ]);
    f.random.mtRand.mockReturnValue(0);
    expect(await f.hotel.persuadeHero(ctx, [10])).toEqual(['persuadeHero.persuade_succ']);
    expect(f.rewards.deleteHeroBaseAdd).toHaveBeenCalledWith(10);
    expect(f.heroes.regenerateHeroAttri).toHaveBeenCalledWith(1001, 10);
    expect(f.mail.send).toHaveBeenCalledWith(
      2000,
      'heroPersuadeHero.PersuadeHero_mail_title',
      'PersuadeHero.PersuadeHero_mail_content',
    );
    const cleanup = f.db.executed.find((q) =>
      q.sql.startsWith('delete from sys_user_task where tid >'),
    )!;
    expect(cleanup.parameters).toEqual([400100, 400110]);
    expect(cleanup.sql).not.toContain('uid');
  });

  it('generates the supplied friendship tier once and excludes the sex-specific task', async () => {
    const f = fixture([
      { match: /select state from sys_lionize/, rows: [{ state: 1 }] },
      { match: /select sex from sys_city_hero/, rows: [{ sex: 0 }] },
    ]);
    f.random.mtRand
      .mockReturnValueOnce(401)
      .mockReturnValueOnce(402)
      .mockReturnValueOnce(403)
      .mockReturnValueOnce(404)
      .mockReturnValueOnce(405)
      .mockReturnValueOnce(406)
      .mockReturnValueOnce(501)
      .mockReturnValueOnce(502);
    expect(await f.hotel.getHeroPublicTask(ctx, [10, 20])).toEqual([[]]);
    const inserted = f.db.executed.filter((q) => q.sql.startsWith('insert into sys_hero_task'));
    expect(inserted.map((q) => q.parameters[2])).toEqual([402, 403, 404, 405, 406, 502]);
  });
});
