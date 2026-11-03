import { describe, expect, it } from 'vitest';
import { firstGetUserBattleInfo, ifFrozeExit } from '../battle/battlefield-troop-support';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { BattlefieldCommands } from './battlefield.commands';

type Row = Record<string, unknown>;

const NOW = 1762100000;

const lang = new LangService({
  battle: {
    user_not_in_battle: '你已经不在战场中或者战场已经结束。',
    battle_froze: '战场已经结束，你不能再行动，战场将在剩余的最后一场战斗结束后关闭。',
    nobility_not_rearch: '您的爵位还没达到或超过“公士”，无法打开战场。',
    nobility_not_rearch_dafu: '您的爵位还没达到“大夫“，无法打开赤壁战场。',
    not_complete_shishi: '史诗任务尚未完成，无法打开赤壁战场。',
    no_battle_infor: '没有战场信息',
    open_level: [1, 5, 10, 12],
  },
  useGoods: {
    today_war_count_zero: '当前剧情战场参战次数为0,不需要重置',
    qingzhan_suc: '请战书使用成功，你的剧情战场参战次数已经变为0。',
  },
});

const ctx = (uid = 1001) => ({ uid, cid: 0, ip: 0, sip: '' });

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const cmd = new BattlefieldCommands(
    db.scope,
    lang,
    new GoodsRules(db.scope),
    new UserRules(db.scope),
  );
  return { cmd, db };
}

/** The firstGetUserBattleInfo row (sys_user_battle_state joined with the field + cfg + user). */
const FIELD_ROW = (over: Row = {}): Row => ({
  honour: 10,
  unionid: 1,
  battlefieldid: 77,
  bid: 1001,
  createuid: 1001,
  level: 1,
  maxpeople: 30,
  starttime: NOW - 60,
  endtime: NOW + 3600,
  type: 0,
  state: 0,
  winner: 0,
  in_cross_battle: 0,
  name: '黄巾之乱',
  ...over,
});

const IN_BATTLE = (over: Row = {}): Respond => ({
  // matches both the firstGetUserBattleInfo join (alias u) and getUserBattleInfo's
  // inner join (alias a); the other sys_user_battle_state reads carry no alias.
  match: /from sys_user_battle_state [ua]\b/i,
  rows: [FIELD_ROW(over)],
});
const NO_BATTLE: Respond = {
  match: /from sys_user_battle_state [ua]\b/i,
  rows: [],
};
const NOW_NOW: Respond = { match: /select unix_timestamp\(\)/i, rows: [{ v: NOW }] };
const CFG_BATTLES = (rows: Row[]): Respond => ({
  match: /select \* from cfg_battle_field where state != 0 and type in/i,
  rows,
});
const CFG_BATTLE = (over: Row = {}): Row => ({
  id: 1001,
  name: '黄巾之乱',
  type: 1,
  state: 1,
  maxcount: 5,
  content: '平定黄巾',
  ...over,
});
/** The mem_user_buffer lookup behind UserRules.bufferNobility. */
const NO_BUFFER: Respond = { match: /mem_user_buffer/i, rows: [] };

async function errorOf(run: () => Promise<unknown>): Promise<GameError> {
  try {
    await run();
  } catch (err) {
    return err as GameError;
  }
  throw new Error('expected the command to throw');
}

// ─────────────────────────── getBattleNetUrl / getChibiGongXun ───────────────────────────

describe('BattlefieldCommands disabled cross-server readers', () => {
  it('getBattleNetUrl answers an empty list (BATTLE_NET_ENABLE=false)', async () => {
    const { cmd } = build([NO_BUFFER]);
    expect(await cmd.getBattleNetUrl(ctx())).toEqual([[]]);
  });

  it('getChibiGongXun catches the disabled chibi remote and answers 0', async () => {
    const { cmd } = build([]);
    expect(await cmd.getChibiGongXun(ctx())).toEqual([0]);
  });
});

// ─────────────────────────── getUserBattleInfo ───────────────────────────

