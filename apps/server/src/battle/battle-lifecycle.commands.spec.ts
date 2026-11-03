import { describe, expect, it } from 'vitest';
import { LangService } from '../common/lang.service';
import { GameStateService } from '../core/game-state.service';
import { GoodsRules } from '../core/goods-rules.service';
import { RandomService, ScriptedRandom, sequenceSource } from '../core/random.service';
import type { ReportService } from '../core/report.service';
import type { TaskRules } from '../core/task-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import type { DefaultBoxService } from '../goods/default-box.service';
import { getAvailableBattleActs, isLucky } from './act-battle';
import { BattleLifecycleCommands } from './battle-lifecycle.commands';
import { getSoldierMap, getSoldierString } from './battlefield-troop-support';

/** Whitespace-tolerant SQL matcher: every literal space matches any run of whitespace. */
const rx = (pattern: string, flags = 'i') => new RegExp(pattern.replace(/ +/g, '\\s+'), flags);

const lang = new LangService({
  battle: {
    user_not_in_battle: '你已经不在战场中。',
    battle_froze: '战场已经结束。',
    troop_in_fight_when_quit: '还有军队正在行动中，不能退出战场。',
    exit_suc: '你已经中途退出战场。',
    state_invite: '邀请中',
    invite_not_creator: '你不是战场的创建者。',
    invite_user_not_exist: '您所邀请的用户不存在。',
    invite_not_enough_honour: '被邀请人战场荣誉是负数。',
    invite_user_already: '您已经向该用户发送过邀请。',
    invite_max_people: '当前战场已经达到最大人数。',
    invite_user_suc: '邀请已经发送。',
    invite_user_fail: '邀请失败。',
    invite_not_exist: '该邀请不存在或者已经取消',
    cancel_invite_suc: '取消邀请成功。',
    become_captain: '你已经荣升为队长。',
    medal_info_after: '战场结束后您将得到您的勋章和荣誉奖励信息。',
    logout: '%s 军 %s 退出了战场。',
    name: { '1001': '黄巾之乱', '5001': '千里走单骑' },
    pve_quit_win: '%s 战场结果：胜利，奖励%s。援军返还%s。获得%s %s 枚。现有%s。',
    pvp_quit_win: '%s 战场结果：胜利，奖励%s。援军返还%s。现有%s。',
    quit_lose: '%s 战场结果：失败，扣除%s。援军返还%s。现有%s。',
    '5001_quit_lose': '任务失败。',
    pvp_quit_lose: '%s 战场结果：失败。援军返还%s。现有%s。',
    quit_leave: '%s 逃离战场，扣除%s。援军返还%s。现有%s。',
    pvp_quit_leave: '%s 逃离战场。援军返还%s。现有%s。',
    quit_leave_notstartbattle: '%s 还未开启就离开了。现有%s。',
  },
});

const ctx = (uid = 1001) => ({ uid, cid: 0, ip: 0, sip: '' });

interface Built {
  cmd: BattleLifecycleCommands;
  db: FakeDb;
  reports: unknown[][];
  taskCalls: unknown[][];
  boxCalls: unknown[][];
  /** Runs fn with the command's own RandomService drawing from a scripted sequence. */
  runRng<T>(seq: number[], fn: () => Promise<T>): Promise<T>;
}

function build(rules: Respond[]): Built {
  const db = new FakeDb(rules);
  const reports: unknown[][] = [];
  const taskCalls: unknown[][] = [];
  const boxCalls: unknown[][] = [];
  const report = {
    sendReport: async (...args: unknown[]) => void reports.push(args),
  } as unknown as ReportService;
  const tasks = {
    completeTaskGoalBySortandType: async (...args: unknown[]) => void taskCalls.push(args),
  } as unknown as TaskRules;
  const box = {
    openEvent: async (...args: unknown[]) => {
      boxCalls.push(args);
      return false;
    },
  } as unknown as DefaultBoxService;
  const scripted = new ScriptedRandom();
  const cmd = new BattleLifecycleCommands(
    db.scope,
    lang,
    new GoodsRules(db.scope),
    tasks,
    report,
    new GameStateService(db.scope),
    new RandomService(scripted),
    box,
  );
  return {
    cmd,
    db,
    reports,
    taskCalls,
    boxCalls,
    runRng: <T>(seq: number[], fn: () => Promise<T>) => scripted.run(sequenceSource(seq), fn),
  };
}

/** A joined battlefield (sys_user_battle_state state 0 + sys_user_battle_field): a 黄巾 win. */
const battleRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  honour: 100,
  unionid: 1,
  battlefieldid: 501,
  bid: 1001,
  createuid: 1001,
  level: 12,
  maxpeople: 5,
  starttime: 1700000000,
  endtime: 1700086400,
  type: 0,
  state: 0,
  winner: 1,
  in_cross_battle: 0,
  name: '黄巾之乱',
  ...over,
});

