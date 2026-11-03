import { describe, expect, it } from 'vitest';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { ReportService } from '../core/report.service';
import { TaskRules } from '../core/task-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { canGoto, BattleMoveCommands } from './battle-move.commands';

/** legacy/lang/zh_CN.json entries the specs read (the rest fall back to their keys). */
const lang = new LangService({
  battle: {
    user_not_in_battle: '你已经不在战场中或者战场已经结束。',
    battle_froze: '战场已经结束，你不能再行动。',
    spy_cant_alone: '斥候无法独立出征到战场。',
    road_not_opens: '前往该据点的通路尚未打开。',
    can_not_view_city: '不能查看此据点的驻军',
    troop_not_exist: '战场中没有当前你所选择的这支军队。',
    troop_not_stay: '你所选择的军队正在行动中，请选择其他军队。',
    troop_in_same_city_not_stay: '不能攻击同据点内不在驻守状态的军队。',
    troop_in_same_city: '当前选择的军队已经在这个据点中。',
    city_not_exist: '据点不存在',
    city_cannot_goto: '只能前往相邻的据点。',
    targettroop_not_exist: '战场中没有当前你要攻击的这支军队。',
    same_union: '同一阵营不能攻击。',
    patrol_report: '战场侦察结果：<br/>地点 %s<br/>敌将 %s<br/>等级 %s<br/>',
    patrol_report_suc: '侦察成功，请到公文战报里查看敌人部队信息。',
    patrol_report_soldier: { 13: '流民', 4: '长枪兵' },
    soldier_limit: [0, 1000, 2000, 4000],
  },
  start_battle_troop: {
    no_hero: '没有将领带领不能前往战场。',
    city_not_allow: '该据点不是出发据点。',
    not_enought_honour: '向该据点出发需要更多的战场荣誉。',
    reach_limit: '已经达到派兵次数上限，不能再派遣更多的军队。',
    max_troop: '你已经向战场派遣了2支军队，不能再派遣了。',
  },
  StartTroop: {
    succ: '出征成功。在军队面板中可以查看军队动态。',
    fail: '出征失败。',
    no_soldier: '军队中没有士兵，不能出战。',
    no_so_many_army: '城池中没有这么多军队。',
    insufficient_ground_level: '校场等级不足，不能出征。',
    hero_not_found: '城内没有找到该将领。',
    hero_is_busy: '该将领不在空闲状态，不能出征。',
    hero_not_enough_force: '%s需要消耗%d点体力。将领体力不足，无法出征。',
    goto_battle: '派往战场',
    too_many_sid: '出征失败，一次出征兵种不能多于12种',
    no_enough_food: '城内粮食不足，不能出征。',
    no_enough_ground_level: '当前级别的校场不能发送超过%d的军队。',
  },
  getGroundInfo: { no_ground_built: '该城池尚未建造校场。' },
});

const ctx = { uid: 1001, cid: 3003, ip: 0, sip: '' };
const NO = (match: RegExp): Respond => ({ match, rows: [] });

/** Real collaborators over FakeDb; report is a stub capturing the report text. */
function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const reports: { uid: number; title: number; content: string }[] = [];
  const cmd = new BattleMoveCommands(
    db.scope,
    lang,
    new CityRules(db.scope),
    new GoodsRules(db.scope),
    { completeTaskWithTaskid: async () => {} } as unknown as TaskRules,
    {
      sendReport: async (uid: number, title: number, _o: number, _h: number, content: string) => {
        reports.push({ uid, title, content });
      },
    } as unknown as ReportService,
  );
  return { cmd, db, reports };
}

// ───────────────────────────── canGoto（邻接校验四态） ─────────────────────────────

