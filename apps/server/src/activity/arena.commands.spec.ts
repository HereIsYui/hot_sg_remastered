import { describe, expect, it } from 'vitest';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { RandomService, ScriptedRandom, sequenceSource } from '../core/random.service';
import { RewardRules } from '../core/reward-rules.service';
import { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { TaskRewards } from '../task/task-rewards.service';
import { ArenaCommands } from './arena.commands';
import { PkEngine, type PkHero } from './pk-engine';

type Row = Record<string, unknown>;

const lang = new LangService({
  assemble: {
    hero_count_error: '参战将领必须为3个',
    king_not_in: '君主将必须参加',
    update_succ: '更新成功！',
    target_not_exist: '攻击的玩家不存在！',
    user_not_exist: '您当前不在竞技场中',
    nobility_not_enough: '爵位需达到上造！',
    reward_not_exist: '没有您的奖励数据，无法领取奖励！',
    target_is_wrong: '不能攻击自己！',
    time_is_cooling: '挑战冷却中！',
    time_not_cooling: '不需要消除冷却时间',
    hero_data_error: '将领数据异常',
    need_change_hero: '您目前的将领数量大于3个，请重新配置三个不同的将领！',
    resist_hero_error: '对方将领异常，请联系客服！',
    reward_target_error: '只能领取自己的奖励！',
    reward_cooling_exist: '奖励还在冷却中，请稍后进行领取！',
    refresh_cooling_exist: '请不要频繁刷新！',
    attack_succ_inform: '碉堡了！【%s】挑战竞技场第%d名【%s】成功！',
    resist_succ_inform: '竞技场第%d名【%s】击败挑战者【%s】，捍卫了自己的地位！',
    attack_succ_inform_3: '【%s】在竞技场连胜3场，实力不凡！',
    attack_succ_inform_5: '【%s】在竞技场连胜5场，所向披靡！',
    attack_succ_inform_10: '【%s】在竞技场连胜10场，傲视群雄！',
    attack_succ_inform_15: '【%s】在竞技场连胜15场，已经无人能挡了！',
    attack_succ_inform_30: '【%s】在竞技场连胜30场，实在太逆天了！',
    attack_npc_succ_inform: '“热血名将”在竞技场中被后起之秀“%s”打败！',
    goto_rank_error: '您跳转的名次无效',
    goto_not_need: '您当前就在本名次，无需跳转！',
    goto_over_max: '当前竞技场最低排名为%d，无法跳转到指定名次！',
    special_hero_name: '热血名将',
  },
  useGoods: { king_cannot_find: '您当前没有君主将' },
  waigua: { invalid: '数据异常' },
  buyGoods: { no_enough_YuanBao: '你的元宝不足，请充值。' },
  king: { has_get_reward: '您已经领取过奖励' },
  kingReward: { not_find_data: '数据出现异常，请联系客服' },
  useMojiaGoods: { invalid_param: '参数错误' },
  hero: { xidian_unvalid: '使用外挂将导致账号数据异常，后果自负！' },
});

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };
/** A fixed DB clock for every `select unix_timestamp()` rule. */
const NOW = 1760000000;