const INFO = (over: Record<string, unknown> = {}): Respond => ({
  match: rx('from sys_user_battle_state u [\\s\\S]* where u\\.state = 0 and u\\.uid = \\?'),
  rows: [battleRow(over)],
});
const WIN_LOG: Respond = {
  match: rx(
    'select \\* from log_battle_honour where uid = \\? and battlefieldid = \\? and result = 0',
  ),
  rows: [],
};
const GOALS_OK: Respond[] = [
  {
    match: rx(
      'select group_concat\\(id\\) as v from cfg_task_goal where tid in \\(60000, 60001, 60002\\)',
    ),
    rows: [{ v: '11,12,13' }],
  },
  {
    match: rx(
      'select count\\(\\*\\) as v from sys_user_goal where uid = \\? and gid in \\(11,12,13\\)',
    ),
    rows: [{ v: 3 }],
  },
];
const NO_ACTS: Respond = {
  match: rx('select actid, rate, type from cfg_act where type between 3001 and 3999'),
  rows: [],
};
const UNION_ROW: Respond = {
  match: rx('select a\\.\\*, b\\.name as metal_name from cfg_battle_union a'),
  rows: [
    { unionid: 1, name: '黄巾军', metal_gid: 30001, metal_name: '平定黄巾勋章', taskthing: '' },
  ],
};
const ADULT_OFF: Respond = { match: rx('from `mem_state`'), rows: [{ value: 0 }] };
const WAR_BUFS: Respond[] = [
  { match: rx('insert into mem_war_buf'), rows: [], insertId: 1 },
  { match: rx('select last_insert_id\\(\\) as v'), rows: [{ v: 1 }] },
  { match: rx('insert into mem_war_event'), rows: [], insertId: 1 },
];
const STATE_DELETE: Respond = {
  match: rx('delete from sys_user_battle_state where uid = \\? and battlefieldid = \\?'),
  rows: [{}],
};
const PEOPLE_COUNT = (v: number): Respond => ({
  match: rx(
    'select count\\(\\*\\) as v from sys_user_battle_state where state = 0 and battlefieldid = \\?',
  ),
  rows: [{ v }],
});
const HONOUR_UPDATE: Respond = {
  match: rx('update sys_user set honour = \\? where uid = \\?'),
  rows: [],
};
const MEDAL_THINGS: Respond[] = [
  { match: rx('insert into log_things'), rows: [] },
  { match: rx('insert into sys_things'), rows: [] },
];
const GIFT_10414: Respond[] = [
  { match: rx('select \\* from sys_goods where uid = \\? and gid = \\?'), rows: [] },
  { match: rx('insert into sys_goods \\(uid, gid, count\\) values \\(\\?, \\?, 1\\)'), rows: [] },
];

/** The rules every bare winning quit (no troops, 黄巾 goals ok, adult off) needs. The bare
 * selects (honour log, act rate, troops) are left unmatched — FakeDb answers [] — so `over`
 * rules can override them. */
function bareQuitRules(over: Respond[] = [], infoOver: Record<string, unknown> = {}): Respond[] {
  return [
    INFO(infoOver),
    ...over,
    ...GOALS_OK,
    ADULT_OFF,
    HONOUR_UPDATE,
    STATE_DELETE,
    PEOPLE_COUNT(1),
    UNION_ROW,
    ...MEDAL_THINGS,
    ...GIFT_10414,
    NO_ACTS,
    ...WAR_BUFS,
  ];
}

describe('getSoldierMap / getSoldierString', () => {
  it('parses count,sid pairs preserving order and drops zeros on rebuild', () => {
    const map = getSoldierMap('2,1,30,8,20');
    expect([...map]).toEqual([
      [1, 30],
      [8, 20],
    ]);
    expect(getSoldierString(map)).toBe('2,1,30,8,20');
    map.set(8, 0);
    expect(getSoldierString(map)).toBe('1,1,30');
    const emptied = new Map<number, number>([
      [1, 0],
      [8, 0],
    ]);
    expect(getSoldierString(emptied)).toBe('');
    expect(getSoldierMap('')).toEqual(new Map());
    expect(getSoldierString(getSoldierMap('1,3,50'))).toBe('1,3,50');
  });
});

describe('act-battle helpers', () => {
  it('getAvailableBattleActs reads the running cfg_act rows', async () => {
    const db = new FakeDb([
      {
        match: rx('select actid, rate, type from cfg_act where type between 3001 and 3999'),
        rows: [{ actid: 7, rate: 20, type: 3112 }],
      },
    ]);
    await expect(getAvailableBattleActs(db.scope.db)).resolves.toEqual([
      { actid: 7, rate: 20, type: 3112 },
    ]);
  });

  it('isLucky draws mt_rand(min, max) through the scripted source', () => {
    const lucky = (seq: number[], rate: number, max = 100, min = 1) => {
      const scripted = new ScriptedRandom();
      const random = new RandomService(scripted);
      return scripted.run(sequenceSource(seq), () => isLucky(random, rate, max, min));
    };
    // draw 90 -> mt_rand(1,100) = 1 + 90%100 = 91
    expect(lucky([90], 91)).toBe(true);
    expect(lucky([90], 90)).toBe(false);
    expect(lucky([0], 1)).toBe(true); // rand 1
    expect(lucky([0], 0)).toBe(false);
    // explicit minResult: mt_rand(5,10) = 5 + 0%6 = 5
    expect(lucky([0], 5, 10, 5)).toBe(true);
    expect(lucky([0], 4, 10, 5)).toBe(false);
  });
});

describe('BattleLifecycleCommands.getQuitResult', () => {
  it('grades state 2 / win / flee / other', async () => {
    const { cmd } = build([INFO()]);
    await expect(cmd.getQuitResult(ctx())).resolves.toEqual([1]);
    const { cmd: cmd2 } = build([INFO({ state: 2 })]);
    await expect(cmd2.getQuitResult(ctx())).resolves.toEqual([2]);
    const { cmd: cmd3 } = build([INFO({ winner: -1 })]);
    await expect(cmd3.getQuitResult(ctx())).resolves.toEqual([-1]);
    const { cmd: cmd4 } = build([INFO({ winner: 5 })]);
    await expect(cmd4.getQuitResult(ctx())).resolves.toEqual([0]);
  });

  it('throws user_not_in_battle without a state-0 row', async () => {
    const { cmd } = build([{ match: rx('from sys_user_battle_state u'), rows: [] }]);
    await expect(cmd.getQuitResult(ctx())).rejects.toMatchObject({
      key: 'battle.user_not_in_battle',
    });
  });
});

