import { describe, expect, it } from 'vitest';
import { PkCommands } from './pk.commands';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { RandomService, ScriptedRandom, sequenceSource } from '../core/random.service';
import { RewardRules } from '../core/reward-rules.service';
import { UserRules } from '../core/user-rules.service';
import { TaskRewards } from '../task/task-rewards.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';

const lang = new LangService({
  userPK: { pass_battle_info: '%s在%s战役获得%s' },
  heroPk: {
    no_hero_info: '请刷新并重新选择将领',
    hero_level_low: '当前君主将等级太低，不能参加此战役。',
    user_level_low: '当前修为等级太低，不能参加此战役。',
  },
  useMojiaGoods: { invalid_param: '参数错误' },
  changeCityPosition: { no_adv_lijianfu: '物品不够，请先购买' },
  sendCommand: { command_exception: '你异常了!!!' },
  king: { has_get_reward: '您已经领取过奖励' },
  buyGoods: {
    invalid_pay_type: 'buyGoods.invalid_pay_type',
    invalid_amount: '购买数量无效。',
    no_enough_YuanBao: '你的元宝不足，请充值。',
    junling_max_count: '您目前最多只能购买%d个军令',
  },
});

const UID = 1001;
const ctx = { uid: UID, cid: 0, ip: 0, sip: '' };

