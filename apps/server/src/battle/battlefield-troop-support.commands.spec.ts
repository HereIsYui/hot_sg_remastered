import { describe, expect, it } from 'vitest';
import { type RawBuilder } from 'kysely';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { ReportService } from '../core/report.service';
import {
  enhanceArmy,
  getSoldierMap,
  getSoldierPeople,
  getSoldierString,
  resetBattleFieldUid,
  type BattlefieldDeps,
} from './battlefield-troop-support';
import {
  BattlefieldTroopSupportCommands,
  type BattlefieldQuit,
} from './battlefield-troop-support.commands';

const lang = new LangService({
  battle: {
    user_not_in_battle: '你已经不在战场中或者战场已经结束。',
    battle_froze: '战场已经结束，你不能再行动。',
    too_frequent_quest: '你探索过于频繁了。',
    can_not_quest: '该城池不能探索。',
    state_0: '前进',
    state_1: '返回',
    state_2: '等待',
    state_3: '战斗',
    state_4: '驻军',
    troop_not_exist: '战场中没有当前你所选择的这支军队。',
    troop_not_stay: '你所选择的军队正在行动中，请选择其他军队。',
    troop_not_ahead: '军队不在前进中，不能召回。',
    troop_in_fight: '军队正在战斗中。',
    troop_in_back_no_call: '军队处于返回状态 ，不能调遣军队。',
    troop_in_forward_no_call: '军队还没有进入战场，不能调遣援军。',
    troop_not_in_move: '军队不在行进中，不需要加速。',
    troop_not_need_faster: '部队将在10秒钟内到达，无需使用急行军令。',
    callback_succ: '军队正在返回出发城池，请到出征面板中查看。',
    callback_fail: '召回军队失败。',
    callback_army_honour: '你的军队已离开战场，剩余援军返还战场荣誉%s。',
    add_army_succ: '补充兵力成功。',
    no_reinforce: '改城池已经没有足够的补充兵员。',
    soldier_uplimit: '改城池已经没有足够的补充兵员或者您的兵力已经到达上限。',
    call_army_max: '调遣援军超过最大数目',
    call_army_not_enough_honour: '你没有足够的战场荣誉来调遣援军',
    call_army_suc: '调遣援军成功。',
    call_army_fail: '调遣援军失败。',
    faster_army_suc: '加速行军成功，军队马上就要到达目的地。',
    soldier_limit: [
      0, 1000, 2000, 4000, 8000, 10000, 20000, 40000, 60000, 80000, 100000, 120000, 140000,
    ],
  },
  callBackTroop: { invalid_army: '无效的军队。' },
  depluder: { too_many_sid: '种参与，目前最多允许12兵种参战' },
});

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };
const NO = (match: RegExp): Respond => ({ match, rows: [] });

/** A sys_user_battle_state ⋈ sys_user_battle_field row (firstGetUserBattleInfo shape). */
const BATTLE_ROW = {
  honour: 100,
  unionid: 2,
  battlefieldid: 11,
  bid: 1001,
  createuid: 1001,
  level: 1,
  maxpeople: 5,
  starttime: 900000,
  endtime: 9900000,
  type: 0,
  state: 0,
  winner: -1,
  in_cross_battle: 0,
  name: '黄巾之乱',
};

function build(rules: Respond[], quit?: BattlefieldQuit) {
  const db = new FakeDb(rules);
  const cmd = new BattlefieldTroopSupportCommands(
    db.scope,
    lang,
    new GoodsRules(db.scope),
    new ReportService(db.scope, { raiseAlarm: async () => {} } as never),
    quit,
  );
  return { cmd, db };
}

/** BattlefieldDeps over a FakeDb (for the exported helper functions). */
function depsOf(db: FakeDb): BattlefieldDeps {
  return {
    db: db.scope.db,
    query: async (q: RawBuilder<Row>) => (await q.execute(db.scope.db)).rows as Row[],
    one: async (q: RawBuilder<Row>) => ((await q.execute(db.scope.db)).rows as Row[])[0] ?? false,
    cell: async (q: RawBuilder<Row>) => {
      const row = (await q.execute(db.scope.db)).rows[0];
      return row ? Object.values(row)[0] : undefined;
    },
    lang: (key: string) => lang.t(key),
  };
}

type Row = Record<string, unknown>;

const errKeyOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (err) {
    if (err instanceof GameError) return err.key ?? `raw:${err.message}`;
    throw err;
  }
  return 'no-error';
};