describe('canGoto (BattleFunc.php:2190 adjacency)', () => {
  it('adjacent xy → true', () => {
    expect(canGoto(lang, 16601102, '2,102,103')).toBe(true);
  });

  it('not listed → false', () => {
    expect(canGoto(lang, 16601102, '2,103,104')).toBe(false);
  });

  it('a locked road (-xy) → throws road_not_opens', () => {
    expect(() => canGoto(lang, 16601102, '2,-102')).toThrow(GameError);
    expect(() => canGoto(lang, 16601102, '2,-102')).toThrow();
    try {
      canGoto(lang, 16601102, '1,-102');
      expect.unreachable();
    } catch (err) {
      expect((err as GameError).key).toBe('battle.road_not_opens');
    }
  });

  it('an empty list (count 0) → false', () => {
    expect(canGoto(lang, 16601102, '0')).toBe(false);
  });
});

// ───────────────────────────── startBattleTroop ─────────────────────────────

const BATTLE_ROW = {
  honour: 10,
  unionid: 1,
  battlefieldid: 16001,
  bid: 1001,
  createuid: 1001,
  level: 1,
  maxpeople: 5,
  starttime: 0,
  endtime: 136000,
  type: 0,
  state: 0,
  winner: null,
  in_cross_battle: 0,
  name: '黄巾之乱',
};

/** The full rule chain startBattleTroop walks on the happy path, in execution order. */
function startTroopRules(): Respond[] {
  return [
    { match: /from sys_user_battle_state u/i, rows: [BATTLE_ROW] },
    {
      match: /from cfg_battle_start_city/i,
      rows: [{ bid: 1001, xy: 101, unionid: 1, needhonour: 0, name: '广宗城外' }],
    },
    { match: /sent_troop_count from sys_user_battle_state/i, rows: [{ sent_troop_count: 0 }] },
    {
      match: /count\(\*\) as c from sys_troops\s*where uid = \? and battlefieldid = \?/i,
      rows: [{ c: 0 }],
    },
    NO(/from mem_city_buffer where cid = \? and buftype = 5/i),
    NO(/from mem_city_buffer where cid = \? and buftype = 8/i),
    {
      match: /select level from sys_building\s*where cid = \? and bid = \?/,
      rows: [{ level: 3 }],
    },
    { match: /count\(\*\) as c from sys_troops\s*where uid = \? and cid = \?/i, rows: [{ c: 0 }] },
    {
      match: /from sys_city_hero h\s*left join mem_hero_blood m/i,
      rows: [
        { hid: 80213, uid: 1001, cid: 3003, state: 0, hero_health: 0, force: 20, speed_add_on: 5 },
      ],
    },
    NO(/from mem_city_schedule where cid = \?/i),
    {
      match: /from sys_city_soldier where cid = \?/i,
      rows: [
        { cid: 3003, sid: 1, count: 100 },
        { cid: 3003, sid: 4, count: 200 },
      ],
    },
    { match: /select \* from sys_city where cid = \?/i, rows: [{ cid: 3003, type: 0 }] },
    NO(/from sys_city_technic where cid = \? and tid = 12/i),
    NO(/from sys_city_technic where cid = \? and tid = 13/i),
    {
      match: /from cfg_soldier where fromcity = 1 order by sid/i,
      rows: [
        { sid: 1, speed: 300, food_use: 1, people_need: 1, fromcity: 1 },
        { sid: 4, speed: 1000, food_use: 2, people_need: 2, fromcity: 1 },
      ],
    },
    { match: /select unix_timestamp\(\) as t/i, rows: [{ t: 100000 }] },
    { match: /select food from mem_city_resource where cid = \?/i, rows: [{ food: 100000 }] },
    {
      match: /insert into sys_troops/i,
      rows: [],
      insertId: 5001,
    },
    {
      match: /select \* from sys_user_tactics where uid = \?/i,
      rows: [{ plunder: 1, invade: 2, patrol: 3, field: 4 }],
    },
    NO(/replace into sys_troop_tactics/i),
    NO(/update sys_user_battle_state set sent_troop_count/i),
    NO(/.*/),
  ];
}