describe('BattlefieldCommands.getUserBattleInfo', () => {
  it('answers the unknown battlenet pair when the user is in no battle and no chibi', async () => {
    const { cmd } = build([
      NOW_NOW,
      NO_BATTLE,
      { match: /select \* from sys_user_chibi_state/i, rows: [] },
    ]);
    // 空态赤壁：CHIBI_NET_ENABLE=false 走 else 分支补第二个 0；即使定义为 true，远端失败
    // catch 后 merge array(0) 同样是 [0,0]（BattleFunc.php:197-206）。
    expect(await cmd.getUserBattleInfo(ctx())).toEqual([
      [0, 0, -1],
      [0, 0],
    ]);
  });

  it('reports the joined field without the 逐鹿 timer for a local bid', async () => {
    const { cmd } = build([
      NOW_NOW,
      IN_BATTLE({ bid: 1001, name: '黄巾之乱', in_cross_battle: 0 }),
      { match: /select \* from sys_user_chibi_state/i, rows: [] },
    ]);
    expect(await cmd.getUserBattleInfo(ctx())).toEqual([
      [1, 0, 1001, '黄巾之乱'],
      [0, 0],
    ]);
  });

  it('gates a 逐鹿中原 (6001) wait on 1800s since jointime', async () => {
    const rules = (starttime: number): Respond[] => [
      NOW_NOW,
      IN_BATTLE({ bid: 6001, name: '逐鹿中原', starttime }),
      { match: /select \* from sys_user_chibi_state/i, rows: [] },
    ];
    expect((await build(rules(NOW - 2000)).cmd.getUserBattleInfo(ctx()))[0]).toEqual([
      1,
      0,
      6001,
      '逐鹿中原',
      1,
    ]);
    expect((await build(rules(NOW - 100)).cmd.getUserBattleInfo(ctx()))[0]).toEqual([
      1,
      0,
      6001,
      '逐鹿中原',
      0,
    ]);
  });

  it('flags a cross battle and names 赤壁 from cfg_battle_field 11000 when active', async () => {
    const { cmd } = build([
      NOW_NOW,
      IN_BATTLE({ in_cross_battle: 1 }),
      {
        match: /select \* from sys_user_chibi_state/i,
        rows: [{ uid: 1001, bid: 11000, state: 0 }],
      },
      { match: /select name from cfg_battle_field where id = \?/i, rows: [{ name: '赤壁' }] },
    ]);
    expect(await cmd.getUserBattleInfo(ctx())).toEqual([
      [1, 1, 1001, '黄巾之乱'],
      [1, '赤壁'],
    ]);
  });
});

// ─────────────────────────── getBattleInfo / getChibiInfo ───────────────────────────