describe('battlefield gates (firstGetUserBattleInfo / ifFrozeExit)', () => {
  it('questInCity without a battle row → user_not_in_battle', async () => {
    const { cmd } = build([NO(/.*/)]);
    expect(await errKeyOf(() => cmd.questInCity(ctx, [80213, 9355]))).toBe(
      'battle.user_not_in_battle',
    );
  });

  it('a frozen battlefield (field state=1) → battle_froze', async () => {
    const { cmd } = build([
      { match: /from sys_user_battle_state u/i, rows: [{ ...BATTLE_ROW, state: 1 }] },
      NO(/.*/),
    ]);
    expect(await errKeyOf(() => cmd.questInCity(ctx, [80213, 9355]))).toBe('battle.battle_froze');
  });

  it('callArmy through ifFrozeExit: empty → user_not_in_battle, frozen → battle_froze', async () => {
    const { cmd } = build([NO(/.*/)]);
    expect(await errKeyOf(() => cmd.callArmy(ctx, [501, 3, 10]))).toBe('battle.user_not_in_battle');
    const frozen = build([
      { match: /from sys_user_battle_state s/i, rows: [{ state: 1, battlefieldid: 11 }] },
      NO(/.*/),
    ]).cmd;
    expect(await errKeyOf(() => frozen.callArmy(ctx, [501, 3, 10]))).toBe('battle.battle_froze');
  });
});

describe('questInCity', () => {
  const happyRules = (
    mark: { rows?: Record<string, unknown>[]; params?: unknown[] },
    now: number,
  ): Respond[] => [
    { match: /from sys_user_battle_state u/i, rows: [BATTLE_ROW] },
    { match: /select can_quest as v from sys_battle_city/i, rows: [{ v: 1 }] },
    { match: /from sys_battle_city a, sys_troops b/i, rows: [{ v: 80001 }] },
    {
      match: /from mem_battle_event_mark/i,
      rows: mark.rows ?? [],
      params: mark.params,
    },
    { match: /select unix_timestamp\(\) as v/i, rows: [{ v: now }] },
    { match: /from sys_city_hero where hid/i, rows: [{ hid: 80001, name: '君主', level: 10 }] },
    { match: /from cfg_battle_event/i, rows: [{ v: '探索到了黄巾军的粮草。' }] },
    NO(/.*/),
  ];

  it('explores: writes the mark and the type-11 event, returns hero + event msg', async () => {
    const { cmd, db } = build(happyRules({ rows: [] }, 1000000));
    const res = await cmd.questInCity(ctx, [0, 9355]);
    expect(res[0]).toMatchObject({ hid: 80001, name: '君主' });
    expect(res[1]).toBe('探索到了黄巾军的粮草。');
    const inserts = db.executed.filter((e) => /^insert into mem_battle_event /.test(e.sql));
    expect(inserts).toHaveLength(1);
    // sendBattleEvent(0, uid, bid, battlefieldid, unionid, cid%1000, 11)
    expect(inserts[0]!.parameters).toEqual([0, 1001, 1001, 11, 2, 355, 11]);
    expect(db.executed.some((e) => /^insert into mem_battle_event_mark /.test(e.sql))).toBe(true);
  });

  it('reuses an existing mark row (update in place), hid 0 falls back to the stationed army', async () => {
    const { cmd, db } = build(
      happyRules({ rows: [{ id: 7, time: 1000000 - 120 }], params: [11, 1, 9355] }, 1000000),
    );
    const res = await cmd.questInCity(ctx, [0, 9355]);
    expect(res[0]).toMatchObject({ hid: 80001 });
    expect(db.executed.some((e) => /^update mem_battle_event_mark set/i.test(e.sql))).toBe(true);
    expect(db.executed.some((e) => /^insert into mem_battle_event_mark /.test(e.sql))).toBe(false);
  });

  it('60s cooldown → too_frequent_quest and no event', async () => {
    const { cmd, db } = build(
      happyRules({ rows: [{ id: 7, time: 1000000 - 30 }], params: [11, 1, 9355] }, 1000000),
    );
    expect(await errKeyOf(() => cmd.questInCity(ctx, [0, 9355]))).toBe('battle.too_frequent_quest');
    expect(db.executed.some((e) => /^insert into mem_battle_event /.test(e.sql))).toBe(false);
  });

  it('a city without can_quest or without an own army → can_not_quest', async () => {
    const { cmd } = build([
      { match: /from sys_user_battle_state u/i, rows: [BATTLE_ROW] },
      { match: /select can_quest as v from sys_battle_city/i, rows: [{ v: 0 }] },
      { match: /from sys_battle_city a, sys_troops b/i, rows: [{ v: 80001 }] },
      NO(/.*/),
    ]);
    expect(await errKeyOf(() => cmd.questInCity(ctx, [0, 9355]))).toBe('battle.can_not_quest');
    const noArmy = build([
      { match: /from sys_user_battle_state u/i, rows: [BATTLE_ROW] },
      { match: /select can_quest as v from sys_battle_city/i, rows: [{ v: 1 }] },
      { match: /from sys_battle_city a, sys_troops b/i, rows: [] },
      NO(/.*/),
    ]);
    expect(await errKeyOf(() => noArmy.cmd.questInCity(ctx, [0, 9355]))).toBe(
      'battle.can_not_quest',
    );
  });
});