function build(rules: Respond[] = [], draws: number[] = []) {
  const db = new FakeDb(rules);
  const scripted = new ScriptedRandom();
  const random = new RandomService(scripted);
  const users = new UserRules(db.scope);
  const goods = new GoodsRules(db.scope);
  const rewards = new TaskRewards(
    db.scope,
    lang,
    new CityRules(db.scope),
    goods,
    new HeroRules(db.scope),
    users,
    random,
  );
  const cmd = new PkCommands(
    db.scope,
    lang,
    random,
    goods,
    users,
    rewards,
    new RewardRules(db.scope, goods, rewards),
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

/** GoodsRules.checkGoods — the 军令 stock. */
const JUNLING_CHECK = (count: number): Respond => ({
  match: /select count from sys_goods\s+where uid = \? and gid = \?/,
  params: [UID, 19200],
  rows: count > 0 ? [{ count }] : [],
});
const LORD_LEVEL = (level: number): Respond => ({
  match: /select level as v from sys_city_hero\s+where uid = \? and herotype = 1000/,
  rows: [{ v: level }],
});
const BATTLE_NEED = (column: string, level: number): Respond => ({
  match: new RegExp(`select ${column} as v from cfg_pk_battle where id = \\?`),
  rows: [{ v: level }],
});
const XIUWEI_LEVEL = (level: number): Respond => ({
  match: /select level as v from sys_user_level where uid = \?/,
  rows: [{ v: level }],
});
/** sys_pk_user.normal (flag 0) / special (flag 1) — battleId*100 + last cleared level. */
const PK_USER_CELL = (column: 'normal' | 'special', value: number): Respond => ({
  match: new RegExp(`select ${column} as v from sys_pk_user where uid = \\?`),
  rows: [{ v: value }],
});
const PK_MAX_LEVEL = (battleid: number, type: number, max: number): Respond => ({
  match: /select max\(levelid\) as v from cfg_pk_level\s+where battleid = \? and type = \?/,
  params: [battleid, type],
  rows: [{ v: max }],
});
const OWN_HERO_COUNT = (n: number): Respond => ({
  match: /select count\(\*\) as v from sys_city_hero\s+where uid = \? and hid in \(\?, \?, \?\)/,
  rows: [{ v: n }],
});
/** The three user-hero selects differ only by the bound hid (standIndex is bound first). */
const USER_HERO = (hid: number, row: Record<string, unknown>): Respond => ({
  match: /select a\.hid, a\.sex, `force` as energy, \? as standIndex/,
  params: [row.standIndex, hid],
  rows: [row],
});
/** The three cfg_pk_level area lookups differ only by the bound area. */
const NPC_HID = (
  battleid: number,
  levelid: number,
  type: number,
  area: number,
  hid: number,
): Respond => ({
  match:
    /select hid as v from cfg_pk_level\s+where battleid = \? and levelid = \? and type = \?\s+and area = \?/,
  params: [battleid, levelid, type, area],
  rows: [{ v: hid }],
});
const NPC_HERO = (hid: number, row: Record<string, unknown>): Respond => ({
  match: /select hid, sex, energy \+ energy_add as energy,\s+\? as standIndex/,
  params: [row.standIndex, hid],
  rows: [row],
});

/** A one-hit-kill attacker (bravery 1000 → attack 10000) vs a defence-10 NPC: damage 9950. */
const STRONG_USER = (hid: number, standIndex: number): Record<string, unknown> => ({
  hid,
  sex: 1,
  energy: 10,
  standIndex,
  command: 0,
  affair: 0,
  bravery: 1000,
  wisdom: 0,
  speed: 0,
});
/** A defenceless NPC with energy 50 → blood 2500, dead to one 9950 blow. */
const WEAK_NPC = (hid: number, standIndex: number): Record<string, unknown> => ({
  hid,
  sex: 0,
  energy: 50,
  standIndex,
  command: 0,
  affair: 0,
  bravery: 0,
  wisdom: 0,
  speed: 0,
});
/** 29999 → mt_rand(1,20000)=10000: above every capped trigger stat, so no 暴击/破击/闪避/格挡. */
const NO_TRIGGER_DRAW = 29999;
/** Draws for three one-blow pairs (4 rolls each) plus the drop roll. */
const THREE_BLOW_DRAWS = [1, 2, 3].flatMap(() => [
  NO_TRIGGER_DRAW,
  NO_TRIGGER_DRAW,
  NO_TRIGGER_DRAW,
  NO_TRIGGER_DRAW,
]);

function winRules(): Respond[] {
  const userHids = [80213, 80214, 80215];
  return [
    JUNLING_CHECK(5),
    LORD_LEVEL(100),
    BATTLE_NEED('hero_level', 10),
    PK_USER_CELL('normal', 109), // battle 1, 9 floors cleared → floor 10 completes the chapter
    PK_MAX_LEVEL(1, 0, 10),
    OWN_HERO_COUNT(3),
    ...userHids.map((hid, i) => USER_HERO(hid, STRONG_USER(hid, 11 + i))),
    ...[1, 2, 3].map((area) => NPC_HID(1, 10, 0, area, 10 + area)),
    ...[11, 12, 13].map((hid, i) => NPC_HERO(hid, WEAK_NPC(hid, 21 + i))),
    {
      // rewardtype is a literal in the statement, so the two chest queries differ by text
      match:
        /select rewardid, count from cfg_pk_reward\s+where battleid = \? and type = \? and rewardtype = 1/,
      params: [1, 0],
      rows: [{ rewardid: 50305, count: 2 }],
    },
    {
      match:
        /select rewardid, count from cfg_pk_reward\s+where battleid = \? and type = \? and rewardtype = 0/,
      params: [1, 0],
      rows: [{ rewardid: 50297, count: 1 }],
    },
    {
      match: /select \* from cfg_armor where id = \?/,
      rows: [{ id: 50305, name: '战神盔', ori_hp_max: 100 }],
    },
    { match: /select strong_value from cfg_strong_probability where level = \?/, rows: [] },
    {
      match: /select \* from cfg_goods where gid = \?/,
      rows: [{ gid: 50297, name: '青铜宝箱' }],
    },
    { match: /select name as v from cfg_armor where id = \?/, rows: [{ v: '战神盔' }] },
    { match: /select name as v from cfg_goods where gid = \?/, rows: [{ v: '青铜宝箱' }] },
    // first-pass bookkeeping: ranks 1-2 still empty (uid 0)
    { match: /select uid as v from cfg_pk_first/, rows: [{ v: 0 }] },
    { match: /select 1 as one from cfg_pk_first/, rows: [{ one: 1 }] },
    { match: /select name as v from sys_user where uid = \?/, rows: [{ v: 'changle' }] },
    { match: /select battlename as v from cfg_pk_battle where id = \?/, rows: [{ v: '黄巾之乱' }] },
    { match: /select 1 as one from sys_pk_user where uid = \?/, rows: [{ one: 1 }] },
  ];
}

describe('PkCommands engine (getOneBattleRet)', () => {
  it('rejects fewer than 4 arguments before touching the database', async () => {
    const { cmd, db, run } = build();
    const err = await errorOf(run(() => cmd.getOneBattleRet(ctx, [1, 0, 10])));
    expect(err.key).toBe('useMojiaGoods.invalid_param');
    expect(db.executed).toHaveLength(0);
  });

  it('answers the 迁城文案 when the 军令 stock is empty (PKFunc.php:376 quirk)', async () => {
    const { cmd, db, run } = build([JUNLING_CHECK(0)]);
    const err = await errorOf(
      run(() => cmd.getOneBattleRet(ctx, [1, 0, 1, [80213, 80214, 80215]])),
    );
    expect(err.key).toBe('changeCityPosition.no_adv_lijianfu');
    // the level gates were never reached
    expect(db.executed.some((e) => /cfg_pk_battle/.test(e.sql))).toBe(false);
  });

  it('gates 普通 on the lord hero level and 精英 on 修为', async () => {
    const low = build([JUNLING_CHECK(5), LORD_LEVEL(5), BATTLE_NEED('hero_level', 10)]);
    const err = await errorOf(
      low.run(() => low.cmd.getOneBattleRet(ctx, [1, 0, 1, [80213, 80214, 80215]])),
    );
    expect(err.key).toBe('heroPk.hero_level_low');

    const elite = build([JUNLING_CHECK(5), XIUWEI_LEVEL(1), BATTLE_NEED('user_level', 5)]);
    const err2 = await errorOf(
      elite.run(() => elite.cmd.getOneBattleRet(ctx, [1, 1, 1, [80213, 80214, 80215]])),
    );
    expect(err2.key).toBe('heroPk.user_level_low');
  });

  it('rejects skipping chapters and floors with the generic 你异常了!!!', async () => {
    const { cmd, run } = build([
      JUNLING_CHECK(5),
      BATTLE_NEED('hero_level', 10),
      LORD_LEVEL(100),
      PK_USER_CELL('normal', 105), // battle 1 floor 5 cleared
      PK_MAX_LEVEL(3, 0, 10),
    ]);
    const err = await errorOf(
      run(() => cmd.getOneBattleRet(ctx, [3, 0, 1, [80213, 80214, 80215]])),
    );
    expect(err.key).toBe('sendCommand.command_exception');
  });

  it('demands three owned heroes', async () => {
    const short = build([
      JUNLING_CHECK(5),
      LORD_LEVEL(100),
      BATTLE_NEED('hero_level', 10),
      PK_USER_CELL('normal', 101),
      PK_MAX_LEVEL(1, 0, 10),
    ]);
    const err = await errorOf(short.run(() => short.cmd.getOneBattleRet(ctx, [1, 0, 1, [80213]])));
    expect(err.key).toBe('useMojiaGoods.invalid_param');

    const foreign = build([
      JUNLING_CHECK(5),
      LORD_LEVEL(100),
      BATTLE_NEED('hero_level', 10),
      PK_USER_CELL('normal', 101),
      PK_MAX_LEVEL(1, 0, 10),
      OWN_HERO_COUNT(2),
    ]);
    const err2 = await errorOf(
      foreign.run(() => foreign.cmd.getOneBattleRet(ctx, [1, 0, 1, [80213, 80214, 999001]])),
    );
    expect(err2.key).toBe('heroPk.no_hero_info');
  });

  it('a lost fight still costs one 军令 and grants nothing', async () => {
    // user heroes never strike meaningfully (attack 10, damage 9); NPC heroes one-shot them back
    const userHids = [80213, 80214, 80215];
    const rules: Respond[] = [
      JUNLING_CHECK(5),
      LORD_LEVEL(100),
      BATTLE_NEED('hero_level', 10),
      PK_USER_CELL('normal', 101),
      PK_MAX_LEVEL(1, 0, 10),
      OWN_HERO_COUNT(3),
      ...userHids.map((hid, i) =>
        USER_HERO(hid, { ...STRONG_USER(hid, 11 + i), bravery: 0, wisdom: 0 }),
      ),
      ...[1, 2, 3].map((area) => NPC_HID(1, 1, 0, area, 20 + area)),
      ...[21, 22, 23].map((hid, i) => NPC_HERO(hid, { ...WEAK_NPC(hid, 21 + i), bravery: 1000 })),
    ];
    const { cmd, db, run } = build(rules, [NO_TRIGGER_DRAW]);
    const ret = (await run(() =>
      cmd.getOneBattleRet(ctx, [1, 0, 1, [80213, 80214, 80215]]),
    )) as Record<string, unknown>[];
    expect(ret).toHaveLength(1);
    expect(ret[0]!.winer).toBe(0);
    expect(ret[0]!.reward).toBe('');
    expect(ret[0]!.endflag).toBe(1);
    // the 军令 was still charged (log_goods -1), but no chest, first pass or notice
    expect(db.executed.some((e) => /insert into `log_goods`/.test(e.sql))).toBe(true);
    expect(db.executed.some((e) => /insert into `sys_inform`/.test(e.sql))).toBe(false);
    expect(db.executed.some((e) => /update cfg_pk_first/.test(e.sql))).toBe(false);
    expect(db.executed.some((e) => /update sys_pk_user set/.test(e.sql))).toBe(false);
  });

  it('a chapter-final win pays the cfg_pk_reward chest and books the first pass', async () => {
    const { cmd, db, run } = build(winRules(), THREE_BLOW_DRAWS);
    const ret = (await run(() =>
      cmd.getOneBattleRet(ctx, [1, 0, 10, [80213, 80214, 80215]]),
    )) as Record<string, unknown>[];
    const battle = ret[0]!;
    expect(battle.winer).toBe(1);
    expect(battle.totalNum).toBe(3);
    expect(battle.endflag).toBe(1);
    // three pairs, one 9950 blow each
    const report = battle.report as Record<string, unknown>[][];
    expect(report).toHaveLength(3);
    expect(report[0]![0]!['damage']).toBe(9950);
    expect(report[0]![0]!['blood']).toBe(0);
    // chest: armor first, then the goods (rewardtype order)
    const reward = battle.reward as Record<string, unknown>[];
    expect(reward).toHaveLength(2);
    expect(reward[0]!.flag).toBe(1);
    expect((reward[0]!.info as Record<string, unknown>).name).toBe('战神盔');
    expect(reward[0]!.count).toBe(2);
    expect(reward[1]!.flag).toBe(0);
    expect((reward[1]!.info as Record<string, unknown>).gid).toBe(50297);
    // exactly two goods-log rows: the 军令 charge and the chest's 青铜宝箱 (no drop roll hit)
    const goodsLogs = db.executed.filter((e) => /insert into `log_goods`/.test(e.sql));
    expect(goodsLogs.map((e) => e.parameters)).toEqual([
      [UID, 19200, -1, 0],
      [UID, 50297, 1, 1],
    ]);
    // progress advanced to 1*100+10, first-pass rank 1 booked, notice with the chest color
    expect(db.executed.some((e) => /update sys_pk_user set normal = \?/.test(e.sql))).toBe(true);
    const firstPass = db.executed.find((e) => /update cfg_pk_first set uid = \?/.test(e.sql))!;
    expect(firstPass.sql).toContain('rankid = 1');
    expect(firstPass.parameters).toEqual([UID, 1, 0]);
    const inform = db.executed.find((e) => /insert into `sys_inform`/.test(e.sql))!;
    expect(inform.parameters).toContain(15627776);
  });

  it('the drop item is granted only when mt_rand(1,10) rolls exactly 3', async () => {
    const userHids = [80213, 80214, 80215];
    const rules: Respond[] = [
      JUNLING_CHECK(5),
      LORD_LEVEL(100),
      BATTLE_NEED('hero_level', 10),
      PK_USER_CELL('normal', 205), // battle 2 floor 5 — floor 3 is mid-chapter, no chest
      PK_MAX_LEVEL(2, 0, 10),
      OWN_HERO_COUNT(3),
      ...userHids.map((hid, i) => USER_HERO(hid, STRONG_USER(hid, 11 + i))),
      ...[1, 2, 3].map((area) => NPC_HID(2, 3, 0, area, 20 + area)),
      ...[21, 22, 23].map((hid, i) => NPC_HERO(hid, WEAK_NPC(hid, 21 + i))),
      {
        match: /select \* from cfg_goods where gid = \?/,
        rows: [{ gid: 18020, name: '军令·贰' }],
      },
      { match: /select name as v from cfg_goods where gid = \?/, rows: [{ v: '军令·贰' }] },
      { match: /select 1 as one from sys_pk_user where uid = \?/, rows: [{ one: 1 }] },
      { match: /select name as v from sys_user where uid = \?/, rows: [{ v: 'changle' }] },
      {
        match: /select battlename as v from cfg_pk_battle where id = \?/,
        rows: [{ v: '官渡之战' }],
      },
    ];
    // 12 battle draws (3 one-blow pairs) then the drop draw: 2 → mt_rand(1,10) = 3
    const { cmd, db, run } = build(rules, [...THREE_BLOW_DRAWS, 2]);
    const ret = (await run(() =>
      cmd.getOneBattleRet(ctx, [2, 0, 3, [80213, 80214, 80215]]),
    )) as Record<string, unknown>[];
    const reward = ret[0]!.reward as Record<string, unknown>[];
    expect(reward).toHaveLength(1);
    expect(reward[0]!.flag).toBe(0);
    expect((reward[0]!.info as Record<string, unknown>).gid).toBe(18020); // 18000 + 2*10 + 0
    expect(reward[0]!.count).toBe(1);
    // mid-chapter: progress not overwritten, no first pass, plain-colored notice
    expect(db.executed.some((e) => /update sys_pk_user set/.test(e.sql))).toBe(false);
    expect(db.executed.some((e) => /update cfg_pk_first/.test(e.sql))).toBe(false);
    const inform = db.executed.find((e) => /insert into `sys_inform`/.test(e.sql))!;
    expect(inform.parameters).toContain(49151);
  });
});

describe('PkCommands loadCampaignInitData', () => {
  const HERO_LIST: Respond = {
    match: /from cfg_pk_battle a, cfg_pk_level b, cfg_pk_hero c/,
    rows: [],
  };

  it('a fresh user is auto-enrolled and receives 10 军令', async () => {
    const { cmd, db, run } = build([
      { match: /select normal, special from sys_pk_user where uid = \?/, rows: [] },
      HERO_LIST,
      { match: /select id from cfg_pk_battle order by id/, rows: [{ id: 1 }, { id: 2 }] },
      {
        match: /select \* from cfg_goods where gid = \?/,
        rows: [{ gid: 18010, name: '军令·壹' }],
      },
      { match: /select \* from sys_goods where uid = \? and gid = \?/, rows: [] },
      { match: /select count as v from sys_goods/, rows: [{ v: 0 }] },
      { match: /select id, description from cfg_pk_battle order by id/, rows: [] },
    ]);
    const ret = (await run(() => cmd.loadCampaignInitData(ctx))) as unknown[];
    expect(
      db.executed.some((e) =>
        /insert into sys_pk_user \(uid, normal, special\) values \(\?, 1, 1\)/.test(e.sql),
      ),
    ).toBe(true);
    const grant = db.executed.find((e) => /insert into `log_goods`/.test(e.sql))!;
    expect(grant.parameters).toEqual([UID, 19200, 10, 5]);
    const goods = ret[4] as Record<string, unknown>;
    expect(goods.junling).toBe(10);
    expect(goods.wuzhuqian).toBe(0);
    expect(ret[3]).toHaveLength(4);
    expect(ret[5]).toEqual([]);
  });

  it('an enrolled user keeps his stock and gets no grant', async () => {
    const { cmd, db, run } = build([
      {
        match: /select normal, special from sys_pk_user where uid = \?/,
        rows: [{ normal: 105, special: 1 }],
      },
      HERO_LIST,
      { match: /select id from cfg_pk_battle order by id/, rows: [] },
      {
        match: /select \* from sys_goods where uid = \? and gid = \?/,
        params: [UID, 19200],
        rows: [{ uid: UID, gid: 19200, count: 7 }],
      },
      {
        match: /select count as v from sys_goods/,
        params: [UID, 10195],
        rows: [{ v: 3 }],
      },
    ]);
    const ret = (await run(() => cmd.loadCampaignInitData(ctx))) as unknown[];
    expect(db.executed.some((e) => /insert into sys_pk_user/.test(e.sql))).toBe(false);
    expect(db.executed.some((e) => /insert into `log_goods`/.test(e.sql))).toBe(false);
    expect(ret[0]).toEqual({ normal: 105, special: 1 });
    expect(ret[4]).toEqual({ junling: 7, wuzhuqian: 3 });
  });
});

describe('PkCommands getPkFirstReward', () => {
  it('refuses rows the player did not earn and double claims', async () => {
    const fresh = build([{ match: /select 1 as one from cfg_pk_first/, rows: [] }]);
    const err = await errorOf(fresh.run(() => fresh.cmd.getPkFirstReward(ctx, [1, 0, 1])));
    expect(err.key).toBe('useMojiaGoods.invalid_param');

    const claimed = build([
      {
        match:
          /select 1 as one from cfg_pk_first\s+where uid = \? and battleid = \? and rankid = \? and type = \?$/,
        rows: [{ one: 1 }],
      },
      { match: /select 1 as one from cfg_pk_first/, rows: [{ one: 1 }] },
    ]);
    const err2 = await errorOf(claimed.run(() => claimed.cmd.getPkFirstReward(ctx, [1, 0, 1])));
    expect(err2.key).toBe('king.has_get_reward');
  });

  it('parses the stored reward, grants it and stamps the claim time', async () => {
    const { cmd, db, run } = build([
      {
        match:
          /select 1 as one from cfg_pk_first\s+where uid = \? and battleid = \? and rankid = \? and type = \?$/,
        rows: [{ one: 1 }],
      },
      { match: /select 1 as one from cfg_pk_first/, rows: [] },
      {
        match: /select reward as v from cfg_pk_first/,
        rows: [{ v: '1,0,324,5' }],
      },
      { match: /select \* from cfg_goods where gid = \?/, rows: [{ gid: 324, name: '虎符' }] },
    ]);
    const ret = (await run(() => cmd.getPkFirstReward(ctx, [1, 0, 1]))) as unknown[];
    const grant = ret[0] as Record<string, unknown>[];
    expect(grant).toHaveLength(1);
    expect(grant[0]!.gid).toBe(324);
    expect(grant[0]!.count).toBe(5);
    expect(grant[0]!.gtype).toBe(0);
    const goodsLog = db.executed.find((e) => /insert into `log_goods`/.test(e.sql))!;
    expect(goodsLog.parameters).toEqual([UID, 324, 5, 5]);
    const stamp = db.executed.find((e) =>
      /update cfg_pk_first set time = unix_timestamp\(\)/.test(e.sql),
    )!;
    expect(stamp.parameters).toEqual([UID, 1, 1, 0]);
  });
});

describe('PkCommands loadPKRewardRank', () => {
  it('parses goods and armor rewards and skips empty uids', async () => {
    const { cmd, run } = build([
      {
        match:
          /select \* from cfg_pk_first\s+where battleid = \? and type = \? order by rankid asc limit 3/,
        rows: [
          {
            battleid: 1,
            passtime: 1700000000,
            rankid: 1,
            reward: '1,0,324,5',
            time: 0,
            type: 0,
            uid: UID,
          },
          { battleid: 1, passtime: 0, rankid: 2, reward: '1,1,50305,2', time: 0, type: 0, uid: 0 },
        ],
      },
      { match: /select name as v from sys_user where uid = \?/, rows: [{ v: 'changle' }] },
      { match: /select from_unixtime\(\?\) as v/, rows: [{ v: '2023-11-14 22:13:20' }] },
      { match: /select \* from cfg_goods where gid = \?/, rows: [{ gid: 324, name: '虎符' }] },
      { match: /select \* from cfg_armor where id = \?/, rows: [{ id: 50305, name: '战神盔' }] },
    ]);
    const ret = (await run(() => cmd.loadPKRewardRank(ctx, [1, 0]))) as unknown[];
    const rows = ret[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.userName).toBe('changle');
    expect(rows[0]!.formatTime).toBe('2023-11-14 22:13:20');
    expect(rows[0]!.rewardType).toBe(0);
    expect((rows[0]!.rewardGood as Record<string, unknown>).gid).toBe(324);
    expect(rows[0]!.rewardCount).toBe('5');
    expect('userName' in rows[1]!).toBe(false);
    expect(rows[1]!.rewardType).toBe(1);
    expect((rows[1]!.rewardGood as Record<string, unknown>).id).toBe(50305);
    expect(rows[1]!.rewardCount).toBe('2');
  });
});

describe('PkCommands regetCampaignMaxData', () => {
  it('returns the floors and both currencies, false when absent', async () => {
    const filled = build([
      {
        match: /select normal, special from sys_pk_user where uid = \?/,
        rows: [{ normal: 205, special: 1 }],
      },
      { match: /select count as v from sys_goods/, params: [UID, 19200], rows: [{ v: 12 }] },
      { match: /select count as v from sys_goods/, params: [UID, 10195], rows: [{ v: 0 }] },
    ]);
    expect(await filled.run(() => filled.cmd.regetCampaignMaxData(ctx))).toEqual([
      { normal: 205, special: 1 },
      12,
      0,
    ]);

    const empty = build();
    expect(await empty.run(() => empty.cmd.regetCampaignMaxData(ctx))).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('PkCommands buyJunlingFunc', () => {
  it('only sells for 元宝 and only a positive count', async () => {
    const wrongType = build();
    const err = await errorOf(wrongType.run(() => wrongType.cmd.buyJunlingFunc(ctx, [1, 5])));
    expect(err.key).toBe('buyGoods.invalid_pay_type');
    expect(wrongType.db.executed).toHaveLength(0);

    const zero = build();
    const err2 = await errorOf(zero.run(() => zero.cmd.buyJunlingFunc(ctx, [0, 0])));
    expect(err2.key).toBe('buyGoods.invalid_amount');
    expect(zero.db.executed).toHaveLength(0);
  });

  it('demands 元宝 and enforces the 100 军令 stock cap', async () => {
    const poor = build([
      { match: /select money as v from sys_user where uid = \?/, rows: [{ v: 10 }] },
    ]);
    const err = await errorOf(poor.run(() => poor.cmd.buyJunlingFunc(ctx, [0, 5])));
    expect(err.key).toBe('buyGoods.no_enough_YuanBao'); // 5*5 = 25 > 10

    const capped = build([
      { match: /select money as v from sys_user where uid = \?/, rows: [{ v: 100 }] },
      { match: /select count as v from sys_goods/, params: [UID, 19200], rows: [{ v: 98 }] },
    ]);
    const err2 = await errorOf(capped.run(() => capped.cmd.buyJunlingFunc(ctx, [0, 5])));
    expect(err2.key).toBe('buyGoods.junling_max_count');
    expect(err2.args).toEqual([2]);
  });

  it('charges 5 元宝 per 军令 and answers [type, newStock, money]', async () => {
    const { cmd, db, run } = build([
      { match: /select money as v from sys_user where uid = \?/, rows: [{ v: 100 }] },
      { match: /select count as v from sys_goods/, params: [UID, 19200], rows: [{ v: 10 }] },
    ]);
    const ret = (await run(() => cmd.buyJunlingFunc(ctx, [0, 5]))) as unknown[];
    expect(ret[0]).toBe(0);
    expect(ret[1]).toBe(15);
    // the fake returns the same row for both money reads, so the echo is the pre-deduction value
    expect(ret[2]).toBe(100);
    const moneyLog = db.executed.find((e) => /insert into log_money/.test(e.sql))!;
    expect(moneyLog.parameters).toEqual([UID, -25, 0]);
    const goodsLog = db.executed.find((e) => /insert into `log_goods`/.test(e.sql))!;
    expect(goodsLog.parameters).toEqual([UID, 19200, 5, 0]);
  });
});

describe('PkCommands getAllHeroByUid', () => {
  const HERO_PAGE = (rows: Record<string, unknown>[]): Respond => ({
    match:
      /select h\.\*, \(h\.bravery_base \+ h\.bravery_add \+ h\.bravery_add_on\) as heroBravery, m\.\*/,
    rows,
  });
  const KING: Respond = {
    match: /select \* from sys_city_hero h left join mem_hero_blood m on m\.hid = h\.hid/,
    rows: [{ hid: 80213, name: 'changle', herotype: 1000 }],
  };
  const KING_HID: Respond = {
    match: /select hid as v from sys_city_hero where uid = \? and herotype = 1000/,
    rows: [{ v: 80213 }],
  };

  it('demands an array of selected hids and a positive page', async () => {
    const bad = build();
    const err = await errorOf(bad.run(() => bad.cmd.getAllHeroByUid(ctx, ['x', 1])));
    expect(err.key).toBe('useMojiaGoods.invalid_param');
    const zero = build();
    const err2 = await errorOf(zero.run(() => zero.cmd.getAllHeroByUid(ctx, [[], 0])));
    expect(err2.key).toBe('useMojiaGoods.invalid_param');
  });

  it('page 1 without a selection leads with the king hero and lists 9 others', async () => {
    const { cmd, db, run } = build([
      HERO_PAGE([
        { hid: 80214, heroBravery: 50 },
        { hid: 80215, heroBravery: 40 },
      ]),
      KING,
    ]);
    const ret = (await run(() => cmd.getAllHeroByUid(ctx, [[], 1]))) as unknown[];
    expect(ret).toHaveLength(3);
    expect((ret[0] as unknown[]).length).toBe(2);
    expect(ret[1]).toBe(1);
    expect(ret[2]).toEqual({ hid: 80213, name: 'changle', herotype: 1000 });
    const list = db.executed.find((e) => /heroBravery/.test(e.sql))!;
    expect(list.sql).not.toContain('not in');
    expect(list.parameters).toEqual([UID, 0, 9]);
  });

  it('page 1 excludes the chosen hids; the king row disappears once he is picked', async () => {
    const picked = build([KING_HID, HERO_PAGE([{ hid: 80215, heroBravery: 10 }])]);
    const ret = (await picked.run(() =>
      picked.cmd.getAllHeroByUid(ctx, [[80213], 1]),
    )) as unknown[];
    expect(ret).toHaveLength(2); // king already selected → no king row
    expect(picked.db.executed.find((e) => /heroBravery/.test(e.sql))!.parameters).toEqual([
      UID,
      80213,
      0,
      10,
    ]);

    const unpicked = build([KING_HID, HERO_PAGE([]), KING]);
    const ret2 = (await unpicked.run(() =>
      unpicked.cmd.getAllHeroByUid(ctx, [[80214], 1]),
    )) as unknown[];
    expect(ret2).toHaveLength(3); // king not selected → he is appended for the first slot
    expect((ret2[0] as unknown[]).length).toBe(0);
  });

  it('later pages page by 10 with the not-in filter', async () => {
    const { cmd, db, run } = build([HERO_PAGE([])]);
    const ret = (await run(() => cmd.getAllHeroByUid(ctx, [[80214, 80215], 3]))) as unknown[];
    expect(ret[1]).toBe(3);
    const list = db.executed.find((e) => /heroBravery/.test(e.sql))!;
    expect(list.sql).toContain('not in (?, ?)');
    expect(list.parameters).toEqual([UID, 80214, 80215, 20, 10]);
  });
});