describe('BattlefieldCommands.getBattleInfo', () => {
  it('throws nobility_not_rearch below 公士 (no 推恩令 active)', async () => {
    const { cmd } = build([
      { match: /select nobility from sys_user/i, rows: [{ nobility: 0 }] },
      NO_BUFFER,
    ]);
    await expect(errorOf(() => cmd.getBattleInfo(ctx()))).resolves.toMatchObject({
      key: 'battle.nobility_not_rearch',
    });
  });

  it('builds the hall reply [version, 0, battles, 0, 0, warCount, 5] and clears the alarm', async () => {
    const { cmd, db } = build([
      { match: /update sys_alarm set battle = 0/i, rows: [] },
      { match: /select nobility from sys_user/i, rows: [{ nobility: 2 }] },
      NO_BUFFER,
      NO_BATTLE,
      { match: /select value from mem_state where state = 30/i, rows: [{ value: 7 }] },
      CFG_BATTLES([CFG_BATTLE()]),
      NOW_NOW,
      { match: /select \* from cfg_act_battle where state > 0/i, rows: [] },
      { match: /select today_war_count from mem_user_schedule/i, rows: [{ today_war_count: 2 }] },
    ]);
    const ret = (await cmd.getBattleInfo(ctx())) as unknown[];
    expect(ret).toEqual([7, 0, [{ ...CFG_BATTLE(), hasBattleAct: false }], 0, 0, 2, 5]);
    expect(db.executed.some((q) => /update sys_alarm set battle = 0/i.test(q.sql))).toBe(true);
  });

  it('marks hasBattleAct for a running rate-2 activity (state 1, whole server)', async () => {
    const { cmd } = build([
      { match: /select nobility from sys_user/i, rows: [{ nobility: 2 }] },
      NO_BUFFER,
      NO_BATTLE,
      { match: /select value from mem_state where state = 30/i, rows: [] },
      CFG_BATTLES([CFG_BATTLE()]),
      NOW_NOW,
      { match: /select \* from cfg_act_battle where state > 0/i, rows: [{ state: 1, rate: 2 }] },
      { match: /select today_war_count from mem_user_schedule/i, rows: [] },
    ]);
    const ret = (await cmd.getBattleInfo(ctx())) as unknown[];
    expect((ret[2] as Row[])[0]!.hasBattleAct).toBe(true);
    // no war-count row reads as 0, as PHP's empty() did
    expect(ret[5]).toBe(0);
  });

  it('applies a state-2 activity only to the bids in cfg_act_battle_details', async () => {
    const DETAILS = /select count\(\*\) from cfg_act_battle_details/i;
    const { cmd } = build([
      { match: /select nobility from sys_user/i, rows: [{ nobility: 2 }] },
      NO_BUFFER,
      NO_BATTLE,
      { match: /select value from mem_state where state = 30/i, rows: [] },
      CFG_BATTLES([CFG_BATTLE({ id: 1001 }), CFG_BATTLE({ id: 3001, type: 3, name: '十常侍' })]),
      NOW_NOW,
      {
        match: /select \* from cfg_act_battle where state > 0/i,
        rows: [{ actid: 3, state: 2, rate: 2 }],
      },
      { match: DETAILS, params: [3, 1001], rows: [{ v: 1 }] },
      { match: DETAILS, params: [3, 3001], rows: [{ v: 0 }] },
      { match: /select today_war_count from mem_user_schedule/i, rows: [] },
    ]);
    const ret = (await cmd.getBattleInfo(ctx())) as unknown[];
    const battles = ret[2] as Row[];
    expect(battles[0]!.hasBattleAct).toBe(true);
    expect(battles[1]!.hasBattleAct).toBe(false);
  });

  it('greys out a full type-0 battlefield (canCreate false) and passes others', async () => {
    const { cmd } = build([
      { match: /select nobility from sys_user/i, rows: [{ nobility: 2 }] },
      NO_BUFFER,
      NO_BATTLE,
      { match: /select value from mem_state where state = 30/i, rows: [] },
      CFG_BATTLES([
        CFG_BATTLE({ id: 1001, type: 0, maxcount: 2 }),
        CFG_BATTLE({ id: 3001, type: 3 }),
      ]),
      NOW_NOW,
      { match: /select \* from cfg_act_battle where state > 0/i, rows: [] },
      {
        match: /select count\(\*\) from sys_user_battle_field/i,
        rows: [{ v: 2 }],
      },
      { match: /select today_war_count from mem_user_schedule/i, rows: [] },
    ]);
    const ret = (await cmd.getBattleInfo(ctx())) as unknown[];
    const battles = ret[2] as Row[];
    expect(battles[0]!.canCreate).toBe(false);
    expect(battles[1]!.canCreate).toBeUndefined();
  });

  it('collapses the reply when cfg_battle_field is empty (PHP $ret[2][] auto-vivification)', async () => {
    const { cmd } = build([
      { match: /select nobility from sys_user/i, rows: [{ nobility: 2 }] },
      NO_BUFFER,
      NO_BATTLE,
      { match: /select value from mem_state where state = 30/i, rows: [{ value: 7 }] },
      CFG_BATTLES([]),
      NOW_NOW,
      { match: /select today_war_count from mem_user_schedule/i, rows: [{ today_war_count: 3 }] },
    ]);
    // Without a seeded $ret[2] the trailing zeros shift into its place, exactly as PHP.
    expect(await cmd.getBattleInfo(ctx())).toEqual([7, 0, 0, 0, 3, 5]);
  });

  it('throws battle_froze even with emptythrow=0 when the field is frozen', async () => {
    const { cmd } = build([
      { match: /select nobility from sys_user/i, rows: [{ nobility: 2 }] },
      NO_BUFFER,
      IN_BATTLE({ state: 1 }),
    ]);
    await expect(errorOf(() => cmd.getBattleInfo(ctx()))).resolves.toMatchObject({
      key: 'battle.battle_froze',
    });
  });
});

describe('BattlefieldCommands.getChibiInfo', () => {
  const rules: Respond[] = [
    { match: /update sys_alarm set battle = 0/i, rows: [] },
    { match: /select nobility from sys_user/i, rows: [{ nobility: 2 }] },
    NO_BUFFER,
    NO_BATTLE,
    { match: /select value from mem_state where state = 30/i, rows: [{ value: 7 }] },
    CFG_BATTLES([CFG_BATTLE()]),
    NOW_NOW,
    { match: /select \* from cfg_act_battle where state > 0/i, rows: [] },
    { match: /select today_war_count from mem_user_schedule/i, rows: [] },
  ];

  it('mirrors enterChibi into the second element', async () => {
    const { cmd } = build(rules);
    expect(((await cmd.getChibiInfo(ctx(), [1])) as unknown[])[1]).toBe(1);
    expect(((await cmd.getChibiInfo(ctx(), [0])) as unknown[])[1]).toBe(0);
    expect(((await cmd.getChibiInfo(ctx(), [])) as unknown[])[1]).toBe(0);
  });
});

// ─────────────────────────── getUserBattleState / refreshUserBattleState ───────────────────────────

