import { describe, expect, it } from 'vitest';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { UserRules } from '../core/user-rules.service';
import { TaskGoals } from '../task/task-goals.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { BattlefieldMetaCommands } from './battlefield-meta.commands';

/** Whitespace-tolerant SQL matcher: metacharacters escaped, every space matches any whitespace. */
const rx = (pattern: string, flags = 'i') =>
  new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ +/g, '\\s+'), flags);

const lang = new LangService({
  battle: {
    user_not_in_battle: '你已经不在战场中或者战场已经结束。',
    battle_froze: '战场已经结束。',
    troop_not_exist: '战场中没有当前你所选择的这支军队。',
    only_talk_in_same_city: '只能与同一据点中的将领交谈。',
    too_frequent_talk: '你交谈过于频繁了。',
    defaut_chat_msg: '将军有何贵干，无事请回。',
    all_unions: '所有',
    state_in: '参加',
    state_invite: '邀请中',
    '8001_wood_state': '工场监官：将军汝等已运来  %s 木材,还剩 %s 木材,还剩  %s 分钟。',
  },
  buyGoods: {
    invalid_amount: '购买数量无效。',
    stop_sale: '此商品已经停售。',
    sold_out: '此商品已经卖光了。',
    no_enough_Credit: '你的荣誉值不够，不能购买此商品',
    no_enough_Medal: '你的%s不够，不能购买此商品',
    can_not_exchange: '此商品已经不能用勋章兑换。',
    only_one_goods: '此商品只能购买1个',
    no_enough_Exploit: '您的功勋不足以购买此商品',
    no_enough_gongxun: '您的勋绩不足以购买此商品',
    no_enough_chibi_gongxun: '您的赤壁功勋不足以购买此商品',
    no_enough_Level: '您当前的跨服战场等级不符合购买要求',
    no_enough_achievement_Level: '您当前的七擒孟获战场成就等级不符合购买要求',
    unsuccessful: '购买失败',
    nobility_limit: '只有爵位达到“公士”才能购买和使用“聚贤包”。',
    armor_box_full: '装备栏已满',
    reach_remain_amountLimit:
      '购买数量无效。此商品每人限购%d个，你已经购买%d个，只能再购买%d个此商品。',
    reach_buy_limit: '此商品每人限购%d个，你已经达到购买限制，不能再购买更多此商品。',
  },
  recruitHero: { hotel_level_low: '招贤馆等级不够，不能容纳更多的将领。' },
});

const ctx = (uid = 1001) => ({ uid, cid: 0, ip: 0, sip: '' });
const NO = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const cmd = new BattlefieldMetaCommands(
    db.scope,
    lang,
    new GoodsRules(db.scope),
    new TaskGoals(db.scope, new UserRules(db.scope)),
    new UserRules(db.scope),
  );
  return { cmd, db };
}

/** The battleinfo row firstGetUserBattleInfo answers for an in-battle player. */
const IN_BATTLE = (over: Record<string, unknown> = {}) => [
  {
    honour: 100,
    unionid: 3,
    battlefieldid: 12,
    bid: 8001,
    createuid: 1001,
    level: 2,
    maxpeople: 50,
    starttime: 0,
    endtime: 0,
    type: 1,
    state: 0,
    winner: null,
    in_cross_battle: 0,
    name: '凤仪亭',
    ...over,
  },
];

describe('BattlefieldMetaCommands.refreshBattleTaskState', () => {
  it('checks the open 609xx tasks and reports per-city min state', async () => {
    const { cmd, db } = build([
      {
        match: rx('select tid as id from sys_user_task where uid = ? and state = 0 and tid in'),
        rows: [{ id: 60901 }, { id: 60902 }],
      },
      // goal of task 60901 recorded → complete; goal of 60902 missing → not
      {
        match: rx('from cfg_task_goal g left join sys_user_goal u'),
        params: [1001, 60901],
        rows: [
          { id: 9001, tid: 60901, sort: 0, type: 1, count: '5', uid: 1001, currentcount: null },
        ],
      },
      {
        match: rx('from cfg_task_goal g left join sys_user_goal u'),
        params: [1001, 60902],
        rows: [
          { id: 9002, tid: 60902, sort: 0, type: 1, count: '5', uid: null, currentcount: null },
        ],
      },
      NO(rx('select 1 from cfg_task_goal where tid = ? and sort = ?')),
      {
        match: rx('from cfg_task_cid'),
        rows: [{ cid: 355, state: 3 }],
      },
    ]);
    const res = await cmd.refreshBattleTaskState(ctx());
    expect(res).toEqual([{ cid: 355, state: 3 }]);
    // finishedTidStr only carries the completed task; allTidStr carries both (PHP builds "0,…")
    const finalQuery = db.executed.find((q) => /from cfg_task_cid/.test(q.sql))!;
    expect(finalQuery.parameters).toEqual([0, 60901, 0, 60901, 60902]);
    // checkTaskComplete raised the alarm once
    expect(db.executed.some((q) => /insert into sys_alarm/.test(q.sql))).toBe(true);
  });
});

describe('BattlefieldMetaCommands.getLastMainTask', () => {
  it('returns the 60901-60914 chain for bid 9001 and nothing otherwise', async () => {
    const rows = [{ name: '运木', todo: '上交木材', id: 60901, count: 5000, type: 83, sort: 100 }];
    const { cmd, db } = build([
      { match: rx('from sys_user_task sys left join cfg_task cfg'), rows },
      NO(/.*/),
    ]);
    expect(await cmd.getLastMainTask(ctx(), [9001])).toEqual(rows);
    expect(await cmd.getLastMainTask(ctx(), ['9001'])).toEqual(rows); // loose ==, as PHP
    expect(await cmd.getLastMainTask(ctx(), [2001])).toEqual([]);
    expect(db.executed.filter((q) => /from sys_user_task sys/.test(q.sql)).length).toBe(2);
  });
});

