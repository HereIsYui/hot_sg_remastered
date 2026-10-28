import { describe, expect, it } from 'vitest';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { phpCompare } from '../core/php';
import { RandomService, ScriptedRandom, sequenceSource } from '../core/random.service';
import { UserRules } from '../core/user-rules.service';
import { TaskRewards } from '../task/task-rewards.service';
import { TaskRules } from '../core/task-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { LotteryCommands } from './lottery.commands';

const lang = new LangService({
  lottery: {
    inform_win_goods: '恭喜【%s】玩家在幸运宝匣中获得【%s】！',
    no_such_goods: '没有这样的物品',
    no_such_armor: '没有这样的装备',
    restart_limit: '你每天只有一次重开机会',
    not_available: '该功能未开放',
    not_available_time:
      '幸运宝盒在每天的11点和19点开启，每次开启时间为1小时。每次开启可免费抽奖一次，如不满意，您还有一次重开的机会。',
    nobility_limit: '你爵位未达到公士，不能使用幸运宝匣。',
  },
  waigua: { invalid: '数据异常' },
});

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };

function build(rules: Respond[], draws: number[] = []) {
  const db = new FakeDb(rules);
  const scripted = new ScriptedRandom();
  const random = new RandomService(scripted);
  const users = new UserRules(db.scope);
  const goods = new GoodsRules(db.scope);
  const cmd = new LotteryCommands(
    db.scope,
    lang,
    random,
    goods,
    new TaskRewards(
      db.scope,
      lang,
      new CityRules(db.scope),
      goods,
      new HeroRules(db.scope),
      users,
      random,
    ),
    new TaskRules(db.scope, users),
    users,
  );
  const run = <T>(fn: () => Promise<T>): Promise<T> => scripted.run(sequenceSource(draws), fn);
  return { cmd, db, run };
}

async function errorOf(p: Promise<unknown>): Promise<GameError> {
  try {
    await p;
  } catch (e) {
    return e as GameError;
  }
  throw new Error('expected the command to throw');
}

/** mem_state state=150 gates the feature; ''/0/missing all mean open (phpEmpty). */
const OPEN_STATE = (value: unknown): Respond => ({
  match: /from mem_state where state = 150/,
  rows: [{ v: value }],
});
const CLOCK = (hour: number): Respond => ({
  match: /select now\(\) as v/,
  rows: [{ v: `2026-10-29 ${String(hour).padStart(2, '0')}:05:00` }],
});
const NOBILITY = (value: unknown): Respond => ({
  match: /select nobility as v from sys_user/,
  rows: [{ v: value }],
});
const NO_BUFFER: Respond = { match: /mem_user_buffer/, rows: [] };
const PUSHEN = (bufparam: number): Respond => ({
  match: /mem_user_buffer/,
  rows: [{ bufparam }],
});
const TODAY = (n: number): Respond => ({
  match: /count\(\*\) as v from log_lottery/,
  rows: [{ v: n }],
});
const PENDING = (row: Record<string, unknown>): Respond => ({
  match: /select \* from mem_lottery_goods where uid = \? and got = 0/,
  rows: [row],
});
const ANY_ROUND = (row: Record<string, unknown>): Respond => ({
  match: /select \* from mem_lottery_goods where uid = \?$/,
  rows: [row],
});
const GOODS_BY_GID = (row: Record<string, unknown>): Respond => ({
  match: /select \* from cfg_goods where gid = \?/,
  rows: [row],
});
const ARMOR_BY_ID = (row: Record<string, unknown>): Respond => ({
  match: /select \* from cfg_armor where id = \?/,
  rows: [row],
});
/** The 6等 top-up query has a literal `level = 6`, the per-grade ones bind it. */
const FILL_GOODS = (row: Record<string, unknown>): Respond => ({
  match: /cfg_goods where gid < 10000\s+and `group` in \(0, 1, 2, 3\) and level = 6/,
  rows: [row],
});
const NO_TIER_GOODS: Respond = {
  match: /cfg_goods where gid < 10000\s+and `group` in \((?:4, 5)|(?:0, 1, 2, 3)\) and level = \?/,
  rows: [],
};