describe('troop detail readers', () => {
  it('getBattleTroopDetail for an NPC troop: union name/cfg_battle_hero hero, state text', async () => {
    const { cmd } = build([
      {
        match: /from sys_troops\s+where id = \?/i,
        rows: [
          {
            id: 501,
            cid: 9301,
            uid: 5,
            soldiers: '2,4,100,6,50',
            hid: 1001,
            targetcid: 9355,
            pathtime: 300,
            endtime: 1000100,
            state: 0,
            battleunionid: 2,
          },
        ],
      },
      { match: /from cfg_battle_union/i, rows: [{ v: '黄巾' }] },
      { match: /from cfg_battle_hero/i, rows: [{ name: '张角', level: 30 }] },
      { match: /from sys_battle_city where cid = \?/i, rows: [{ v: '广宗' }] },
      { match: /from mem_troops_buffer/i, rows: [] },
      { match: /from sys_troop_things a, cfg_things b/i, rows: [] },
      NO(/.*/),
    ]);
    const [info] = (await cmd.getBattleTroopDetail(ctx, [501])) as [Record<string, unknown>];
    expect(info).toMatchObject({
      id: 501,
      uid: 5,
      soldiers: '2,4,100,6,50',
      pathtime: 300,
      endtime: 1000100,
      unionname: '黄巾',
      name: '黄巾',
      heroinfo: { name: '张角', level: 30 },
      targetcityname: '广宗',
      state: '前进',
      thingname: '--',
      thingcount: '--',
    });
    expect(info.buffers).toBeUndefined();
  });

  it('getBattleTroopDetail for a player troop: sys_user name, stationed target and buffers', async () => {
    const { cmd } = build([
      {
        match: /from sys_troops\s+where id = \?/i,
        rows: [
          {
            id: 502,
            cid: 9355,
            uid: 1001,
            soldiers: '1,4,100',
            hid: 80213,
            targetcid: 9301,
            pathtime: 300,
            endtime: 1000100,
            state: 4,
            battleunionid: 2,
          },
        ],
      },
      { match: /from cfg_battle_union/i, rows: [{ v: '汉' }] },
      { match: /from sys_user where uid = \?/i, rows: [{ v: 'changle' }] },
      { match: /from sys_city_hero where hid = \?/i, rows: [{ name: '君主', level: 10 }] },
      { match: /from sys_battle_city where cid = \?/i, rows: [{ v: '长社' }] },
      { match: /from mem_troops_buffer/i, rows: [{ buftype: 1, bufparam: 0 }] },
      { match: /from sys_troop_things a, cfg_things b/i, rows: [{ name: '玉玺', count: 1 }] },
      NO(/.*/),
    ]);
    const [info] = (await cmd.getBattleTroopDetail(ctx, [502])) as [Record<string, unknown>];
    expect(info).toMatchObject({
      name: 'changle',
      unionname: '汉',
      heroinfo: { name: '君主', level: 10 },
      targetcityname: '长社',
      state: '驻军',
      pathtime: '--',
      endtime: '--',
      thingname: '玉玺',
      thingcount: 1,
      buffers: [{ buftype: 1, bufparam: 0 }],
    });
  });

  it('a battleunionid over 1000 is another player: it overrides the union name', async () => {
    const { cmd } = build([
      {
        match: /from sys_troops\s+where id = \?/i,
        rows: [
          {
            id: 503,
            cid: 9355,
            uid: 1001,
            soldiers: '1,4,100',
            hid: 80213,
            targetcid: 9301,
            pathtime: 0,
            endtime: 0,
            state: 4,
            battleunionid: 1002,
          },
        ],
      },
      { match: /from cfg_battle_union/i, rows: [] },
      { match: /from sys_user where uid = \?/i, rows: [{ v: '盟友' }] },
      { match: /from sys_city_hero where hid = \?/i, rows: [{ name: '君主', level: 10 }] },
      { match: /from sys_battle_city where cid = \?/i, rows: [{ v: '长社' }] },
      { match: /from mem_troops_buffer/i, rows: [] },
      { match: /from sys_troop_things a, cfg_things b/i, rows: [] },
      NO(/.*/),
    ]);
    const [info] = (await cmd.getBattleTroopDetail(ctx, [503])) as [Record<string, unknown>];
    expect(info).toMatchObject({ name: '盟友', unionname: '盟友' });
  });

  it('unknown troop → invalid_army; the short card has no march fields', async () => {
    const { cmd } = build([NO(/.*/)]);
    expect(await errKeyOf(() => cmd.getBattleTroopDetail(ctx, [999]))).toBe(
      'callBackTroop.invalid_army',
    );
    expect(await errKeyOf(() => cmd.getCityBattleTroopDetail(ctx, [999]))).toBe(
      'callBackTroop.invalid_army',
    );
    const short = build([
      {
        match: /from sys_troops\s+where id = \?/i,
        rows: [
          {
            id: 501,
            cid: 9301,
            uid: 5,
            soldiers: '1,4,100',
            hid: 1001,
            targetcid: 9355,
            battleunionid: 2,
          },
        ],
      },
      { match: /from cfg_battle_union/i, rows: [{ v: '黄巾' }] },
      { match: /from cfg_battle_hero/i, rows: [{ name: '张角', level: 30 }] },
      NO(/.*/),
    ]);
    const [info] = (await short.cmd.getCityBattleTroopDetail(ctx, [501])) as [
      Record<string, unknown>,
    ];
    expect(info).toMatchObject({ id: 501, unionname: '黄巾', name: '黄巾' });
    expect(info.pathtime).toBeUndefined();
    expect(info.targetcityname).toBeUndefined();
    expect(info.thingname).toBeUndefined();
  });
});