function build(rules: Respond[], draws: number[] = []) {
  const db = new FakeDb(rules);
  const scripted = new ScriptedRandom();
  const random = new RandomService(scripted);
  const users = new UserRules(db.scope);
  const goods = new GoodsRules(db.scope);
  const cities = new CityRules(db.scope);
  const rewards = new TaskRewards(
    db.scope,
    lang,
    cities,
    goods,
    new HeroRules(db.scope),
    users,
    random,
  );
  const grant = new RewardRules(db.scope, goods, rewards);
  const cmd = new ArenaCommands(
    db.scope,
    lang,
    random,
    goods,
    cities,
    users,
    rewards,
    grant,
    new PkEngine(random),
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

/** The cfg_assemble_reward rows as the shipped dump has them (rates sum to 100). */
const CFG_REWARDS: Row[] = [
  { id: 1, name: '黄金', gid: -1, base: 50000, type: 2, rate: 30 },
  { id: 2, name: '粮食', gid: -2, base: 50000, type: 2, rate: 15 },
  { id: 3, name: '木材', gid: -3, base: 50000, type: 2, rate: 15 },
  { id: 4, name: '铜钱', gid: 152, base: 10, type: 0, rate: 8 },
  { id: 5, name: '礼金', gid: 0, base: 1, type: 0, rate: 2 },
  { id: 6, name: '五铢钱', gid: 10960, base: 50, type: 0, rate: 15 },
  { id: 7, name: '孙子兵法', gid: 10961, base: 3, type: 0, rate: 15 },
];

/** A hero slice row for the startUserPK part queries (PKFunc.php:887-899). */
function heroPart(hid: number, standIndex: number, bravery: number): Respond {
  return {
    match: /from sys_city_hero a, mem_hero_blood b where a\.hid = b\.hid/,
    params: [standIndex, hid],
    rows: [
      {
        hid,
        sex: 1,
        energy: 10,
        standIndex,
        command: 10,
        affair: 10,
        bravery,
        wisdom: 10,
        speed: 0,
      },
    ],
  };
}

/** A full joined hero row for `select h.*, b.*` (base info / loadUserBattleHero). */
function fullHero(hid: number, uid: number | undefined): Respond {
  return {
    match: /select h\.\*, b\.\* from sys_city_hero h, mem_hero_blood b/,
    params: uid === undefined ? [hid] : [hid, uid],
    rows: [
      { hid, uid: uid ?? 1001, name: `将${hid}`, sex: 1, level: 5, herotype: 1000, force: 10 },
    ],
  };
}

interface ChallengeOpts {
  userRank: number;
  targetRank: number;
  count?: number;
  resistBravery?: number;
  rewardid?: number;
  endtime?: number;
  /** The defender's king lookup answers nothing. */
  noResistKing?: boolean;
  /** The `sys_user_assemble ... rank > attackNewRank` swap check. */
  swapCheck?: Row[];
  /** Rows of `mem_assemble where rank between min and max` for the shift. */
  between?: Row[];
  /** Per-uid re-reads of `mem_assemble rank` for the shift loop. */
  rankOf?: Record<number, number>;
  /** The `sys_user_assemble ... maxrank > ?` check. */
  maxrankCheck?: Row[];
  /** Extra rules appended last (money checks, a self mem_assemble row, ...). */
  extra?: Respond[];
}

/** The full rule set of a 1001 → 1002 challenge; every knob the tests vary sits in opts. */
function challengeRules(opts: ChallengeOpts): Respond[] {
  const resistBravery = opts.resistBravery ?? 10;
  const rewardid = opts.rewardid ?? 10960;
  const endtime = opts.endtime ?? NOW + 9000;
  return [
    { match: /from `mem_user_buffer`/i, rows: [] },
    { match: /next_challenge_time > unix_timestamp\(\)/, rows: [] },
    {
      match: /^select `rank` as v from mem_assemble where uid = \?$/,
      params: [1001],
      rows: [{ v: opts.userRank }],
    },
    {
      match: /^select \* from mem_assemble where uid = \?$/,
      params: [1002],
      rows: [{ uid: 1002, rank: opts.targetRank, rewardid, count: 50, level: 4, endtime }],
    },
    { match: /^select nobility as v from sys_user where uid = \?$/, rows: [{ v: 2 }] },
    {
      match: /^select \* from mem_assemble_hero where uid = \?$/,
      params: [1001],
      rows: [{ uid: 1001, hid1: 80213, hid2: 5, hid3: 7 }],
    },
    {
      match: /^select \* from mem_assemble_hero where uid = \?$/,
      params: [1002],
      rows: [{ uid: 1002, hid1: 80001, hid2: 80002, hid3: 80003 }],
    },
    {
      match: /^select hid as v from sys_city_hero where uid = \? and herotype = '1000'$/,
      params: [1001],
      rows: [{ v: 80213 }],
    },
    {
      match: /^select hid as v from sys_city_hero where uid = \? and herotype = '1000'$/,
      params: [1002],
      rows: opts.noResistKing ? [] : [{ v: 80001 }],
    },
    {
      match: /select count\(1\) as v from sys_city_hero where uid = \?\s+and hid in \(\?, \?, \?\)/,
      rows: [{ v: 3 }],
    },
    heroPart(80213, 11, 20),
    heroPart(5, 12, 20),
    heroPart(7, 13, 20),
    heroPart(80001, 21, resistBravery),
    heroPart(80002, 22, resistBravery),
    heroPart(80003, 23, resistBravery),
    { match: /select unix_timestamp\(curDate\(\)\) as v/, rows: [{ v: NOW }] },
    {
      match: /^select next_challenge_time - 600 as v from sys_user_assemble where uid = \?$/,
      rows: [{ v: NOW + 100000 }],
    },
    {
      match: /^select \* from sys_user_assemble where uid = \?$/,
      params: [1001],
      rows: [
        {
          uid: 1001,
          rank: opts.userRank,
          count: opts.count ?? 0,
          maxrank: opts.userRank,
          maxwin: 0,
          next_challenge_time: NOW + 1600,
          next_refresh_time: 0,
        },
      ],
    },
    fullHero(80213, undefined),
    fullHero(5, undefined),
    fullHero(7, undefined),
    fullHero(80001, undefined),
    fullHero(80002, undefined),
    fullHero(80003, undefined),
    // dealWithResult
    { match: /^select 1 as ok from sys_user_assemble where uid = \?$/, rows: [] },
    { match: /select name as v from sys_user where uid = \?/, rows: [{ v: '挑战者' }] },
    {
      match: /^select level as v from sys_user_level where uid = \?$/,
      params: [1002],
      rows: [{ v: 4 }],
    },
    {
      match: /^select 1 as ok from sys_user_assemble where uid = \?\s+and `rank` > \?$/,
      rows: opts.swapCheck ?? [],
    },
    {
      match:
        /select uid, `rank` from mem_assemble\s+where `rank` between \? and \? order by `rank` asc/,
      rows: opts.between ?? [],
    },
    {
      match: /^select `rank` as v from mem_assemble where uid = \?$/,
      params: [1003],
      rows: [{ v: opts.rankOf?.[1003] ?? 0 }],
    },
    {
      match: /^select `rank` as v from mem_assemble where uid = \?$/,
      params: [1004],
      rows: [{ v: opts.rankOf?.[1004] ?? 0 }],
    },
    {
      match: /^select 1 as ok from sys_user_assemble where uid = \?\s+and maxrank > \?$/,
      rows: opts.maxrankCheck ?? [],
    },
    {
      match:
        /^select times as v from mem_assemble_record where fromuid = \?\s+order by time desc limit 1$/,
      rows: [{ v: 2 }],
    },
    { match: /^select maxwin as v from sys_user_assemble where uid = \?$/, rows: [{ v: 0 }] },
    { match: /^select base as v from cfg_assemble_reward where gid = \?$/, rows: [{ v: 50 }] },
    {
      match: /^select 1 as ok from mem_assemble where uid = \?\s+and endtime < unix_timestamp\(\)$/,
      rows: [],
    },
    {
      match: /^select type, base from cfg_assemble_reward where gid = \?$/,
      rows: [{ type: 0, base: 50 }],
    },
    { match: /^select lastcid as v from sys_user where uid = \?$/, rows: [{ v: 209355 }] },
    {
      match: /^select \* from cfg_goods where gid = \?$/,
      params: [10960],
      rows: [{ gid: 10960, name: '五铢钱', type: 0 }],
    },
    { match: /^select name as v from cfg_assemble_reward where gid = \?$/, rows: [{ v: '黄金' }] },
    { match: /^select \* from cfg_assemble_reward$/, rows: CFG_REWARDS },
    { match: /^select unix_timestamp\(\) as v$/, rows: [{ v: NOW }] },
    { match: /^select `rank` as v from mem_assemble where uid < 1000$/, rows: [] },
    {
      match:
        /select \*, greatest\(0, endtime - unix_timestamp\(\)\) as getRewardTime from mem_assemble/,
      rows: [],
    },
    { match: /from mem_assemble_record where fromuid = \? or touid = \?/, rows: [] },
    { match: /from mem_assemble_win_record order by/, rows: [] },
    ...(opts.extra ?? []),
  ];
}

describe('PkEngine (PKFunc.php:9-208)', () => {
  const scripted = new ScriptedRandom();
  const pk = new PkEngine(new RandomService(scripted));
  // bravery 20 → attackValue 200 vs wisdom 10 → defenceValue 100: intval(200*(1-100/2100)) = 190
  const hero = (hid: number, standIndex: number, energy = 10): PkHero => ({
    hid,
    sex: 1,
    energy,
    standIndex,
    command: 10,
    affair: 10,
    bravery: 20,
    wisdom: 10,
    speed: 0,
  });

  it('1v1 without triggers: the queue-front heroes trade 190s and the attacker wins in 5 swings', () => {
    const ret = scripted.run(sequenceSource([19999]), () =>
      pk.startUserPK([hero(1, 11)], [hero(2, 21)]),
    ) as {
      report: { blood: number; damage: number; battleId: number }[][];
      totalNum: number;
      winer: number;
    };
    // draw 19999 → mt_rand(1,20000)=20000 → no trigger fires
    expect(ret.winer).toBe(1);
    expect(ret.totalNum).toBe(5);
    expect(ret.report).toHaveLength(1);
    expect(ret.report[0]).toHaveLength(5);
    expect(ret.report[0]![0]).toMatchObject({
      flag: 0,
      attack: 0,
      resist: 0,
      damage: 190,
      blood: 310,
      attackhid: 1,
      resisthid: 2,
      battleId: 1,
      attackStandIndex: 11,
      resistStandIndex: 21,
    });
    expect(ret.report[0]![4]).toMatchObject({ damage: 190, blood: 0, battleId: 5 });
  });

  it('a faster defender takes the attacker role and the attack side loses (winer 0)', () => {
    const slow = hero(1, 11);
    const fast = { ...hero(2, 21), speed: 5 };
    const ret = scripted.run(sequenceSource([19999]), () => pk.startUserPK([slow], [fast])) as {
      report: { attackhid: number; resisthid: number }[][];
      winer: number;
    };
    expect(ret.report[0]![0]).toMatchObject({ attackhid: 2, resisthid: 1 });
    expect(ret.winer).toBe(0);
  });

  it('a survivor re-enters with energy = blood/50, so the next pairing restarts from max(energy*50, 500)', () => {
    const attacker = hero(1, 11, 15); // blood 750
    const weak = (hid: number): PkHero => ({ ...hero(hid, 21), bravery: 10 }); // deals 95
    const ret = scripted.run(sequenceSource([19999]), () =>
      pk.startUserPK([attacker], [weak(2), weak(3)]),
    ) as { report: { blood: number; battleId: number }[][]; totalNum: number; winer: number };
    // pairing 1: attacker 750-95*2=560 → energy 11 → next blood max(550,500)=550 (not 560)
    expect(ret.report).toHaveLength(2);
    expect(ret.totalNum).toBe(10);
    expect(ret.report[1]![0]).toMatchObject({ blood: 310 });
    expect(ret.report[1]![1]).toMatchObject({ blood: 455 }); // 550 - 95
    expect(ret.report[1]![3]).toMatchObject({ blood: 360 }); // 455 - 95
    expect(ret.report[1]![4]).toMatchObject({ blood: 0, battleId: 10 });
    expect(ret.winer).toBe(1);
  });
});

describe('ArenaCommands.loadArenaBattleInitData', () => {
  it('rejects nobility below 上造 (with 推恩令 taken into account)', async () => {
    const { cmd, db } = build([
      { match: /^select nobility as v from sys_user where uid = \?$/, rows: [{ v: 1 }] },
      { match: /from `mem_user_buffer`/i, rows: [] },
    ]);
    const err = await errorOf(cmd.loadArenaBattleInitData(ctx));
    expect(err.key).toBe('assemble.nobility_not_enough');
    expect(db.executed.some((e) => /mem_assemble/.test(e.sql))).toBe(false);
  });

  it('a 推恩令 bufparam lifts the real nobility over the gate', async () => {
    const { cmd } = build([
      { match: /^select nobility as v from sys_user where uid = \?$/, rows: [{ v: 1 }] },
      { match: /from `mem_user_buffer`/i, rows: [{ bufparam: 5, buftype: 16 }] },
      { match: /^select \* from mem_assemble where uid = \?$/, rows: [{ uid: 1001, rank: 3 }] },
      { match: /^select \* from sys_user_assemble where uid = \?$/, rows: [{ uid: 1001 }] },
      { match: /select unix_timestamp\(curDate\(\)\) as v/, rows: [{ v: NOW }] },
      {
        match: /^select next_challenge_time - 600 as v from sys_user_assemble where uid = \?$/,
        rows: [{ v: NOW + 100000 }],
      },
      {
        match: /greatest\(0, next_challenge_time - unix_timestamp\(\)\) as leavingtime/,
        rows: [{ uid: 1001, rank: 3, leavingtime: 0 }],
      },
      { match: /from mem_assemble_record where fromuid = \? or touid = \?/, rows: [] },
      { match: /from mem_assemble_win_record order by/, rows: [] },
      { match: /^select `rank` as v from mem_assemble where uid < 1000$/, rows: [] },
      {
        match:
          /select \*, greatest\(0, endtime - unix_timestamp\(\)\) as getRewardTime from mem_assemble/,
        rows: [],
      },
      { match: /^select hid1, hid2, hid3 from mem_assemble_hero where uid = \?$/, rows: [] },
    ]);
    const res = (await cmd.loadArenaBattleInitData(ctx)) as unknown[];
    expect(res[0]).toMatchObject({ rank: 3, leavingtime: 0 });
    expect(res[3]).toEqual([0]);
    expect(res[4]).toEqual([]);
  });

  it('first entry: ranks max(rank)+1 on an empty board, seeds the hero config and rolls a reward', async () => {
    const { cmd, db, run } = build(
      [
        { match: /^select nobility as v from sys_user where uid = \?$/, rows: [{ v: 2 }] },
        { match: /from `mem_user_buffer`/i, rows: [] },
        { match: /^select \* from mem_assemble where uid = \?$/, rows: [] },
        { match: /^select \* from sys_user_assemble where uid = \?$/, rows: [] },
        { match: /^select max\(`rank`\) as v from mem_assemble$/, rows: [{ v: null }] },
        { match: /^select `rank` as v from mem_assemble where uid = \?$/, rows: [{ v: 1 }] },
        {
          match: /^select level as v from sys_city_hero where uid = \? and herotype = '1000'$/,
          rows: [{ v: 5 }],
        },
        { match: /^select \* from mem_assemble_hero where uid = \?$/, rows: [] },
        {
          match: /^select hid as v from sys_city_hero where uid = \? and herotype = '1000'$/,
          rows: [{ v: 80213 }],
        },
        { match: /select unix_timestamp\(curDate\(\)\) as v/, rows: [{ v: NOW }] },
        {
          match: /^select next_challenge_time - 600 as v from sys_user_assemble where uid = \?$/,
          rows: [{ v: 0 }],
        },
        {
          match: /greatest\(0, next_challenge_time - unix_timestamp\(\)\) as leavingtime/,
          rows: [{ uid: 1001, rank: 1, count: 0, maxrank: 1, leavingtime: 0 }],
        },
        { match: /from mem_assemble_record where fromuid = \? or touid = \?/, rows: [] },
        { match: /from mem_assemble_win_record order by/, rows: [] },
        { match: /^select `rank` as v from mem_assemble where uid < 1000$/, rows: [] },
        {
          match:
            /select \*, greatest\(0, endtime - unix_timestamp\(\)\) as getRewardTime from mem_assemble/,
          rows: [
            {
              uid: 1001,
              rank: 1,
              rewardid: -1,
              count: 50000,
              level: 5,
              endtime: NOW,
              getRewardTime: 0,
            },
          ],
        },
        {
          match: /select name, base from cfg_assemble_reward where gid = \?/,
          rows: [{ name: '黄金', base: 50000 }],
        },
        { match: /^select level as v from sys_user_level where uid = \?$/, rows: [{ v: 3 }] },
        { match: /select name as v from sys_user where uid = \?/, rows: [{ v: 'changle' }] },
        {
          match: /^select hid1, hid2, hid3 from mem_assemble_hero where uid = \?$/,
          rows: [{ hid1: 80213, hid2: 80213, hid3: 80213 }],
        },
        fullHero(80213, 1001),
        { match: /^select \* from cfg_assemble_reward$/, rows: CFG_REWARDS },
        { match: /^select unix_timestamp\(\) as v$/, rows: [{ v: NOW }] },
      ],
      [1],
    );
    const res = (await run(() => cmd.loadArenaBattleInitData(ctx))) as unknown[];
    // board was empty → rank 1
    expect(
      db.executed.some(
        (e) =>
          /insert into mem_assemble \(`rank`, uid, level\)/.test(e.sql) && e.parameters[0] === 1,
      ),
    ).toBe(true);
    expect(
      db.executed.some(
        (e) =>
          /insert into sys_user_assemble \(uid, `rank`, maxrank\)/.test(e.sql) &&
          e.parameters[1] === 1,
      ),
    ).toBe(true);
    expect(
      db.executed.some(
        (e) =>
          /insert into mem_assemble_hero \(uid, hid1, hid2, hid3\)/.test(e.sql) &&
          e.parameters[1] === 80213,
      ),
    ).toBe(true);
    // roll draw 1 → mt_rand(1,100)=2 → the first rate row wins (黄金, 50000), endtime now+18000
    expect(
      db.executed.some(
        (e) =>
          /update mem_assemble set rewardid = \?, count = \?, endtime = \?\s+where uid = \?/.test(
            e.sql,
          ) &&
          e.parameters[0] === -1 &&
          e.parameters[1] === 50000 &&
          e.parameters[2] === NOW + 18000,
      ),
    ).toBe(true);
    // the midnight quirk reset the daily count (lasttime 0)
    expect(db.executed.some((e) => /update sys_user_assemble set count = '0'/.test(e.sql))).toBe(
      true,
    );
    expect(res[0]).toMatchObject({ rank: 1, leavingtime: 0 });
    expect(res[1]).toEqual([]);
    expect(res[2]).toEqual([]);
    // [npcPos, enriched own row] — the own row counts as isUser → base*5
    expect(res[3]).toEqual([
      0,
      {
        uid: 1001,
        rank: 1,
        rewardid: -1,
        count: 50000,
        level: 5,
        endtime: NOW,
        getRewardTime: 0,
        username: 'changle',
        rewardname: '黄金',
        userid: 1001,
        base: 50000,
        kingLevel: 3,
        canGetRewardCount: 250000,
      },
    ]);
    const heroRow = {
      hid: 80213,
      uid: 1001,
      name: '将80213',
      sex: 1,
      level: 5,
      herotype: 1000,
      force: 10,
    };
    expect(res[4]).toEqual([heroRow, heroRow, heroRow]);
  });
});

describe('ArenaCommands.holdBattleHeroInfo', () => {
  it('requires exactly three hids', async () => {
    const { cmd } = build([{ match: /from sys_city_hero/i, rows: [] }]);
    const err = await errorOf(cmd.holdBattleHeroInfo(ctx, [80213, 5]));
    expect(err.key).toBe('assemble.hero_count_error');
  });

  it('requires the king hero among the three', async () => {
    const { cmd } = build([
      {
        match: /^select hid as v from sys_city_hero where uid = \? and herotype = '1000'$/,
        rows: [{ v: 80213 }],
      },
    ]);
    const err = await errorOf(cmd.holdBattleHeroInfo(ctx, [1, 2, 3]));
    expect(err.key).toBe('assemble.king_not_in');
  });

  it('rejects a duplicate slot when the player owns three or more heroes', async () => {
    const { cmd } = build([
      {
        match: /^select hid as v from sys_city_hero where uid = \? and herotype = '1000'$/,
        rows: [{ v: 80213 }],
      },
      {
        match: /^select \* from sys_city_hero where uid = \? and hid in \(\?, \?, \?\)$/,
        rows: [{ hid: 80213 }, { hid: 5 }],
      },
      {
        match: /^select hid from sys_city_hero where uid = \?$/,
        rows: [{ hid: 1 }, { hid: 2 }, { hid: 3 }],
      },
    ]);
    const err = await errorOf(cmd.holdBattleHeroInfo(ctx, [80213, 80213, 5]));
    expect(err.key).toBe('assemble.need_change_hero');
  });

  it('stores the three hids and answers 更新成功', async () => {
    const { cmd, db } = build([
      {
        match: /^select hid as v from sys_city_hero where uid = \? and herotype = '1000'$/,
        rows: [{ v: 80213 }],
      },
      {
        match: /^select \* from sys_city_hero where uid = \? and hid in \(\?, \?, \?\)$/,
        rows: [{ hid: 80213 }, { hid: 5 }, { hid: 7 }],
      },
    ]);
    const res = await cmd.holdBattleHeroInfo(ctx, [80213, 5, 7]);
    expect(
      db.executed.some(
        (e) =>
          /insert into mem_assemble_hero \(uid, hid1, hid2, hid3\)/.test(e.sql) &&
          JSON.stringify(e.parameters.slice(0, 4)) === JSON.stringify([1001, 80213, 5, 7]),
      ),
    ).toBe(true);
    expect(res).toEqual(['更新成功！']);
  });
});

describe('ArenaCommands.loadUserBattleHero', () => {
  it('returns only the configured heroes that still exist', async () => {
    const { cmd } = build([
      {
        match: /^select hid1, hid2, hid3 from mem_assemble_hero where uid = \?$/,
        rows: [{ hid1: 80213, hid2: 5, hid3: 0 }],
      },
      fullHero(80213, 1001),
      fullHero(5, 1001),
      { match: /select h\.\*, b\.\*/, params: [0, 1001], rows: [] },
    ]);
    const res = (await cmd.loadUserBattleHero(ctx)) as unknown[];
    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({ hid: 80213 });
    expect(res[1]).toMatchObject({ hid: 5 });
  });
});

describe('ArenaCommands.loadRankBefore10', () => {
  it('answers [] outside the arena and the ranked window inside', async () => {
    const outside = build([
      { match: /^select 1 as ok from mem_assemble where uid = \?$/, rows: [] },
    ]);
    expect(await outside.cmd.loadRankBefore10(ctx)).toEqual([]);

    const { cmd } = build([
      { match: /^select 1 as ok from mem_assemble where uid = \?$/, rows: [{ ok: 1 }] },
      { match: /^select `rank` as v from mem_assemble where uid < 1000$/, rows: [] },
      { match: /^select `rank` as v from mem_assemble where uid = \?$/, rows: [{ v: 1 }] },
      {
        match:
          /select \*, greatest\(0, endtime - unix_timestamp\(\)\) as getRewardTime from mem_assemble/,
        rows: [
          {
            uid: 1001,
            rank: 1,
            rewardid: -1,
            count: 50000,
            level: 5,
            endtime: NOW + 3600,
            getRewardTime: 3600,
          },
        ],
      },
      {
        match: /select name, base from cfg_assemble_reward where gid = \?/,
        rows: [{ name: '黄金', base: 50000 }],
      },
      { match: /^select level as v from sys_user_level where uid = \?$/, rows: [{ v: 3 }] },
      { match: /select name as v from sys_user where uid = \?/, rows: [{ v: 'changle' }] },
      { match: /^select unix_timestamp\(\) as v$/, rows: [{ v: NOW }] },
    ]);
    const res = (await cmd.loadRankBefore10(ctx)) as unknown[][];
    expect(res[0]![0]).toBe(0);
    expect(res[0]![1]).toMatchObject({
      userid: 1001,
      username: 'changle',
      base: 50000,
      canGetRewardCount: 250000,
      getRewardTime: 3600,
    });
  });
});

describe('ArenaCommands.startArenaChallenge', () => {
  it('refuses while cooling, for missing ranks, self targets and out-of-range targets', async () => {
    const cooling = build([
      { match: /next_challenge_time > unix_timestamp\(\)/, rows: [{ ok: 1 }] },
    ]);
    const err1 = await errorOf(cooling.cmd.startArenaChallenge(ctx, [1002, 0]));
    expect(err1.key).toBe('assemble.time_is_cooling');

    const noRank = build([
      { match: /next_challenge_time > unix_timestamp\(\)/, rows: [] },
      { match: /^select `rank` as v from mem_assemble where uid = \?$/, rows: [] },
    ]);
    const err2 = await errorOf(noRank.cmd.startArenaChallenge(ctx, [1002, 0]));
    expect(err2.key).toBe('assemble.user_not_exist');

    const noTarget = build([
      { match: /from `mem_user_buffer`/i, rows: [] },
      { match: /next_challenge_time > unix_timestamp\(\)/, rows: [] },
      {
        match: /^select `rank` as v from mem_assemble where uid = \?$/,
        rows: [{ v: 15 }],
      },
      { match: /^select \* from mem_assemble where uid = \?$/, rows: [] },
    ]);
    const err3 = await errorOf(noTarget.cmd.startArenaChallenge(ctx, [1002, 0]));
    expect(err3.key).toBe('assemble.target_not_exist');

    const self = build(
      challengeRules({
        userRank: 15,
        targetRank: 12,
        extra: [
          {
            match: /^select \* from mem_assemble where uid = \?$/,
            params: [1001],
            rows: [{ uid: 1001, rank: 15, rewardid: 10960, count: 50, level: 4, endtime: NOW }],
          },
        ],
      }),
    );
    const err4 = await errorOf(self.cmd.startArenaChallenge(ctx, [1001, 0]));
    expect(err4.key).toBe('assemble.target_is_wrong');

    const ahead = build(challengeRules({ userRank: 15, targetRank: 15 }));
    const err5 = await errorOf(ahead.cmd.startArenaChallenge(ctx, [1002, 0]));
    expect(err5.key).toBe('assemble.target_not_exist');

    // targetRank > 10, and 11 < 21-9 → out of the challenge window
    const tooFar = build(challengeRules({ userRank: 21, targetRank: 11 }));
    const err6 = await errorOf(tooFar.cmd.startArenaChallenge(ctx, [1002, 0]));
    expect(err6.key).toBe('assemble.target_not_exist');
  });

  it('rejects a defender without any king hero', async () => {
    const { cmd } = build(challengeRules({ userRank: 15, targetRank: 12, noResistKing: true }));
    const err = await errorOf(cmd.startArenaChallenge(ctx, [1002, 0]));
    expect(err.key).toBe('assemble.resist_hero_error');
  });

  it('charges (count-9)*5 元宝 past 10 challenges and fails without them', async () => {
    const rules = challengeRules({ userRank: 15, targetRank: 12, count: 12 });
    rules.push({ match: /and money < \?$/, rows: [{ ok: 1 }] });
    const { cmd, db } = build(rules);
    const err = await errorOf(cmd.startArenaChallenge(ctx, [1002, 0]));
    expect(err.key).toBe('buyGoods.no_enough_YuanBao');
    expect(db.executed.some((e) => /insert into `?log_money`?/.test(e.sql))).toBe(false);
    expect(db.executed.some((e) => /select h\.\*, b\.\*/.test(e.sql))).toBe(false);
  });

  it('charges 50 元宝 for a first-rank challenge and fails without them', async () => {
    const { cmd, db } = build(challengeRules({ userRank: 20, targetRank: 5 }));
    // no `money >= 50` rule → the check fails → throw before the battle
    const err = await errorOf(cmd.startArenaChallenge(ctx, [1002, 0]));
    expect(err.key).toBe('buyGoods.no_enough_YuanBao');
    expect(db.executed.some((e) => /insert into `?log_money`?/.test(e.sql))).toBe(false);
    expect(db.executed.some((e) => /select h\.\*, b\.\*/.test(e.sql))).toBe(false);
  });

  it('a loss: no rank change, a flag-0 record with times 0, and the challenge counters move', async () => {
    const { cmd, db, run } = build(
      challengeRules({ userRank: 15, targetRank: 12, resistBravery: 30 }),
      [19999],
    );
    const res = (await run(() => cmd.startArenaChallenge(ctx, [1002, 0]))) as unknown[];
    const battle = res[1] as { report: unknown[][]; totalNum: number; winer: number };
    // the stronger defender (attack 300 → 285) kills each attacker; the survivor's 120 blood
    // re-enters as energy 2 → initHeroState's max(2*50, 500) resets it to 500 → 4 swings each
    expect(battle.winer).toBe(0);
    expect(battle.report).toHaveLength(3);
    expect(battle.report[0]).toHaveLength(4);
    expect(battle.report[1]).toHaveLength(4);
    expect(battle.totalNum).toBe(12);
    const record = db.executed.find((e) => /insert into mem_assemble_record/.test(e.sql))!;
    expect(record.parameters).toEqual([1001, 1002, 15, 12, 4]);
    expect(
      db.executed.some((e) => /update sys_user_assemble set count = count \+ 1/.test(e.sql)),
    ).toBe(true);
    expect(
      db.executed.some((e) =>
        /update sys_user_assemble set next_challenge_time = unix_timestamp\(\) \+ 600/.test(e.sql),
      ),
    ).toBe(true);
    // resistRank 12 > 10 → no defeat announcement
    expect(db.executed.some((e) => /insert into `sys_inform`/.test(e.sql))).toBe(false);
  });

  it('a win: both rank tables shift the between rows, the streak announces at 3, the reward pays', async () => {
    const { cmd, db, run } = build(
      challengeRules({
        userRank: 15,
        targetRank: 12,
        swapCheck: [{ ok: 1 }],
        between: [
          { uid: 1003, rank: 13 },
          { uid: 1004, rank: 14 },
        ],
        rankOf: { 1003: 13, 1004: 14 },
        maxrankCheck: [{ ok: 1 }],
      }),
      [19999],
    );
    const res = (await run(() => cmd.startArenaChallenge(ctx, [1002, 0]))) as unknown[];
    const battle = res[1] as {
      report: unknown[][];
      totalNum: number;
      winer: number;
      reward: unknown;
    };
    expect(battle.winer).toBe(1);
    expect(battle.totalNum).toBe(15);
    // the two rows between 12 and 14 each moved down one, in both tables
    for (const [rank, uid] of [
      [14, 1003],
      [15, 1004],
    ] as const) {
      expect(
        db.executed.some(
          (e) =>
            /update mem_assemble set `rank` = \?\s+where uid = \?/.test(e.sql) &&
            e.parameters[0] === rank &&
            e.parameters[1] === uid,
        ),
      ).toBe(true);
      expect(
        db.executed.some(
          (e) =>
            /update sys_user_assemble set `rank` = \?\s+where uid = \?/.test(e.sql) &&
            e.parameters[0] === rank &&
            e.parameters[1] === uid,
        ),
      ).toBe(true);
    }
    expect(
      db.executed.some(
        (e) =>
          /^update sys_user_assemble set `rank` = \?\s+where uid = \?$/.test(e.sql) &&
          e.parameters[0] === 12 &&
          e.parameters[1] === 1001,
      ),
    ).toBe(true);
    expect(
      db.executed.some(
        (e) =>
          /^update sys_user_assemble set maxrank = \?\s+where uid = \?$/.test(e.sql) &&
          e.parameters[0] === 12,
      ),
    ).toBe(true);
    // streak 2+1=3 → win record + announcement
    expect(
      db.executed.some(
        (e) =>
          /insert into mem_assemble_win_record/.test(e.sql) &&
          JSON.stringify(e.parameters) === JSON.stringify([1001, 1002, 3, 4]),
      ),
    ).toBe(true);
    expect(db.executed.some((e) => /insert into `sys_inform`/.test(e.sql))).toBe(true);
    expect(
      db.executed.some(
        (e) =>
          /^update sys_user_assemble set maxwin = \?\s+where uid = \?$/.test(e.sql) &&
          e.parameters[0] === 3,
      ),
    ).toBe(true);
    // 五铢钱 base 50, endtime in 2.5h → floor(50*2.5)=125 paid as goods
    expect(
      db.executed.some(
        (e) =>
          /insert into `?log_goods`?/.test(e.sql) &&
          JSON.stringify(e.parameters) === JSON.stringify([1001, 10960, 125, 619]),
      ),
    ).toBe(true);
    expect(battle.reward).toEqual([
      { flag: 0, info: { gid: 10960, name: '五铢钱', type: 0 }, count: 125, gtype: 0 },
    ]);
    // the grant row keeps the streak and both ranks
    const record = db.executed.find(
      (e) => /insert into mem_assemble_record/.test(e.sql) && e.parameters[4] === 3,
    )!;
    expect(record.parameters).toEqual([1001, 1002, 10960, 125, 3, 12, 13, 1, 4]);
    // the defender's next reward re-rolls (draw 19999 → rate 100 → the last row)
    expect(
      db.executed.some(
        (e) =>
          /update mem_assemble set rewardid = \?, count = \?, endtime = \?\s+where uid = \?/.test(
            e.sql,
          ) &&
          e.parameters[0] === 10961 &&
          e.parameters[3] === 1002,
      ),
    ).toBe(true);
  });
});

describe('ArenaCommands.refreshAssembleRankInfo', () => {
  it('validates the index, both rows and the 6s refresh cooldown', async () => {
    const { cmd } = build([{ match: /.*/, rows: [] }]);
    const err1 = await errorOf(cmd.refreshAssembleRankInfo(ctx, [2]));
    expect(err1.key).toBe('useMojiaGoods.invalid_param');

    const missing = build([
      { match: /^select 1 as ok from mem_assemble where uid = \?$/, rows: [] },
    ]);
    const err2 = await errorOf(missing.cmd.refreshAssembleRankInfo(ctx, [0]));
    expect(err2.key).toBe('assemble.user_not_exist');

    const cooling = build([
      { match: /^select 1 as ok from mem_assemble where uid = \?$/, rows: [{ ok: 1 }] },
      { match: /^select 1 as ok from sys_user_assemble where uid = \?$/, rows: [{ ok: 1 }] },
      { match: /next_refresh_time > unix_timestamp\(\)/, rows: [{ ok: 1 }] },
    ]);
    const err3 = await errorOf(cooling.cmd.refreshAssembleRankInfo(ctx, [1]));
    expect(err3.key).toBe('assemble.refresh_cooling_exist');
  });

  it('returns records, win records and the requested window, then arms the cooldown', async () => {
    const { cmd, db } = build([
      { match: /^select 1 as ok from mem_assemble where uid = \?$/, rows: [{ ok: 1 }] },
      { match: /^select 1 as ok from sys_user_assemble where uid = \?$/, rows: [{ ok: 1 }] },
      { match: /next_refresh_time > unix_timestamp\(\)/, rows: [] },
      {
        match: /from mem_assemble_record where fromuid = \? or touid = \?/,
        rows: [
          {
            id: 1,
            fromuid: 1001,
            touid: 1002,
            flag: 1,
            rewardid: 10960,
            rewardcount: 125,
            times: 1,
            attackrank: 12,
            resistrank: 13,
            rKingLevel: 4,
            ischange: 1,
            time: NOW,
          },
        ],
      },
      { match: /from mem_assemble_win_record order by/, rows: [] },
      { match: /select name as v from sys_user where uid = \?/, rows: [{ v: '挑战者' }] },
      { match: /^select level as v from sys_user_level where uid = \?$/, rows: [{ v: 4 }] },
      {
        match: /^select name as v from cfg_assemble_reward where gid = \?$/,
        rows: [{ v: '五铢钱' }],
      },
      { match: /^select `rank` as v from mem_assemble where uid < 1000$/, rows: [] },
      { match: /^select `rank` as v from mem_assemble where uid = \?$/, rows: [{ v: 12 }] },
      {
        match:
          /select \*, greatest\(0, endtime - unix_timestamp\(\)\) as getRewardTime from mem_assemble/,
        rows: [{ uid: 1002, rank: 12, rewardid: 10960, count: 50, level: 4, endtime: NOW }],
      },
      {
        match: /select name, base from cfg_assemble_reward where gid = \?/,
        rows: [{ name: '五铢钱', base: 50 }],
      },
      { match: /^select unix_timestamp\(\) as v$/, rows: [{ v: NOW }] },
    ]);
    const res = (await cmd.refreshAssembleRankInfo(ctx, [1])) as unknown[][];
    expect(res[0]![0]).toMatchObject({
      fromname: '挑战者',
      toname: '挑战者',
      rewardname: '五铢钱',
      toKingLevel: 4,
    });
    expect(res[1]).toEqual([]);
    expect(res[2]![0]).toBe(0);
    expect(res[2]![1]).toMatchObject({ userid: 1002, base: 50 });
    expect(
      db.executed.some((e) =>
        /update sys_user_assemble set next_refresh_time = unix_timestamp\(\) \+ 6/.test(e.sql),
      ),
    ).toBe(true);
  });
});

describe('ArenaCommands.gotoSelectedRank', () => {
  it('validates the rank, the arena membership, the same rank and the board maximum', async () => {
    const { cmd } = build([{ match: /.*/, rows: [] }]);
    const err1 = await errorOf(cmd.gotoSelectedRank(ctx, [10]));
    expect(err1.key).toBe('assemble.goto_rank_error');

    const outside = build([
      { match: /^select `rank` as v from mem_assemble where uid = \?$/, rows: [] },
    ]);
    const err2 = await errorOf(outside.cmd.gotoSelectedRank(ctx, [50]));
    expect(err2.key).toBe('assemble.user_not_exist');

    const same = build([
      { match: /^select `rank` as v from mem_assemble where uid = \?$/, rows: [{ v: 50 }] },
    ]);
    const err3 = await errorOf(same.cmd.gotoSelectedRank(ctx, [50]));
    expect(err3.key).toBe('assemble.goto_not_need');

    const over = build([
      { match: /^select `rank` as v from mem_assemble where uid = \?$/, rows: [{ v: 600 }] },
      { match: /^select max\(`rank`\) as v from mem_assemble$/, rows: [{ v: 300 }] },
    ]);
    const err4 = await errorOf(over.cmd.gotoSelectedRank(ctx, [500]));
    expect(err4.key).toBeNull();
    expect(err4.message).toBe('当前竞技场最低排名为300，无法跳转到指定名次！');
  });

  it('climbs to rank 50, shifts the in-between rows and pays 50 元宝', async () => {
    const { cmd, db } = build([
      {
        match: /^select `rank` as v from mem_assemble where uid = \?$/,
        params: [1001],
        rows: [{ v: 600 }],
      },
      { match: /^select max\(`rank`\) as v from mem_assemble$/, rows: [{ v: 700 }] },
      { match: /and money < \?$/, rows: [] },
      {
        match:
          /select uid, `rank` from mem_assemble\s+where `rank` between \? and \? order by `rank` asc/,
        rows: [
          { uid: 1002, rank: 50 },
          { uid: 1003, rank: 599 },
        ],
      },
      {
        match: /^select `rank` as v from mem_assemble where uid = \?$/,
        params: [1002],
        rows: [{ v: 50 }],
      },
      {
        match: /^select `rank` as v from mem_assemble where uid = \?$/,
        params: [1003],
        rows: [{ v: 599 }],
      },
      { match: /and maxrank > \?$/, rows: [] },
      {
        match: /^select `rank`, maxrank from sys_user_assemble where uid = \?$/,
        rows: [{ rank: 50, maxrank: 50 }],
      },
      { match: /^select `rank` as v from mem_assemble where uid < 1000$/, rows: [] },
      {
        match:
          /select \*, greatest\(0, endtime - unix_timestamp\(\)\) as getRewardTime from mem_assemble/,
        rows: [{ uid: 1001, rank: 50, rewardid: -1, count: 50000, level: 5, endtime: NOW }],
      },
      {
        match: /select name, base from cfg_assemble_reward where gid = \?/,
        rows: [{ name: '黄金', base: 50000 }],
      },
      { match: /^select level as v from sys_user_level where uid = \?$/, rows: [{ v: 3 }] },
      { match: /select name as v from sys_user where uid = \?/, rows: [{ v: 'changle' }] },
      { match: /^select unix_timestamp\(\) as v$/, rows: [{ v: NOW }] },
    ]);
    const res = (await cmd.gotoSelectedRank(ctx, [50])) as unknown[][];
    expect(
      db.executed.some(
        (e) =>
          /insert into `?log_money`?/.test(e.sql) &&
          JSON.stringify(e.parameters) === JSON.stringify([1001, -50, 619]),
      ),
    ).toBe(true);
    expect(
      db.executed.some(
        (e) =>
          /update mem_assemble set `rank` = \?\s+where uid = \?/.test(e.sql) &&
          e.parameters[0] === 51 &&
          e.parameters[1] === 1002,
      ),
    ).toBe(true);
    expect(
      db.executed.some(
        (e) =>
          /update mem_assemble set `rank` = \?\s+where uid = \?/.test(e.sql) &&
          e.parameters[0] === 600 &&
          e.parameters[1] === 1003,
      ),
    ).toBe(true);
    expect(
      db.executed.some(
        (e) =>
          /^update mem_assemble set `rank` = \?\s+where uid = \?$/.test(e.sql) &&
          e.parameters[0] === 50 &&
          e.parameters[1] === 1001,
      ),
    ).toBe(true);
    expect(res[0]).toEqual({ rank: 50, maxrank: 50 });
    expect(res[1]![0]).toBe(0);
    expect(res[1]![1]).toMatchObject({ rank: 50, canGetRewardCount: 250000 });
  });
});

describe('ArenaCommands.clearArenaCoolTime', () => {
  it('refuses when not cooling or broke, then clears for 10 元宝', async () => {
    const { cmd } = build([{ match: /next_challenge_time > unix_timestamp\(\)/, rows: [] }]);
    const err = await errorOf(cmd.clearArenaCoolTime(ctx));
    expect(err.key).toBe('assemble.time_not_cooling');

    const broke = build([
      { match: /next_challenge_time > unix_timestamp\(\)/, rows: [{ ok: 1 }] },
      { match: /and money >= 10$/, rows: [] },
    ]);
    const err2 = await errorOf(broke.cmd.clearArenaCoolTime(ctx));
    expect(err2.key).toBe('buyGoods.no_enough_YuanBao');

    const { cmd: ok, db } = build([
      { match: /next_challenge_time > unix_timestamp\(\)/, rows: [{ ok: 1 }] },
      { match: /and money >= 10$/, rows: [{ ok: 1 }] },
    ]);
    expect(await ok.clearArenaCoolTime(ctx)).toEqual([1]);
    expect(
      db.executed.some(
        (e) =>
          /insert into `?log_money`?/.test(e.sql) &&
          JSON.stringify(e.parameters) === JSON.stringify([1001, -10, 619]),
      ),
    ).toBe(true);
    expect(
      db.executed.some((e) =>
        /update sys_user_assemble set next_challenge_time = unix_timestamp\(\)\s+where uid = \?$/.test(
          e.sql,
        ),
      ),
    ).toBe(true);
  });
});

describe('ArenaCommands.getArenaReward', () => {
  it('only pays the caller, after the 5h timer, and re-rolls the reward', async () => {
    const { cmd } = build([{ match: /.*/, rows: [] }]);
    const err1 = await errorOf(cmd.getArenaReward(ctx, [999]));
    expect(err1.key).toBe('assemble.reward_target_error');

    const outside = build([{ match: /^select \* from mem_assemble where uid = \?$/, rows: [] }]);
    const err2 = await errorOf(outside.cmd.getArenaReward(ctx, [1001]));
    expect(err2.key).toBe('assemble.user_not_exist');

    const cooling = build([
      {
        match: /^select \* from mem_assemble where uid = \?$/,
        rows: [{ uid: 1001, endtime: NOW }],
      },
      { match: /and endtime > unix_timestamp\(\)/, rows: [{ ok: 1 }] },
    ]);
    const err3 = await errorOf(cooling.cmd.getArenaReward(ctx, [1001]));
    expect(err3.key).toBe('assemble.reward_cooling_exist');
  });

  it('a resource reward pays the city and answers the "name*count" string form', async () => {
    const { cmd, db, run } = build(
      [
        {
          match: /^select \* from mem_assemble where uid = \?$/,
          rows: [{ uid: 1001, rank: 1, rewardid: -1, count: 50000, level: 5, endtime: NOW - 100 }],
        },
        { match: /and endtime > unix_timestamp\(\)/, rows: [] },
        { match: /^select lastcid as v from sys_user where uid = \?$/, rows: [{ v: 209355 }] },
        {
          match: /^select type, base from cfg_assemble_reward where gid = \?$/,
          rows: [{ type: 2, base: 50000 }],
        },
        { match: /^select unix_timestamp\(\) as v$/, rows: [{ v: NOW }] },
        {
          match: /^select name as v from cfg_assemble_reward where gid = \?$/,
          rows: [{ v: '黄金' }],
        },
        { match: /^select \* from cfg_assemble_reward$/, rows: CFG_REWARDS },
      ],
      [1],
    );
    const res = (await run(() => cmd.getArenaReward(ctx, [1001]))) as unknown[];
    // lefttime -100 → multiple capped at 5 → 50000*5 gold into lastcid, reported as the string form
    expect(res[0]).toEqual([0, '黄金*250000']);
    expect(db.executed.some((e) => /update mem_city_resource set wood/.test(e.sql))).toBe(true);
    // re-roll (draw 1 → rate 2 → 黄金 50000)
    expect(
      db.executed.some(
        (e) =>
          /update mem_assemble set rewardid = \?, count = \?, endtime = \?\s+where uid = \?/.test(
            e.sql,
          ) &&
          e.parameters[0] === -1 &&
          e.parameters[1] === 50000 &&
          e.parameters[2] === NOW + 18000 &&
          e.parameters[3] === 1001,
      ),
    ).toBe(true);
  });

  it('a goods reward answers the wrapped item popup payload', async () => {
    const { cmd, run } = build(
      [
        {
          match: /^select \* from mem_assemble where uid = \?$/,
          rows: [{ uid: 1001, rank: 1, rewardid: 10960, count: 50, level: 5, endtime: NOW - 100 }],
        },
        { match: /and endtime > unix_timestamp\(\)/, rows: [] },
        { match: /^select lastcid as v from sys_user where uid = \?$/, rows: [{ v: 209355 }] },
        {
          match: /^select type, base from cfg_assemble_reward where gid = \?$/,
          rows: [{ type: 0, base: 50 }],
        },
        { match: /^select unix_timestamp\(\) as v$/, rows: [{ v: NOW }] },
        {
          match: /^select \* from cfg_goods where gid = \?$/,
          rows: [{ gid: 10960, name: '五铢钱', type: 0 }],
        },
        { match: /^select \* from cfg_assemble_reward$/, rows: CFG_REWARDS },
      ],
      [1],
    );
    const res = (await run(() => cmd.getArenaReward(ctx, [1001]))) as unknown[];
    // base 50, multiple capped 5 → 250
    expect(res[0]).toEqual([
      1,
      [{ gid: 10960, name: '五铢钱', type: 0, flag: 0, count: 250, gtype: 0 }],
    ]);
  });
});

describe('ArenaCommands.getArenaRankRewardInfo', () => {
  it('lists the top 3 with levels, the actid=1000001 ladder and the own row', async () => {
    const { cmd } = build([
      {
        match: /from log_assemble_reward where `rank` <= 3/,
        rows: [
          { rank: 1, userid: 1001, name: '甲' },
          { rank: 2, userid: 1002, name: '乙' },
        ],
      },
      {
        match: /^select level as v from sys_user_level where uid = \?$/,
        params: [1001],
        rows: [{ v: 5 }],
      },
      {
        match: /^select level as v from sys_user_level where uid = \?$/,
        params: [1002],
        rows: [{ v: 0 }],
      },
      {
        match: /from cfg_activity_rank_reward where actid = '1000001'/,
        rows: [{ actid: 1000001, minrank: 1, maxrank: 1, reward: '1,0,12027,1' }],
      },
      {
        match: /^select \* from cfg_goods where gid = \?$/,
        params: [12027],
        rows: [{ gid: 12027, name: '宝物', type: 0 }],
      },
      {
        match: /^select `rank`, reward from log_assemble_reward where uid = \?$/,
        rows: [{ rank: 3, reward: 0 }],
      },
    ]);
    const res = (await cmd.getArenaRankRewardInfo(ctx)) as unknown[];
    expect(res[0]).toEqual([
      { rank: 1, userid: 1001, name: '甲', level: 5 },
      { rank: 2, userid: 1002, name: '乙', level: 0 },
    ]);
    // the flat [rankIndex, reward, ...] keeps the exploded string parts
    expect(res[1]).toEqual([
      1,
      {
        gid: 12027,
        name: '宝物',
        type: 0,
        rewardType: '0',
        rewardCount: '1',
        minrank: 1,
        maxrank: 1,
      },
    ]);
    expect(res[2]).toEqual({ rank: 3, reward: 0 });
  });

  it('answers null for a player without a log row', async () => {
    const { cmd } = build([
      { match: /from log_assemble_reward where `rank` <= 3/, rows: [] },
      { match: /from cfg_activity_rank_reward where actid = '1000001'/, rows: [] },
      { match: /^select `rank`, reward from log_assemble_reward where uid = \?$/, rows: [] },
    ]);
    const res = (await cmd.getArenaRankRewardInfo(ctx)) as unknown[];
    expect(res[0]).toEqual([]);
    expect(res[1]).toEqual([]);
    expect(res[2]).toBeNull();
  });
});

describe('ArenaCommands.getArenaRankReward', () => {
  it('refuses without a log row and after claiming', async () => {
    const { cmd } = build([
      { match: /^select \* from log_assemble_reward where uid = \?$/, rows: [] },
    ]);
    const err1 = await errorOf(cmd.getArenaRankReward(ctx));
    expect(err1.key).toBe('assemble.reward_not_exist');

    const claimed = build([
      {
        match: /^select \* from log_assemble_reward where uid = \?$/,
        rows: [{ rank: 2, uid: 1001, reward: 1, time: NOW }],
      },
    ]);
    const err2 = await errorOf(claimed.cmd.getArenaRankReward(ctx));
    expect(err2.key).toBe('king.has_get_reward');
  });

  it('marks the claim and parses the reward string into goods', async () => {
    const { cmd, db } = build([
      {
        match: /^select \* from log_assemble_reward where uid = \?$/,
        rows: [{ rank: 2, uid: 1001, name: 'changle', reward: 0, time: 0 }],
      },
      {
        match: /^select reward as v from cfg_activity_rank_reward/,
        rows: [{ v: '1,0,12028,1' }],
      },
      {
        match: /^select \* from cfg_goods where gid = \?$/,
        params: [12028],
        rows: [{ gid: 12028, name: '宝物', type: 0 }],
      },
    ]);
    const res = (await cmd.getArenaRankReward(ctx)) as unknown[];
    expect(
      db.executed.some(
        (e) =>
          /update log_assemble_reward set reward = '1', time = unix_timestamp\(\)/.test(e.sql) &&
          e.parameters[0] === 1001,
      ),
    ).toBe(true);
    expect(res[0]).toBe(2);
    expect(res[1]).toEqual([{ gid: 12028, name: '宝物', type: 0, count: 1, gype: '0', gtype: 0 }]);
  });

  it('refuses with kingReward.not_find_data when no ladder row covers the rank', async () => {
    const { cmd } = build([
      {
        match: /^select \* from log_assemble_reward where uid = \?$/,
        rows: [{ rank: 99999999, uid: 1001, name: 'changle', reward: 0, time: 0 }],
      },
      { match: /^select reward as v from cfg_activity_rank_reward/, rows: [] },
    ]);
    const err = await errorOf(cmd.getArenaRankReward(ctx));
    expect(err.key).toBe('kingReward.not_find_data');
  });
});