describe('LotteryCommands gates', () => {
  it('startLottery checks nobility before the open gate and refuses 公士以下', async () => {
    const { cmd, db, run } = build([NOBILITY(0), NO_BUFFER]);
    const err = await errorOf(run(() => cmd.startLottery(ctx)));
    expect(err.key).toBe('lottery.nobility_limit');
    // the mem_state gate was never reached
    expect(db.executed.some((e) => /mem_state/.test(e.sql))).toBe(false);
  });

  it('startLottery: an active 推恩令 lifts the nobility past the gate', async () => {
    const { cmd, run } = build([NOBILITY(0), PUSHEN(5), OPEN_STATE('1')]);
    const err = await errorOf(run(() => cmd.startLottery(ctx)));
    // got past the nobility gate, stopped at the closed feature
    expect(err.key).toBe('lottery.not_available');
  });

  it('startLottery answers not_available while mem_state 150 is set', async () => {
    const { cmd, run } = build([NOBILITY(1), NO_BUFFER, OPEN_STATE('1')]);
    const err = await errorOf(run(() => cmd.startLottery(ctx)));
    expect(err.key).toBe('lottery.not_available');
  });

  it('gate commands answer not_available_time outside the 11/19 DB-clock hours', async () => {
    const { cmd, run } = build([OPEN_STATE(''), CLOCK(14)]);
    const err = await errorOf(run(() => cmd.getLotteryReward(ctx)));
    expect(err.key).toBe('lottery.not_available_time');
  });

  it('getLotteryReward demands a pending got=0 round', async () => {
    const { cmd, run } = build([
      OPEN_STATE('0'), // "0" is phpEmpty → open
      CLOCK(11),
      { match: /select uid as v from mem_lottery_goods/, rows: [] },
    ]);
    const err = await errorOf(run(() => cmd.getLotteryReward(ctx)));
    expect(err.key).toBe('waigua.invalid');
  });

  it('restart demands a pending round and at most one 重开', async () => {
    const noRound = build([OPEN_STATE(''), CLOCK(19)]);
    const err1 = await errorOf(noRound.run(() => noRound.cmd.restart(ctx, [5, 0, ''])));
    expect(err1.key).toBe('waigua.invalid');

    const used = build([
      OPEN_STATE(''),
      CLOCK(19),
      PENDING({ uid: 1001, records: '0,5,1', win: '0,5,1', got: 0, restart_count: 1 }),
    ]);
    const err2 = await errorOf(used.run(() => used.cmd.restart(ctx, [5, 0, ''])));
    expect(err2.key).toBe('lottery.restart_limit');
  });
});

describe('LotteryCommands.startLottery', () => {
  const goodsRow = { gid: 5, level: 1, name: '一级材料', group: 4 };
  const armorRow = { id: 22, level: 2, name: '二级装备', ori_hp_max: 50 };

  it('the free draw rolls the wheel, logs it and returns [type, id, count, count]', async () => {
    const { cmd, db, run } = build(
      [
        OPEN_STATE(''),
        CLOCK(19),
        NOBILITY(1),
        NO_BUFFER,
        TODAY(0), // the day's first draw is free — the pay chain never runs
        PENDING({ uid: 1001, records: '0,5,3,1,22,1', win: '-1,0,0', got: 0, restart_count: 0 }),
        GOODS_BY_GID(goodsRow),
        ARMOR_BY_ID(armorRow),
      ],
      [0, 0], // win roll → 1 → 1等; then the grade's single item
    );
    const res = (await run(() => cmd.startLottery(ctx))) as unknown[];
    expect(res).toEqual([0, 5, '3', 0]);
    expect(
      db.executed.some(
        (e) =>
          /update mem_lottery_goods set win = \? where uid = \?/.test(e.sql) &&
          e.parameters[0] === '0,5,3',
      ),
    ).toBe(true);
    expect(
      db.executed.some(
        (e) =>
          /insert into log_lottery/.test(e.sql) && e.parameters[1] === 5 && e.parameters[2] === 0,
      ),
    ).toBe(true);
    // the free draw pays nothing
    expect(db.executed.some((e) => /insert into `?log_goods`?/.test(e.sql))).toBe(false);
  });

  it('a second draw without 续抽 items answers the [-1,-2] limit triple', async () => {
    const { cmd, run } = build([
      OPEN_STATE(''),
      CLOCK(19),
      NOBILITY(1),
      NO_BUFFER,
      TODAY(1),
      { match: /from sys_goods where uid/, rows: [] },
    ]);
    const res = (await run(() => cmd.startLottery(ctx))) as unknown[];
    expect(res).toEqual([-1, -2, -1, 1]);
  });

  it('pays with 10191 (虎尾, under its 4/day limit) before falling through', async () => {
    const { cmd, db, run } = build(
      [
        OPEN_STATE(''),
        CLOCK(19),
        NOBILITY(1),
        NO_BUFFER,
        TODAY(1),
        {
          match: /from sys_goods where uid = \? and gid = \?/,
          params: [1001, 10191],
          rows: [{ v: 2 }],
        },
        { match: /count\(\*\) as v from log_goods/, rows: [{ v: 1 }] },
        PENDING({ uid: 1001, records: '0,5,3', win: '-1,0,0', got: 0, restart_count: 0 }),
        GOODS_BY_GID(goodsRow),
      ],
      [0, 0],
    );
    await run(() => cmd.startLottery(ctx));
    expect(
      db.executed.some(
        (e) =>
          /insert into `?log_goods`?/.test(e.sql) &&
          e.parameters[0] === 1001 &&
          e.parameters[1] === 10191 &&
          e.parameters[2] === -1 &&
          e.parameters[3] === 0,
      ),
    ).toBe(true);
  });

  it('a used-up 10191 falls through to 159 (幸运之钥, 20/day)', async () => {
    const { cmd, db, run } = build(
      [
        OPEN_STATE(''),
        CLOCK(19),
        NOBILITY(1),
        NO_BUFFER,
        TODAY(1),
        {
          match: /from sys_goods where uid = \? and gid = \?/,
          params: [1001, 10191],
          rows: [{ v: 2 }],
        },
        {
          match: /from sys_goods where uid = \? and gid = \?/,
          params: [1001, 159],
          rows: [{ v: 1 }],
        },
        { match: /count\(\*\) as v from log_goods/, rows: [{ v: 4 }] },
        PENDING({ uid: 1001, records: '0,5,3', win: '-1,0,0', got: 0, restart_count: 0 }),
        GOODS_BY_GID(goodsRow),
      ],
      [0, 0],
    );
    await run(() => cmd.startLottery(ctx));
    const burns = db.executed.filter(
      (e) => /insert into `?log_goods`?/.test(e.sql) && e.parameters[2] === -1,
    );
    expect(burns.map((e) => e.parameters[1])).toEqual([159]);
  });
});