describe('BattlefieldCommands.getUserBattleState', () => {
  const HALL_TAIL: Respond[] = [
    { match: /select value from mem_state where state = 30/i, rows: [{ value: 7 }] },
    CFG_BATTLES([CFG_BATTLE()]),
    NOW_NOW,
    { match: /select \* from cfg_act_battle where state > 0/i, rows: [] },
    { match: /select today_war_count from mem_user_schedule/i, rows: [{ today_war_count: 2 }] },
    { match: /select max\(achivement_id\) from sys_user_achivement/i, rows: [{ v: null }] },
  ];

  it('answers the hall list with level 1 and a false waiting bid when idle', async () => {
    const { cmd } = build([
      { match: /select nobility from sys_user/i, rows: [{ nobility: 2 }] },
      NO_BUFFER,
      NO_BATTLE,
      { match: /sys_battlenet_waiting_queue/i, rows: [] },
      ...HALL_TAIL,
    ]);
    expect(await cmd.getUserBattleState(ctx())).toEqual([
      7,
      0,
      [{ ...CFG_BATTLE(), hasBattleAct: false }],
      0,
      0,
      2,
      5,
      1,
      false,
    ]);
  });

  it('reports the waiting state (2) and the queued bid', async () => {
    const { cmd } = build([
      { match: /select nobility from sys_user/i, rows: [{ nobility: 2 }] },
      NO_BUFFER,
      NO_BATTLE,
      { match: /sys_battlenet_waiting_queue/i, rows: [{ bid: 1001 }] },
      ...HALL_TAIL,
    ]);
    const ret = (await cmd.getUserBattleState(ctx())) as unknown[];
    expect(ret[1]).toBe(2);
    expect(ret.at(-1)).toBe(1001);
  });

  it('short-circuits to [version, 1, 1, bid] for a cross battle', async () => {
    const { cmd } = build([
      { match: /select nobility from sys_user/i, rows: [{ nobility: 2 }] },
      NO_BUFFER,
      IN_BATTLE({ in_cross_battle: 1 }),
      { match: /select value from mem_state where state = 30/i, rows: [{ value: 7 }] },
      { match: /select bid from sys_user_battle_state where uid/i, rows: [{ bid: 6001 }] },
    ]);
    expect(await cmd.getUserBattleState(ctx())).toEqual([7, 1, 1, 6001]);
  });

  it('returns the full field snapshot with flags, troops, start cities and net level', async () => {
    const { cmd } = build([
      { match: /select nobility from sys_user/i, rows: [{ nobility: 2 }] },
      NO_BUFFER,
      IN_BATTLE({ bid: 1001, unionid: 1 }),
      { match: /select value from mem_state where state = 30/i, rows: [{ value: 7 }] },
      {
        match: /select \* from sys_battle_city/i,
        rows: [
          { cid: 1001, unionid: -1, hasuser: 0 },
          { cid: 1002, unionid: 1, hasuser: 0 },
          { cid: 1003, unionid: 1, hasuser: 1 },
          { cid: 1004, unionid: 2, hasuser: 0 },
          { cid: 1005, unionid: 1001, hasuser: 1 },
        ],
      },
      { match: /select unionid, flag from cfg_battle_union/i, rows: [{ unionid: 1, flag: 'A' }] },
      {
        match: /select flagchar from sys_user/i,
        rows: [{ flagchar: 'L' }],
      },
      {
        match: /from sys_troops t left join sys_city_hero h/i,
        rows: [{ id: 5, heroname: '张飞' }],
      },
      {
        match: /select \* from cfg_battle_start_city/i,
        rows: [{ xy: 101, needhonour: 0 }],
      },
      { match: /select max\(achivement_id\) from sys_user_achivement/i, rows: [{ v: 70023 }] },
    ]);
    const ret = (await cmd.getUserBattleState(ctx())) as unknown[];
    expect(ret[0]).toBe(7);
    expect(ret[1]).toBe(1);
    expect(ret[2]).toBe(0); // the non-cross marker the PHP pushes before the field row
    expect(ret[3]).toMatchObject({ bid: 1001 });
    const citys = ret[4] as Row[];
    expect(citys.map((c) => c.flag)).toEqual([5, 2, 1, 0, 4]);
    expect(citys[2]!.flagchar).toBe('A');
    expect(citys[4]!.flagchar).toBe('L');
    expect(ret[5]).toEqual([{ id: 5, heroname: '张飞' }]);
    expect(ret[6]).toEqual([{ xy: 101, needhonour: 0 }]);
    expect(ret[7]).toBe(3); // getUserPVENetLevel from achivement 70023
    expect(ret).toHaveLength(8); // bid 1001 → no winpoint tail
  });

  it('appends the winpoint rows for 官渡 (2001)', async () => {
    const { cmd } = build([
      { match: /select nobility from sys_user/i, rows: [{ nobility: 2 }] },
      NO_BUFFER,
      IN_BATTLE({ bid: 2001, unionid: 1 }),
      { match: /select value from mem_state where state = 30/i, rows: [{ value: 7 }] },
      { match: /select \* from sys_battle_city/i, rows: [] },
      { match: /select unionid, flag from cfg_battle_union/i, rows: [] },
      { match: /from sys_troops t left join sys_city_hero h/i, rows: [] },
      { match: /select \* from cfg_battle_start_city/i, rows: [] },
      {
        match: /select \* from sys_battle_winpoint/i,
        rows: [{ battlefieldid: 77, point: 10 }],
      },
      { match: /select max\(achivement_id\) from sys_user_achivement/i, rows: [{ v: null }] },
    ]);
    const ret = (await cmd.getUserBattleState(ctx())) as unknown[];
    expect(ret).toHaveLength(9);
    expect(ret[7]).toEqual([{ battlefieldid: 77, point: 10 }]);
  });

  it('throws battle_froze when the joined field is already finished', async () => {
    const { cmd } = build([
      { match: /select nobility from sys_user/i, rows: [{ nobility: 2 }] },
      NO_BUFFER,
      IN_BATTLE({ state: 1 }),
    ]);
    await expect(errorOf(() => cmd.getUserBattleState(ctx()))).resolves.toMatchObject({
      key: 'battle.battle_froze',
    });
  });
});

