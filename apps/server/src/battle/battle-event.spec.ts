import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import {
  runBattlefieldArrivalEvents,
  runBattlefieldResultEvents,
  type BattleEventDeps,
} from './battle-event';

/** The warEvent callback shape the result site needs (matches BattleResultDeps.warEvent). */
interface BattleWarEvent {
  (battleid: number, unionid: number, type: number, content: string): Promise<void>;
}

const NO = (match: RegExp): Respond => ({ match, rows: [] });
const NO_RAW = NO(/.*/);

function depsOf(rules: Respond[]): {
  deps: BattleEventDeps & { warEvent: BattleWarEvent };
  db: FakeDb;
  warEvents: Array<{ battleid: number; unionid: number; type: number; content: string }>;
} {
  const db = new FakeDb(rules);
  const warEvents: Array<{ battleid: number; unionid: number; type: number; content: string }> = [];
  const deps = {
    db: db.scope.db,
    query: async (q: ReturnType<typeof sql<Record<string, unknown>>>) =>
      (await q.execute(db.scope.db)).rows,
    cell: async (q: ReturnType<typeof sql<Record<string, unknown>>>) => {
      const row = (await q.execute(db.scope.db)).rows[0];
      return row ? Object.values(row)[0] : undefined;
    },
    tasks: new TaskRules(db.scope, new UserRules(db.scope)),
    randRaw: () => 5,
    warEvent: async (battleid: number, unionid: number, type: number, content: string) => {
      warEvents.push({ battleid, unionid, type, content });
    },
  };
  return { deps, db, warEvents };
}

const TROOP = { battlefieldid: 30, battleunionid: 1, bid: 1001 };

/** cfg_task_goal lookup + the sys_user_battle_state rows the goal/task grants fan out to. */
const GOAL_RULES: Respond[] = [
  { match: /select id from cfg_task_goal where tid = \?/i, rows: [{ id: 900001 }] },
  {
    match: /select 1 as x from sys_troops where battlefieldid = \? and battleunionid <> \?/i,
    rows: [],
  },
  {
    match:
      /select 1 as x from sys_troops where cid = \? and battlefieldid = \? and battleunionid <> \?/i,
    rows: [],
  },
  NO_RAW,
];