describe('LotteryCommands.restart', () => {
  const goods77 = { gid: 77, level: 8, name: '八等奖', group: 1 };
  const armor22 = { id: 22, level: 2, name: '二级装备', ori_hp_max: 50 };

  it('reroll avoids the previous win and keeps the stale goods count on an armor pick', async () => {
    const { cmd, db, run } = build(
      [
        OPEN_STATE(''),
        CLOCK(19),
        PENDING({
          uid: 1001,
          records: '1,22,1,0,77,2',
          win: '0,77,2',
          got: 0,
          restart_count: 0,
        }),
        GOODS_BY_GID(goods77),
        ARMOR_BY_ID(armor22),
      ],
      [6000, 0], // win roll → 6001 → past 6000, so 8等
    );
    // The previous win was the 8等 item: the forward scan re-picks it, the downward rescan walks
    // to the 2等 armor — and keeps winCount from the goods pick (the original only assigns it in
    // the goods branch), so the reply is [1, 22, '2'] and the stored win reads '1,22,2'.
    const res = (await run(() => cmd.restart(ctx, [77, 0, 'ignored']))) as unknown[];
    expect(res).toEqual([1, 22, '2']);
    expect(
      db.executed.some(
        (e) => /restart_count = restart_count \+ 1/.test(e.sql) && e.parameters[0] === '1,22,2',
      ),
    ).toBe(true);
  });
});