describe('BattleLifecycleCommands.quitBattle — win', () => {
  it('sends the garrison home with the reinforce honour, medal, reward good and log', async () => {
    const { cmd, db, reports, taskCalls, boxCalls, runRng } = build([
      { match: rx('select name from sys_user where uid = \\?'), rows: [{ name: 'nick' }] },
      INFO(),
      WIN_LOG,
      { match: rx('from cfg_act_battle where state > 0'), rows: [] },
      {
        match: rx('select \\* from sys_troops where uid = \\? and battlefieldid = \\?'),
        rows: [
          {
            id: 5,
            uid: 1001,
            hid: 7,
            cid: 601,
            startcid: 209355,
            state: 4,
            task: 9,
            soldiers: '2,1,30,8,20',
            battlefieldid: 501,
            pathtime: 60,
          },
        ],
      },
      {
        match: rx("select type, group_concat\\(sid, ',', count\\) as soldiers"),
        rows: [{ type: 0, soldiers: '8,20' }],
      },
      { match: rx('update sys_troops set starttime'), rows: [] },
      {
        match: rx(
          'select \\* from sys_troops where cid = \\? and \\(\\(state = 4 or state = 3\\) or targetcid = \\?\\)',
        ),
        rows: [],
      },
      {
        match: rx('select uid, unionid from sys_battle_city where cid = \\?'),
        rows: [{ uid: 1001, unionid: 1 }],
      },
      {
        match: rx(
          'update sys_battle_city set uid = \\?, ownerunionid = \\?, unionid = \\?, hasuser = \\? where cid = \\?',
        ),
        rows: [],
      },
      ...GOALS_OK,
      { match: rx('select \\* from sys_goods where uid = \\? and gid = 19990'), rows: [] },
      {
        match: rx('insert into sys_goods \\(uid, gid, count\\) values \\(\\?, 19990, 1\\)'),
        rows: [],
      },
      ADULT_OFF,
      HONOUR_UPDATE,
      STATE_DELETE,
      PEOPLE_COUNT(2),
      UNION_ROW,
      ...MEDAL_THINGS,
      ...GIFT_10414,
      NO_ACTS,
      ...WAR_BUFS,
    ]);
    // mt_rand(1,100) -> 1 + 90%100 = 91 (> 90, so the 乾坤珠宝 roll hits for bid 1001)
    await runRng([90], () => cmd.quitBattle(ctx()));
    expect(reports).toHaveLength(1);
    expect(reports[0]![0]).toBe(1001);
    expect(reports[0]![1]).toBe(40);
    // honour: 100 + reinforce 1 (floor(20*6/100)) + win 12*12*8 = 1253
    const honourUpdate = db.executed.find((q) => /update sys_user set honour/i.test(q.sql));
    expect(honourUpdate?.parameters).toEqual([1253, 1001]);
    // troop turns home with the remaining soldiers and task 7
    const troopUpdate = db.executed.find((q) => /update sys_troops set starttime/i.test(q.sql));
    expect(troopUpdate?.sql).toContain('task = 7');
    expect(troopUpdate?.parameters).toEqual(['1,1,30', 5]);
    // win medal: addThings(30001, 14, 4) — level 12 + creator bonus 2
    const things = db.executed.find((q) => /insert into `?log_things`?/i.test(q.sql));
    expect(things?.parameters).toEqual([1001, 30001, 14, 4]);
    // 战场犒赏 good 19990 inserted once
    expect(db.executed.some((q) => /values \(\?, 19990, 1\)/i.test(q.sql))).toBe(true);
    // 乾坤珠宝 10414 rolled in (myrand 91 > 90)
    expect(
      db.executed.some((q) =>
        /insert into sys_goods \(uid, gid, count\) values \(\?, \?, 1\)/i.test(q.sql),
      ),
    ).toBe(true);
    // 黄巾 win completes the sort 54 type 1 goal
    expect(taskCalls).toEqual([[1001, 54, 1]]);
    expect(boxCalls).toEqual([]);
    // log_battle_honour row: result 0, honour 1253, metal 12
    const log = db.executed.find((q) => /insert into log_battle_honour/i.test(q.sql));
    expect(log?.parameters).toEqual([1001, '1001', 501, 1700000000, 0, 1253, 14, '1', '12']);
    // 战况 line: 黄巾军 军 nick 退出了战场。
    const evt = db.executed.find((q) => /insert into mem_war_event/i.test(q.sql));
    expect(evt?.parameters[2]).toBe('黄巾军 军 nick 退出了战场。');
  });

  it('appends <br/> to the message even without activity rolls', async () => {
    const { cmd, db, reports, runRng } = build([
      INFO(),
      WIN_LOG,
      { match: rx('from cfg_act_battle where state > 0'), rows: [] },
      { match: rx('select \\* from sys_troops where uid = \\? and battlefieldid = \\?'), rows: [] },
      ...GOALS_OK,
      {
        match: rx('select \\* from sys_goods where uid = \\? and gid = 19990'),
        rows: [{ uid: 1001, gid: 19990, count: 1 }],
      },
      {
        match: rx('update sys_goods set count = count \\+ 1 where uid = \\? and gid = 19990'),
        rows: [],
      },
      ADULT_OFF,
      HONOUR_UPDATE,
      STATE_DELETE,
      PEOPLE_COUNT(1),
      UNION_ROW,
      NO_ACTS,
      ...WAR_BUFS,
    ]);
    await runRng([0], () => cmd.quitBattle(ctx()));
    // myrand = 1: no 乾坤珠宝 insert
    expect(db.executed.some((q) => /values \(\?, \?, 1\)/i.test(q.sql))).toBe(false);
    // no troops → no troop writes; message ends with the bare <br/>
    expect(String(reports[0]![4]).endsWith('<br/>')).toBe(true);
  });

  it('rolls the activity box when a cfg_act row matches the bid and level', async () => {
    const { cmd, boxCalls, runRng } = build([
      INFO(),
      WIN_LOG,
      { match: rx('from cfg_act_battle where state > 0'), rows: [] },
      { match: rx('select \\* from sys_troops where uid = \\? and battlefieldid = \\?'), rows: [] },
      ...GOALS_OK,
      { match: rx('select \\* from sys_goods where uid = \\? and gid = 19990'), rows: [] },
      {
        match: rx('insert into sys_goods \\(uid, gid, count\\) values \\(\\?, 19990, 1\\)'),
        rows: [],
      },
      ADULT_OFF,
      HONOUR_UPDATE,
      STATE_DELETE,
      PEOPLE_COUNT(1),
      UNION_ROW,
      ...GIFT_10414,
      {
        match: rx('select actid, rate, type from cfg_act where type between 3001 and 3999'),
        rows: [{ actid: 7, rate: 100, type: 3112 }],
      },
      { match: rx('select lastcid as v from sys_user where uid = \\?'), rows: [{ v: 209355 }] },
      ...WAR_BUFS,
    ]);
    // draws: myrand(1,100)=91, isLucky(100,100) = 1 + 92%100 = 93 <= 100 -> hit
    await runRng([90, 92], () => cmd.quitBattle(ctx()));
    // type 3112 -> bid 1001 level 12 -> openDefaultBox(uid, lastcid, 7, 3000)
    expect(boxCalls).toEqual([[1001, 209355, 7, 3000]]);
  });

  it('skips the box when the level does not match the act type', async () => {
    const { cmd, boxCalls, runRng } = build([
      INFO(),
      WIN_LOG,
      { match: rx('from cfg_act_battle where state > 0'), rows: [] },
      { match: rx('select \\* from sys_troops where uid = \\? and battlefieldid = \\?'), rows: [] },
      ...GOALS_OK,
      { match: rx('select \\* from sys_goods where uid = \\? and gid = 19990'), rows: [] },
      {
        match: rx('insert into sys_goods \\(uid, gid, count\\) values \\(\\?, 19990, 1\\)'),
        rows: [],
      },
      ADULT_OFF,
      HONOUR_UPDATE,
      STATE_DELETE,
      PEOPLE_COUNT(1),
      UNION_ROW,
      ...GIFT_10414,
      {
        match: rx('select actid, rate, type from cfg_act where type between 3001 and 3999'),
        rows: [{ actid: 7, rate: 100, type: 3113 }],
      },
      ...WAR_BUFS,
    ]);
    await runRng([90, 92], () => cmd.quitBattle(ctx()));
    expect(boxCalls).toEqual([]);
  });
});