describe('到达侧触发器（cfg_js.php:535-593, task 8 调遣到达）', () => {
  it('targettype 3 分组：checkBattleResult( troop.bid, event.bid ) 通过 → 只写 winner（原 550 行的 sys_user_goal 插入引用不存在的列，原样不再复刻）', async () => {
    const { deps, db } = depsOf([
      ...GOAL_RULES,
      {
        match:
          /select \* from sys_troops where uid = 0\s+and battlefieldid = \? and hid in \(1001, 1002, 1005\)/i,
        rows: [],
      },
      NO_RAW,
    ]);
    await runBattlefieldArrivalEvents(
      deps,
      TROOP,
      1001,
      [{ targetid1: 600001, targetid2: 0, targettype: 3, triggertype: 0, msg: '', bid: 1001 }],
      5,
    );
    const winner = db.executed.find((e) => /update sys_user_battle_field/i.test(e.sql))!;
    expect(winner.sql).toMatch(/set finishtime = unix_timestamp\(\),\s*winner = \? where id = \?/i);
    expect(winner.parameters).toEqual([1, 30]);
    // checkBattleResult 参数序：cfg_js 侧是 (troop.bid, event.bid) → check1001(event.bid=1001)
    const check = db.executed.find((e) => /hid in \(1001, 1002, 1005\)/i.test(e.sql))!;
    expect(check.parameters).toEqual([1001]);
    // 原版这一步因未知列 battleunionid 直接 die —— 移植侧记录性跳过，不写 sys_user_goal。
    expect(db.executed.some((e) => /insert into sys_user_goal/i.test(e.sql))).toBe(false);
  });

  it('targettype 1 分组：先删本人 goal，再给同阵营全部参战者发 sys_user_task', async () => {
    const { deps, db } = depsOf([...GOAL_RULES, NO_RAW]);
    await runBattlefieldArrivalEvents(
      deps,
      TROOP,
      1001,
      [{ targetid1: 600100, targetid2: 0, targettype: 1, triggertype: 0, msg: '', bid: 1001 }],
      5,
    );
    const del = db.executed.find((e) => /delete from sys_user_goal/i.test(e.sql))!;
    expect(del.sql).toMatch(/where uid = \? and gid = \?/i);
    expect(del.parameters).toEqual([1001, 900001]);
    const ins = db.executed.find((e) => /insert into sys_user_task/i.test(e.sql))!;
    expect(ins.sql).toMatch(
      /select uid, \?,\s*0\s*from sys_user_battle_state where battlefieldid = \?\s*and unionid = \?\s*on duplicate key update state = 0/i,
    );
    expect(ins.parameters).toEqual([600100, 30, 1]);
  });

  it('targettype 其他：completeTask（replace sys_user_goal）', async () => {
    const { deps, db } = depsOf([...GOAL_RULES, NO_RAW]);
    await runBattlefieldArrivalEvents(
      deps,
      TROOP,
      1001,
      [{ targetid1: 600200, targetid2: 0, targettype: 9, triggertype: 0, msg: '', bid: 1001 }],
      5,
    );
    const ins = db.executed.find((e) => /replace into sys_user_goal/i.test(e.sql))!;
    expect(ins.parameters).toEqual([1001, 900001]);
  });

  it('增兵分组（50000 ≥ targetid1 > 1000）：按 cfg_battle_troop 重建 sys_troops（battleid2cid 落点）', async () => {
    const { deps, db } = depsOf([
      {
        match: /select \* from cfg_battle_troop\s*where bid = \? and hid in \(\?\)/i,
        rows: [
          {
            xy: 367,
            hid: 1104,
            npcvalue: 10000,
            soldiers: '20,21',
            drop: '-1',
            rate: 0,
            unionid: 2,
            bid: 1001,
          },
        ],
      },
      NO_RAW,
    ]);
    await runBattlefieldArrivalEvents(
      deps,
      TROOP,
      1001,
      [{ targetid1: 1104, targetid2: 0, targettype: 0, triggertype: 0, msg: '', bid: 1001 }],
      5,
    );
    expect(
      db.executed.some((e) =>
        /delete from sys_troops where battlefieldid = \?\s*and hid in \(\?\)/i.test(e.sql),
      ),
    ).toBe(true);
    const ins = db.executed.find((e) => /insert into sys_troops \(cid, uid, hid/i.test(e.sql))!;
    // randRaw 恒 5：20 取 5%10=5；21 取 5%(10-5)=0 → 跳过。level 5 → 10000*32=320000；
    // 20→ceil(320000*5*0.1/127)=1260。
    expect(ins.parameters).toEqual([630367, 1104, '1,20,1260,', '-1', 0, 30, 2, 1001]);
  });

  it('消失将领分组（targetid2 > 1000）：删除据点上该 hid 的部队（到达侧不过滤 uid）', async () => {
    const { deps, db } = depsOf([NO_RAW]);
    await runBattlefieldArrivalEvents(
      deps,
      TROOP,
      1001,
      [
        {
          targetid1: 0,
          targetid2: 1101,
          targettype: 0,
          triggertype: 0,
          msg: '某事发生了',
          bid: 1001,
        },
      ],
      5,
    );
    const del = db.executed.find((e) => /delete from sys_troops where battlefieldid/i.test(e.sql))!;
    expect(del.sql).toMatch(/where battlefieldid = \?\s*and hid in \(\?\)$/i);
    expect(del.parameters).toEqual([30, 1101]);
    // cfg_js.php:565-566 的消息分支是空体 —— 到达侧不写 mem_war_event。
    expect(db.executed.some((e) => /insert into mem_war_event/i.test(e.sql))).toBe(false);
  });

  it('triggertype 2 分组门槛：敌军还在战场才触发；敌军已清空则整条事件跳过', async () => {
    const { deps, db } = depsOf([
      {
        match: /select 1 as x from sys_troops where battlefieldid = \? and battleunionid <> \?/i,
        rows: [],
      },
      NO_RAW,
    ]);
    await runBattlefieldArrivalEvents(
      deps,
      TROOP,
      1001,
      [{ targetid1: 600200, targetid2: 0, targettype: 9, triggertype: 2, msg: '', bid: 1001 }],
      5,
    );
    expect(db.executed.some((e) => /replace into sys_user_goal/i.test(e.sql))).toBe(false);
  });
});

describe('终局侧触发器（OLdBattleCron.php:1343-1407, getBattleResult type 4）', () => {
  const ARGS = {
    bbid: 30,
    mtroop: { bid: 1001, battleunionid: 1 },
    resistcid: 630367,
    resisthid: 1011,
    uid: 1001,
  };

  it('targettype 3：check1001 返回 2（张角还在）在 PHP 里同为真 —— winner 照写，goal 在门槛外照发', async () => {
    const { deps, db } = depsOf([
      // 张角三兄弟仍在 → check1001 返回 2 —— 原版 `if (checkBattleResult(...))` 对 1/2 都为真，
      // 只有非 1001 战场（返回 0）才拦得住。移植按原样保留这一宽松门槛。
      {
        match:
          /select \* from sys_troops where uid = 0\s+and battlefieldid = \? and hid in \(1001, 1002, 1005\)/i,
        rows: [{ id: 1, hid: 1001 }],
      },
      { match: /select id from cfg_task_goal where tid = \?/i, rows: [{ id: 900001 }] },
      {
        match:
          /select 1 as x from sys_troops where cid = \? and battlefieldid = \? and battleunionid <> \?/i,
        rows: [],
      },
      NO_RAW,
    ]);
    await runBattlefieldResultEvents(
      deps,
      ARGS,
      [{ targetid1: 600001, targetid2: 0, targettype: 3, triggertype: 0, msg: '', bid: 1001 }],
      5,
    );
    const winner = db.executed.find((e) => /update sys_user_battle_field/i.test(e.sql))!;
    expect(winner.parameters).toEqual([1, 30]);
    const goal = db.executed.find((e) =>
      /insert into sys_user_goal \(uid, gid\) select/i.test(e.sql),
    )!;
    expect(goal.sql).toMatch(/on duplicate key update gid = values\(gid\)/i);
    expect(goal.parameters).toEqual([900001, 30, 1]);
    // 终局侧 checkBattleResult 参数序：(event.bid, bbid) → check1001(bbid=30)
    const check = db.executed.find((e) => /hid in \(1001, 1002, 1005\)/i.test(e.sql))!;
    expect(check.parameters).toEqual([30]);
  });

  it('targettype 3 门槛只拦非 1001 战场：bid=3001 → checkBattleResult=0，winner 不写而 goal 照发（门槛外）', async () => {
    const { deps, db } = depsOf([
      { match: /select id from cfg_task_goal where tid = \?/i, rows: [{ id: 900001 }] },
      {
        match:
          /select 1 as x from sys_troops where cid = \? and battlefieldid = \? and battleunionid <> \?/i,
        rows: [],
      },
      NO_RAW,
    ]);
    await runBattlefieldResultEvents(
      deps,
      ARGS,
      [{ targetid1: 600001, targetid2: 0, targettype: 3, triggertype: 0, msg: '', bid: 3001 }],
      5,
    );
    expect(db.executed.some((e) => /update sys_user_battle_field/i.test(e.sql))).toBe(false);
    expect(
      db.executed.some((e) => /insert into sys_user_goal \(uid, gid\) select/i.test(e.sql)),
    ).toBe(true);
  });

  it('msg 分组写入 mem_war_event（unionid 0 —— 原版 $unionid 未定义即空串插 0）', async () => {
    const { deps, warEvents } = depsOf([...GOAL_RULES, NO_RAW]);
    await runBattlefieldResultEvents(
      deps,
      ARGS,
      [
        {
          targetid1: 0,
          targetid2: 0,
          targettype: 0,
          triggertype: 0,
          msg: '黄巾军占领了某据点',
          bid: 1001,
        },
      ],
      5,
    );
    expect(warEvents).toEqual([
      { battleid: 30, unionid: 0, type: 2, content: '黄巾军占领了某据点' },
    ]);
  });

  it('triggertype 2 分组门槛（取反 + 限据点）：该据点敌军清空才触发', async () => {
    const { deps, db } = depsOf([
      // 敌军还在 → cando 0 → 事件跳过
      {
        match:
          /select 1 as x from sys_troops where cid = \? and battlefieldid = \? and battleunionid <> \?/i,
        rows: [{ x: 1 }],
      },
      NO_RAW,
    ]);
    await runBattlefieldResultEvents(
      deps,
      ARGS,
      [{ targetid1: 600200, targetid2: 0, targettype: 9, triggertype: 2, msg: '', bid: 1001 }],
      5,
    );
    expect(db.executed.some((e) => /replace into sys_user_goal/i.test(e.sql))).toBe(false);
  });

  it('消失将领分组只删 NPC（uid < 1000）—— 与到达侧的唯一 SQL 差异', async () => {
    const { deps, db } = depsOf([NO_RAW]);
    await runBattlefieldResultEvents(
      deps,
      ARGS,
      [{ targetid1: 0, targetid2: 1101, targettype: 0, triggertype: 0, msg: '', bid: 1001 }],
      5,
    );
    const del = db.executed.find((e) => /delete from sys_troops where battlefieldid/i.test(e.sql))!;
    expect(del.sql).toMatch(/where battlefieldid = \? and uid < 1000\s*and hid in \(\?\)$/i);
    expect(del.parameters).toEqual([30, 1101]);
  });
});
