import { describe, expect, it } from 'vitest';
import { BattlefieldLifecycleCommands } from './battlefield-lifecycle.commands';
import {
  addUserTasks,
  deleteOldBattleTasks,
  getBattleStartCityInfo,
  playerAttendBattle,
  playerExitBattle,
  resetBattleFieldUid,
  sendBattleEvent,
  setFlags,
  type BattlefieldDeps,
  type Row,
} from './battlefield-helpers';
import { battleid2cid, createSoldier } from './battlefield-utils';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { RandomService, ScriptedRandom, sequenceSource } from '../core/random.service';
import { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';

const lang = new LangService({
  battle: {
    login: '%s 军 %s 加入了战场。',
    login_1: '%s 加入了战场。',
    logout: '%s 军 %s 退出了战场。',
  },
});

const UID = 1001;
const ctx = { uid: UID, cid: 0, ip: 0, sip: '' };
const NOW = 1_700_000_000;

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const goods = new GoodsRules(db.scope);
  const users = new UserRules(db.scope);
  const scripted = new ScriptedRandom();
  const cmd = new BattlefieldLifecycleCommands(
    db.scope,
    lang,
    goods,
    users,
    new RandomService(scripted),
  );
  return { cmd, db, scripted };
}

function bfDeps(db: FakeDb): BattlefieldDeps {
  const scope = db.scope;
  return {
    get db() {
      return scope.db;
    },
    rows: async (q) => (await q.execute(scope.db)).rows as Row[],
    one: async (q) => ((await q.execute(scope.db)).rows as Row[])[0] ?? false,
    cell: async (q) => {
      const row = ((await q.execute(scope.db)).rows as Row[])[0];
      return row ? Object.values(row)[0] : false;
    },
    lang: (key, ...args) => lang.t(key, ...args),
  };
}

const NO = (match: RegExp, rows: Record<string, unknown>[] = []): Respond => ({ match, rows });
/** Matches everything with no rows — the ordered-rules tail every test ends with. */
const CATCH_ALL = NO(/[\s\S]*/);

const NOBILITY = (value: number): Respond => ({
  match: /^select nobility from sys_user where uid = \?$/,
  rows: [{ nobility: value }],
});
const NO_BUFFER: Respond = { match: /mem_user_buffer/, rows: [] };
const STATE_ROWS = (rows: Record<string, unknown>[]): Respond => ({
  match: /^select \* from sys_user_battle_state where state = 0 and uid = \?$/,
  rows,
});
const BATTLE_FIELD_1001: Respond = {
  match: /^select \* from cfg_battle_field where id = \? and state <> 0$/,
  rows: [
    {
      id: 1001,
      name: '黄巾之乱',
      type: 0,
      maxpeople: 5,
      maxlevel: 12,
      maxcount: 300,
      maxdaycount: 5,
      maxtime: 10800,
      state: 1,
      user_unionid: 1,
      // 真实配置：珍珠/珊瑚票 ',' 结尾、无 things 票、爵位 1。
      demandGoods: '30:2,31:2,',
      demandThings: ',',
      demandNobility: 1,
    },
  ],
};
const DEMANDS_ROW: Respond = {
  match: /^select demandGoods, demandThings, demandNobility from cfg_battle_field where id = \?$/,
  rows: [
    {
      demandGoods: '30:2,31:2,',
      demandThings: ',',
      demandNobility: 1,
    },
  ],
};
/** cfg_battle_field 5001 的票：夜明珠 1 颗（goods 38）、爵位 3（簪袅）。 */
const DEMANDS_5001: Respond = {
  match: /^select demandGoods, demandThings, demandNobility from cfg_battle_field where id = \?$/,
  rows: [{ demandGoods: '38:1,', demandThings: ',', demandNobility: 3 }],
};
const WAR_COUNT = (value: number): Respond => ({
  match: /^select today_war_count from mem_user_schedule where uid = \?$/,
  rows: [{ today_war_count: value }],
});
const HONOUR_NAME = (honour: number, name: string): Respond => ({
  match: /^select honour, name from sys_user where uid = \?$/,
  rows: [{ honour, name }],
});
const CFG_CITYS: Respond = {
  match: /^select \* from cfg_battle_city where bid = \? order by xy$/,
  rows: [
    {
      bid: 1001,
      xy: 101,
      nextxy: '2,164,160,',
      drop: '-1',
      unionid: 2,
      rate: 0,
      name: '钜鹿',
      image: 5,
      winpoint: 0,
      losepoint: 0,
      position: 101,
      reinforce_soldiers: null,
      can_quest: 0,
    },
    {
      bid: 1001,
      xy: 275,
      nextxy: '2,367,334,',
      drop: '-1',
      unionid: -1,
      rate: 0,
      name: '河内',
      image: 1,
      winpoint: 0,
      losepoint: 0,
      position: 275,
      reinforce_soldiers: null,
      can_quest: 0,
    },
  ],
};
/** 每个据点的 cfg_battle_troop(type=0) 行，用 params 区分两次同形查询。 */
const CFG_TROOPS = (xy: number, rows: Record<string, unknown>[]): Respond => ({
  match:
    /^select \* from cfg_battle_troop where bid = \? and xy = \?[\s\S]*and type = 0 order by id$/,
  params: [1001, xy],
  rows,
});
const UNION_MAP: Respond = {
  match: /^select unionid, flag from cfg_battle_union$/,
  rows: [
    { unionid: 1, flag: '汉' },
    { unionid: 2, flag: '黄' },
    { unionid: 10, flag: '汉' },
  ],
};
const UNION_1: Respond = {
  match: /^select \* from cfg_battle_union where unionid = \?$/,
  params: [1],
  rows: [
    {
      bid: 1001,
      unionid: 1,
      name: '汉',
      flag: '汉',
      taskgroup: '60000,60001,60002,60003,60004',
      init_tasks: null,
      metal_gid: 30001,
      taskthing: '0',
    },
  ],
};
const UNION_10: Respond = {
  match: /^select \* from cfg_battle_union where unionid = \?$/,
  params: [10],
  rows: [
    {
      bid: 5001,
      unionid: 10,
      name: '刘袁联军',
      flag: '汉',
      taskgroup: '60023,60024',
      init_tasks: '60023,60024',
      metal_gid: 30006,
      taskthing: '50',
    },
  ],
};
const NO_TASK_GOAL_282: Respond = NO(/^select id from cfg_task_goal where tid = 282$/);
const LAST_INSERT_ID = (value: number): Respond => ({
  match: /^select last_insert_id\(\) as v$/,
  rows: [{ v: value }],
});
const START_CITIES_1001: Respond = {
  match:
    /^select \* from cfg_battle_start_city where bid = \?[\s\S]*and unionid = \? order by needhonour asc$/,
  params: [1001, 1],
  // FakeDb 不执行 order by：行按 needhonour 升序给出（SQL 文本另行断言）。
  rows: [
    { bid: 1001, xy: 767, name: '襄阳', unionid: 1, needhonour: 0 },
    { bid: 1001, xy: 275, name: '河内', unionid: 1, needhonour: 200 },
  ],
};