describe('callBackArmy', () => {
  const stationedTroop = {
    id: 501,
    uid: 1001,
    cid: 9355,
    hid: 80213,
    targetcid: 9355,
    task: 9,
    state: 4,
    soldiers: '2,3,5000,7,3000',
    battlefieldid: 11,
    startcid: 209355,
    battleunionid: 2,
    bid: 1001,
  };

  const rulesFor = (troop: Respond['rows'], reinforce: string): Respond[] => [
    { match: /from sys_troops where id = \? and uid = \?/i, rows: troop },
    {
      match: /group_concat\(sid, ',', count\)/i,
      rows: reinforce === '' ? [] : [{ v: reinforce }],
      params: [501],
    },
    { match: /from sys_user where uid = \?/i, rows: [{ v: 'changle' }] },
    { match: /from sys_troops\s+where cid = \?/i, rows: [] },
    { match: /select uid, unionid from sys_battle_city/i, rows: [{ uid: 0, unionid: -1 }] },
    NO(/.*/),
  ];

  it('sends the army home (task 7, state 1, battlefieldid 0, cid=startcid) and refunds honour', async () => {
    const { cmd, db } = build(rulesFor([stationedTroop], '3,2000,7,1000'));
    const res = await cmd.callBackArmy(ctx, [501]);
    expect(res).toEqual(['军队正在返回出发城池，请到出征面板中查看。']);
    const update = db.executed.find((e) => /update sys_troops set starttime/i.test(e.sql))!;
    // remaining: 3→3000, 7→2000
    expect(update.parameters).toEqual(['2,3,3000,7,2000', 501]);
    // backhonour = floor(2000*1/100) + floor(1000*3/100) = 20 + 30 = 50
    const honour = db.executed.find((e) => /update sys_user set honour/i.test(e.sql));
    expect(honour?.parameters).toEqual([50, 1001]);
    const reports = db.executed.filter((e) => /insert into sys_report/i.test(e.sql));
    expect(reports).toHaveLength(1);
    // the sys_report insert columns: uid, origincid, origincity, happencid, happencity, title,
    // type, time(raw), read, battleid, content → content is the 10th bound value
    expect(reports[0]!.parameters[7]).toContain('返还战场荣誉50');
  });

  it('an army emptied by the refund throws its hero home and deletes the troop', async () => {
    const emptied = { ...stationedTroop, soldiers: '1,3,100' };
    const { cmd, db } = build(rulesFor([emptied], '3,150'));
    const res = await cmd.callBackArmy(ctx, [501]);
    expect(res).toEqual(['军队正在返回出发城池，请到出征面板中查看。']);
    expect(db.executed.some((e) => /update sys_city_hero set state = 0/i.test(e.sql))).toBe(true);
    expect(db.executed.some((e) => /^delete from sys_troops where id = \?/i.test(e.sql))).toBe(
      true,
    );
    // backhonour = floor(100*1/100) = 1
    expect(db.executed.some((e) => /update sys_user set honour/i.test(e.sql))).toBe(true);
  });

  it('resetBattleFieldUid re-owns the vacated 据点', async () => {
    const { cmd, db } = build([
      { match: /from sys_troops where id = \? and uid = \?/i, rows: [stationedTroop] },
      { match: /group_concat\(sid, ',', count\)/i, rows: [] },
      { match: /from sys_troops\s+where cid = \?/i, rows: [{ uid: 1001, battleunionid: 2 }] },
      {
        match: /select uid, unionid from sys_battle_city/i,
        rows: [{ uid: 1001, unionid: 2 }],
      },
      NO(/.*/),
    ]);
    const res = await cmd.callBackArmy(ctx, [501]);
    expect(res).toEqual(['军队正在返回出发城池，请到出征面板中查看。']);
    const update = db.executed.find((e) => /update sys_battle_city set uid = \?/i.test(e.sql));
    expect(update?.parameters).toEqual([1001, 2, 2, 1, 9355]);
  });

  it('bid 5001 auto-fail calls the quitBattle hook with the monarch name', async () => {
    const calls: unknown[][] = [];
    const quit: BattlefieldQuit = {
      quitBattle: async (uid, param) => {
        calls.push([uid, ...param]);
        return [];
      },
    };
    const { cmd } = build(rulesFor([{ ...stationedTroop, bid: 5001 }], ''), quit);
    await cmd.callBackArmy(ctx, [501]);
    expect(calls).toEqual([[1001, 'changle']]);
    // without the hook the branch logs and skips instead of throwing
    const noHook = build(rulesFor([{ ...stationedTroop, bid: 5001 }], ''));
    const res = await noHook.cmd.callBackArmy(ctx, [501]);
    expect(res).toHaveLength(1);
  });

  it('guards: missing troop → troop_not_exist, marching troop → troop_not_stay', async () => {
    const { cmd } = build([NO(/.*/)]);
    expect(await errKeyOf(() => cmd.callBackArmy(ctx, [999]))).toBe('battle.troop_not_exist');
    const marching = build(rulesFor([{ ...stationedTroop, state: 0 }], ''));
    expect(await errKeyOf(() => marching.cmd.callBackArmy(ctx, [501]))).toBe(
      'battle.troop_not_stay',
    );
  });
});