describe('LotteryCommands rewards', () => {
  const goods5 = { gid: 5, level: 5, name: '宝物', group: 1 };
  const fill66 = { gid: 66, level: 6, name: '六等奖', group: 0 };

  it('getLotteryReward pays the win then deals a fresh round of eight items', async () => {
    const { cmd, db, run } = build([
      OPEN_STATE(''),
      CLOCK(11),
      { match: /select uid as v from mem_lottery_goods/, rows: [{ v: 1001 }] },
      PENDING({ uid: 1001, records: '0,5,1', win: '0,5,1', got: 0, restart_count: 0 }),
      ANY_ROUND({ uid: 1001, records: '0,5,1', win: '-1,0,0', got: 1, restart_count: 0 }),
      GOODS_BY_GID(goods5),
      NO_TIER_GOODS,
      FILL_GOODS(fill66),
      { match: /cfg_task_goal/, rows: [] },
      { match: /select name as v from sys_user/, rows: [{ v: '长乐' }] },
      { match: /log_lottery/, rows: [] },
    ]);
    const res = (await run(() => cmd.getLotteryReward(ctx))) as unknown[];
    // the fresh round: 8 grade buckets, the 6等 top-up filled all eight slots
    const records = res[0] as Record<string, unknown>[][];
    expect(records).toHaveLength(8);
    expect(records[5]).toHaveLength(8);
    expect(records[5]![0]).toMatchObject({ gid: 66, level: 6, count: 1 });
    for (const i of [0, 1, 2, 3, 4, 6, 7]) expect(records[i]).toHaveLength(0);
    expect(res[1]).toBe('-1'); // explode() strings, as the original returns
    expect(res[2]).toBe('0');
    expect(res[3]).toBe('0');
    expect(res[4]).toBe(0);
    expect(res[5]).toBe(0);
    // the award: goods granted with log reason 1000, round closed, notice sent
    expect(
      db.executed.some(
        (e) =>
          /insert into `?log_goods`?/.test(e.sql) &&
          e.parameters[0] === 1001 &&
          e.parameters[1] === 5 &&
          e.parameters[2] === 1 &&
          e.parameters[3] === 1000,
      ),
    ).toBe(true);
    expect(db.executed.some((e) => /update mem_lottery_goods set got = 1/.test(e.sql))).toBe(true);
    const inform = db.executed.find((e) => /insert into `?sys_inform`?/.test(e.sql));
    expect(inform?.parameters[7]).toBe('恭喜【长乐】玩家在幸运宝匣中获得【宝物*1】！');
    expect(
      db.executed.some(
        (e) =>
          /update mem_lottery_goods set records = \?/.test(e.sql) &&
          e.parameters[0] === Array(8).fill('0,66,1').join(','),
      ),
    ).toBe(true);
  });

  it('autoGetReward returns [win, fresh round]', async () => {
    const { cmd, run } = build([
      OPEN_STATE(''),
      CLOCK(19),
      { match: /select uid as v from mem_lottery_goods/, rows: [{ v: 1001 }] },
      PENDING({ uid: 1001, records: '0,5,1', win: '0,5,1', got: 0, restart_count: 0 }),
      ANY_ROUND({ uid: 1001, records: '0,5,1', win: '-1,0,0', got: 1, restart_count: 0 }),
      GOODS_BY_GID(goods5),
      NO_TIER_GOODS,
      FILL_GOODS(fill66),
      { match: /cfg_task_goal/, rows: [] },
      { match: /select name as v from sys_user/, rows: [{ v: '长乐' }] },
      { match: /log_lottery/, rows: [] },
    ]);
    const res = (await run(() => cmd.autoGetReward(ctx))) as unknown[];
    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({ gid: 5, name: '宝物', count: '1' });
    expect(res[1]).toHaveLength(6);
  });

  it('addCount with no pending round lands on the gid=0 礼金 row without paying anything', async () => {
    const giftRow = { gid: 0, level: 1, name: '礼金', group: 0 };
    const { cmd, db, run } = build([
      OPEN_STATE(''),
      CLOCK(19),
      PENDING({}), // no win row → PHP reads null and explode(",", null) === [""]
      GOODS_BY_GID(giftRow),
      { match: /cfg_task_goal/, rows: [] },
      { match: /select name as v from sys_user/, rows: [{ v: '长乐' }] },
    ]);
    const res = (await run(() => cmd.addCount(ctx))) as Record<string, unknown>;
    expect(res).toMatchObject({ gid: 0, name: '礼金' });
    expect(res.count).toBeNull();
    expect(db.executed.some((e) => /insert into `?sys_inform`?/.test(e.sql))).toBe(true);
    // addGift(0) returns early, addGoods never ran
    expect(db.executed.some((e) => /insert into `?log_gift`?/.test(e.sql))).toBe(false);
    expect(db.executed.some((e) => /insert into `?sys_goods`?/.test(e.sql))).toBe(false);
  });

  it('addCount pays an armor win of grade ≤ 5 with a notice and a log_armor row', async () => {
    const armorRow = { id: 22, level: 2, name: '二级装备', ori_hp_max: 50 };
    const { cmd, db, run } = build([
      OPEN_STATE(''),
      CLOCK(19),
      PENDING({ uid: 1001, records: '1,22,1', win: '1,22,1', got: 0, restart_count: 0 }),
      ARMOR_BY_ID(armorRow),
      { match: /cfg_task_goal/, rows: [] },
      { match: /select name as v from sys_user/, rows: [{ v: '长乐' }] },
    ]);
    const res = (await run(() => cmd.addCount(ctx))) as Record<string, unknown>;
    expect(res).toMatchObject({ id: 22, name: '二级装备', count: '1' });
    expect(db.executed.some((e) => /insert into `?sys_user_armor`?/.test(e.sql))).toBe(true);
    expect(
      db.executed.some((e) => /insert into `?log_armor`?/.test(e.sql) && e.parameters[3] === 1000),
    ).toBe(true);
    const inform = db.executed.find((e) => /insert into `?sys_inform`?/.test(e.sql));
    expect(inform?.parameters[7]).toBe('恭喜【长乐】玩家在幸运宝匣中获得【二级装备】！');
  });
});