async function errorOf(p: Promise<unknown>): Promise<{ key: string | null; message: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as { key: string | null; message: string };
    return { key: err.key ?? null, message: err.message };
  }
  throw new Error('expected the command to throw');
}

// ───────────────────────────── utils.php 助手 ─────────────────────────────

describe('battleid2cid / createSoldier (utils.php:1558-1591)', () => {
  it('battleid2cid maps (battlefieldid, xy) onto the 600-offset cid space', () => {
    expect(battleid2cid(77, 101)).toBe(677101);
    expect(battleid2cid(31, 619)).toBe(631619);
  });

  it('createSoldier rolls per-type counts and stops drawing once 10 units are handed out', () => {
    let draws = 0;
    const seq = [3, 70, 40]; // 3%10=3, 70%7=0, 40%7=5 → {20:3, 22:5} = 8 单位，未满 10
    const out = createSoldier(
      () => seq[draws++ % seq.length]!,
      10000,
      '20,21,22',
      2, // npcValue × 2^2 = 40000
    );
    expect(draws).toBe(3);
    // 20 号兵 3 份 → ceil(40000*3*0.1/127)=95；22 号兵 5 份 → ceil(40000*5*0.1/263)=77
    expect(out).toBe('2,20,95,22,77,');
  });

  it('createSoldier consumes one draw per remaining element even when the roll lands 0', () => {
    // 9%10=9 → {20:9}; 之后 10-totalRnd=1，rand()%1 恒 0：21、22 各再消耗一次 draw（不加数量）
    let draws = 0;
    const seq = [9, 5, 6];
    const out = createSoldier(() => seq[draws++ % seq.length]!, 10000, '20,21,22', 2);
    expect(draws).toBe(3);
    expect(out).toBe(`1,20,${Math.ceil((40000 * 9 * 0.1) / 127)},`);
  });

  it('createSoldier never reaches the 10-unit break: rand()%(10-total) caps each roll below it', () => {
    // 数学事实：rnd = rand() % (10-total) ≤ 9-total → total 恒 ≤ 9，原版的
    // `>10` 收缩与 `>= 10` break 均为死分支 —— 每个元素恰好消耗一次 draw。
    // 3%10=3 → {20:3}; 60%7=4 → {21:4}; 40%3=1 → {22:1}
    let draws = 0;
    const seq = [3, 60, 40];
    const out = createSoldier(() => seq[draws++ % seq.length]!, 10000, '20,21,22', 2);
    expect(draws).toBe(3);
    expect(out).toBe('3,20,95,21,125,22,16,');
  });
});

describe('resetBattleFieldUid (BattleFunc.php:4152)', () => {
  const CID = 677275;
  const TROOPS = (rows: Record<string, unknown>[]): Respond => ({
    match:
      /^select \* from sys_troops where cid = \? and \(\(state = 4 or state = 3\) or targetcid = \?\)$/,
    params: [CID, CID],
    rows,
  });
  const CITY_ROW: Respond = {
    match: /^select uid, unionid from sys_battle_city where cid = \?$/,
    rows: [{ uid: 3, unionid: 2 }],
  };

  it('an empty strongpoint flips to uid=-1/unionid=-1 (string form, hasuser 0)', async () => {
    const db = new FakeDb([TROOPS([]), CITY_ROW, CATCH_ALL]);
    const ret = await resetBattleFieldUid(bfDeps(db), CID);
    expect(ret).toEqual({ oriuid: 3, oriunionid: 2, uid: '-1', unionid: '-1' });
    const upd = db.executed.find((e) => /update sys_battle_city/.test(e.sql));
    expect(upd?.sql).toContain('set uid = -1, unionid = -1, hasuser = 0');
  });

  it('a single-union NPC garrison keeps the union and uid 0', async () => {
    const db = new FakeDb([
      TROOPS([
        { uid: 0, battleunionid: 2 },
        { uid: 0, battleunionid: 2 },
      ]),
      CITY_ROW,
      CATCH_ALL,
    ]);
    const ret = (await resetBattleFieldUid(bfDeps(db), CID)) as Row;
    expect(ret.unionid).toBe(2);
    expect(ret.uid).toBe(0);
    const upd = db.executed.find((e) => /update sys_battle_city/.test(e.sql));
    expect(upd?.sql).toContain('ownerunionid');
    expect(upd?.parameters).toEqual([0, 2, 2, 0, CID]);
  });

  it('two unions stationed together return 0 and mark the strongpoint 争夺中', async () => {
    const db = new FakeDb([
      TROOPS([
        { uid: 0, battleunionid: 2 },
        { uid: 1001, battleunionid: 1 },
      ]),
      CITY_ROW,
      CATCH_ALL,
    ]);
    expect(await resetBattleFieldUid(bfDeps(db), CID)).toBe(0);
    const upd = db.executed.find((e) => /update sys_battle_city/.test(e.sql));
    expect(upd?.sql).toContain('set uid = 0, unionid = 0');
  });

  it('the same union with two different users keeps union, uid 0 and hasuser 1', async () => {
    const db = new FakeDb([
      TROOPS([
        { uid: 1001, battleunionid: 1 },
        { uid: 1002, battleunionid: 1 },
      ]),
      CITY_ROW,
      CATCH_ALL,
    ]);
    const ret = (await resetBattleFieldUid(bfDeps(db), CID)) as Row;
    expect(ret).toEqual({ oriuid: 3, oriunionid: 2, uid: 0, unionid: 1 });
    const upd = db.executed.find((e) => /update sys_battle_city/.test(e.sql));
    // 同一阵营不同用户分支：uid=0 内联，参数为 (unionid, hasuser, cid)。
    expect(upd?.sql).toContain('set uid = 0, unionid =');
    expect(upd?.parameters).toEqual([1, 1, CID]);
  });

  it('a missing sys_battle_city row returns the zeroed info without writing', async () => {
    const db = new FakeDb([TROOPS([]), NO(/^select uid, unionid from sys_battle_city/), CATCH_ALL]);
    const ret = await resetBattleFieldUid(bfDeps(db), CID);
    expect(ret).toEqual({ oriuid: 0, oriunionid: 0, uid: 0, unionid: 0 });
    expect(db.executed.some((e) => /update sys_battle_city/.test(e.sql))).toBe(false);
  });
});