describe('callBackToField', () => {
  const marchingTroop = {
    id: 501,
    uid: 1001,
    cid: 9355,
    hid: 80213,
    targetcid: 9301,
    task: 7,
    state: 0,
    soldiers: '1,3,100',
    starttime: 999000,
    battlefieldid: 11,
    startcid: 9355,
    battleunionid: 2,
    bid: 1001,
  };

  const rulesFor = (troop: Respond['rows'], reinforce: string): Respond[] => [
    { match: /from sys_troops where id = \? and uid = \?/i, rows: troop },
    {
      match: /group_concat\(sid, ',', count\)/i,
      rows: reinforce === '' ? [] : [{ v: reinforce }],
      params: [501],
    },
    NO(/.*/),
  ];

  it('recalls a marching army from its start city, refunding honour WITHOUT a report', async () => {
    const { cmd, db } = build(rulesFor([marchingTroop], '3,500'));
    const res = await cmd.callBackToField(ctx, [501, 11]);
    expect(res).toEqual(['军队正在返回出发城池，请到出征面板中查看。']);
    // the whole reinforce stack is refunded → soldiers '' → backhonour floor(100*1/100)=1
    const update = db.executed.find((e) =>
      /update sys_troops set state = 1, soldiers/i.test(e.sql),
    );
    expect(update?.parameters).toEqual(['', 501]);
    expect(
      db.executed.some((e) =>
        /endtime = unix_timestamp\(\) - starttime \+ unix_timestamp\(\)/i.test(e.sql),
      ),
    ).toBe(true);
    expect(db.executed.some((e) => /update sys_user set honour/i.test(e.sql))).toBe(true);
    expect(db.executed.some((e) => /insert into sys_report/i.test(e.sql))).toBe(false);
  });

  it('away from the start city: only the state flips, soldiers and honour untouched', async () => {
    const away = { ...marchingTroop, cid: 9301 };
    const { cmd, db } = build(rulesFor([away], '3,500'));
    const res = await cmd.callBackToField(ctx, [501, 11]);
    expect(res).toEqual(['军队正在返回出发城池，请到出征面板中查看。']);
    const update = db.executed.find((e) => /update sys_troops set state = 1,/i.test(e.sql));
    expect(update?.parameters).toEqual([501]);
    expect(db.executed.some((e) => /update sys_user set honour/i.test(e.sql))).toBe(false);
  });

  it('guards: not marching → troop_not_ahead; chibi (11000) → the empty remote error', async () => {
    const { cmd } = build(rulesFor([{ ...marchingTroop, state: 4 }], ''));
    expect(await errKeyOf(() => cmd.callBackToField(ctx, [501, 11]))).toBe(
      'battle.troop_not_ahead',
    );
    expect(await errKeyOf(() => cmd.callBackToField(ctx, [501, 11000]))).toBe('raw:');
  });
});

describe('addArmyFromReinforce', () => {
  const rulesFor = (pool: string, troop: Respond['rows']): Respond[] => [
    { match: /select reinforce_soldiers as v from sys_battle_city/i, rows: [{ v: pool }] },
    { match: /select soldiers, ulimit from sys_troops/i, rows: troop },
    { match: /from sys_city_technic/i, rows: [] },
    { match: /from cfg_soldier where fromcity = 1/i, rows: [{ sid: 3, speed: 300 }] },
    NO(/.*/),
  ];

  it('tops the army up from the pool without an ulimit and rewrites the pool', async () => {
    const { cmd, db } = build(rulesFor('2,3,50,7,10', [{ soldiers: '1,3,10', ulimit: 0 }]));
    const res = await cmd.addArmyFromReinforce(ctx, [9355, 501, 3]);
    expect(res).toEqual(['补充兵力成功。']);
    const troopUpdate = db.executed.find((e) => /update sys_troops set soldiers/i.test(e.sql));
    expect(troopUpdate?.parameters[0]).toBe('1,3,60');
    const poolUpdate = db.executed.find((e) =>
      /update sys_battle_city set reinforce_soldiers/i.test(e.sql),
    );
    expect(poolUpdate?.parameters).toEqual(['1,7,10', 9355]);
    expect(
      db.executed.some((e) =>
        /^insert into sys_battle_reinforce \(troopid, sid, count\)/i.test(e.sql),
      ),
    ).toBe(true);
  });

  it('caps by ulimit over the army size', async () => {
    const { cmd, db } = build(rulesFor('2,3,50,7,10', [{ soldiers: '1,3,10', ulimit: 20 }]));
    await cmd.addArmyFromReinforce(ctx, [9355, 501, 3]);
    const troopUpdate = db.executed.find((e) => /update sys_troops set soldiers/i.test(e.sql));
    expect(troopUpdate?.parameters[0]).toBe('1,3,20'); // 10 + min(50, 20-10)
    const poolUpdate = db.executed.find((e) =>
      /update sys_battle_city set reinforce_soldiers/i.test(e.sql),
    );
    expect(poolUpdate?.parameters[0]).toBe('2,3,40,7,10');
  });

  it('guards: cap reached → soldier_uplimit, missing sid → no_reinforce, empty troop → troop_not_exist', async () => {
    const { cmd } = build(rulesFor('2,3,50', [{ soldiers: '1,3,10', ulimit: 5 }]));
    expect(await errKeyOf(() => cmd.addArmyFromReinforce(ctx, [9355, 501, 3]))).toBe(
      'battle.soldier_uplimit',
    );
    const noSid = build(rulesFor('1,7,10', [{ soldiers: '1,3,10', ulimit: 0 }]));
    expect(await errKeyOf(() => noSid.cmd.addArmyFromReinforce(ctx, [9355, 501, 3]))).toBe(
      'battle.no_reinforce',
    );
    const emptyTroop = build(rulesFor('1,3,50', [{ soldiers: '0', ulimit: 0 }]));
    expect(await errKeyOf(() => emptyTroop.cmd.addArmyFromReinforce(ctx, [9355, 501, 3]))).toBe(
      'battle.troop_not_exist',
    );
  });
});