describe('startBattleTroop', () => {
  it('writes the task-7 row with the folded soldiers, food and march time', async () => {
    const { cmd, db } = build(startTroopRules());
    const ret = await cmd.startBattleTroop(ctx, [3003, 80213, '2,1,50,4,60,', 0, 101]);
    expect(ret).toEqual(['出征成功。在军队面板中可以查看军队动态。']);

    const insert = db.executed.find((q) => /insert into sys_troops/i.test(q.sql));
    expect(insert).toBeDefined();
    // uid, cid, hid, pathtime, soldiers, people, fooduse, battlefieldid, battleunionid,
    // targetcid, startcid, bid, ulimit — task 7 / state 0 / endtime+10 are literals.
    expect(insert!.parameters).toEqual([
      1001,
      3003,
      80213,
      514, // floor(162000 / (300 * 1 * 1.05)) — sid 1 is the slowest
      '2,1,50,4,60,',
      170, // 1*50 + 2*60 people_need
      1700, // (1*50 + 2*60) food_use * ceil((136000-100000)/3600)
      16001,
      1,
      16601101, // battleid2cid(16001, 101)
      3003,
      1001,
      110, // ulimit = 50 + 60
    ]);
    expect(insert!.sql).toContain('unix_timestamp() + 10');

    // 配兵折算：sys_city_soldier 的 -50/-60 扣减。
    const takes = db.executed.filter(
      (q) => /insert into sys_city_soldier/i.test(q.sql) && q.parameters[2] === '-50',
    );
    expect(takes).toHaveLength(1);
    expect(takes[0]!.parameters[1]).toBe(1);
    expect(
      db.executed.some(
        (q) => /insert into sys_city_soldier/i.test(q.sql) && q.parameters[2] === '-60',
      ),
    ).toBe(true);

    // 玩家战术复制到新军队（troopid 来自 insertId）。
    const tactics = db.executed.find((q) => /replace into sys_troop_tactics/i.test(q.sql));
    expect(tactics!.parameters).toEqual([5001, 1, 2, 3, 4]);
    expect(
      db.executed.some((q) => /update sys_user_battle_state set sent_troop_count/i.test(q.sql)),
    ).toBe(true);
  });

  it('rejects a hero-less march and a scout-only army', async () => {
    const { cmd } = build([NO(/.*/)]);
    await expect(cmd.startBattleTroop(ctx, [3003, 0, '1,1,10,', 0, 101])).rejects.toMatchObject({
      key: 'start_battle_troop.no_hero',
    });

    const rules = startTroopRules();
    // 斥候 (sid 3) 也要在城内兵力表里，才能走到"斥候不能独行"的判断。
    const soldierRule = rules.find((r) => /from sys_city_soldier where cid/i.test(String(r.match)));
    soldierRule!.rows = [
      { cid: 3003, sid: 1, count: 100 },
      { cid: 3003, sid: 3, count: 10 },
    ];
    const { cmd: cmd2 } = build(rules);
    await expect(
      cmd2.startBattleTroop(ctx, [3003, 80213, '1,3,10,', 0, 101]),
    ).rejects.toMatchObject({ key: 'battle.spy_cant_alone' });
  });

  it('honours the start-city gate and the honour gate', async () => {
    const { cmd } = build([
      { match: /from sys_user_battle_state u/i, rows: [BATTLE_ROW] },
      NO(/from cfg_battle_start_city/i),
      NO(/.*/),
    ]);
    await expect(cmd.startBattleTroop(ctx, [3003, 80213, '2,1,50,', 0, 999])).rejects.toMatchObject(
      {
        key: 'start_battle_troop.city_not_allow',
      },
    );

    const { cmd: cmd2 } = build([
      { match: /from sys_user_battle_state u/i, rows: [BATTLE_ROW] },
      {
        match: /from cfg_battle_start_city/i,
        rows: [{ bid: 1001, xy: 101, unionid: 1, needhonour: 100, name: 'x' }],
      },
      NO(/.*/),
    ]);
    await expect(
      cmd2.startBattleTroop(ctx, [3003, 80213, '2,1,50,', 0, 101]),
    ).rejects.toMatchObject({ key: 'start_battle_troop.not_enought_honour' });
  });
});

// ───────────────────────────── battleTroopDispatch / battleAttack ─────────────────────────────

const FIELD_ROW = {
  unionid: 1,
  battlefieldid: 16001,
  honour: 5,
  type: 0,
  state: 0,
  bid: 1001,
  progress: 1,
  level: 1,
};