describe('setFlags (BattleFunc.php:3686)', () => {
  const rows = (over: Row): Row[] => [
    { cid: 677101, unionid: over.unionid, uid: 0, hasuser: over.hasuser },
  ];

  it.each([
    ['-1 无人据点 → 白旗 5、无字旗', -1, undefined, 5, ''],
    ['0 争夺中 → 3、无字旗', 0, undefined, 3, ''],
    ['本阵 npc 城 → 2、汉旗', 1, undefined, 2, '汉'],
    ['本阵玩家据点 → 1、汉旗', 1, 1, 1, '汉'],
    ['敌阵 npc 城 → 0、黄旗', 2, undefined, 0, '黄'],
    ['敌阵玩家据点 → 4、黄旗', 2, 1, 4, '黄'],
  ])('%s', async (_name, unionid, hasuser, flag, flagchar) => {
    const db = new FakeDb([UNION_MAP, CATCH_ALL]);
    const out = await setFlags(bfDeps(db), 1, rows({ unionid, hasuser }));
    expect(out[0]!.flag).toBe(flag);
    expect(out[0]!.flagchar).toBe(flagchar);
  });

  it('an enemy npc city carries the enemy union flagchar', async () => {
    const db = new FakeDb([UNION_MAP, CATCH_ALL]);
    const out = await setFlags(bfDeps(db), 1, rows({ unionid: 2, hasuser: undefined }));
    expect(out[0]!.flag).toBe(0);
    expect(out[0]!.flagchar).toBe('黄');
  });

  it('a player union (>1000) reads flagchar from sys_user', async () => {
    const db = new FakeDb([
      UNION_MAP,
      NO(/^select flagchar from sys_user where uid = \?$/, [{ flagchar: 'Y' }]),
      CATCH_ALL,
    ]);
    const out = await setFlags(bfDeps(db), 1001, rows({ unionid: 1001, hasuser: 1 }));
    expect(out[0]!.flag).toBe(1);
    expect(out[0]!.flagchar).toBe('Y');
  });

  it('an unknown union reads null flagchar (PHP undefined-index notice)', async () => {
    const db = new FakeDb([UNION_MAP, CATCH_ALL]);
    const out = await setFlags(bfDeps(db), 1, rows({ unionid: 25, hasuser: undefined }));
    expect(out[0]!.flag).toBe(0);
    expect(out[0]!.flagchar).toBeNull();
  });
});

describe('playerAttendBattle / playerExitBattle (BattleFunc.php:4034-4068)', () => {
  it('writes mem_war_buf state 1 and the type-2 join event, text per camp_name', async () => {
    const db = new FakeDb([LAST_INSERT_ID(5), CATCH_ALL]);
    const deps = bfDeps(db);
    expect(await playerAttendBattle(deps, 77, 1, 1001, "changle's", '')).toBe(1);
    expect(await playerAttendBattle(deps, 77, 1, 1001, 'changle', '汉')).toBe(1);
    const bufs = db.executed.filter((e) => /insert into mem_war_buf/.test(e.sql));
    // (battleid, unionid, uid, nick) — state 是内联字面量（原版也是引号字面量）。
    expect(bufs[0]!.parameters).toEqual([77, 1, 1001, "changle's"]);
    expect(bufs[0]!.sql).toMatch(/, 1, unix_timestamp\(\)\)$/);
    expect(bufs[1]!.parameters).toEqual([77, 1, 1001, 'changle']);
    const evts = db.executed.filter((e) => /insert into mem_war_event/.test(e.sql));
    // 空 camp_name 走 login_1；非空走 login；addslashes 转义 nick 的引号。
    expect(evts[0]!.parameters[2]).toBe("changle\\'s 加入了战场。");
    expect(evts[1]!.parameters).toEqual([77, 1, '汉 军 changle 加入了战场。']);
  });

  it('playerExitBattle writes state 0 and the logout text; a 0 last_insert_id reports 0', async () => {
    const db = new FakeDb([LAST_INSERT_ID(0), CATCH_ALL]);
    expect(await playerExitBattle(bfDeps(db), 77, 1, 1001, 'changle', '汉')).toBe(0);
    const buf = db.executed.find((e) => /insert into mem_war_buf/.test(e.sql))!;
    expect(buf.parameters).toEqual([77, 1, 1001, 'changle']);
    expect(buf.sql).toMatch(/, 0, unix_timestamp\(\)\)$/);
    // sql_insert 的 error==0 分支：mem_war_event 不再写。
    expect(db.executed.some((e) => /insert into mem_war_event/.test(e.sql))).toBe(false);
  });
});

describe('getBattleStartCityInfo (BattleFunc.php:4122)', () => {
  const CITIES = (rows: Record<string, unknown>[]): Respond => ({
    match:
      /^select \* from cfg_battle_start_city where bid = \?[\s\S]*and unionid = \? order by needhonour asc$/,
    rows,
  });

  it('orders the bid+union start cities by needhonour and returns null for a 0 bid', async () => {
    const db = new FakeDb([
      CITIES([
        { bid: 1001, xy: 767, name: '襄阳', unionid: 1, needhonour: 0 },
        { bid: 1001, xy: 275, name: '河内', unionid: 1, needhonour: 200 },
      ]),
      CATCH_ALL,
    ]);
    const deps = bfDeps(db);
    expect(await getBattleStartCityInfo(deps, 1001, 1)).toHaveLength(2);
    expect(await getBattleStartCityInfo(deps, 0, 1)).toBeNull();
    expect(await getBattleStartCityInfo(deps, 1001, 0)).toBeNull();
    expect(db.executed.filter((e) => /cfg_battle_start_city/.test(e.sql))).toHaveLength(1);
  });

  it('bid 6001 assigns a random start city once (FakeDb ordered rules → one call per db)', async () => {
    const assign: Respond = {
      match: /^select xy, `name` from cfg_battle_city where bid = 6001/,
      rows: [{ xy: 503, name: '许昌' }],
    };
    const db = new FakeDb([
      {
        match: /^select startcid from sys_user_battle_state where state = 0 and uid = \?$/,
        rows: [{ startcid: 0 }],
      },
      assign,
      CATCH_ALL,
    ]);
    expect(await getBattleStartCityInfo(bfDeps(db), 6001, 1001)).toEqual([
      { xy: 503, name: '许昌' },
    ]);
    const upd = db.executed.find((e) => /update sys_user_battle_state set startcid/.test(e.sql));
    expect(upd?.parameters).toEqual([503, 1001]);

    // startcid 已分配 → 直接查该城，不再分配。
    const db2 = new FakeDb([
      {
        match: /^select startcid from sys_user_battle_state where state = 0 and uid = \?$/,
        rows: [{ startcid: 503 }],
      },
      assign,
      CATCH_ALL,
    ]);
    expect(await getBattleStartCityInfo(bfDeps(db2), 6001, 1001)).toEqual([
      { xy: 503, name: '许昌' },
    ]);
    expect(db2.executed.some((e) => /update sys_user_battle_state set startcid/.test(e.sql))).toBe(
      false,
    );
    // 复用查询按已分配的 xy 过滤。
    const reuse = db2.executed.find((e) => /where bid = 6001 and xy = \?$/.test(e.sql))!;
    expect(reuse.parameters).toEqual([503]);
  });

  it('bid 6001 with no cfg_battle_city rows dies like the original SQL error', async () => {
    const db = new FakeDb([
      {
        match: /^select startcid from sys_user_battle_state where state = 0 and uid = \?$/,
        rows: [{ startcid: 0 }],
      },
      CATCH_ALL,
    ]);
    await expect(getBattleStartCityInfo(bfDeps(db), 6001, 1001)).rejects.toThrowError();
  });
});