describe('BattlefieldCommands.refreshUserBattleState', () => {
  it('collapses any failure to [0]', async () => {
    const { cmd } = build([NO_BATTLE]);
    expect(await cmd.refreshUserBattleState(ctx())).toEqual([0]);
  });

  it('bundles [1, field, flags, troops, startCities] and drops the winpoint tail for bid 1001', async () => {
    const { cmd } = build([
      IN_BATTLE({ bid: 1001, unionid: 1 }),
      { match: /select \* from sys_battle_city/i, rows: [{ cid: 1001, unionid: 1, hasuser: 1 }] },
      { match: /select unionid, flag from cfg_battle_union/i, rows: [{ unionid: 1, flag: 'A' }] },
      {
        match: /from sys_troops t left join sys_city_hero h/i,
        rows: [{ id: 9, ulimit: 3 }],
      },
      { match: /select \* from cfg_battle_start_city/i, rows: [{ xy: 101 }] },
    ]);
    const ret = (await cmd.refreshUserBattleState(ctx())) as unknown[];
    expect(ret[0]).toBe(1);
    expect(ret[1]).toMatchObject({ bid: 1001 });
    expect(ret[2]).toEqual([{ cid: 1001, unionid: 1, hasuser: 1, flagchar: 'A', flag: 1 }]);
    expect(ret[3]).toEqual([{ id: 9, ulimit: 3 }]);
    expect(ret[4]).toEqual([{ xy: 101 }]);
    expect(ret).toHaveLength(5);
  });

  it('keeps the troops query with t.ulimit (unlike getUserBattleState)', async () => {
    const { cmd, db } = build([
      IN_BATTLE({ bid: 1001, unionid: 1 }),
      { match: /select \* from sys_battle_city/i, rows: [] },
      { match: /select unionid, flag from cfg_battle_union/i, rows: [] },
      { match: /from sys_troops t left join sys_city_hero h/i, rows: [] },
      { match: /select \* from cfg_battle_start_city/i, rows: [] },
    ]);
    await cmd.refreshUserBattleState(ctx());
    const troops = db.executed.find((q) =>
      /from sys_troops t left join sys_city_hero h/.test(q.sql),
    );
    expect(troops?.sql).toContain('t.ulimit');
  });
});

// ─────────────────────────── shared helpers via this module ───────────────────────────

describe('shared firstGetUserBattleInfo / ifFrozeExit through BattlefieldDeps', () => {
  it('firstGetUserBattleInfo honours emptythrow', async () => {
    const { cmd } = build([NO_BATTLE]);
    await expect(errorOf(() => firstGetUserBattleInfo(cmd['deps'](), 1001))).resolves.toMatchObject(
      { key: 'battle.user_not_in_battle' },
    );
    expect(await firstGetUserBattleInfo(cmd['deps'](), 1001, 0)).toBe(false);
  });

  it('ifFrozeExit reads the field columns and throws when frozen', async () => {
    const { cmd } = build([
      {
        match: /from sys_user_battle_state s\s+left join sys_user_battle_field f/i,
        rows: [{ unionid: 1, battlefieldid: 77, state: 1, type: 0, bid: 1001 }],
      },
    ]);
    await expect(errorOf(() => ifFrozeExit(cmd['deps'](), 1001))).resolves.toMatchObject({
      key: 'battle.battle_froze',
    });
  });
});