describe('BattleLifecycleCommands.quitBattle — gates and punishments', () => {
  it('throws troop_in_fight_when_quit when a troop is not garrisoned', async () => {
    const { cmd, db } = build([
      INFO(),
      { match: rx('from cfg_act_battle where state > 0'), rows: [] },
      {
        match: rx('select \\* from sys_troops where uid = \\? and battlefieldid = \\?'),
        rows: [{ id: 5, state: 3, soldiers: '0', hid: 7, cid: 601 }],
      },
    ]);
    await expect(cmd.quitBattle(ctx())).rejects.toMatchObject({
      key: 'battle.troop_in_fight_when_quit',
    });
    expect(db.executed.some((q) => /update sys_user set honour/i.test(q.sql))).toBe(false);
  });

  it('zeroes the honour through the anti-addiction punish (online ≥ 5h)', async () => {
    const { cmd, db, runRng } = build(
      bareQuitRules([
        { match: rx('from `mem_state`'), rows: [{ value: 1 }] },
        {
          match: rx('select \\* from sys_user_fcm where uid = \\?'),
          rows: [{ state: 0, onlinetime: 600000 }],
        },
      ]),
    );
    await runRng([0], () => cmd.quitBattle(ctx()));
    // online 10000 min >= 300 -> punish 0; win 1152 -> 0
    const honourUpdate = db.executed.find((q) => /update sys_user set honour/i.test(q.sql));
    expect(honourUpdate?.parameters).toEqual([100, 1001]);
    // medal 12 * punish 0 -> intval(0) -> no addThings rows
    expect(db.executed.some((q) => /insert into `?log_things`?/i.test(q.sql))).toBe(false);
  });

  it('halves the honour with the 0.5 punish (online 90 min..5h)', async () => {
    const { cmd, db, runRng } = build(
      bareQuitRules([
        { match: rx('from `mem_state`'), rows: [{ value: 1 }] },
        {
          match: rx('select \\* from sys_user_fcm where uid = \\?'),
          rows: [{ state: 0, onlinetime: 6000 }],
        },
      ]),
    );
    await runRng([0], () => cmd.quitBattle(ctx()));
    // online 100 min in (90, 300) -> 0.5; win 1152*0.5 = 576 -> honour 100 + 576
    const honourUpdate = db.executed.find((q) => /update sys_user set honour/i.test(q.sql));
    expect(honourUpdate?.parameters).toEqual([676, 1001]);
    // medal 14 * 0.5 = 7
    const things = db.executed.find((q) => /insert into `?log_things`?/i.test(q.sql));
    expect(things?.parameters).toEqual([1001, 30001, 7, 4]);
  });

  it('denies the win honour and medal roll once a result=0 log exists for this battlefield', async () => {
    const { cmd, db, runRng } = build(
      bareQuitRules([
        // the honour-log check finds a row (both the 黄巾 branch and the unconditional one)
        { ...WIN_LOG, rows: [{ uid: 1001 }] },
        // 犒赏 good already owned -> update branch
        {
          match: rx('select \\* from sys_goods where uid = \\? and gid = 19990'),
          rows: [{ uid: 1001, gid: 19990, count: 1 }],
        },
        {
          match: rx('update sys_goods set count = count \\+ 1 where uid = \\? and gid = 19990'),
          rows: [],
        },
      ]),
    );
    await runRng([90], () => cmd.quitBattle(ctx()));
    // canwin=false: win honour 0, medal 0 (addThings no-ops), no 乾坤珠宝 roll
    const honourUpdate = db.executed.find((q) => /update sys_user set honour/i.test(q.sql));
    expect(honourUpdate?.parameters).toEqual([100, 1001]);
    expect(db.executed.some((q) => /insert into `?log_things`?/i.test(q.sql))).toBe(false);
    expect(db.executed.some((q) => /values \(\?, \?, 1\)/i.test(q.sql))).toBe(false);
  });

  it('fails the 黄巾 canwin gate when the three main goals are not all complete', async () => {
    const { cmd, db, runRng } = build(
      bareQuitRules([
        {
          match: rx(
            'select count\\(\\*\\) as v from sys_user_goal where uid = \\? and gid in \\(11,12,13\\)',
          ),
          rows: [{ v: 2 }],
        },
      ]),
    );
    await runRng([90], () => cmd.quitBattle(ctx()));
    const honourUpdate = db.executed.find((q) => /update sys_user set honour/i.test(q.sql));
    expect(honourUpdate?.parameters).toEqual([100, 1001]);
    // canwin=false -> medal 0 -> addThings no-ops
    expect(db.executed.some((q) => /insert into `?log_things`?/i.test(q.sql))).toBe(false);
    expect(db.executed.some((q) => /values \(\?, \?, 1\)/i.test(q.sql))).toBe(false);
  });

  it('applies the cfg_act_battle weekend rate', async () => {
    const { cmd, db, runRng } = build(
      bareQuitRules([
        {
          match: rx('from cfg_act_battle where state > 0'),
          rows: [{ actid: 2, state: 1, rate: 1.5 }],
        },
      ]),
    );
    await runRng([0], () => cmd.quitBattle(ctx()));
    // 12*12*8*1.5 = 1728 -> honour 100 + 1728
    const honourUpdate = db.executed.find((q) => /update sys_user set honour/i.test(q.sql));
    expect(honourUpdate?.parameters).toEqual([1828, 1001]);
    const things = db.executed.find((q) => /insert into `?log_things`?/i.test(q.sql));
    expect(things?.parameters).toEqual([1001, 30001, 21, 4]);
  });

  it('applies the state-2 rate only to battlefields listed in cfg_act_battle_details', async () => {
    const { cmd, db, runRng } = build(
      bareQuitRules([
        {
          match: rx('from cfg_act_battle where state > 0'),
          rows: [{ actid: 3, state: 2, rate: 2 }],
        },
        { match: rx('select count\\(\\*\\) as v from cfg_act_battle_details'), rows: [{ v: 0 }] },
      ]),
    );
    await runRng([0], () => cmd.quitBattle(ctx()));
    // no detail row -> rate stays 1
    const honourUpdate = db.executed.find((q) => /update sys_user set honour/i.test(q.sql));
    expect(honourUpdate?.parameters).toEqual([1252, 1001]);
  });

  it('closes the battlefield when the last state-0 member quits', async () => {
    const { cmd, db, runRng } = build(
      bareQuitRules([
        PEOPLE_COUNT(0),
        { match: rx('update sys_user_battle_field set state = 1 where id = \\?'), rows: [] },
        { match: rx('update sys_user_battle_field set winner = 6'), rows: [] },
      ]),
    );
    await runRng([0], () => cmd.quitBattle(ctx()));
    expect(
      db.executed.some((q) =>
        /update sys_user_battle_field set state = 1 where id = \?/i.test(q.sql),
      ),
    ).toBe(true);
    expect(
      db.executed.some((q) => /update sys_user_battle_field set winner = 6/i.test(q.sql)),
    ).toBe(true);
  });
});