describe('callArmy', () => {
  const battleRow = {
    unionid: 2,
    battlefieldid: 11,
    honour: 100,
    bid: 1001,
    type: 0,
    state: 0,
    progress: 0,
    level: 1,
  };
  const troopRow = {
    id: 501,
    uid: 1001,
    cid: 9355,
    hid: 80213,
    targetcid: 9355,
    task: 9,
    state: 4,
    soldiers: '1,3,10',
    battlefieldid: 11,
    startcid: 209355,
    battleunionid: 2,
    bid: 1001,
  };

  const rulesFor = (troop: Respond['rows'], goods = 5): Respond[] => [
    { match: /from sys_user_battle_state s/i, rows: [battleRow] },
    {
      match: /from sys_troops\s+where id = \?[\s\S]*?and uid = \? and battlefieldid = \?/i,
      rows: troop,
    },
    {
      match: /from sys_goods\s+where uid = \? and gid = \?/i,
      rows: [{ v: goods }],
      params: [1001, 135],
    },
    { match: /from sys_city_technic/i, rows: [] },
    { match: /from sys_city_hero where hid = \?/i, rows: [{ speed_add_on: 0 }] },
    { match: /from cfg_soldier where fromcity = 1/i, rows: [{ sid: 3, speed: 300 }] },
    NO(/.*/),
  ];

  it('summons soldiers, charging honour and one 援军令 tier', async () => {
    const { cmd, db } = build(rulesFor([troopRow]));
    const res = await cmd.callArmy(ctx, [501, 3, 50]);
    expect(res).toEqual([1, 501, '1,3,60', 99, '调遣援军成功。']);
    expect(db.executed.some((e) => /insert into `log_goods`/i.test(e.sql))).toBe(true); // reduceGoods 135
    expect(db.executed.some((e) => /update sys_user set honour = honour - \?/i.test(e.sql))).toBe(
      true,
    );
    const troopUpdate = db.executed.find((e) => /update sys_troops set soldiers/i.test(e.sql));
    expect(troopUpdate?.parameters[0]).toBe('1,3,60');
  });

  it('charges the tier-2 援军令 count for heavy summons', async () => {
    // count=40 of sid 12: value = 40*2900 = 116000 → tier 2; needHonour = ceil(40*8/100) = 4
    const { cmd, db } = build(rulesFor([troopRow], 9));
    await cmd.callArmy(ctx, [501, 12, 40]);
    const reduce = db.executed.find((e) => /insert into `log_goods`/i.test(e.sql));
    expect(reduce?.parameters).toEqual([1001, 135, -2, 0]);
    const honour = db.executed.find((e) => /update sys_user set honour = honour - \?/i.test(e.sql));
    expect(honour?.parameters).toEqual([4, 1001]);
    const troopUpdate = db.executed.find((e) => /update sys_troops set soldiers/i.test(e.sql));
    expect(troopUpdate?.parameters[0]).toBe('2,3,10,12,40');
  });

  it('guards: over the cap → call_army_max; goods short → raw 135#N', async () => {
    // count1 = 100*100/1 = 10000, count2 = 1000-10 → 990
    const capped = build(rulesFor([troopRow]));
    expect(await errKeyOf(() => capped.cmd.callArmy(ctx, [501, 3, 991]))).toBe(
      'battle.call_army_max',
    );
    const goodsShort = build(rulesFor([troopRow], 0));
    expect(await errKeyOf(() => goodsShort.cmd.callArmy(ctx, [501, 3, 50]))).toBe(
      'raw:not_enough_goods135#1',
    );
    // NOTE: the call_army_not_enough_honour check is the original's defensive dead branch —
    // for count ≤ maxCall = honour*100/people, ceil(count*people/100) ≤ honour always holds.
  });

  it('guards: fighting/returning/forward armies cannot take reinforcements', async () => {
    const fighting = build(rulesFor([{ ...troopRow, state: 3 }]));
    expect(await errKeyOf(() => fighting.cmd.callArmy(ctx, [501, 3, 1]))).toBe(
      'battle.troop_in_fight',
    );
    const returning = build(rulesFor([{ ...troopRow, state: 1 }]));
    expect(await errKeyOf(() => returning.cmd.callArmy(ctx, [501, 3, 1]))).toBe(
      'battle.troop_in_back_no_call',
    );
    const forward = build(rulesFor([{ ...troopRow, task: 7, state: 0 }]));
    expect(await errKeyOf(() => forward.cmd.callArmy(ctx, [501, 3, 1]))).toBe(
      'battle.troop_in_forward_no_call',
    );
  });
});