// ─────────────────────────── 赤壁 gate ───────────────────────────

describe('BattlefieldCommands.getChibiState4User', () => {
  it('throws nobility_not_rearch_dafu below 大夫 without 推恩令', async () => {
    const { cmd } = build([{ match: /select nobility from sys_user/i, rows: [{ nobility: 4 }] }]);
    await expect(errorOf(() => cmd.getChibiState4User(ctx(), [1]))).resolves.toMatchObject({
      key: 'battle.nobility_not_rearch_dafu',
    });
  });

  it('throws not_complete_shishi while mem_state 5 is unset', async () => {
    const { cmd } = build([
      { match: /select nobility from sys_user/i, rows: [{ nobility: 5 }] },
      { match: /select 1 from mem_state where state = 5/i, rows: [] },
    ]);
    await expect(errorOf(() => cmd.getChibiState4User(ctx(), [1]))).resolves.toMatchObject({
      key: 'battle.not_complete_shishi',
    });
  });

  it('answers [nobility, 1, enterChibi] when the 史诗 progress is done', async () => {
    const { cmd } = build([
      { match: /select nobility from sys_user/i, rows: [{ nobility: 6 }] },
      { match: /select 1 from mem_state where state = 5/i, rows: [{ '1': 1 }] },
    ]);
    expect(await cmd.getChibiState4User(ctx(), [1])).toEqual([6, 1, 1]);
    expect(await cmd.getChibiState4User(ctx(), [0])).toEqual([6, 1, 0]);
  });
});

// ─────────────────────────── 勋章行情 / 请战书 ───────────────────────────

describe('BattlefieldCommands.getMedalExchangeInfo', () => {
  it('quotes 12:1 for 30003, 20:1 for type-0 fields and 10:1 otherwise, with own stock', async () => {
    const { cmd } = build([
      {
        match: /ifnull\(sys_things\.count, 0\)/i,
        rows: [
          { tid: 30001, name: '平定黄巾勋章', type: 0, count: 3 },
          { tid: 30002, name: '袁军官渡勋章', type: 1, count: 0 },
          { tid: 30003, name: '曹军官渡勋章', type: 1, count: 5 },
        ],
      },
    ]);
    expect(await cmd.getMedalExchangeInfo(ctx())).toEqual([
      ['平定黄巾勋章', 30001, 20, 3],
      ['袁军官渡勋章', 30002, 10, 0],
      ['曹军官渡勋章', 30003, 12, 5],
    ]);
  });
});

describe('BattlefieldCommands.resetTodayWarCount', () => {
  it('refuses when today_war_count is already 0 (missing row reads as 0)', async () => {
    const { cmd } = build([{ match: /select today_war_count from mem_user_schedule/i, rows: [] }]);
    await expect(errorOf(() => cmd.resetTodayWarCount(ctx()))).resolves.toMatchObject({
      key: 'useGoods.today_war_count_zero',
    });
  });

  it('answers the raw not_enough_goods138 (client purchase prompt) without the item', async () => {
    const { cmd } = build([
      { match: /select today_war_count from mem_user_schedule/i, rows: [{ today_war_count: 3 }] },
      { match: /select count from sys_goods/i, rows: [] },
    ]);
    await expect(errorOf(() => cmd.resetTodayWarCount(ctx()))).resolves.toMatchObject({
      key: null,
      message: 'not_enough_goods138',
    });
  });

  it('zeroes the counter, burns one 请战书 and returns [138, 0, 文案]', async () => {
    const { cmd, db } = build([
      { match: /select today_war_count from mem_user_schedule/i, rows: [{ today_war_count: 3 }] },
      { match: /select count from sys_goods/i, rows: [{ count: 2 }] },
      { match: /update mem_user_schedule set today_war_count = 0/i, rows: [] },
      { match: /insert into "log_goods"/i, rows: [] },
      { match: /update sys_goods set count = greatest/i, rows: [] },
    ]);
    expect(await cmd.resetTodayWarCount(ctx())).toEqual([
      138,
      0,
      '请战书使用成功，你的剧情战场参战次数已经变为0。',
    ]);
    expect(
      db.executed.some((q) => /update mem_user_schedule set today_war_count = 0/i.test(q.sql)),
    ).toBe(true);
    const log = db.executed.find((q) => /insert into .?log_goods.?/i.test(q.sql));
    // reduceGoods writes (uid, gid, count=-1, type=0); `time` is inlined unix_timestamp().
    expect(log?.parameters).toEqual([1001, 138, -1, 0]);
  });
});