describe('LotteryCommands specialProp pity tables', () => {
  const goods66 = { gid: 66, level: 6, name: '六等奖', group: 0 };
  const goods55 = { gid: 55, level: 5, name: '五等奖', group: 0 };

  it('4th draw of the day with no sub-7等 drop loads the 8000 weight onto 6等', async () => {
    const { cmd, run } = build(
      [
        OPEN_STATE(''),
        CLOCK(19),
        {
          match: /left join cfg_goods/,
          rows: [{ level: 8 }, { level: 8 }, { level: 8 }],
        },
        PENDING({ uid: 1001, records: '0,66,1', win: '0,66,1', got: 0, restart_count: 0 }),
        GOODS_BY_GID(goods66),
      ],
      [5000, 0], // 5001 would land on 7等 with the default table, on 6等 with the pity one
    );
    const res = (await run(() => cmd.restart(ctx, [0, 0, '']))) as unknown[];
    expect(res).toEqual([0, 66, '1']);
  });

  it('7th draw of the day with no sub-6等 drop loads the 9000 weight onto 5等', async () => {
    const { cmd, run } = build(
      [
        OPEN_STATE(''),
        CLOCK(19),
        {
          match: /left join cfg_goods/,
          rows: [
            { level: 6 },
            { level: 6 },
            { level: 6 },
            { level: 6 },
            { level: 6 },
            { level: 6 },
          ],
        },
        PENDING({ uid: 1001, records: '0,55,1', win: '0,55,1', got: 0, restart_count: 0 }),
        GOODS_BY_GID(goods55),
      ],
      [5000, 0],
    );
    const res = (await run(() => cmd.restart(ctx, [0, 0, '']))) as unknown[];
    expect(res).toEqual([0, 55, '1']);
  });
});

describe('LotteryCommands simple commands', () => {
  it('getTodayCount reads the sliding 1-hour window', async () => {
    const { cmd, run } = build([TODAY(3)]);
    expect(await run(() => cmd.getTodayCount(ctx))).toBe(3);
    const empty = build([]);
    expect(await empty.run(() => empty.cmd.getTodayCount(ctx))).toBe(0);
  });

  it('getWin as a command reproduces the legacy fatal: argument 3 never reaches it', async () => {
    const { cmd } = build([OPEN_STATE('')]);
    const err = await errorOf(cmd.getWin());
    expect(err).toBeInstanceOf(GameError);
    expect(err.key).toBeNull();
    expect(err.message).toBe(
      'Missing argument 3 for getWin(), called in /var/www/html/server/game/Command.php on line 117 and defined',
    );
  });

  it('useMoney always takes the deduction branch (an array outranks an int in PHP) and takes 6 元宝', async () => {
    const { cmd, db, run } = build([
      { match: /select money as v from sys_user/, rows: [{ v: 10 }] },
    ]);
    expect(await run(() => cmd.useMoney(ctx))).toEqual([1]);
    expect(db.executed.some((e) => /update sys_user set money = money - 6/.test(e.sql))).toBe(true);

    const poor = build([{ match: /select money as v from sys_user/, rows: [{ v: 5 }] }]);
    expect(await poor.run(() => poor.cmd.useMoney(ctx))).toEqual([0]);
    expect(poor.db.executed.some((e) => /update sys_user set money = money - 6/.test(e.sql))).toBe(
      false,
    );

    const broke = build([{ match: /select money as v from sys_user/, rows: [] }]);
    expect(await broke.run(() => broke.cmd.useMoney(ctx))).toEqual([0]);
  });
});

describe('phpCompare for the pity scan', () => {
  it('a left-join miss (null level) counts as better than any grade, like PHP null < 6', () => {
    expect(phpCompare(null, 6)).toBeLessThan(0);
    expect(phpCompare(6, 6)).toBe(0);
    expect(phpCompare(5, 6)).toBeLessThan(0);
    expect(phpCompare(7, 6)).toBeGreaterThan(0);
  });
});