describe('fasterArmy', () => {
  const battleRow = {
    unionid: 2,
    battlefieldid: 11,
    honour: 50,
    bid: 1001,
    type: 0,
    state: 0,
    progress: 0,
    level: 1,
  };

  const rulesFor = (troop: Respond['rows'], goods = 3): Respond[] => [
    { match: /from sys_user_battle_state s/i, rows: [battleRow] },
    {
      match: /from sys_troops\s+where id = \?[\s\S]*?and uid = \?[\s\S]*?and battlefieldid = \?/i,
      rows: troop,
    },
    {
      match: /from sys_goods\s+where uid = \? and gid = \?/i,
      rows: [{ count: goods }], // GoodsRules.checkGoods reads the `count` column
      params: [1001, 136],
    },
    {
      match: /select pathtime, endtime, state from sys_troops/i,
      rows: [{ pathtime: 300, endtime: 1000010, state: 0 }],
    },
    NO(/.*/),
  ];

  it('cuts the remaining march to 10s and returns the refreshed state block', async () => {
    const { cmd, db } = build(
      rulesFor([
        { id: 501, uid: 1001, state: 0, endtime: 1000100, now: 1000000, battlefieldid: 11 },
      ]),
    );
    const res = (await cmd.fasterArmy(ctx, [501, 11])) as unknown[];
    const update = db.executed.find((e) =>
      /update sys_troops set endtime = unix_timestamp\(\) \+ 10/i.test(e.sql),
    );
    expect(update?.parameters).toEqual([501]);
    expect(res[0]).toEqual({ pathtime: 300, endtime: 1000010, state: '前进' });
    expect(res[1]).toBe('加速行军成功，军队马上就要到达目的地。');
    expect(db.executed.some((e) => /insert into `log_goods`/i.test(e.sql))).toBe(true);
  });

  it('guards: not marching → troop_not_in_move; <10s left → troop_not_need_faster; no goods → raw 136', async () => {
    const staying = build(
      rulesFor([
        { id: 501, uid: 1001, state: 4, endtime: 1000100, now: 1000000, battlefieldid: 11 },
      ]),
    );
    expect(await errKeyOf(() => staying.cmd.fasterArmy(ctx, [501, 11]))).toBe(
      'battle.troop_not_in_move',
    );
    const almost = build(
      rulesFor([
        { id: 501, uid: 1001, state: 0, endtime: 1000005, now: 1000000, battlefieldid: 11 },
      ]),
    );
    expect(await errKeyOf(() => almost.cmd.fasterArmy(ctx, [501, 11]))).toBe(
      'battle.troop_not_need_faster',
    );
    const noGoods = build(
      rulesFor(
        [{ id: 501, uid: 1001, state: 0, endtime: 1000100, now: 1000000, battlefieldid: 11 }],
        0,
      ),
    );
    expect(await errKeyOf(() => noGoods.cmd.fasterArmy(ctx, [501, 11]))).toBe(
      'raw:not_enough_goods136',
    );
  });
});

describe('getFasterGoodInfo / fasterChibiArmy / fasterMenghuoArmy', () => {
  it('returns the cfg_shop row of the speedup goods', async () => {
    const { cmd } = build([
      {
        match: /from cfg_shop where onsale = 1 and gid = \?/i,
        rows: [{ gid: 136, name: '急行军令', onsale: 1 }],
      },
      NO(/.*/),
    ]);
    const res = await cmd.getFasterGoodInfo(ctx, [136]);
    expect(res[0]).toMatchObject({ gid: 136, name: '急行军令' });
  });

  it('the chibi/menghuo branches throw the empty remote error only for their bids', async () => {
    const { cmd } = build([NO(/.*/)]);
    expect(await errKeyOf(() => cmd.fasterChibiArmy(ctx, [501, 11000]))).toBe('raw:');
    // the original compares loosely — the string '11000' reaches the branch too
    expect(await errKeyOf(() => cmd.fasterChibiArmy(ctx, [501, '11000']))).toBe('raw:');
    expect(await cmd.fasterChibiArmy(ctx, [501, 1001])).toBeUndefined();
    expect(await errKeyOf(() => cmd.fasterMenghuoArmy(ctx, [501, 9001]))).toBe('raw:');
    expect(await cmd.fasterMenghuoArmy(ctx, [501, 1001])).toBeUndefined();
  });
});