describe('BattlefieldMetaCommands.chatWithHero', () => {
  // The shared rules of a successful talk: own garrisoned troop + target troop in the same city.
  const TROOP_RULES = (target: Record<string, unknown>): Respond[] => [
    {
      match: rx('from sys_troops where id = ? and (state = 3 or state = 4)'),
      params: [501],
      rows: [{ id: 501, cid: 83556, battleunionid: 3, hid: 80213 }],
    },
    {
      match: rx(
        'select cid, id, uid, hid, state, bid, battlefieldid, battleunionid from sys_troops where id = ?',
      ),
      params: [601],
      rows: [target],
    },
    { match: rx('from sys_user_battle_state u'), rows: IN_BATTLE() },
  ];
  const DEFAULT_TARGET = {
    cid: 83556,
    id: 601,
    uid: 0,
    hid: 1234,
    state: 4,
    bid: 8001,
    battlefieldid: 12,
    battleunionid: 3,
  };

  it('talks through cfg_battle_event triggertype=8 and fires the event_type=8 trigger', async () => {
    const { cmd, db } = build([
      ...TROOP_RULES(DEFAULT_TARGET),
      {
        match: rx('triggertype = 8 and targettype = 0 and triggerid = ?'),
        params: [8001, 1234],
        rows: [{ id: 1, msg: '你好，勇士。', targettype2: 0, targetid1_option: '0' }],
      },
      NO(rx('select sex, face from cfg_battle_hero where hid = ?')),
      NO(rx('select sex, face from sys_city_hero where hid = ?')),
      NO(/.*/),
    ]);
    // the face fetch stays unanswered → false, exactly like the original's empty fetch
    expect(await cmd.chatWithHero(ctx(), [501, 601])).toEqual([false, '你好，勇士。']);
    const event = db.executed.find((q) => /insert into mem_battle_event/.test(q.sql))!;
    expect(event.parameters).toEqual([501, 1001, 8001, 12, 3, 1234, 8]);
  });

  it('falls back to the default line when no event passes', async () => {
    const { cmd } = build([
      ...TROOP_RULES(DEFAULT_TARGET),
      {
        match: rx('triggertype = 8 and targettype = 0 and triggerid = ?'),
        params: [8001, 1234],
        rows: [],
      },
      {
        match: rx('select sex, face from cfg_battle_hero where hid = ?'),
        params: [1234],
        rows: [{ sex: 1, face: 7 }],
      },
      NO(/.*/),
    ]);
    expect(await cmd.chatWithHero(ctx(), [501, 601])).toEqual([
      { sex: 1, face: 7 },
      '将军有何贵干，无事请回。',
    ]);
  });

  it('renders the option hero face and the event msg', async () => {
    const { cmd } = build([
      ...TROOP_RULES(DEFAULT_TARGET),
      {
        match: rx('triggertype = 8 and targettype = 0 and triggerid = ?'),
        params: [8001, 1234],
        rows: [
          { id: 1, msg: '第一句', targettype2: 0, targetid1_option: '8056' },
          { id: 2, msg: '任务完成才有', targettype2: 6, targetid2: 60901, targetid1_option: '-1' },
        ],
      },
      {
        match: rx('from cfg_battle_hero where hid = ?'),
        params: [8056],
        rows: [{ sex: 1, face: 7 }],
      },
      {
        match: rx('from sys_city_hero where hid = ?'),
        params: [80213],
        rows: [{ sex: 0, face: 3 }],
      },
      {
        match: rx('select id as v from cfg_task_goal where tid = ?'),
        params: [60901],
        rows: [{ v: 9001 }],
      },
      {
        match: rx('select 1 from sys_user_goal where uid = ? and gid = ?'),
        params: [1001, 9001],
        rows: [{ 1: 1 }],
      },
      NO(/.*/),
    ]);
    // pass → option face for event 1, own-hero face for event 2 (targetid1_option < 0)
    expect(await cmd.chatWithHero(ctx(), [501, 601])).toEqual([
      { sex: 1, face: 7 },
      '第一句',
      { sex: 0, face: 3 },
      '任务完成才有',
    ]);
  });

  it('fails on a missing target troop or a different 据点', async () => {
    const { cmd } = build([...TROOP_RULES({ ...DEFAULT_TARGET, cid: 83557 }), NO(/.*/)]);
    await expect(cmd.chatWithHero(ctx(), [501, 999])).rejects.toMatchObject({
      key: 'battle.troop_not_exist',
    });
    await expect(cmd.chatWithHero(ctx(), [501, 601])).rejects.toMatchObject({
      key: 'battle.only_talk_in_same_city',
    });
  });

  it('rejects a frozen battlefield', async () => {
    const { cmd } = build([
      // the frozen battleinfo rule wins over TROOP_RULES's own (first match wins)
      { match: rx('from sys_user_battle_state u'), rows: IN_BATTLE({ state: 1 }) },
      ...TROOP_RULES(DEFAULT_TARGET).filter(
        (r) => !/sys_user_battle_state u/.test(String(r.match)),
      ),
      NO(/.*/),
    ]);
    await expect(cmd.chatWithHero(ctx(), [501, 601])).rejects.toMatchObject({
      key: 'battle.battle_froze',
    });
  });

  it('keeps the hid=7001 talk cooldown (and does not stamp the mark within 300s)', async () => {
    const { cmd, db } = build([
      ...TROOP_RULES({ ...DEFAULT_TARGET, bid: 7001 }),
      {
        match: rx(
          'from mem_battle_event_mark where battlefieldid = ? and mark_id = ? and option1 = ?',
        ),
        params: [12, 2, 1234],
        rows: [{ id: 9, time: 1_000_000 }],
      },
      { match: rx('select unix_timestamp'), rows: [{ v: 1_000_100 }] }, // 100s < 300s
      NO(/.*/),
    ]);
    await expect(cmd.chatWithHero(ctx(), [501, 601])).rejects.toMatchObject({
      key: 'battle.too_frequent_talk',
    });
    expect(db.executed.some((q) => /update mem_battle_event_mark set `time`/.test(q.sql))).toBe(
      false,
    );
  });

  it('hid=8056: moves the wood onto the supervisor and fires event 10000 at level*5000', async () => {
    const { cmd, db } = build([
      ...TROOP_RULES({ ...DEFAULT_TARGET, hid: 8056 }),
      // own troop carries 4000 wood, supervisor already holds 7000 → 11000 ≥ 10000 (level 2 × 5000)
      { match: rx('from sys_troop_things where troop_id = ?'), params: [501], rows: [{ v: 4000 }] },
      { match: rx('from sys_troop_things where troop_id = ?'), params: [601], rows: [{ v: 7000 }] },
      { match: rx('GREATEST'), params: [12], rows: [{ v: 7 }] },
      NO(rx('select sex, face from cfg_battle_hero where hid = ?')),
      NO(/.*/),
    ]);
    const res = (await cmd.chatWithHero(ctx(), [501, 601])) as unknown[];
    // totalCnt clamps at reqCnt; the leftover minutes read from mark 101
    expect(res).toEqual([false, '工场监官：将军汝等已运来  10000 木材,还剩 0 木材,还剩  7 分钟。']);
    const events = db.executed.filter((q) => /insert into mem_battle_event/.test(q.sql));
    expect(events.map((e) => e.parameters[6])).toEqual([10000, 8]);
    expect(events[0]!.parameters).toEqual([501, 1001, 8001, 12, 3, 8056, 10000]);
    // the wood transfer: insert on the supervisor troop (uid 0, tid 83) and clear the own troop
    const transfer = db.executed.find((q) => /insert into sys_troop_things/.test(q.sql))!;
    expect(transfer.parameters).toEqual([0, 601, 83, 4000, 4000]); // cnt twice: values + on-duplicate
    expect(
      db.executed.some(
        (q) => /delete from sys_troop_things/.test(q.sql) && q.parameters[0] === 501,
      ),
    ).toBe(true);
  });

  it('hid=8056: no wood yet → no 10000 event and an empty minutes placeholder', async () => {
    const { cmd, db } = build([
      ...TROOP_RULES({ ...DEFAULT_TARGET, hid: 8056 }),
      { match: rx('from sys_troop_things where troop_id = ?'), params: [501], rows: [] },
      { match: rx('from sys_troop_things where troop_id = ?'), params: [601], rows: [] },
      { match: rx('GREATEST'), rows: [] }, // no mark row → PHP sprintf %s of false = ''
      NO(rx('select sex, face from cfg_battle_hero where hid = ?')),
      NO(/.*/),
    ]);
    const res = (await cmd.chatWithHero(ctx(), [501, 601])) as unknown[];
    expect(res).toEqual([false, '工场监官：将军汝等已运来  0 木材,还剩 10000 木材,还剩   分钟。']);
    expect(db.executed.filter((q) => /insert into mem_battle_event/.test(q.sql)).length).toBe(1);
  });

  it('hid=5050: the literal branch without the targettype=0 filter', async () => {
    const { cmd, db } = build([
      ...TROOP_RULES({ ...DEFAULT_TARGET, hid: 5050 }),
      {
        // no `targettype = 0` in this query — assert by matching its exact shape
        match: rx('triggertype = 8 and triggerid = ?'),
        params: [8001, 5050],
        rows: [{ id: 1, msg: '陶谦有请。', targettype2: 0, targetid1_option: '0' }],
      },
      NO(rx('triggertype = 8 and targettype = 0')),
      {
        match: rx('from cfg_battle_hero where hid = ?'),
        params: [5050],
        rows: [{ sex: 1, face: 9 }],
      },
      NO(/.*/),
    ]);
    expect(await cmd.chatWithHero(ctx(), [501, 601])).toEqual([{ sex: 1, face: 9 }, '陶谦有请。']);
    const event = db.executed.find((q) => /insert into mem_battle_event/.test(q.sql))!;
    expect(event.parameters[6]).toEqual(8);
  });
});