// ─────────────────────────── getPVPBattleInfo ───────────────────────────

describe('BattlefieldCommands.getPVPBattleInfo', () => {
  const PVP_ROWS: Row[] = [
    { id: 11, bid: 1001, name: '黄巾之乱', level: 5, maxpeople: 30, minpeople: 1, state: 0 },
    { id: 12, bid: 1001, name: '黄巾之乱', level: 5, maxpeople: 30, minpeople: 1, state: 0 },
    { id: 13, bid: 1001, name: '黄巾之乱', level: 1, maxpeople: 30, minpeople: 1, state: 0 },
  ];
  const baseRules = (rows: Row[]): Respond[] => [
    {
      match: /from sys_user_battle_field u left join cfg_battle_field c/i,
      rows,
    },
    {
      match: /select count\(\*\) from sys_user_battle_state\s+where state = 0 and battlefieldid/i,
      rows: [{ v: 4 }],
    },
  ];

  it('keeps the first instance per level with its people count', async () => {
    const { cmd } = build(baseRules(PVP_ROWS));
    const ret = (await cmd.getPVPBattleInfo(ctx(), [1001])) as unknown[];
    expect(ret[0]).toEqual([
      { ...PVP_ROWS[0], people: 4 },
      { ...PVP_ROWS[2], people: 4 },
    ]);
    expect(ret).toHaveLength(1); // bid 1001 has no camp-choice branch
  });

  it('lists every cfg_battle_union camp for 官渡 (2001)', async () => {
    const { cmd } = build([
      ...baseRules([]),
      {
        match: /select unionid, name from cfg_battle_union where bid = \?$/i,
        rows: [
          { unionid: 1, name: '袁绍军' },
          { unionid: 2, name: '曹操军' },
        ],
      },
    ]);
    const ret = (await cmd.getPVPBattleInfo(ctx(), [2001])) as unknown[];
    expect(ret[1]).toEqual([
      { unionid: 1, name: '袁绍军' },
      { unionid: 2, name: '曹操军' },
    ]);
  });

  it('restricts 讨伐董卓 (4001) to the 汉室 camp', async () => {
    const { cmd } = build([
      ...baseRules([]),
      {
        match: /select unionid, name from cfg_battle_union/i,
        rows: [{ unionid: 7, name: '汉室' }],
      },
    ]);
    const ret = (await cmd.getPVPBattleInfo(ctx(), [4001])) as unknown[];
    expect(ret[1]).toEqual([{ unionid: 7, name: '汉室' }]);
  });

  it('offers the君主 himself as the 逐鹿中原 (6001) camp', async () => {
    const { cmd } = build([
      ...baseRules([]),
      { match: /select 25 as unionid, name from sys_user/i, rows: [{ unionid: 25, name: '赵四' }] },
    ]);
    const ret = (await cmd.getPVPBattleInfo(ctx(), [6001])) as unknown[];
    expect(ret[1]).toEqual([{ unionid: 25, name: '赵四' }]);
  });

  it('applies the lang battle.open_level filter (1, 5, 10, 12)', async () => {
    const { cmd, db } = build(baseRules(PVP_ROWS));
    await cmd.getPVPBattleInfo(ctx(), [1001]);
    const q = db.executed.find((x) => /from sys_user_battle_field u left join/.test(x.sql));
    expect(q?.parameters).toEqual([1001, 1, 5, 10, 12]);
  });
});

// ─────────────────────────── 战报 / 战场详情 / 总览 / 时刻表 ───────────────────────────

describe('BattlefieldCommands.getBattleNews', () => {
  it('answers [total, pageRows] with start = page * pageCount', async () => {
    const { cmd, db } = build([
      { match: /select count\(\*\) from log_battle_news/i, rows: [{ v: 12 }] },
      { match: /select \* from log_battle_news/i, rows: [{ id: 3 }] },
    ]);
    expect(await cmd.getBattleNews(ctx(), [77, 1, 2, 5])).toEqual([12, [{ id: 3 }]]);
    const page = db.executed.find((q) =>
      /from log_battle_news where battleid = \?\s+order by/.test(q.sql),
    );
    expect(page?.parameters).toEqual([77, 10, 5]);
  });
});