describe('helpers', () => {
  it('getSoldierMap / getSoldierString / getSoldierPeople round-trip', () => {
    expect(getSoldierMap('')).toEqual(new Map());
    expect(getSoldierMap('0')).toEqual(new Map());
    const m = getSoldierMap('2,3,100,7,50');
    expect(m).toEqual(
      new Map([
        [3, 100],
        [7, 50],
      ]),
    );
    expect(getSoldierString(m)).toBe('2,3,100,7,50');
    m.set(3, 0);
    expect(getSoldierString(m)).toBe('1,7,50');
    expect(getSoldierString(new Map())).toBe('');
    expect(getSoldierPeople('2,3,100,7,50')).toBe(150);
    expect(getSoldierPeople('0')).toBe(0);
  });

  it('enhanceArmy merges, regenerates pathtime and records the reinforcement', async () => {
    const db = new FakeDb([
      { match: /from sys_city_technic/i, rows: [] },
      { match: /from sys_city_hero where hid = \?/i, rows: [{ speed_add_on: 0 }] },
      { match: /from cfg_soldier where fromcity = 1/i, rows: [{ sid: 3, speed: 300 }] },
      NO(/.*/),
    ]);
    const newsoldiers = await enhanceArmy(depsOf(db), 501, '1,3,10', 3, 50, 209355, 80213, 1001);
    expect(newsoldiers).toBe('1,3,60');
    const updates = db.executed.filter((e) => /update sys_troops set soldiers/i.test(e.sql));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.parameters[0]).toBe('1,3,60');
    expect(updates[0]!.parameters[1]).toBe(540); // 162000 / (300*1*1)
    expect(
      db.executed.some((e) => /^delete from sys_battle_reinforce where troopid/i.test(e.sql)),
    ).toBe(true);
    expect(
      db.executed.some((e) =>
        /^insert into sys_battle_reinforce \(troopid, sid, count\)/i.test(e.sql),
      ),
    ).toBe(true);
  });

  it('enhanceArmy refuses a 13th soldier type with the count leading the message', async () => {
    const db = new FakeDb([NO(/.*/)]);
    const full = '12,1,1,2,1,3,1,4,1,5,1,6,1,7,1,8,1,9,1,10,1,11,1,12,1';
    await expect(enhanceArmy(depsOf(db), 501, full, 45, 1, 0, 0)).rejects.toThrow(
      '13种参与，目前最多允许12兵种参战',
    );
  });

  it('resetBattleFieldUid: same union+uid keeps the owner, mixed unions zero it, empty clears it', async () => {
    const sameOwner = new FakeDb([
      {
        match: /from sys_troops\s+where cid = \?/i,
        rows: [
          { uid: 1001, battleunionid: 2 },
          { uid: 1001, battleunionid: 2 },
        ],
      },
      { match: /select uid, unionid from sys_battle_city/i, rows: [{ uid: 0, unionid: 0 }] },
      NO(/.*/),
    ]);
    const r1 = (await resetBattleFieldUid(depsOf(sameOwner), 9355)) as Record<string, unknown>;
    expect(r1).toMatchObject({ uid: 1001, unionid: 2 });
    const upd = sameOwner.executed.find((e) => /update sys_battle_city set uid = \?/i.test(e.sql));
    expect(upd?.parameters).toEqual([1001, 2, 2, 1, 9355]);

    const mixed = new FakeDb([
      {
        match: /from sys_troops\s+where cid = \?/i,
        rows: [
          { uid: 1001, battleunionid: 2 },
          { uid: 1002, battleunionid: 4 },
        ],
      },
      { match: /select uid, unionid from sys_battle_city/i, rows: [{ uid: 1001, unionid: 2 }] },
      NO(/.*/),
    ]);
    expect(await resetBattleFieldUid(depsOf(mixed), 9355)).toBe(0);
    const zeroed = mixed.executed.find((e) =>
      /update sys_battle_city set uid = 0, unionid = 0/i.test(e.sql),
    );
    expect(zeroed).toBeDefined();

    const blank = new FakeDb([
      { match: /from sys_troops\s+where cid = \?/i, rows: [] },
      { match: /select uid, unionid from sys_battle_city/i, rows: [{ uid: 1001, unionid: 2 }] },
      NO(/.*/),
    ]);
    const r3 = (await resetBattleFieldUid(depsOf(blank), 9355)) as Record<string, unknown>;
    expect(r3).toMatchObject({ oriuid: 1001, uid: '-1', unionid: '-1' });
    expect(blank.executed.some((e) => /update sys_battle_city set uid = -1/i.test(e.sql))).toBe(
      true,
    );
  });
});