describe('BattleLifecycleCommands.quitBattle — flee / lose / preparation', () => {
  it('fleeing costs level²·20 and hands the field to the next member', async () => {
    const { cmd, db, reports, runRng } = build([
      INFO({ winner: -1 }),
      WIN_LOG,
      { match: rx('from cfg_act_battle where state > 0'), rows: [] },
      { match: rx('select \\* from sys_troops where uid = \\? and battlefieldid = \\?'), rows: [] },
      ...GOALS_OK,
      ADULT_OFF,
      HONOUR_UPDATE,
      {
        match: rx(
          'select \\* from sys_user_battle_field where createuid = \\? and id = \\(select battlefieldid',
        ),
        rows: [{ id: 501, createuid: 1001 }],
      },
      {
        match: rx(
          'select \\* from sys_user_battle_state where state = 0 and battlefieldid = \\? and uid != \\? order by jointime limit 1',
        ),
        rows: [{ uid: 1002, jointime: '2026-01-01 00:00:00' }],
      },
      { match: rx('update sys_user_battle_field set createuid = \\? where id = \\?'), rows: [] },
      STATE_DELETE,
      PEOPLE_COUNT(1),
      UNION_ROW,
      ...WAR_BUFS,
    ]);
    await runRng([0], () => cmd.quitBattle(ctx()));
    // flee: -12*12*20 = -2880 -> honour 100 - 2880 = -2780
    const honourUpdate = db.executed.find((q) => /update sys_user set honour/i.test(q.sql));
    expect(honourUpdate?.parameters).toEqual([-2780, 1001]);
    // captain transfer to uid 1002 with the become_captain report
    const transfer = db.executed.find((q) =>
      /update sys_user_battle_field set createuid/i.test(q.sql),
    );
    expect(transfer?.parameters).toEqual([1002, 501]);
    expect(reports).toContainEqual([1002, 40, 0, 0, '你已经荣升为队长。']);
    // no medal on a flee
    expect(db.executed.some((q) => /insert into `?log_things`?/i.test(q.sql))).toBe(false);
    // log_battle_honour result 2
    const log = db.executed.find((q) => /insert into log_battle_honour/i.test(q.sql));
    expect(log?.parameters[4]).toBe(2);
  });

  it('losing costs level²·5 and prefixes the 5001 task-failed text', async () => {
    const { cmd, db, reports, runRng } = build([
      INFO({ bid: 5001, unionid: 3, winner: 2, name: '千里走单骑' }),
      { match: rx('from cfg_act_battle where state > 0'), rows: [] },
      { match: rx('select \\* from sys_troops where uid = \\? and battlefieldid = \\?'), rows: [] },
      WIN_LOG,
      ADULT_OFF,
      HONOUR_UPDATE,
      STATE_DELETE,
      PEOPLE_COUNT(1),
      UNION_ROW,
      ...WAR_BUFS,
    ]);
    await runRng([0], () => cmd.quitBattle(ctx()));
    // lose: -12*12*5 = -720 -> honour -620; no goal checks for unionid 3
    const honourUpdate = db.executed.find((q) => /update sys_user set honour/i.test(q.sql));
    expect(honourUpdate?.parameters).toEqual([-620, 1001]);
    expect(db.executed.some((q) => /cfg_task_goal where tid in \(60000/i.test(q.sql))).toBe(false);
    // 5001 loss message prefix
    expect(String(reports[0]![4]).startsWith('任务失败。')).toBe(true);
    // log_battle_honour result 1
    const log = db.executed.find((q) => /insert into log_battle_honour/i.test(q.sql));
    expect(log?.parameters[4]).toBe(1);
  });

  it('quitting before the battle starts (state 2) skips the honour log and still transfers the captain', async () => {
    const { cmd, db, reports, runRng } = build([
      INFO({ state: 2, starttime: 0 }),
      { match: rx('select unix_timestamp\\(\\) as v'), rows: [{ v: 1700000000 }] },
      { match: rx('from cfg_act_battle where state > 0'), rows: [] },
      { match: rx('select \\* from sys_troops where uid = \\? and battlefieldid = \\?'), rows: [] },
      WIN_LOG,
      ...GOALS_OK,
      { match: rx('select \\* from sys_goods where uid = \\? and gid = 19990'), rows: [] },
      {
        match: rx('insert into sys_goods \\(uid, gid, count\\) values \\(\\?, 19990, 1\\)'),
        rows: [],
      },
      ADULT_OFF,
      HONOUR_UPDATE,
      {
        match: rx(
          'select \\* from sys_user_battle_field where createuid = \\? and id = \\(select battlefieldid',
        ),
        rows: [{ id: 501, createuid: 1001 }],
      },
      {
        match: rx(
          'select \\* from sys_user_battle_state where state = 0 and battlefieldid = \\? and uid != \\? order by jointime limit 1',
        ),
        rows: [{ uid: 1002, jointime: '2026-01-01 00:00:00' }],
      },
      { match: rx('update sys_user_battle_field set createuid = \\? where id = \\?'), rows: [] },
      STATE_DELETE,
      PEOPLE_COUNT(1),
      UNION_ROW,
      ...MEDAL_THINGS,
      ...GIFT_10414,
      NO_ACTS,
      ...WAR_BUFS,
    ]);
    await runRng([0], () => cmd.quitBattle(ctx()));
    // quittype 3: no log_battle_honour insert
    expect(db.executed.some((q) => /insert into log_battle_honour/i.test(q.sql))).toBe(false);
    // but the captain still transfers (quittype 2/3)
    expect(db.executed.some((q) => /update sys_user_battle_field set createuid/i.test(q.sql))).toBe(
      true,
    );
    // message: quit_leave_notstartbattle with the original honour (reports[0] is the transfer)
    expect(String(reports[1]![4])).toBe('黄巾之乱 还未开启就离开了。现有100。');
  });

  it('sends the title-48 report for a 据点战 (type 1) win and zeroes its honour', async () => {
    const { cmd, db, reports, runRng } = build([
      INFO({ type: 1, bid: 2001, unionid: 2, winner: 2, name: '官渡之战' }),
      { match: rx('from cfg_act_battle where state > 0'), rows: [] },
      { match: rx('select \\* from sys_troops where uid = \\? and battlefieldid = \\?'), rows: [] },
      WIN_LOG,
      ADULT_OFF,
      HONOUR_UPDATE,
      {
        match: rx(
          'update sys_user_battle_state set state = 1 where uid = \\? and battlefieldid = \\?',
        ),
        rows: [],
      },
      PEOPLE_COUNT(1),
      UNION_ROW,
      ...WAR_BUFS,
    ]);
    await runRng([0], () => cmd.quitBattle(ctx()));
    expect(reports[0]![1]).toBe(48);
    // pvp_quit_win + medal_info_after
    expect(String(reports[0]![4])).toContain('战场结束后您将得到您的勋章和荣誉奖励信息。');
    // type 1 zeroes the win honour and keeps sys_user_battle_state (state=1)
    const honourUpdate = db.executed.find((q) => /update sys_user set honour/i.test(q.sql));
    expect(honourUpdate?.parameters).toEqual([100, 1001]);
    expect(db.executed.some((q) => /update sys_user_battle_state set state = 1/i.test(q.sql))).toBe(
      true,
    );
  });
});

describe('BattleLifecycleCommands.quitBattle — reinforcement edge cases', () => {
  it('deletes the troop and frees the hero when every soldier is returned', async () => {
    const { cmd, db, runRng } = build([
      INFO(),
      WIN_LOG,
      { match: rx('from cfg_act_battle where state > 0'), rows: [] },
      {
        match: rx('select \\* from sys_troops where uid = \\? and battlefieldid = \\?'),
        rows: [
          {
            id: 5,
            uid: 1001,
            hid: 7,
            cid: 601,
            startcid: 209355,
            state: 4,
            soldiers: '1,8,50',
            battlefieldid: 501,
            pathtime: 60,
          },
        ],
      },
      {
        match: rx("select type, group_concat\\(sid, ',', count\\) as soldiers"),
        rows: [{ type: 0, soldiers: '8,50' }],
      },
      { match: rx('delete from sys_troops where id = \\?'), rows: [{}] },
      { match: rx('update sys_city_hero set state = 0 where hid = \\?'), rows: [] },
      {
        match: rx(
          'select \\* from sys_troops where cid = \\? and \\(\\(state = 4 or state = 3\\) or targetcid = \\?\\)',
        ),
        rows: [],
      },
      {
        match: rx('select uid, unionid from sys_battle_city where cid = \\?'),
        rows: [{ uid: 1001, unionid: 1 }],
      },
      { match: rx('update sys_battle_city set uid = -1'), rows: [] },
      ...GOALS_OK,
      { match: rx('select \\* from sys_goods where uid = \\? and gid = 19990'), rows: [] },
      {
        match: rx('insert into sys_goods \\(uid, gid, count\\) values \\(\\?, 19990, 1\\)'),
        rows: [],
      },
      ADULT_OFF,
      HONOUR_UPDATE,
      STATE_DELETE,
      PEOPLE_COUNT(1),
      UNION_ROW,
      ...MEDAL_THINGS,
      ...GIFT_10414,
      NO_ACTS,
      ...WAR_BUFS,
    ]);
    await runRng([0], () => cmd.quitBattle(ctx()));
    expect(db.executed.some((q) => /delete from sys_troops where id = \?/i.test(q.sql))).toBe(true);
    expect(
      db.executed.some((q) => /update sys_city_hero set state = 0 where hid = \?/i.test(q.sql)),
    ).toBe(true);
    // reinforce honour: floor(50 * 6 / 100) = 3 -> honour 100 + 3 + 1152
    const honourUpdate = db.executed.find((q) => /update sys_user set honour/i.test(q.sql));
    expect(honourUpdate?.parameters).toEqual([1255, 1001]);
  });

  it('type-1 (event) reinforcements return soldiers but no honour; overdraft clamps at 0', async () => {
    const { cmd, db, runRng } = build([
      INFO(),
      WIN_LOG,
      { match: rx('from cfg_act_battle where state > 0'), rows: [] },
      {
        match: rx('select \\* from sys_troops where uid = \\? and battlefieldid = \\?'),
        rows: [
          {
            id: 5,
            uid: 1001,
            hid: 7,
            cid: 601,
            startcid: 209355,
            state: 4,
            soldiers: '2,8,50,11,30',
            battlefieldid: 501,
            pathtime: 60,
          },
        ],
      },
      {
        match: rx("select type, group_concat\\(sid, ',', count\\) as soldiers"),
        rows: [
          { type: 0, soldiers: '11,10' },
          { type: 1, soldiers: '8,50' },
        ],
      },
      { match: rx('update sys_troops set starttime'), rows: [] },
      {
        match: rx(
          'select \\* from sys_troops where cid = \\? and \\(\\(state = 4 or state = 3\\) or targetcid = \\?\\)',
        ),
        rows: [],
      },
      {
        match: rx('select uid, unionid from sys_battle_city where cid = \\?'),
        rows: [{ uid: 1001, unionid: 1 }],
      },
      {
        match: rx(
          'update sys_battle_city set uid = \\?, ownerunionid = \\?, unionid = \\?, hasuser = \\? where cid = \\?',
        ),
        rows: [],
      },
      ...GOALS_OK,
      { match: rx('select \\* from sys_goods where uid = \\? and gid = 19990'), rows: [] },
      {
        match: rx('insert into sys_goods \\(uid, gid, count\\) values \\(\\?, 19990, 1\\)'),
        rows: [],
      },
      ADULT_OFF,
      HONOUR_UPDATE,
      STATE_DELETE,
      PEOPLE_COUNT(1),
      UNION_ROW,
      ...MEDAL_THINGS,
      ...GIFT_10414,
      NO_ACTS,
      ...WAR_BUFS,
    ]);
    await runRng([0], () => cmd.quitBattle(ctx()));
    // sid 11 (people 10): 30 available, 10 called -> floor(10*10/100)=1; the type-1 row adds none
    const troopUpdate = db.executed.find((q) => /update sys_troops set starttime/i.test(q.sql));
    // remaining: sid 8 clamped to 0 (50-50), sid 11 keeps 20
    expect(troopUpdate?.parameters).toEqual(['1,11,20', 5]);
    const honourUpdate = db.executed.find((q) => /update sys_user set honour/i.test(q.sql));
    expect(honourUpdate?.parameters).toEqual([100 + 1 + 1152, 1001]);
  });
});

describe('BattleLifecycleCommands.quitBattle — dropBattleGoods', () => {
  it('drops the level-5 act goods within the daily cap of 3', async () => {
    const { cmd, db, runRng } = build(
      bareQuitRules(
        [
          {
            match: rx('select \\* from cfg_act_task_good_drop where param = \\?'),
            rows: [
              { type: 160001, count: 2 },
              { type: 160002, count: 0 },
              { type: 0, count: 3 },
            ],
          },
          { match: rx('select sum\\(`count`\\) as v from log_goods'), rows: [{ v: 2 }] },
          {
            match: rx(
              'insert into sys_goods \\(uid, gid, count\\) values \\(\\?, \\?, \\?\\) on duplicate key',
            ),
            rows: [],
          },
          { match: rx('insert into log_goods'), rows: [] },
        ],
        { level: 5 },
      ),
    );
    await runRng([0], () => cmd.quitBattle(ctx()));
    // only the first good passes the gid>0 && count!=0 gate
    const addGoods = db.executed.filter((q) =>
      /insert into sys_goods \(uid, gid, count\) values \(\?, \?, \?\)\s+on duplicate key/i.test(
        q.sql,
      ),
    );
    expect(addGoods).toHaveLength(1);
    expect(addGoods[0]!.parameters).toEqual([1001, 160001, 2, 2]);
    expect(db.executed.some((q) => /insert into `?log_goods`?/i.test(q.sql))).toBe(true);
  });

  it('never reaches the drops when the level is not 5', async () => {
    const { cmd, db, runRng } = build(bareQuitRules());
    await runRng([0], () => cmd.quitBattle(ctx()));
    expect(db.executed.some((q) => /cfg_act_task_good_drop/i.test(q.sql))).toBe(false);
  });
});

describe('BattleLifecycleCommands.inviteBattleUser', () => {
  const inviteRules: Respond[] = [
    {
      match: rx('select \\* from sys_user_battle_field where id = \\?'),
      rows: [{ id: 501, bid: 1001, state: 0, createuid: 1001, maxpeople: 5, level: 12 }],
    },
    {
      match: rx('select uid, honour from sys_user where name = \\?'),
      rows: [{ uid: 1002, honour: 50 }],
    },
    {
      match: rx('select id from sys_battle_invite where battlefieldid = \\? and touid = \\?'),
      rows: [],
    },
    PEOPLE_COUNT(1),
    { match: rx('insert into sys_battle_invite'), rows: [], insertId: 9 },
    { match: rx('select id as v from cfg_task_goal where tid = 283'), rows: [{ v: 555 }] },
    { match: rx('insert into sys_user_goal \\(uid, gid\\)'), rows: [] },
  ];

  it('inserts the invite and returns the client row', async () => {
    const { cmd, db } = build(inviteRules);
    const ret = (await cmd.inviteBattleUser(ctx(), [501, '李四', '张三'])) as unknown[];
    expect(ret[0]).toBe(1);
    expect(ret[2]).toBe(1);
    expect(ret[3]).toEqual({
      fromuid: 1001,
      id: 9,
      touid: 1002,
      name: '李四',
      herocount: 0,
      honour: 50,
      cancel: true,
      state: '邀请中',
    });
    const insert = db.executed.find((q) => /insert into sys_battle_invite/i.test(q.sql));
    expect(insert?.parameters).toEqual([1001, '黄巾之乱', 501, '12', 1002, '张三', '李四']);
    const goal = db.executed.find((q) => /insert into sys_user_goal/i.test(q.sql));
    expect(goal?.parameters).toEqual([1001, '555', '555']);
  });

  it('rejects a frozen battlefield, a non-creator, an unknown user, a negative honour, a duplicate and a full field', async () => {
    const frozen = build([{ ...inviteRules[0]!, rows: [{ id: 501, state: 1 }] }]);
    await expect(frozen.cmd.inviteBattleUser(ctx(), [501, '李四', '张三'])).rejects.toMatchObject({
      key: 'battle.battle_froze',
    });
    const creator = build([{ ...inviteRules[0]!, rows: [{ id: 501, state: 0, createuid: 999 }] }]);
    await expect(creator.cmd.inviteBattleUser(ctx(), [501, '李四', '张三'])).rejects.toMatchObject({
      key: 'battle.invite_not_creator',
    });
    const nouser = build([
      inviteRules[0]!,
      { match: rx('select uid, honour from sys_user where name = \\?'), rows: [] },
    ]);
    await expect(nouser.cmd.inviteBattleUser(ctx(), [501, '李四', '张三'])).rejects.toMatchObject({
      key: 'battle.invite_user_not_exist',
    });
    const poor = build([
      inviteRules[0]!,
      { ...inviteRules[1]!, rows: [{ uid: 1002, honour: -5 }] },
    ]);
    await expect(poor.cmd.inviteBattleUser(ctx(), [501, '李四', '张三'])).rejects.toMatchObject({
      key: 'battle.invite_not_enough_honour',
    });
    const dup = build([
      inviteRules[0]!,
      inviteRules[1]!,
      {
        match: rx('select id from sys_battle_invite where battlefieldid = \\? and touid = \\?'),
        rows: [{ id: 3 }],
      },
    ]);
    await expect(dup.cmd.inviteBattleUser(ctx(), [501, '李四', '张三'])).rejects.toMatchObject({
      key: 'battle.invite_user_already',
    });
    const full = build([inviteRules[0]!, inviteRules[1]!, inviteRules[2]!, PEOPLE_COUNT(5)]);
    await expect(full.cmd.inviteBattleUser(ctx(), [501, '李四', '张三'])).rejects.toMatchObject({
      key: 'battle.invite_max_people',
    });
  });

  it('throws user_not_in_battle when the battlefield row is gone', async () => {
    const { cmd } = build([
      { match: rx('select \\* from sys_user_battle_field where id = \\?'), rows: [] },
    ]);
    await expect(cmd.inviteBattleUser(ctx(), [501, '李四', '张三'])).rejects.toMatchObject({
      key: 'battle.user_not_in_battle',
    });
  });
});

describe('BattleLifecycleCommands.ignoreBattle / cancelBattleInvite', () => {
  it('ignoreBattle deletes by id and returns the remaining invites', async () => {
    const { cmd, db } = build([
      { match: rx('delete from sys_battle_invite where id = \\?'), rows: [{}] },
      {
        match: rx(
          'select \\* from sys_battle_invite where touid = \\? and state = 0 order by time desc',
        ),
        rows: [{ id: 2, touid: 1001, state: 0 }],
      },
    ]);
    await expect(cmd.ignoreBattle(ctx(), [2])).resolves.toEqual([
      [{ id: 2, touid: 1001, state: 0 }],
    ]);
    expect(db.executed[0]!.parameters).toEqual([2]);
  });

  it('cancelBattleInvite deletes the caller’s invite', async () => {
    const { cmd, db } = build([
      {
        match: rx('select \\* from sys_battle_invite where id = \\? and fromuid = \\?'),
        rows: [{ id: 4, fromuid: 1001 }],
      },
      { match: rx('delete from sys_battle_invite where id = \\?'), rows: [{}] },
    ]);
    await expect(cmd.cancelBattleInvite(ctx(), [4])).resolves.toEqual(['取消邀请成功。', 4]);
    expect(db.executed[1]!.parameters).toEqual([4]);
  });

  it('throws invite_not_exist for a foreign or missing invite', async () => {
    const { cmd } = build([
      { match: rx('select \\* from sys_battle_invite where id = \\? and fromuid = \\?'), rows: [] },
    ]);
    await expect(cmd.cancelBattleInvite(ctx(), [4])).rejects.toMatchObject({
      key: 'battle.invite_not_exist',
    });
  });
});