describe('deleteOldBattleTasks / addUserTasks / sendBattleEvent', () => {
  it('deletes the user task + goal rows for cfg_task_goal sort 100/110/120', async () => {
    const db = new FakeDb([
      NO(/^SELECT GROUP_CONCAT\(DISTINCT tid\) FROM cfg_task_goal/, [
        { 'GROUP_CONCAT(DISTINCT tid)': '100,110,120' },
      ]),
      NO(/^ select group_concat\(id\) from cfg_task_goal/, [{ 'group_concat(id)': '11,12,13' }]),
      CATCH_ALL,
    ]);
    await deleteOldBattleTasks(bfDeps(db), UID);
    const del1 = db.executed.find((e) => /DELETE FROM sys_user_task/.test(e.sql))!;
    expect(del1.sql).toContain('tid in (100,110,120)');
    const del2 = db.executed.find((e) => /DELETE FROM sys_user_goal/.test(e.sql))!;
    expect(del2.sql).toContain('gid in (11,12,13)');
  });

  it('a NULL GROUP_CONCAT (== "" in PHP 5) skips both deletes', async () => {
    const db = new FakeDb([
      NO(/^SELECT GROUP_CONCAT\(DISTINCT tid\) FROM cfg_task_goal/, [
        { 'GROUP_CONCAT(DISTINCT tid)': null },
      ]),
      CATCH_ALL,
    ]);
    await deleteOldBattleTasks(bfDeps(db), UID);
    expect(db.executed.some((e) => /DELETE FROM sys_user_task/.test(e.sql))).toBe(false);
  });

  it('addUserTasks upserts each task as state 0; sendBattleEvent enqueues the trigger', async () => {
    const db = new FakeDb([CATCH_ALL]);
    const deps = bfDeps(db);
    await addUserTasks(deps, UID, ['60019', '60020']);
    const ups = db.executed.filter((e) => /insert into sys_user_task/.test(e.sql));
    expect(ups.map((u) => u.parameters)).toEqual([
      [UID, 60019],
      [UID, 60020],
    ]);
    expect(ups[0]!.sql).toContain('on duplicate key update state = 0');
    await sendBattleEvent(deps, 0, UID, 1001, 77, 1, 0, 9);
    const evt = db.executed.find((e) => /insert into mem_battle_event/.test(e.sql))!;
    expect(evt.parameters).toEqual([0, UID, 1001, 77, 1, 0, 9]);
  });
});

// ───────────────────────────── 命令 ─────────────────────────────

describe('getBattleInvite', () => {
  it('returns the pending invitations of the user, newest first', async () => {
    const invites = [{ id: 2, fromuid: 1002, battlename: '黄巾之乱', battlefieldid: 77, time: 5 }];
    const { cmd } = build([NO(/^select \* from sys_battle_invite/, invites), CATCH_ALL]);
    expect(await cmd.getBattleInvite(ctx)).toEqual([invites]);
  });
});