const ORIGIN_CITY = { cid: 16601101, nextxy: '2,102', unionid: 1, uid: 1001, hasuser: 1 };

describe('battleTroopDispatch', () => {
  it('marches a stationed troop to an adjacent strongpoint with task 8', async () => {
    const { cmd, db } = build([
      { match: /from sys_user_battle_state s/i, rows: [FIELD_ROW] },
      {
        match: /select \* from sys_troops\s*where id = \? and uid = \?/i,
        rows: [
          { id: 5002, uid: 1001, cid: 16601101, state: 4, battlefieldid: 16001, pathtime: 30 },
        ],
      },
      {
        match: /select \* from sys_battle_city where cid = \?/i,
        params: [16601102],
        rows: [{ cid: 16601102, nextxy: '2,103', unionid: 2 }],
      },
      {
        match: /select \* from sys_battle_city where cid = \?/i,
        params: [16601101],
        rows: [ORIGIN_CITY],
      },
      NO(/from mem_battle_attack_lock/i),
      NO(/update sys_troops set starttime/i),
      {
        match: /from sys_troops\s*where cid = \?/i,
        rows: [{ uid: 1001, battleunionid: 1, state: 4 }],
      },
      {
        match: /select uid, unionid from sys_battle_city where cid = \?/i,
        rows: [{ uid: 1001, unionid: 1 }],
      },
      NO(/.*/),
    ]);
    const ret = await cmd.battleTroopDispatch(ctx, [5002, 16601102, '主公', '目标']);
    expect(ret).toEqual(['出征成功。在军队面板中可以查看军队动态。']);
    const update = db.executed.find((q) => /update sys_troops set starttime/i.test(q.sql));
    expect(update).toBeDefined();
    expect(update!.sql).toContain('task = 8');
    expect(update!.sql).toContain('endtime = unix_timestamp() + pathtime');
    expect(update!.parameters).toEqual([16601102, 5002]);
    // 出发据点重新判归属.
    expect(db.executed.some((q) => /update sys_battle_city set uid = \?/i.test(q.sql))).toBe(true);
  });

  it('guards: missing troop, marching troop and a locked road', async () => {
    const { cmd } = build([
      { match: /from sys_user_battle_state s/i, rows: [FIELD_ROW] },
      NO(/select \* from sys_troops\s*where id = \? and uid = \?/i),
      NO(/.*/),
    ]);
    await expect(cmd.battleTroopDispatch(ctx, [5002, 16601102, 'a', 'b'])).rejects.toMatchObject({
      key: 'battle.troop_not_exist',
    });

    const { cmd: cmd2 } = build([
      { match: /from sys_user_battle_state s/i, rows: [FIELD_ROW] },
      {
        match: /select \* from sys_troops\s*where id = \? and uid = \?/i,
        rows: [{ id: 5002, uid: 1001, cid: 16601101, state: 0, battlefieldid: 16001 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd2.battleTroopDispatch(ctx, [5002, 16601102, 'a', 'b'])).rejects.toMatchObject({
      key: 'battle.troop_not_stay',
    });

    const { cmd: cmd3 } = build([
      { match: /from sys_user_battle_state s/i, rows: [FIELD_ROW] },
      {
        match: /select \* from sys_troops\s*where id = \? and uid = \?/i,
        rows: [{ id: 5002, uid: 1001, cid: 16601101, state: 4, battlefieldid: 16001 }],
      },
      {
        match: /select \* from sys_battle_city where cid = \?/i,
        params: [16601102],
        rows: [{ cid: 16601102 }],
      },
      {
        match: /select \* from sys_battle_city where cid = \?/i,
        params: [16601101],
        rows: [{ cid: 16601101, nextxy: '1,105' }],
      },
      NO(/.*/),
    ]);
    await expect(cmd3.battleTroopDispatch(ctx, [5002, 16601102, 'a', 'b'])).rejects.toMatchObject({
      key: 'battle.city_cannot_goto',
    });
    // the road_not_opens variant: nextxy lists the target as -102 (road closed) before anything
    // else — the PHP throws instead of returning false.
    const { cmd: cmd4 } = build([
      { match: /from sys_user_battle_state s/i, rows: [FIELD_ROW] },
      {
        match: /select \* from sys_troops\s*where id = \? and uid = \?/i,
        rows: [{ id: 5002, uid: 1001, cid: 16601101, state: 4, battlefieldid: 16001 }],
      },
      {
        match: /select \* from sys_battle_city where cid = \?/i,
        params: [16601102],
        rows: [{ cid: 16601102 }],
      },
      {
        match: /select \* from sys_battle_city where cid = \?/i,
        params: [16601101],
        rows: [{ cid: 16601101, nextxy: '1,-102' }],
      },
      NO(/.*/),
    ]);
    await expect(cmd4.battleTroopDispatch(ctx, [5002, 16601102, 'a', 'b'])).rejects.toMatchObject({
      key: 'battle.road_not_opens',
    });
  });
});

describe('battleAttack', () => {
  /** Same-strongpoint attack: 10 seconds, no adjacency gate. */
  it('same-city target writes task 9 with endtime +10', async () => {
    const { cmd, db } = build([
      { match: /from sys_user_battle_state s/i, rows: [FIELD_ROW] },
      {
        match: /select \* from sys_troops\s*where id = \? and uid = \?/i,
        rows: [{ id: 5002, uid: 1001, cid: 16601101, state: 4, battlefieldid: 16001 }],
      },
      {
        match: /select \* from sys_troops where id = \?/i,
        rows: [
          { id: 6001, uid: 0, cid: 16601101, battleunionid: 2, hid: 1002, state: 4, battleid: 0 },
        ],
      },
      {
        match: /select \* from sys_battle_city where cid = \?/i,
        rows: [ORIGIN_CITY],
      },
      NO(/update sys_troops set starttime/i),
      { match: /from sys_troops\s*where cid = \?/i, rows: [] },
      {
        match: /select uid, unionid from sys_battle_city where cid = \?/i,
        rows: [{ uid: 1001, unionid: 1 }],
      },
      NO(/.*/),
    ]);
    const ret = await cmd.battleAttack(ctx, [5002, 6001, '敌将', '广宗']);
    expect(ret).toEqual(['出征成功。在军队面板中可以查看军队动态。']);
    const update = db.executed.find((q) => /update sys_troops set starttime/i.test(q.sql));
    expect(update!.sql).toContain('task = 9');
    expect(update!.sql).toContain('targettroopid = ?');
    expect(update!.sql).toContain('endtime = unix_timestamp() + 10');
    expect(update!.parameters).toEqual([16601101, 6001, 5002]);
  });

  it('cross-city target requires adjacency and marches with the stored pathtime', async () => {
    const { cmd, db } = build([
      { match: /from sys_user_battle_state s/i, rows: [FIELD_ROW] },
      {
        match: /select \* from sys_troops\s*where id = \? and uid = \?/i,
        rows: [{ id: 5002, uid: 1001, cid: 16601101, state: 4, battlefieldid: 16001 }],
      },
      {
        match: /select \* from sys_troops where id = \?/i,
        rows: [
          { id: 6001, uid: 0, cid: 16601102, battleunionid: 2, hid: 1002, state: 4, battleid: 0 },
        ],
      },
      {
        match: /select \* from sys_battle_city where cid = \?/i,
        params: [16601101],
        rows: [ORIGIN_CITY],
      },
      {
        match: /select \* from sys_battle_city where cid = \?/i,
        params: [16601102],
        rows: [{ cid: 16601102, nextxy: '2,101', unionid: 2 }],
      },
      NO(/from mem_battle_attack_lock/i),
      NO(/update sys_troops set starttime/i),
      NO(/.*/),
    ]);
    await cmd.battleAttack(ctx, [5002, 6001, '敌将', '邻村']);
    const update = db.executed.find((q) => /update sys_troops set starttime/i.test(q.sql));
    expect(update!.sql).toContain('endtime = unix_timestamp() + pathtime');
    expect(update!.parameters).toEqual([16601102, 6001, 5002]);
  });

  it('guards: same union, unknown target troop', async () => {
    const { cmd } = build([
      { match: /from sys_user_battle_state s/i, rows: [FIELD_ROW] },
      {
        match: /select \* from sys_troops\s*where id = \? and uid = \?/i,
        rows: [{ id: 5002, uid: 1001, cid: 16601101, state: 4, battlefieldid: 16001 }],
      },
      {
        match: /select \* from sys_troops where id = \?/i,
        rows: [
          { id: 6001, uid: 0, cid: 16601101, battleunionid: 1, hid: 1002, state: 4, battleid: 0 },
        ],
      },
      {
        match: /select \* from sys_battle_city where cid = \?/i,
        rows: [ORIGIN_CITY],
      },
      NO(/.*/),
    ]);
    await expect(cmd.battleAttack(ctx, [5002, 6001, 'a', 'b'])).rejects.toMatchObject({
      key: 'battle.same_union',
    });

    const { cmd: cmd2 } = build([
      { match: /from sys_user_battle_state s/i, rows: [FIELD_ROW] },
      {
        match: /select \* from sys_troops\s*where id = \? and uid = \?/i,
        rows: [{ id: 5002, uid: 1001, cid: 16601101, state: 4, battlefieldid: 16001 }],
      },
      NO(/select \* from sys_troops where id = \?/i),
      NO(/.*/),
    ]);
    await expect(cmd2.battleAttack(ctx, [5002, 9999, 'a', 'b'])).rejects.toMatchObject({
      key: 'battle.targettroop_not_exist',
    });
  });
});

// ───────────────────────────── battlePatrol ─────────────────────────────

describe('battlePatrol', () => {
  it('files the type-45 report, spends the pigeon and throws the success text', async () => {
    const { cmd, db, reports } = build([
      { match: /select count from sys_goods/i, rows: [{ count: 2 }] },
      {
        match:
          /select t\.cid, t\.id, t\.uid, t\.soldiers, t\.pathtime,\s*t\.state, h\.name as heroname/i,
        rows: [{ cid: 16601101, id: 5002, uid: 1001, state: 4, soldiers: '1,1,100,' }],
      },
      {
        match: /select cid, id, uid, soldiers, hid, bid, state\s*from sys_troops where id = \?/i,
        rows: [
          {
            cid: 16601101,
            id: 6001,
            uid: 0,
            soldiers: '2,13,50,4,70,',
            hid: 1002,
            bid: 1001,
            state: 4,
          },
        ],
      },
      {
        match: /select name, level from cfg_battle_hero where hid = \?/i,
        rows: [{ name: '张角', level: 30 }],
      },
      {
        // SQL 模板在 cfg_battle_city 后换行缩进 — 正则要容许空白。
        match: /select name from cfg_battle_city\s+where bid = \? and xy = \?/i,
        rows: [{ name: '广宗' }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.battlePatrol(ctx, [5002, 6001])).rejects.toMatchObject({
      key: 'battle.patrol_report_suc',
    });
    expect(reports).toHaveLength(1);
    expect(reports[0]!.uid).toBe(1001);
    expect(reports[0]!.title).toBe(45);
    // lang.t 自带 sprintf 渲染 — 参数必须传给 t()（PHP 的 vsprintf($GLOBALS[...], $args) 语义）。
    expect(reports[0]!.content).toBe(
      lang.t('battle.patrol_report', '广宗', '张角', 30) + '流民 50<br/>长枪兵 70<br/>',
    );
    expect(db.executed.some((q) => /update sys_goods set count = greatest/i.test(q.sql))).toBe(
      true,
    );
  });

  it('without a pigeon → raw not_enough_goods140 (购买框)', async () => {
    const { cmd } = build([NO(/select count from sys_goods/i), NO(/.*/)]);
    await expect(cmd.battlePatrol(ctx, [5002, 6001])).rejects.toMatchObject({
      key: null,
      message: 'not_enough_goods140',
    });
  });
});

// ───────────────────────────── readers ─────────────────────────────

describe('getBattleFieldState', () => {
  it('returns name/cid/troops/flagged cities/own troops/add-army/quest gates', async () => {
    const { cmd } = build([
      { match: /from sys_user_battle_state u/i, rows: [BATTLE_ROW] },
      {
        match: /select \* from sys_battle_city where cid = \?/i,
        params: [16601101],
        rows: [ORIGIN_CITY],
      },
      {
        match: /select \* from sys_battle_city where cid = \?/i,
        params: [16601101],
        rows: [ORIGIN_CITY],
      },
      NO(/left join cfg_battle_hero h on/i),
      NO(/left join sys_city_hero h on \(s\.hid = h\.hid\)\s*left join sys_user u2/i),
      {
        match: /select \* from sys_battle_city where battlefieldid = \?/i,
        rows: [{ ...ORIGIN_CITY, flag: 0, flagchar: '' }],
      },
      { match: /select unionid, flag from cfg_battle_union/i, rows: [{ unionid: 1, flag: '汉' }] },
      NO(/select t\.state, t\.targetcid, t\.soldiers/i),
      { match: /SELECT 1 as x FROM sys_battle_city a, sys_troops b/i, rows: [{ x: 1 }] },
      NO(/.*/),
    ]);
    const ret = await cmd.getBattleFieldState(ctx, [16001, 1, 16601101, '广宗', 16601101]);
    expect(ret[0]).toBe('广宗'); // addslashes is a no-op here, as in the original
    expect(ret[1]).toBe(16601101);
    expect(ret[2]).toEqual([]); // troops3
    const cityinfo = ret[3] as Record<string, unknown>[];
    expect(cityinfo).toHaveLength(1);
    expect(cityinfo[0]!.flag).toBe(1); // own union + hasuser → 我方据点
    expect(cityinfo[0]!.flagchar).toBe('汉');
    expect(ret[4]).toEqual([]);
    expect(ret[5]).toBe(1); // sql_check → 0/1
    expect(ret[6]).toBe(false); // unionid 1 is neither 28 nor 30
    expect(ret[7]).toBe(false);
  });

  it('bid 6001 blocks viewing a non-adjacent strongpoint', async () => {
    const { cmd } = build([
      {
        match: /from sys_user_battle_state u/i,
        rows: [{ ...BATTLE_ROW, bid: 6001 }],
      },
      NO(/select \* from sys_battle_city where cid = \?/i),
      NO(/.*/),
    ]);
    await expect(
      cmd.getBattleFieldState(ctx, [16001, 1, 16601105, '逐鹿', 16601101]),
    ).rejects.toMatchObject({ key: 'battle.can_not_view_city' });
  });
});

describe('info readers', () => {
  it('getInfoForBattleArmyAttack: same-strongpoint target gets pathtime 10 and the NPC hero', async () => {
    const { cmd } = build([
      {
        match:
          /select t\.cid, t\.id, t\.uid, t\.soldiers, t\.pathtime,\s*t\.state, h\.name as heroname/i,
        rows: [
          { cid: 16601101, id: 5002, uid: 1001, soldiers: '1,1,100,', pathtime: 30, state: 4 },
        ],
      },
      {
        match: /select cid, id, uid, soldiers, hid, state\s*from sys_troops where id = \?/i,
        rows: [{ cid: 16601101, id: 6001, uid: 0, soldiers: '2,13,50,', hid: 1002, state: 4 }],
      },
      {
        match: /select name, level from cfg_battle_hero where hid = \?/i,
        rows: [{ name: '张角', level: 30 }],
      },
      NO(/.*/),
    ]);
    const ret = await cmd.getInfoForBattleArmyAttack(ctx, [5002, 6001, '张角']);
    const troop = ret[0] as Record<string, unknown>;
    const target = ret[1] as Record<string, unknown>;
    expect(troop.pathtime).toBe(10);
    expect(target.heroname).toBe('张角');
    expect(target.level).toBe(30);
    expect(ret[2]).toBe('张角');
  });

  it('getInfoForBattleArmyAttack: a different-strongpoint target hides its soldiers', async () => {
    const { cmd } = build([
      {
        match:
          /select t\.cid, t\.id, t\.uid, t\.soldiers, t\.pathtime,\s*t\.state, h\.name as heroname/i,
        rows: [
          { cid: 16601101, id: 5002, uid: 1001, soldiers: '1,1,100,', pathtime: 30, state: 4 },
        ],
      },
      {
        match: /select cid, id, uid, soldiers, hid, state\s*from sys_troops where id = \?/i,
        rows: [{ cid: 16601102, id: 6001, uid: 0, soldiers: '2,13,50,', hid: 1002, state: 4 }],
      },
      {
        match: /select name, level from cfg_battle_hero where hid = \?/i,
        rows: [{ name: '张角', level: 30 }],
      },
      NO(/.*/),
    ]);
    const target = (await cmd.getInfoForBattleArmyAttack(ctx, [5002, 6001, '张角']))[1] as Record<
      string,
      unknown
    >;
    expect(target.soldiers).toBe('');
  });

  it('getInfoForBattleArmySend: rejects the same strongpoint, tags the target otherwise', async () => {
    const troopRow = {
      id: 5002,
      uid: 1001,
      soldiers: '1,1,100,',
      pathtime: 30,
      state: 4,
      cid: 16601101,
    };
    const rules: Respond[] = [
      {
        match: /select t\.id, t\.uid, t\.soldiers, t\.pathtime, t\.state,\s*h\.name as heroname/i,
        rows: [troopRow],
      },
      NO(/.*/),
    ];
    const { cmd } = build(rules);
    await expect(cmd.getInfoForBattleArmySend(ctx, [5002, 16601101, '目标'])).rejects.toMatchObject(
      {
        key: 'battle.troop_in_same_city',
      },
    );
    const ret = await cmd.getInfoForBattleArmySend(ctx, [5002, 16601102, '目标"引号']);
    expect(ret[0]).toMatchObject({ targetname: '目标\\"引号', targetid: 16601102 }); // addslashes
  });

  it('getInfoForBattleArmyReinforce: the city troops and the reinforce pool', async () => {
    const { cmd } = build([
      {
        match:
          /select t\.cid, t\.id, t\.uid, t\.soldiers, t\.pathtime,\s*t\.state, h\.name as heroname/i,
        rows: [{ cid: 16601101, id: 5002, uid: 1001, soldiers: '1,1,100,', state: 4 }],
      },
      {
        match: /select reinforce_soldiers from sys_battle_city/i,
        rows: [{ reinforce_soldiers: '0,' }],
      },
      NO(/.*/),
    ]);
    const ret = await cmd.getInfoForBattleArmyReinforce(ctx, [16601101]);
    expect(ret[0]).toHaveLength(1);
    expect(ret[1]).toBe('0,');
  });

  it('selectOneTroop returns the empty placeholder plus the troop row', async () => {
    const { cmd } = build([
      { match: /select id, cid from sys_troops/i, rows: [{ id: 5002, cid: 16601101 }] },
      NO(/.*/),
    ]);
    expect(await cmd.selectOneTroop(ctx, [5002])).toEqual([[], { id: 5002, cid: 16601101 }]);
    const { cmd: cmd2 } = build([NO(/.*/)]);
    await expect(cmd2.selectOneTroop(ctx, [5002])).rejects.toMatchObject({
      key: 'battle.troop_not_exist',
    });
  });
});

describe('getCurrentCityGroundLevel1/2', () => {
  it('throws without a 校场 and returns the level with one', async () => {
    const { cmd } = build([NO(/select level from sys_building/i), NO(/.*/)]);
    await expect(cmd.getCurrentCityGroundLevel1(ctx, [3003])).rejects.toMatchObject({
      key: 'getGroundInfo.no_ground_built',
    });
    const { cmd: cmd2 } = build([
      { match: /select level from sys_building/i, rows: [{ level: 5 }] },
      NO(/.*/),
    ]);
    expect(await cmd2.getCurrentCityGroundLevel2(ctx, [3003])).toEqual([5]);
  });
});