describe('BattlefieldCommands.getBattleInfor', () => {
  it('throws no_battle_infor for an unknown bid', async () => {
    const { cmd } = build([
      { match: /select name, minpeople, maxpeople, maxlevel, content/i, rows: [] },
    ]);
    await expect(errorOf(() => cmd.getBattleInfor(ctx(), [1001, 77, 1]))).resolves.toMatchObject({
      key: 'battle.no_battle_infor',
    });
  });

  it('throws no_battle_infor when the battlefield instance is gone', async () => {
    const { cmd } = build([
      {
        match: /select name, minpeople, maxpeople, maxlevel, content/i,
        rows: [{ name: '黄巾之乱', minpeople: 1, maxpeople: 30, content: '平定黄巾' }],
      },
      { match: /select count\(\*\) as total from sys_user_battle_state/i, rows: [{ total: 4 }] },
      { match: /select \* from sys_user_battle_field\s+where state = 0 and id/i, rows: [] },
    ]);
    await expect(errorOf(() => cmd.getBattleInfor(ctx(), [1001, 77, 1]))).resolves.toMatchObject({
      key: 'battle.no_battle_infor',
    });
  });

  it('returns the eight detail lines', async () => {
    const { cmd } = build([
      {
        match: /select name, minpeople, maxpeople, maxlevel, content/i,
        rows: [
          {
            name: '黄巾之乱',
            minpeople: 1,
            maxpeople: 30,
            content: '平定黄巾',
            winCondition: 'win',
            loseCondition: 'lose',
          },
        ],
      },
      { match: /select count\(\*\) as total from sys_user_battle_state/i, rows: [{ total: 4 }] },
      {
        match: /select \* from sys_user_battle_field\s+where state = 0 and id/i,
        rows: [{ id: 77, level: 5 }],
      },
    ]);
    expect(await cmd.getBattleInfor(ctx(), [1001, 77, 1])).toEqual([
      '黄巾之乱',
      1,
      30,
      5,
      '平定黄巾',
      4,
      'win',
      'lose',
    ]);
  });
});

describe('BattlefieldCommands.getBattleActiveState', () => {
  it('answers [open, close, conditioned] with each table projection', async () => {
    const { cmd, db } = build([
      {
        match: /select id, name, content from cfg_battle_field where state != 0/i,
        rows: [{ id: 1001, name: '黄巾之乱', content: '平定黄巾' }],
      },
      {
        match: /select id, name, openCondition from cfg_battle_field where state = 0/i,
        rows: [{ id: 2001, name: '官渡之战', openCondition: 'cond' }],
      },
      { match: /sys_battle_open_condition/i, rows: [{ id: 3001 }] },
    ]);
    expect(await cmd.getBattleActiveState()).toEqual([
      [{ id: 1001, name: '黄巾之乱', content: '平定黄巾' }],
      [{ id: 2001, name: '官渡之战', openCondition: 'cond' }],
      [{ id: 3001 }],
    ]);
    expect(db.executed).toHaveLength(3);
  });
});

describe('BattlefieldCommands.getBattleTime', () => {
  it('rewrites weekly rows (date 0, actid <= 7) from today and keeps actid as weekday', async () => {
    const { cmd } = build([
      {
        match: /cfg_act_battle\s+where state > 0 and \(date = 0/s,
        rows: [{ actid: 3, rate: 2, date: 0, starthour: 10, endhour: 22, state: 1 }],
      },
      { match: /select weekday\(from_unixtime\(unix_timestamp\(\)\)\) \+ 1/i, rows: [{ v: 2 }] },
      {
        match: /DATE_FORMAT\(from_unixtime\(unix_timestamp\(\)/i,
        rows: [{ v: '11.05' }],
      },
    ]);
    expect(await cmd.getBattleTime()).toEqual([
      [{ actid: 3, rate: 2, date: '11.05', starthour: 10, endhour: 22, state: 1, weekday: 3 }],
    ]);
  });

  it('rewrites dated rows from their own day and derives the weekday', async () => {
    const { cmd, db } = build([
      {
        match: /cfg_act_battle\s+where state > 0 and \(date = 0/s,
        rows: [{ actid: 99, rate: 3, date: NOW, starthour: 0, endhour: 24, state: 1 }],
      },
      { match: /select DATE_FORMAT\(from_unixtime\(\?\), '%m\.%d'\)/i, rows: [{ v: '11.02' }] },
      { match: /select weekday\(from_unixtime\(\?\)\) \+ 1/i, rows: [{ v: 1 }] },
    ]);
    const ret = (await cmd.getBattleTime()) as unknown[];
    expect((ret[0] as Row[])[0]).toEqual({
      actid: 99,
      rate: 3,
      date: '11.02',
      starthour: 0,
      endhour: 24,
      state: 1,
      weekday: 1,
    });
    const dated = db.executed.find((q) =>
      /select DATE_FORMAT\(from_unixtime\(\?\), '%m\.%d'\)/.test(q.sql),
    );
    expect(dated?.parameters).toEqual([NOW]);
  });
});