describe('createBattle', () => {
  it('gates: nobility below 公士 and negative battlefield honour', async () => {
    const low = build([NOBILITY(0), NO_BUFFER, CATCH_ALL]);
    await expect(low.cmd.createBattle(ctx, [1001, 2])).rejects.toMatchObject({
      key: 'battle.nobility_not_rearch',
    });

    const honoured = build([
      NOBILITY(1),
      NO_BUFFER,
      STATE_ROWS([]),
      BATTLE_FIELD_1001,
      NO(/^select count\(\*\) from sys_user_battle_field/, [{ 'count(*)': 0 }]),
      WAR_COUNT(0),
      HONOUR_NAME(-1, 'changle'),
      CATCH_ALL,
    ]);
    await expect(honoured.cmd.createBattle(ctx, [1001, 2])).rejects.toMatchObject({
      key: 'battle.honour_invalid',
    });
  });

  it('gates: already in battle / no_battle_field / too_many_battle / war count', async () => {
    const inBattle = build([NOBILITY(1), NO_BUFFER, STATE_ROWS([{ uid: UID }]), CATCH_ALL]);
    await expect(inBattle.cmd.createBattle(ctx, [1001, 2])).rejects.toMatchObject({
      key: 'battle.user_already_in_battle',
    });

    const closed = build([
      NOBILITY(1),
      NO_BUFFER,
      STATE_ROWS([]),
      NO(/^select \* from cfg_battle_field where id = \? and state <> 0$/),
      CATCH_ALL,
    ]);
    await expect(closed.cmd.createBattle(ctx, [2001, 2])).rejects.toMatchObject({
      key: 'battle.no_battle_field',
    });

    const full = build([
      NOBILITY(1),
      NO_BUFFER,
      STATE_ROWS([]),
      BATTLE_FIELD_1001,
      NO(/^select count\(\*\) from sys_user_battle_field/, [{ 'count(*)': 300 }]),
      CATCH_ALL,
    ]);
    await expect(full.cmd.createBattle(ctx, [1001, 2])).rejects.toMatchObject({
      key: 'battle.too_many_battle',
    });

    const war = build([
      NOBILITY(1),
      NO_BUFFER,
      STATE_ROWS([]),
      BATTLE_FIELD_1001,
      NO(/^select count\(\*\) from sys_user_battle_field/, [{ 'count(*)': 0 }]),
      WAR_COUNT(5),
      CATCH_ALL,
    ]);
    await expect(war.cmd.createBattle(ctx, [1001, 2])).rejects.toMatchObject({
      key: 'battle.today_war_count_reach_limit',
    });
  });

  it('gates: 讨伐令 (goods 137) short for level 11, consumed ×(level-10) when owned', async () => {
    const short = build([
      NOBILITY(1),
      NO_BUFFER,
      STATE_ROWS([]),
      BATTLE_FIELD_1001,
      NO(/^select count\(\*\) from sys_user_battle_field/, [{ 'count(*)': 0 }]),
      WAR_COUNT(0),
      HONOUR_NAME(100, 'changle'),
      DEMANDS_ROW,
      NO(/^select `count` from sys_goods/, [{ count: 0 }]),
      CATCH_ALL,
    ]);
    await expect(short.cmd.createBattle(ctx, [1001, 11])).rejects.toMatchObject({
      key: null,
      message: 'not_enough_goods137#1',
    });

    const owned = build([
      NOBILITY(1),
      NO_BUFFER,
      STATE_ROWS([]),
      BATTLE_FIELD_1001,
      NO(/^select count\(\*\) from sys_user_battle_field/, [{ 'count(*)': 0 }]),
      WAR_COUNT(0),
      HONOUR_NAME(100, 'changle'),
      DEMANDS_ROW,
      NO(/^select `count` from sys_goods/, [{ count: 9 }]),
      CATCH_ALL,
    ]);
    await owned.cmd.createBattle(ctx, [1001, 11]);
    const reduce = owned.db.executed.find(
      (e) =>
        /update sys_goods set count = greatest\(0, count - \?\)/.test(e.sql) &&
        e.parameters[2] === 137,
    );
    expect(reduce?.parameters).toEqual([1, UID, 137]);
  });

  it('gates: 珍珠/珊瑚票不足 → join_resource_not_enough, 数量足则整组扣掉', async () => {
    const short = build([
      NOBILITY(1),
      NO_BUFFER,
      STATE_ROWS([]),
      BATTLE_FIELD_1001,
      NO(/^select count\(\*\) from sys_user_battle_field/, [{ 'count(*)': 0 }]),
      WAR_COUNT(0),
      HONOUR_NAME(100, 'changle'),
      {
        ...DEMANDS_ROW,
        rows: [{ demandGoods: '30:2,31:2,', demandThings: ',', demandNobility: 1 }],
      },
      NO(/^select T.name ,S.count from \(select name,gid from cfg_goods/, [
        { name: '珍珠', count: null },
      ]),
      CATCH_ALL,
    ]);
    expect(await errorOf(short.cmd.createBattle(ctx, [1001, 2]))).toEqual({
      key: 'battle.join_resource_not_enough',
      message: 'battle.join_resource_not_enough',
    });

    const owned = build([
      NOBILITY(1),
      NO_BUFFER,
      STATE_ROWS([]),
      BATTLE_FIELD_1001,
      NO(/^select count\(\*\) from sys_user_battle_field/, [{ 'count(*)': 0 }]),
      WAR_COUNT(0),
      HONOUR_NAME(100, 'changle'),
      DEMANDS_ROW,
      NO(/^select T.name ,S.count from \(select name,gid from cfg_goods/),
      NO(/^select T.name ,S.count from \(select name,tid from cfg_things/),
      CATCH_ALL,
    ]);
    await owned.cmd.createBattle(ctx, [1001, 2]);
    const reduces = owned.db.executed.filter((e) =>
      /update sys_goods set count = greatest\(0, count - \?\)/.test(e.sql),
    );
    expect(reduces.map((r) => r.parameters)).toEqual([
      [2, UID, 30],
      [2, UID, 31],
    ]);
  });

  it('generates sys_battle_city + NPC sys_troops (rng-driven), assigns -1 strongpoints and returns the three-part reply', async () => {
    const { cmd, db, scripted } = build([
      NOBILITY(1),
      NO_BUFFER,
      STATE_ROWS([]),
      BATTLE_FIELD_1001,
      NO(/^select count\(\*\) from sys_user_battle_field/, [{ 'count(*)': 0 }]),
      WAR_COUNT(0),
      HONOUR_NAME(100, 'changle'),
      DEMANDS_ROW,
      CFG_CITYS,
      // 据点 101 (unionid 2)：'20,21,22'；据点 275 (unionid -1)：'18,19'。
      CFG_TROOPS(101, [
        { hid: 1005, npcvalue: 10000, soldiers: '20,21,22', unionid: 2, drop: '', rate: 0 },
      ]),
      CFG_TROOPS(275, [
        { hid: 1019, npcvalue: 10000, soldiers: '18,19', unionid: 2, drop: '', rate: 0 },
      ]),
      NO(
        /^select \* from sys_troops where cid = \? and \(\(state = 4 or state = 3\) or targetcid = \?\)$/,
        [{ uid: 0, battleunionid: 2 }],
      ),
      NO(/^select uid, unionid from sys_battle_city where cid = \?$/, [{ uid: 0, unionid: -1 }]),
      UNION_MAP,
      UNION_1,
      NO(/^SELECT GROUP_CONCAT\(DISTINCT tid\) FROM cfg_task_goal/, [
        { 'GROUP_CONCAT(DISTINCT tid)': null },
      ]),
      NO(/^select id from cfg_task where/, [{ id: 60001 }, { id: 60002 }]),
      { match: /insert into sys_user_battle_field/, insertId: 77 },
      LAST_INSERT_ID(5),
      START_CITIES_1001,
      NO_TASK_GOAL_282,
      CATCH_ALL,
    ]);

    const ret = (await scripted.run(sequenceSource([3, 70, 40, 3, 70]), () =>
      cmd.createBattle(ctx, [1001, 2]),
    )) as unknown[][];

    // 消耗 5 次 rand()：据点 101 三抽（3→20 号 3 份；70→0；40→22 号 5 份），据点 275 两抽。
    const troops = db.executed.filter((e) => /insert into sys_troops/.test(e.sql));
    expect(troops.map((t) => t.parameters[2])).toEqual(['2,20,95,22,77,', '1,18,462,']);
    // (cid, hid, soldiers, drop, rate, battlefieldid, battleunionid, bid) — uid=0/state=4 内联。
    expect(troops[0]!.parameters).toEqual([677101, 1005, '2,20,95,22,77,', '', 0, 77, 2, 1001]);
    expect(troops[1]!.parameters).toEqual([677275, 1019, '1,18,462,', '', 0, 77, 2, 1001]);

    const cities = db.executed.filter((e) => /insert into sys_battle_city/.test(e.sql));
    expect(cities).toHaveLength(2);
    // (cid, battlefieldid, nextxy, name, uid=0, unionid, drop, rate, xy=position, image,
    //  winpoint, losepoint, reinforce_soldiers, can_quest) — NULL 列按 PHP 引号插值成 ''。
    expect(cities[0]!.parameters).toEqual([
      677101,
      77,
      '2,164,160,',
      '钜鹿',
      2,
      '-1',
      0,
      101,
      5,
      0,
      0,
      '',
      0,
    ]);
    expect(cities[1]!.parameters).toEqual([
      677275,
      77,
      '2,367,334,',
      '河内',
      -1,
      '-1',
      0,
      275,
      1,
      0,
      0,
      '',
      0,
    ]);
    // 据点 275 unionid=-1 → resetBattleFieldUid 回填 union 2。
    const reset = db.executed.find((e) =>
      /update sys_battle_city set uid = \?, ownerunionid/.test(e.sql),
    );
    expect(reset?.parameters).toEqual([0, 2, 2, 0, 677275]);

    // sys_user_battle_field 先以 state=-1 落行，末尾翻 0。
    const field = db.executed.find((e) => /insert into sys_user_battle_field/.test(e.sql))!;
    expect(field.parameters.slice(0, 4)).toEqual([1001, UID, 2, 5]);
    expect(Number(field.parameters[4])).toBeGreaterThan(0);
    expect(Number(field.parameters[5]) - Number(field.parameters[4])).toBe(10800);
    expect(field.parameters[6]).toBe(0);
    const flip = db.executed.find((e) => /update sys_user_battle_field set state = 0/.test(e.sql))!;
    expect(flip.parameters).toEqual([77]);

    // 黄巾之乱按 cfg_task group 60000-60004 加 pretid=-1 的任务。
    const tasks = db.executed.filter((e) => /insert into sys_user_task/.test(e.sql));
    expect(tasks.map((t) => t.parameters)).toEqual([
      [UID, 60001],
      [UID, 60002],
    ]);

    // 每日参战次数 upsert + 初始事件 9。
    expect(db.executed.some((e) => /insert into mem_user_schedule/.test(e.sql))).toBe(true);
    const evt = db.executed.find((e) => /insert into mem_battle_event/.test(e.sql))!;
    expect(evt.parameters).toEqual([0, UID, 1001, 77, 1, 0, 9]);
    // tid 282 不存在 → 跳过 goal。
    expect(db.executed.some((e) => /insert into sys_user_goal/.test(e.sql))).toBe(false);
    // playerAttendBattle 的两条战场事件行。
    expect(db.executed.some((e) => /insert into mem_war_buf/.test(e.sql))).toBe(true);
    expect(db.executed.some((e) => /insert into mem_war_event/.test(e.sql))).toBe(true);

    // 回复：[battleinfo, setFlags 后的据点, 起点城]。
    const info = ret[0] as unknown as Row;
    expect(info).toMatchObject({
      battlefieldid: 77,
      bid: 1001,
      createuid: UID,
      level: 2,
      maxpeople: 5,
      honour: 100,
      name: '黄巾之乱',
      type: 0,
      startcid: null,
      state: 0,
      unionid: 1,
    });
    expect(Math.abs(Number(info.endtime) - Date.now() / 1000 - 10800)).toBeLessThan(5);
    const cityRows = ret[1] as Row[];
    expect(cityRows).toHaveLength(2);
    // unionid 2（本方 unionid 1 的敌阵 npc 城）→ flag 0、旗 '黄'。
    expect(cityRows[0]).toMatchObject({
      cid: 677101,
      unionid: 2,
      flag: 0,
      flagchar: '黄',
      xy: 101,
    });
    expect(cityRows[1]).toMatchObject({
      cid: 677275,
      unionid: 2,
      flag: 0,
      flagchar: '黄',
      xy: 275,
    });
    expect(db.executed.find((e) => /cfg_battle_start_city/.test(e.sql))!.sql).toContain(
      'order by needhonour asc',
    );
    expect(ret[2]).toEqual([
      { bid: 1001, xy: 767, name: '襄阳', unionid: 1, needhonour: 0 },
      { bid: 1001, xy: 275, name: '河内', unionid: 1, needhonour: 200 },
    ]);
  });
});

describe('joinToBattle', () => {
  const INVITE = (rows: Record<string, unknown>[]): Respond => ({
    match:
      /^select id, battlefieldid, toname, touid from sys_battle_invite where id = \? and touid = \?$/,
    rows,
  });
  const FIELD_ROW: Respond = {
    match: /^select \* from sys_user_battle_field where id = \? and state = 0$/,
    rows: [
      {
        id: 77,
        bid: 1001,
        createuid: 1002,
        level: 2,
        maxpeople: 5,
        state: 0,
        progress: 0,
        starttime: NOW,
        endtime: NOW + 10800,
        type: 0,
      },
    ],
  };
  const USER_FIELD_INFO: Respond = {
    match: /^select su.honour, u.unionid, u.battlefieldid, b.bid, b.createuid, b.level,/,
    rows: [
      {
        honour: 100,
        unionid: 1,
        battlefieldid: 77,
        bid: 1001,
        createuid: 1002,
        level: 2,
        maxpeople: 5,
        starttime: NOW,
        endtime: NOW + 10800,
        type: 0,
        state: 0,
        winner: -1,
        in_cross_battle: 0,
        name: '黄巾之乱',
      },
    ],
  };

  it('gates: no such invite / already in battle / missing battlefield (9001 stub) / full', async () => {
    const noInvite = build([CATCH_ALL]);
    await expect(noInvite.cmd.joinToBattle(ctx, [9])).rejects.toMatchObject({
      key: 'battle.no_such_invite',
    });

    const inBattle = build([
      INVITE([{ id: 9, battlefieldid: 77, toname: 'changle', touid: UID }]),
      STATE_ROWS([{ uid: UID }]),
      CATCH_ALL,
    ]);
    await expect(inBattle.cmd.joinToBattle(ctx, [9])).rejects.toMatchObject({
      key: 'battle.join_user_already_in_battle',
    });

    // 战场行缺失 → sendRemote9001Request 的 Exception("")。
    const noField = build([
      INVITE([{ id: 9, battlefieldid: 77, toname: 'changle', touid: UID }]),
      STATE_ROWS([]),
      CATCH_ALL,
    ]);
    expect(await errorOf(noField.cmd.joinToBattle(ctx, [9]))).toEqual({ key: null, message: '' });

    const full = build([
      INVITE([{ id: 9, battlefieldid: 77, toname: 'changle', touid: UID }]),
      STATE_ROWS([]),
      FIELD_ROW,
      WAR_COUNT(0),
      NO(/^select user_unionid from cfg_battle_field where id = \?$/, [{ user_unionid: 1 }]),
      UNION_1,
      NO(/^select count\(\*\) from sys_user_battle_state where state = 0 and battlefieldid = \?$/, [
        { 'count(*)': 5 },
      ]),
      CATCH_ALL,
    ]);
    await expect(full.cmd.joinToBattle(ctx, [9])).rejects.toMatchObject({
      key: 'battle.user_full',
    });
  });

  it('gates: today war count ≥ 5 and negative honour', async () => {
    const war = build([
      INVITE([{ id: 9, battlefieldid: 77, toname: 'changle', touid: UID }]),
      STATE_ROWS([]),
      FIELD_ROW,
      WAR_COUNT(5),
      CATCH_ALL,
    ]);
    await expect(war.cmd.joinToBattle(ctx, [9])).rejects.toMatchObject({
      key: 'battle.today_war_count_reach_limit',
    });

    const honour = build([
      INVITE([{ id: 9, battlefieldid: 77, toname: 'changle', touid: UID }]),
      STATE_ROWS([]),
      FIELD_ROW,
      WAR_COUNT(0),
      NO(/^select user_unionid from cfg_battle_field where id = \?$/, [{ user_unionid: 1 }]),
      UNION_1,
      NO(/^select count\(\*\) from sys_user_battle_state where state = 0 and battlefieldid = \?$/, [
        { 'count(*)': 1 },
      ]),
      NO(/^select honour from sys_user where uid = \?$/, [{ honour: -3 }]),
      CATCH_ALL,
    ]);
    await expect(honour.cmd.joinToBattle(ctx, [9])).rejects.toMatchObject({
      key: 'battle.honour_invalid',
    });
  });

  it('joins through the invite: state upsert reuses the row, 1001 tasks, invite deleted, reply built', async () => {
    const { cmd, db } = build([
      INVITE([{ id: 9, battlefieldid: 77, toname: 'changle', touid: UID }]),
      STATE_ROWS([]),
      FIELD_ROW,
      WAR_COUNT(0),
      NO(/^select user_unionid from cfg_battle_field where id = \?$/, [{ user_unionid: 1 }]),
      UNION_1,
      NO(/^select count\(\*\) from sys_user_battle_state where state = 0 and battlefieldid = \?$/, [
        { 'count(*)': 1 },
      ]),
      NO(/^select honour from sys_user where uid = \?$/, [{ honour: 100 }]),
      NOBILITY(1),
      NO_BUFFER,
      DEMANDS_ROW,
      NO(/^SELECT GROUP_CONCAT\(DISTINCT tid\) FROM cfg_task_goal/, [
        { 'GROUP_CONCAT(DISTINCT tid)': null },
      ]),
      NO(/^select id from cfg_task where/, [{ id: 60003 }]),
      NO(/^select \* from sys_battle_city where battlefieldid = \?$/, [
        { cid: 677101, battlefieldid: 77, unionid: 2, uid: 0, hasuser: null },
      ]),
      UNION_MAP,
      USER_FIELD_INFO,
      START_CITIES_1001,
      LAST_INSERT_ID(5),
      CATCH_ALL,
    ]);
    const ret = (await cmd.joinToBattle(ctx, [9])) as unknown[];

    const upsert = db.executed.find((e) => /insert into sys_user_battle_state/.test(e.sql))!;
    expect(upsert.parameters.slice(0, 5)).toEqual([UID, 1001, 77, 1, 2]);
    expect(upsert.sql).toContain('on duplicate key update');

    const tasks = db.executed.filter((e) => /insert into sys_user_task/.test(e.sql));
    expect(tasks.map((t) => t.parameters)).toEqual([[UID, 60003]]);

    expect(db.executed.some((e) => /delete from sys_battle_invite where id = \?/.test(e.sql))).toBe(
      true,
    );
    expect(db.executed.some((e) => /insert into mem_war_buf/.test(e.sql))).toBe(true);
    expect(db.executed.some((e) => /insert into mem_user_schedule/.test(e.sql))).toBe(true);

    expect(ret[0]).toMatchObject({ battlefieldid: 77, bid: 1001, state: 0, name: '黄巾之乱' });
    expect(ret[1]).toEqual([
      {
        cid: 677101,
        battlefieldid: 77,
        unionid: 2,
        uid: 0,
        hasuser: null,
        flag: 0,
        flagchar: '黄',
      },
    ]);
    expect(ret[2]).toEqual(START_CITIES_1001.rows);
  });

  it('bid 8001 blocks once the creator finished the first main-line goal', async () => {
    const done = build([
      INVITE([{ id: 9, battlefieldid: 77, toname: 'changle', touid: UID }]),
      STATE_ROWS([]),
      {
        match: /^select \* from sys_user_battle_field where id = \? and state = 0$/,
        rows: [{ id: 77, bid: 8001, createuid: 1002, level: 2, state: 0, progress: 0 }],
      },
      NO(/^select id from cfg_task_goal where tid = 60800$/, [{ id: 608001 }]),
      NO(/^select 1 from sys_user_goal where uid = \? and gid = \?$/, [{ 1: 1 }]),
      CATCH_ALL,
    ]);
    expect(await errorOf(done.cmd.joinToBattle(ctx, [9]))).toEqual({
      key: null,
      message: '已有玩家完成第一个主线任务，此时已经不能加入到副本中',
    });

    const progressed = build([
      INVITE([{ id: 9, battlefieldid: 77, toname: 'changle', touid: UID }]),
      STATE_ROWS([]),
      {
        match: /^select \* from sys_user_battle_field where id = \? and state = 0$/,
        rows: [{ id: 77, bid: 8001, createuid: 1002, level: 2, state: 0, progress: 1 }],
      },
      NO(/^select id from cfg_task_goal where tid = 60800$/, [{ id: 608001 }]),
      CATCH_ALL,
    ]);
    await expect(progressed.cmd.joinToBattle(ctx, [9])).rejects.toMatchObject({ key: null });
  });
});

describe('joinToPVPBattle', () => {
  const USER_FIELD_INFO_5001: Respond = {
    match: /^select su.honour, u.unionid, u.battlefieldid, b.bid, b.createuid, b.level,/,
    rows: [
      {
        honour: 100,
        unionid: 10,
        battlefieldid: 55,
        bid: 5001,
        createuid: 1002,
        level: 2,
        maxpeople: 1,
        starttime: NOW,
        endtime: NOW + 7200,
        type: 0,
        state: 0,
        winner: -1,
        in_cross_battle: 0,
        name: '千里走单骑',
      },
    ],
  };

  it('gates: already in battle / no_battle_field for closed bids / max_people / frozen / can_not_join', async () => {
    const inBattle = build([STATE_ROWS([{ uid: UID }]), CATCH_ALL]);
    await expect(inBattle.cmd.joinToPVPBattle(ctx, [5001, 0, 10])).rejects.toMatchObject({
      key: 'battle.join_user_already_in_battle',
    });

    // 4001 关闭（真实库 cfg_battle_field.state=0；7001 无行）：$battle=false → $maxpeople=null →
    // 自动挑位 SQL 插值成 `having count(1)<`（null→""，不是字面 NULL），legacy MySQL 直接
    // ERROR 1064（已实测）→ database.php error() trigger_error → amfphp 错误处理 → 客户端收到
    // "PearDB returned an error. "。自动挑位与回退查询都不会执行。
    const closed = build([
      STATE_ROWS([]),
      NO(/^select \* from sys_user where uid = \?$/, [{ uid: UID, name: 'changle', honour: 100 }]),
      NO(/^select \* from cfg_battle_field where id = \? and state <> 0$/),
      CATCH_ALL,
    ]);
    expect(await errorOf(closed.cmd.joinToPVPBattle(ctx, [4001, 0, 7]))).toEqual({
      key: null,
      message: 'PearDB returned an error. ',
    });

    // 显式 battlefieldid 跳过自动挑位：战场不存在 → no_battle_field（7001 的另一条可达路径）。
    const closedExplicit = build([
      STATE_ROWS([]),
      NO(/^select \* from sys_user where uid = \?$/, [{ uid: UID, name: 'changle', honour: 100 }]),
      NO(/^select \* from cfg_battle_field where id = \? and state <> 0$/),
      NO(/^select \* from sys_user_battle_field where id = \?$/),
      CATCH_ALL,
    ]);
    await expect(closedExplicit.cmd.joinToPVPBattle(ctx, [7001, 7, 7])).rejects.toMatchObject({
      key: 'battle.no_battle_field',
    });

    const full = build([
      STATE_ROWS([]),
      NO(/^select \* from sys_user where uid = \?$/, [{ uid: UID, name: 'changle', honour: 100 }]),
      NO(/^select \* from cfg_battle_field where id = \? and state <> 0$/, [
        { id: 5001, state: 1, maxpeople: 1 },
      ]),
      NO(/^select \* from sys_user_battle_field where id = \?$/, [
        { id: 55, bid: 5001, state: 0, level: 2 },
      ]),
      NO(/^select count\(1\) from sys_user_battle_state/, [{ 'count(1)': 1 }]),
      CATCH_ALL,
    ]);
    await expect(full.cmd.joinToPVPBattle(ctx, [5001, 55, 10])).rejects.toMatchObject({
      key: 'battle.max_people',
    });

    const frozen = build([
      STATE_ROWS([]),
      NO(/^select \* from sys_user where uid = \?$/, [{ uid: UID, name: 'changle', honour: 100 }]),
      NO(/^select \* from cfg_battle_field where id = \? and state <> 0$/, [
        { id: 5001, state: 1, maxpeople: 1 },
      ]),
      NO(/^select \* from sys_user_battle_field where id = \?$/, [
        { id: 55, bid: 5001, state: 1, level: 2 },
      ]),
      CATCH_ALL,
    ]);
    await expect(frozen.cmd.joinToPVPBattle(ctx, [5001, 55, 10])).rejects.toMatchObject({
      key: 'battle.no_battle_field_froze',
    });

    // 4001 有历史战场行时推进到 progress 闸门（第二阶段起拒绝）。
    const dongzhuo = build([
      STATE_ROWS([]),
      NO(/^select \* from sys_user where uid = \?$/, [{ uid: UID, name: 'changle', honour: 100 }]),
      NO(/^select \* from cfg_battle_field where id = \? and state <> 0$/, [
        { id: 4001, state: 1, maxpeople: 20 },
      ]),
      NO(/^select id from sys_user_battle_field where bid = \? limit 1$/, [{ id: 3 }]),
      NO(/^select \* from sys_user_battle_field where id = \?$/, [
        { id: 3, bid: 4001, state: 0, level: 2, progress: 2 },
      ]),
      NO(/^select count\(1\) from sys_user_battle_state/, [{ 'count(1)': 0 }]),
      CATCH_ALL,
    ]);
    await expect(dongzhuo.cmd.joinToPVPBattle(ctx, [4001, 3, 7])).rejects.toMatchObject({
      key: 'battle.can_not_join',
    });
  });

  it('joins with the chosen union: init tasks, goal 285 (gid 0), winpoints as the 4th slot', async () => {
    const { cmd, db } = build([
      NOBILITY(4),
      NO_BUFFER,
      STATE_ROWS([]),
      NO(/^select \* from sys_user where uid = \?$/, [{ uid: UID, name: 'changle', honour: 100 }]),
      NO(/^select \* from cfg_battle_field where id = \? and state <> 0$/, [
        {
          id: 5001,
          state: 1,
          maxpeople: 1,
          user_unionid: 10,
          demandGoods: '38:1,',
          demandThings: ',',
          demandNobility: 3,
        },
      ]),
      NO(/^select \* from sys_user_battle_field where id = \?$/, [
        { id: 55, bid: 5001, state: 0, level: 2, createuid: 1002 },
      ]),
      NO(/^select count\(1\) from sys_user_battle_state/, [{ 'count(1)': 0 }]),
      DEMANDS_5001,
      NO(/^select T.name ,S.count from \(select name,gid from cfg_goods/),
      NO(/^select T.name ,S.count from \(select name,tid from cfg_things/),
      UNION_10,
      NO(/^SELECT GROUP_CONCAT\(DISTINCT tid\) FROM cfg_task_goal/, [
        { 'GROUP_CONCAT(DISTINCT tid)': null },
      ]),
      NO(/^select \* from sys_battle_city where battlefieldid = \?$/, [
        { cid: 655523, battlefieldid: 55, unionid: 11, uid: 0, hasuser: 1 },
      ]),
      UNION_MAP,
      USER_FIELD_INFO_5001,
      NO(
        /^select \* from cfg_battle_start_city where bid = \?[\s\S]*and unionid = \? order by needhonour asc$/,
        [{ bid: 5001, xy: 523, name: '许昌', unionid: 10, needhonour: 0 }],
      ),
      NO(/^select \* from sys_battle_winpoint where battlefieldid = \?$/, [
        { battlefieldid: 55, cid: 655101, count: 100 },
      ]),
      NO_TASK_GOAL_282,
      LAST_INSERT_ID(5),
      CATCH_ALL,
    ]);
    const ret = (await cmd.joinToPVPBattle(ctx, [5001, 55, 10])) as unknown[];

    const upsert = db.executed.find((e) => /insert into sys_user_battle_state/.test(e.sql))!;
    expect(upsert.parameters.slice(0, 5)).toEqual([UID, 5001, 55, 10, 2]);

    // union 10 的 init_tasks '60023,60024' → 两条任务；cfg_task_goal 无 285 → gid 0 兜底行。
    const tasks = db.executed.filter((e) => /insert into sys_user_task/.test(e.sql));
    expect(tasks.map((t) => t.parameters)).toEqual([
      [UID, 60023],
      [UID, 60024],
    ]);
    const goal = db.executed.find((e) => /insert into sys_user_goal/.test(e.sql))!;
    expect(goal.parameters).toEqual([UID, 0, 0]);

    // 票据 38:1 → reduceGoods。
    const reduce = db.executed.find((e) =>
      /update sys_goods set count = greatest\(0, count - \?\)/.test(e.sql),
    )!;
    expect(reduce.parameters).toEqual([1, UID, 38]);

    // unionid 10 不在 union_name 表 → camp_name 空 → login_1 文案。
    const evt = db.executed.find((e) => /insert into mem_war_event/.test(e.sql))!;
    expect(evt.parameters[2]).toBe('changle 加入了战场。');

    expect(ret[0]).toMatchObject({ battlefieldid: 55, bid: 5001, name: '千里走单骑' });
    expect(ret[1]).toEqual([
      { cid: 655523, battlefieldid: 55, unionid: 11, uid: 0, hasuser: 1, flag: 4, flagchar: null },
    ]);
    expect(ret[2]).toEqual([{ bid: 5001, xy: 523, name: '许昌', unionid: 10, needhonour: 0 }]);
    expect(ret[3]).toEqual([{ battlefieldid: 55, cid: 655101, count: 100 }]);
  });

  it('auto-picks the emptiest battlefield of the bid when battlefieldid is 0', async () => {
    const { cmd, db } = build([
      NOBILITY(4),
      NO_BUFFER,
      STATE_ROWS([]),
      NO(/^select \* from sys_user where uid = \?$/, [{ uid: UID, name: 'changle', honour: 100 }]),
      NO(/^select \* from cfg_battle_field where id = \? and state <> 0$/, [
        {
          id: 5001,
          state: 1,
          maxpeople: 1,
          user_unionid: 10,
          demandGoods: ',',
          demandThings: ',',
          demandNobility: 3,
        },
      ]),
      {
        match:
          /^select battlefieldid from sys_user_battle_state where unionid = \?[\s\S]*and bid = \?[\s\S]*having count\(1\) < \?[\s\S]*order by count\(1\) limit 1$/,
        rows: [{ battlefieldid: 55 }],
      },
      NO(/^select \* from sys_user_battle_field where id = \?$/, [
        { id: 55, bid: 5001, state: 0, level: 2, createuid: 1002 },
      ]),
      NO(/^select count\(1\) from sys_user_battle_state/, [{ 'count(1)': 0 }]),
      DEMANDS_5001,
      NO(/^SELECT GROUP_CONCAT\(DISTINCT tid\) FROM cfg_task_goal/, [
        { 'GROUP_CONCAT(DISTINCT tid)': null },
      ]),
      NO(/^select \* from sys_battle_city where battlefieldid = \?$/),
      UNION_MAP,
      USER_FIELD_INFO_5001,
      NO(
        /^select \* from cfg_battle_start_city where bid = \?[\s\S]*and unionid = \? order by needhonour asc$/,
      ),
      NO(/^select \* from sys_battle_winpoint where battlefieldid = \?$/),
      NO_TASK_GOAL_282,
      LAST_INSERT_ID(5),
      CATCH_ALL,
    ]);
    await cmd.joinToPVPBattle(ctx, [5001, 0, 10]);
    const upsert = db.executed.find((e) => /insert into sys_user_battle_state/.test(e.sql))!;
    expect(upsert.parameters.slice(0, 5)).toEqual([UID, 5001, 55, 10, 2]);
  });
});