describe('BattlefieldMetaCommands.getBattleHonourStat', () => {
  it('answers null on a story battlefield (type != 1)', async () => {
    const { cmd } = build([
      { match: rx('from sys_user_battle_state u'), rows: IN_BATTLE({ bid: 1001, type: 0 }) },
      NO(/.*/),
    ]);
    expect(await cmd.getBattleHonourStat(ctx())).toBeUndefined();
  });

  it('computes floor(10·honour/avg) per camp', async () => {
    const { cmd } = build([
      { match: rx('from sys_user_battle_state u'), rows: IN_BATTLE({ bid: 2001 }) },
      {
        match: rx('FLOOR(AVG(honour)) AS avgHonour, b.name'),
        rows: [
          { unionid: 3, avgHonour: 50, name: '袁' },
          { unionid: 4, avgHonour: 25, name: '曹' },
        ],
      },
      {
        match: rx('b.uid AS uid, a.unionid, b.name AS name, a.honour'),
        rows: [
          { uid: 1, unionid: 3, name: '甲', honour: 100 },
          { uid: 2, unionid: 3, name: '乙', honour: 20 },
          { uid: 3, unionid: 4, name: '丙', honour: 10 },
        ],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.getBattleHonourStat(ctx())) as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(res[0]).toEqual({
      '3': { unionid: 3, avgHonour: 50, name: '袁' },
      '4': { unionid: 4, avgHonour: 25, name: '曹' },
    });
    expect(res[1]['3']).toEqual([
      { uid: 1, unionid: 3, name: '甲', honour: 100, contribute: 20 },
      { uid: 2, unionid: 3, name: '乙', honour: 20, contribute: 4 },
    ]);
    expect(res[1]['4']).toEqual([{ uid: 3, unionid: 4, name: '丙', honour: 10, contribute: 4 }]);
  });

  it('a camp missing from the averages contributes 0 (PHP null == 0)', async () => {
    const { cmd } = build([
      { match: rx('from sys_user_battle_state u'), rows: IN_BATTLE({ bid: 2001 }) },
      {
        match: rx('FLOOR(AVG(honour)) AS avgHonour, b.name'),
        rows: [{ unionid: 3, avgHonour: 50, name: '袁' }],
      },
      {
        match: rx('b.uid AS uid, a.unionid, b.name AS name, a.honour'),
        rows: [{ uid: 9, unionid: 9, name: ' outsider', honour: 999 }],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.getBattleHonourStat(ctx())) as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(res[1]['9']).toEqual([
      { uid: 9, unionid: 9, name: ' outsider', honour: 999, contribute: 0 },
    ]);
  });

  it('bid 6001 folds all camps into 所有', async () => {
    const { cmd } = build([
      { match: rx('from sys_user_battle_state u'), rows: IN_BATTLE({ bid: 6001 }) },
      {
        match: rx('SELECT 0 as unionid, FLOOR(AVG(honour)) AS avgHonour'),
        rows: [{ unionid: 0, avgHonour: 40 }],
      },
      {
        match: rx('b.uid AS uid, 0 AS unionid, b.name AS name, a.honour'),
        rows: [{ uid: 1, unionid: 0, name: '甲', honour: 40 }],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.getBattleHonourStat(ctx())) as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(res[0]['0']).toEqual({ unionid: 0, avgHonour: 40, name: '所有' });
    expect(res[1]['0']).toEqual([{ uid: 1, unionid: 0, name: '甲', honour: 40, contribute: 10 }]);
  });
});

describe('BattlefieldMetaCommands.getBattleFieldUsers', () => {
  it('merges participants and invites, flags the creator', async () => {
    const { cmd } = build([
      { match: rx('from sys_user_battle_state u'), rows: IN_BATTLE() },
      {
        match: rx('from sys_user_battle_state s'),
        rows: [
          { uid: 1002, honour: null, name: '乙', camp: '袁' },
          { uid: 1001, honour: 5, name: '甲', camp: '袁' },
        ],
      },
      {
        match: rx('from sys_troops where uid = ? and battlefieldid = ?'),
        params: [1002, 12],
        rows: [{ v: 2 }],
      },
      {
        match: rx('from sys_troops where uid = ? and battlefieldid = ?'),
        params: [1001, 12],
        rows: [{ v: 0 }],
      },
      { match: rx('from sys_battle_invite i'), rows: [{ id: 3, name: '丙', honour: '0' }] },
      NO(/.*/),
    ]);
    const res = (await cmd.getBattleFieldUsers(ctx(), [12])) as unknown[];
    expect(res[1]).toBe(2);
    expect(res[2]).toBe(true);
    // rows come back in scripted (order by s.uid) order — the port adds no client-side re-sort
    expect(res[0]).toEqual([
      { uid: 1002, honour: 0, name: '乙', camp: '袁', herocount: 2, state: '参加', cancel: false },
      { uid: 1001, honour: 5, name: '甲', camp: '袁', herocount: 0, state: '参加', cancel: false },
      { id: 3, name: '丙', honour: 0, herocount: 0, state: '邀请中', cancel: true },
    ]);
  });

  it('invites are not cancellable for a non-creator', async () => {
    const { cmd } = build([
      { match: rx('from sys_user_battle_state u'), rows: IN_BATTLE({ createuid: 9999 }) },
      { match: rx('from sys_user_battle_state s'), rows: [] },
      { match: rx('from sys_battle_invite i'), rows: [{ id: 3, name: '丙', honour: 0 }] },
      NO(/.*/),
    ]);
    const res = (await cmd.getBattleFieldUsers(ctx(), [])) as unknown[];
    expect(res[1]).toBe(0);
    expect(res[2]).toBe(false);
    expect((res[0] as unknown[])[0]).toMatchObject({ state: '邀请中', cancel: false });
  });
});

describe('BattlefieldMetaCommands.getUserBattleShopInfo', () => {
  const OPEN_BATTLES = [
    { id: 1001, type: 0, state: 1, maxcount: 5, name: '黄巾之乱' },
    { id: 2001, type: 1, state: 1, maxcount: 5, name: '官渡之战' },
  ];

  it('outside a battlefield: nobility gate, canCreate and the disabled-net tallies', async () => {
    const { cmd } = build([
      { match: rx('from sys_user_battle_state u'), rows: [] }, // firstGetUserBattleInfo(false)
      { match: rx('select nobility as v from sys_user'), rows: [{ v: 2 }] },
      NO(rx('from mem_user_buffer')), // no 推恩令 buffer
      {
        match: rx(
          'select * from cfg_battle_field where state != 0 and (type = 0 or type = 1 or type = 5) order by id',
        ),
        rows: OPEN_BATTLES,
      },
      {
        match: rx('from sys_user_battle_field where bid = ? and state = 0'),
        params: [1001],
        rows: [{ v: 5 }],
      },
      { match: rx('select today_war_count as v from mem_user_schedule'), rows: [{ v: '2' }] },
      { match: rx('select id from cfg_battle_field'), rows: [{ id: 1001 }, { id: 2001 }] },
      {
        match: rx('FROM cfg_shop a, cfg_things b'),
        rows: [
          {
            id: 30,
            gid: 116,
            position: 1,
            medalTypeId: 30000,
            battleBelong: 1,
            medalName: '汉室勋章',
          },
        ],
      },
      NO(rx('FROM cfg_armor a, cfg_shop b')),
      NO(rx('from cfg_hero a, cfg_shop b')),
      { match: rx('select honour as v from sys_user'), rows: [{ v: 77 }] },
      NO(rx('from sys_user_achivement')),
      NO(rx('tid = 104001')),
      NO(/.*/),
    ]);
    const res = (await cmd.getUserBattleShopInfo(ctx(), [])) as unknown[];
    expect(res[0]).toBe(0); // nobility 2 ≥ 1
    expect(res[1]).toEqual([
      { id: 1001, type: 0, state: 1, maxcount: 5, name: '黄巾之乱', canCreate: false },
      { id: 2001, type: 1, state: 1, maxcount: 5, name: '官渡之战' },
    ]);
    expect(res.slice(2)).toEqual([
      0,
      -1,
      '2',
      5,
      [
        {
          id: 30,
          gid: 116,
          position: 1,
          medalTypeId: 30000,
          battleBelong: 1,
          medalName: '汉室勋章',
        },
      ],
      [],
      [],
      77,
      1,
      0,
    ]);
  });

  it('in a battlefield the nobility gate is skipped (ret[0] = 1)', async () => {
    const { cmd } = build([
      { match: rx('from sys_user_battle_state u'), rows: IN_BATTLE({ bid: 1001, type: 0 }) },
      {
        match: rx(
          'select * from cfg_battle_field where state != 0 and (type = 0 or type = 1 or type = 5) order by id',
        ),
        rows: [],
      },
      { match: rx('select id from cfg_battle_field'), rows: [] },
      NO(rx('FROM cfg_shop a, cfg_things b')),
      NO(rx('FROM cfg_armor a, cfg_shop b')),
      NO(rx('from cfg_hero a, cfg_shop b')),
      { match: rx('select honour as v from sys_user'), rows: [{ v: 0 }] },
      NO(rx('from sys_user_achivement')),
      NO(rx('tid = 104001')),
      NO(/.*/),
    ]);
    const res = (await cmd.getUserBattleShopInfo(ctx(), [])) as unknown[];
    expect(res[0]).toBe(1);
    expect(res[3]).toBe(-1); // getUserBattleNetArea → remote disabled
  });

  it('bid 9001 open merges the 孟获 goods ahead of the medal shop', async () => {
    const { cmd } = build([
      { match: rx('from sys_user_battle_state u'), rows: IN_BATTLE() },
      {
        match: rx(
          'select * from cfg_battle_field where state != 0 and (type = 0 or type = 1 or type = 5) order by id',
        ),
        rows: [],
      },
      { match: rx('select id from cfg_battle_field'), rows: [{ id: 9001 }, { id: 8001 }] },
      {
        match: rx('a.id >= 41001 and a.id <= 41009'),
        rows: [{ id: 41001, gid: 41001, position: 0 }],
      },
      {
        match: rx('FROM cfg_shop a, cfg_things b'),
        rows: [
          {
            id: 30,
            gid: 116,
            position: 1,
            medalTypeId: 30000,
            battleBelong: 8,
            medalName: '汉室勋章',
          },
        ],
      },
      NO(rx('FROM cfg_armor a, cfg_shop b')),
      NO(rx('from cfg_hero a, cfg_shop b')),
      { match: rx('select honour as v from sys_user'), rows: [{ v: 0 }] },
      NO(rx('from sys_user_achivement')),
      { match: rx('tid = 104001'), rows: [{ v: 3 }] },
      NO(/.*/),
    ]);
    const res = (await cmd.getUserBattleShopInfo(ctx(), [])) as unknown[];
    expect(res[6]).toEqual([
      { id: 41001, gid: 41001, position: 0 },
      { id: 30, gid: 116, position: 1, medalTypeId: 30000, battleBelong: 8, medalName: '汉室勋章' },
    ]);
    expect(res[11]).toBe(3); // 沙场积分
  });

  it('getUserBattleShopInfoForChiBi reads the same shop', async () => {
    const { cmd } = build([
      { match: rx('from sys_user_battle_state u'), rows: IN_BATTLE() },
      {
        match: rx(
          'select * from cfg_battle_field where state != 0 and (type = 0 or type = 1 or type = 5) order by id',
        ),
        rows: [],
      },
      { match: rx('select id from cfg_battle_field'), rows: [] },
      NO(rx('FROM cfg_shop a, cfg_things b')),
      NO(rx('FROM cfg_armor a, cfg_shop b')),
      NO(rx('from cfg_hero a, cfg_shop b')),
      { match: rx('select honour as v from sys_user'), rows: [{ v: 0 }] },
      NO(rx('from sys_user_achivement')),
      NO(rx('tid = 104001')),
      NO(/.*/),
    ]);
    const res = (await cmd.getUserBattleShopInfoForChiBi(ctx(), [])) as unknown[];
    expect(res[0]).toBe(1);
  });
});

describe('BattlefieldMetaCommands.buyBattleGoods', () => {
  /** A group-6 honour+medal goods row with configurable prices. */
  const GOODS = (over: Record<string, unknown> = {}) => [
    {
      id: 30,
      group: 6,
      onsale: 1,
      gid: 116,
      pack: 1,
      creditPrice: 10,
      medalPrice: 2,
      medalTypeId: 30000,
      totalCount: 2000000000,
      userbuycnt: 0,
      battleGoodsType: 0,
      ...over,
    },
  ];
  /** The base rules of a group-6 honour+medal purchase; `over` tweaks the goods row, `more`
   * rules are placed BEFORE the base ones (FakeDb is first-match-wins) with NO as the tail. */
  const SHOP_RULES = (over: Record<string, unknown> = {}, more: Respond[] = []): Respond[] => [
    ...more,
    { match: rx('from cfg_shop where id = ? and onsale = 1'), rows: GOODS(over) },
    {
      match: rx('select battleBelong as v from cfg_things where tid = ?'),
      params: [30000],
      rows: [{ v: 1 }],
    },
    { match: rx('select honour, nobility from sys_user'), rows: [{ honour: 100, nobility: 3 }] },
    {
      match: rx('from sys_things where uid = ? and tid = ?'),
      params: [1001, 30000],
      rows: [{ v: 10 }],
    },
    NO(/.*/),
  ];

  it('rejects a bad amount and a closed sale', async () => {
    const { cmd } = build([NO(/.*/)]);
    await expect(cmd.buyBattleGoods(ctx(), [30, 0, 0, 0])).rejects.toMatchObject({
      key: 'buyGoods.invalid_amount',
    });
    await expect(cmd.buyBattleGoods(ctx(), [30, 1, 0, 0])).rejects.toMatchObject({
      key: 'buyGoods.stop_sale',
    });
  });

  it('a normal purchase deducts honour and medals and answers the credit cost', async () => {
    const { cmd, db } = build(SHOP_RULES());
    expect(await cmd.buyBattleGoods(ctx(), [30, 1, 0, 0])).toEqual([10]);
    const honour = db.executed.find((q) => /update sys_user set honour/.test(q.sql))!;
    expect(honour.parameters).toEqual([-10, 1001]);
    // addThings logs the medal spend (Kysely-built insert quotes the table name)
    expect(
      db.executed.some((q) => /insert into `?log_things`?/.test(q.sql) && q.parameters[2] === -2),
    ).toBe(true);
    // addGoods delivers the good (gid 116, log type 2)
    expect(
      db.executed.some((q) => /insert into `?log_goods`?/.test(q.sql) && q.parameters[1] === 116),
    ).toBe(true);
    expect(db.executed.some((q) => /insert into log_shop_buy_cnt/.test(q.sql))).toBe(true);
  });

  it('refuses on short honour and short medals (with the medal name)', async () => {
    const { cmd } = build(
      SHOP_RULES({}, [
        { match: rx('select honour, nobility from sys_user'), rows: [{ honour: 5, nobility: 3 }] },
      ]),
    );
    await expect(cmd.buyBattleGoods(ctx(), [30, 1, 0, 0])).rejects.toMatchObject({
      key: 'buyGoods.no_enough_Credit',
    });

    const noMedal = build(
      SHOP_RULES({}, [
        { match: rx('from sys_things where uid = ? and tid = ?'), params: [1001, 30000], rows: [] },
        {
          match: rx('select name as v from cfg_things where tid = ?'),
          params: [30000],
          rows: [{ v: '汉室勋章' }],
        },
      ]),
    );
    await expect(noMedal.cmd.buyBattleGoods(ctx(), [30, 1, 0, 0])).rejects.toMatchObject({
      key: 'buyGoods.no_enough_Medal',
      args: ['汉室勋章'],
    });
  });

  it('group-7 goods read the 跨服 area level (-1) and are refused', async () => {
    const { cmd } = build([
      {
        match: rx('from cfg_shop where id = ? and onsale = 1'),
        rows: GOODS({ id: 40, group: 7, creditPrice: 5, medalPrice: 0, medalTypeId: 60001 }),
      },
      {
        match: rx('select battleBelong as v from cfg_things where tid = ?'),
        params: [60001],
        rows: [{ v: 6001 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.buyBattleGoods(ctx(), [40, 1, 0, 0])).rejects.toMatchObject({
      key: 'buyGoods.no_enough_Level',
    });
  });

  it('battleBelong 9001 goods read the local achievement level then the remote PVE tally (-1)', async () => {
    const { cmd } = build([
      {
        match: rx('from cfg_shop where id = ? and onsale = 1'),
        rows: GOODS({ id: 41, creditPrice: 3, medalPrice: 1, medalTypeId: 40001 }),
      },
      {
        match: rx('select battleBelong as v from cfg_things where tid = ?'),
        params: [40001],
        rows: [{ v: 9001 }],
      },
      NO(rx('from sys_user_achivement')), // level 1
      NO(/.*/),
    ]);
    await expect(cmd.buyBattleGoods(ctx(), [41, 1, 0, 0])).rejects.toMatchObject({
      key: 'buyGoods.no_enough_achievement_Level',
    });

    const zeroPrice = build([
      {
        match: rx('from cfg_shop where id = ? and onsale = 1'),
        rows: GOODS({ id: 41, creditPrice: 0, medalPrice: 1, medalTypeId: 40001 }),
      },
      {
        match: rx('select battleBelong as v from cfg_things where tid = ?'),
        params: [40001],
        rows: [{ v: 9001 }],
      },
      NO(rx('from sys_user_achivement')),
      NO(/.*/),
    ]);
    await expect(zeroPrice.cmd.buyBattleGoods(ctx(), [41, 1, 0, 0])).rejects.toMatchObject({
      key: 'buyGoods.no_enough_gongxun',
    });
  });

  it('赤壁 armor goods read the 赤壁功勋 (0) and are refused', async () => {
    const { cmd } = build([
      {
        match: rx('from cfg_shop where id = ? and onsale = 1'),
        rows: GOODS({ creditPrice: 10, medalTypeId: 60015 }),
      },
      {
        match: rx('select battleBelong as v from cfg_things where tid = ?'),
        params: [60015],
        rows: [{ v: 2 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.buyBattleGoods(ctx(), [30, 1, 0, 0])).rejects.toMatchObject({
      key: 'buyGoods.no_enough_chibi_gongxun',
    });
  });

  it('id 121 outside the honour branch reads a null nobility → nobility_limit', async () => {
    const { cmd } = build([
      {
        match: rx('from cfg_shop where id = ? and onsale = 1'),
        rows: GOODS({ id: 121, creditPrice: 0, medalPrice: 0, medalTypeId: 60015 }),
      },
      {
        match: rx('select battleBelong as v from cfg_things where tid = ?'),
        params: [60015],
        rows: [{ v: 2 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.buyBattleGoods(ctx(), [121, 1, 0, 0])).rejects.toMatchObject({
      key: 'buyGoods.nobility_limit',
    });
  });

  it('id 121 inside the honour branch uses the fetched nobility', async () => {
    const blocked = build(
      SHOP_RULES({ id: 121, creditPrice: 0, medalPrice: 0 }, [
        {
          match: rx('select honour, nobility from sys_user'),
          rows: [{ honour: 100, nobility: 0 }],
        },
      ]),
    );
    await expect(blocked.cmd.buyBattleGoods(ctx(), [121, 1, 0, 0])).rejects.toMatchObject({
      key: 'buyGoods.nobility_limit',
    });
    const allowed = build(
      SHOP_RULES({ id: 121, creditPrice: 0, medalPrice: 0 }, [
        {
          match: rx('select honour, nobility from sys_user'),
          rows: [{ honour: 100, nobility: 2 }],
        },
      ]),
    );
    expect(await allowed.cmd.buyBattleGoods(ctx(), [121, 1, 0, 0])).toEqual([0]);
  });

  it('sold_out and the per-user purchase cap', async () => {
    const soldOut = build(SHOP_RULES({ totalCount: 0 }));
    await expect(soldOut.cmd.buyBattleGoods(ctx(), [30, 1, 0, 0])).rejects.toMatchObject({
      key: 'buyGoods.sold_out',
    });

    const remain = build(
      SHOP_RULES({ userbuycnt: 3 }, [
        {
          match: rx('from log_shop_buy_cnt where uid = ? and `sid` = ?'),
          params: [1001, 30],
          rows: [{ v: 2 }],
        },
      ]),
    );
    await expect(remain.cmd.buyBattleGoods(ctx(), [30, 2, 0, 0])).rejects.toMatchObject({
      key: 'buyGoods.reach_remain_amountLimit',
      args: [3, 2, 1],
    });

    const reached = build(
      SHOP_RULES({ userbuycnt: 3 }, [
        {
          match: rx('from log_shop_buy_cnt where uid = ? and `sid` = ?'),
          params: [1001, 30],
          rows: [{ v: 3 }],
        },
      ]),
    );
    await expect(reached.cmd.buyBattleGoods(ctx(), [30, 2, 0, 0])).rejects.toMatchObject({
      key: 'buyGoods.reach_buy_limit',
      args: [3],
    });
  });

  it('battleGoodsType 1: buys the armor, and a full set opens the battlefield', async () => {
    const { cmd, db } = build(
      SHOP_RULES({ gid: 20001, battleGoodsType: 1, creditPrice: 5, medalPrice: 1 }, [
        { match: rx('select `armor_column` as v from sys_user'), rows: [{ v: 10 }] },
        {
          match: rx('from sys_user_armor where uid = ? and hid = 0'),
          params: [1001],
          rows: [{ v: 3 }],
        },
        {
          match: rx('from cfg_armor where id = ?'),
          params: [20001],
          rows: [{ id: 20001, ori_hp_max: 50 }],
        },
        {
          match: rx('from cfg_armor a, sys_battle_open_condition b'),
          rows: [{ bid: 1001, battleId: 1001 }],
        },
        {
          match: rx('select a.medalTypeId as v from cfg_shop a, cfg_things b'),
          params: [20001],
          rows: [{ v: 30000 }],
        },
        NO(rx('group_concat(distinct armorid)')), // no owned 战场装备 yet
        NO(rx('from cfg_shop where medalTypeId = ?')), // nothing left to buy → set complete
        NO(rx('from sys_battle_open_condition where battleId = ?')),
        NO(rx('from sys_battle_open_condition where dependBattleId = ?')),
      ]),
    );
    expect(await cmd.buyBattleGoods(ctx(), [30, 1, 1, 0])).toEqual([5]);
    expect(db.executed.find((q) => /insert into sys_user_armor/.test(q.sql))!.parameters).toEqual([
      1001,
      20001,
      500,
      50, // hp*10, hp; the hid 0 is inline, as in the original
    ]);
    // the set was complete → the dependent battlefield flips open
    expect(db.executed.some((q) => /delete from sys_battle_open_condition/.test(q.sql))).toBe(true);
    expect(
      db.executed.some(
        (q) => /update cfg_battle_field set state = 1/.test(q.sql) && q.parameters[0] === 1001,
      ),
    ).toBe(true);
    // log_goods type 11 (the raw template inlines unix_timestamp() and the literal reason)
    expect(
      db.executed.some(
        (q) =>
          /insert into log_goods/.test(q.sql) &&
          q.sql.includes(', 11)') &&
          q.parameters[1] === 20001,
      ),
    ).toBe(true);
  });

  it('battleGoodsType 1: armor_box_full when the bag is full', async () => {
    const { cmd } = build(
      SHOP_RULES({ gid: 20001, battleGoodsType: 1, creditPrice: 5, medalPrice: 1 }, [
        { match: rx('select `armor_column` as v from sys_user'), rows: [{ v: 4 }] },
        {
          match: rx('from sys_user_armor where uid = ? and hid = 0'),
          params: [1001],
          rows: [{ v: 3 }],
        },
      ]),
    );
    await expect(cmd.buyBattleGoods(ctx(), [30, 1, 1, 0])).rejects.toMatchObject({
      key: 'buyGoods.armor_box_full',
    });
  });

  it('battleGoodsType 1: only one per purchase', async () => {
    const { cmd } = build(
      SHOP_RULES({ gid: 20001, battleGoodsType: 1, creditPrice: 0, medalPrice: 0 }),
    );
    await expect(cmd.buyBattleGoods(ctx(), [30, 2, 1, 0])).rejects.toMatchObject({
      key: 'buyGoods.only_one_goods',
    });
  });

  it('battleGoodsType 2: recruits the battlefield hero into the 招贤馆', async () => {
    const { cmd, db } = build(
      SHOP_RULES({ gid: 305, battleGoodsType: 2, creditPrice: 5, medalPrice: 1 }, [
        {
          match: rx('from cfg_hero where id = ?'),
          params: [305],
          rows: [
            {
              id: 305,
              name: '张辽',
              npcid: 305,
              sex: 1,
              face: 5,
              level: 6,
              affairs_base: 50,
              bravery_base: 70,
              wisdom_base: 60,
              loyalty: 90,
              command_base: 65,
            },
          ],
        },
        {
          match: rx('from sys_building where cid = ? and bid = ?'),
          params: [209355, 11],
          rows: [{ v: 3 }],
        },
        {
          match: rx('from sys_city_hero where cid = ? and uid = ?'),
          params: [209355, 1001],
          rows: [{ v: 2 }],
        },
        { match: rx('from cfg_hero_level where level = ?'), params: [6], rows: [{ v: 500 }] },
      ]),
    );
    expect(await cmd.buyBattleGoods(ctx(), [30, 1, 2, 209355])).toEqual([5]);
    const heroInsert = db.executed.find((q) => /insert into sys_city_hero/.test(q.sql))!;
    expect(heroInsert.parameters).toEqual([
      1001,
      '张辽',
      '305',
      '1',
      '5',
      209355,
      '6',
      '500',
      50,
      70,
      60,
      2,
      2,
      2,
      '90',
      65,
    ]); // state 0 and herotype '20000' stay inline, as in the original
    // `force` stays quoted (MySQL 8 reserved word) with the level/3 attribute split
    const blood = db.executed.find((q) => /insert into mem_hero_blood/.test(q.sql))!;
    expect(blood.sql).toContain('`force`');
    expect(blood.parameters).toEqual([0, 124, 124, 121, 121, 124, 121, 124, 121]); // bound in values + on-duplicate
    expect(
      db.executed.some((q) => /insert into log_goods/.test(q.sql) && q.sql.includes(', 12)')),
    ).toBe(true);
  });

  it('battleGoodsType 2: a low 招贤馆 refuses', async () => {
    const { cmd } = build(
      SHOP_RULES({ gid: 305, battleGoodsType: 2, creditPrice: 0, medalPrice: 0 }, [
        { match: rx('from cfg_hero where id = ?'), params: [305], rows: [{ id: 305, level: 6 }] },
        NO(rx('from sys_building where cid = ? and bid = ?')),
      ]),
    );
    await expect(cmd.buyBattleGoods(ctx(), [30, 1, 2, 209355])).rejects.toMatchObject({
      key: 'recruitHero.hotel_level_low',
    });
  });

  it('a zero-priced group-7 good is still refused (area level -1 < 0)', async () => {
    const { cmd } = build([
      {
        match: rx('from cfg_shop where id = ? and onsale = 1'),
        rows: GOODS({ id: 40, group: 7, creditPrice: 0, medalPrice: 0, medalTypeId: 60001 }),
      },
      {
        match: rx('select battleBelong as v from cfg_things where tid = ?'),
        params: [60001],
        rows: [{ v: 6001 }],
      },
      NO(/.*/),
    ]);
    // the remote area level is -1, so even a free group-7 good fails the level gate — the
    // subtractBattleNetExpoit deduct path stays unreachable, as in the standalone package
    await expect(cmd.buyBattleGoods(ctx(), [40, 1, 0, 0])).rejects.toMatchObject({
      key: 'buyGoods.no_enough_Level',
    });
  });
});

describe('BattlefieldMetaCommands internal readers', () => {
  it('getBattleDescription / getBattleName / getBattleCondition / getBattleState / getTaskState', async () => {
    const { cmd } = build([
      { match: rx('select content as v from cfg_battle_field'), rows: [{ v: '说明' }] },
      { match: rx('select count(*) as v from cfg_battle_field'), params: [1001], rows: [{ v: 1 }] },
      { match: rx('select count(*) as v from cfg_battle_field'), rows: [{ v: 0 }] }, // unknown bid
      {
        match: rx('select name as v from cfg_battle_field'),
        params: [1001],
        rows: [{ v: '黄巾之乱' }],
      },
      { match: rx('select state as v from cfg_battle_field'), rows: [{ v: 2 }] },
      NO(/.*/),
    ]);
    expect(await cmd.getBattleDescription(1001)).toBe('说明');
    expect(await cmd.getBattleName(1001)).toBe('黄巾之乱');
    expect(await cmd.getBattleName(9999)).toBe('unknown'); // count 0 → unknown
    expect(cmd.getBattleCondition(1001)).toBeNull(); // $GLOBALS['battleState'] never defined
    expect(await cmd.getBattleState(1001)).toBe(2);
    expect(cmd.getTaskState(1)).toBe(1);
    expect(cmd.getTaskState(2)).toBe(1);
    expect(cmd.getTaskState(5)).toBeNull();
  });
});
