import { describe, expect, it } from 'vitest';
import { ScoutService } from '../battle/scout';
import { BattleArrivalService } from '../battle/battle-arrival.service';
import { BattleEngineService } from '../battle/battle-engine.service';
import { CityRules } from '../core/city-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { LangService } from '../common/lang.service';
import { MailService } from '../core/mail.service';
import { RandomService } from '../core/random.service';
import { ReportService } from '../core/report.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { TroopTick } from './troop.tick';

const lang = new LangService({
  report: {
    br: '<br/>',
    empty: '无',
    title: '%s %s，%s',
    heroname: '[%s]%s%s(%d)',
    troopback: '%s%s%s',
    resource: '%s金%s粮%s木%s石%s铁%s',
    title_2row: { '4': '已到达', '5': '运输到达' },
    type: { '0': '运输', '1': '派遣' },
  },
  battle: { patrol_report_soldier: { '1': '民夫', '3': '斥候' } },
});

const random = { rand: () => 0, randRange: () => 0, mtRand: () => 0 } as unknown as RandomService;

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const arrival = new BattleArrivalService(
    db.scope,
    lang,
    new CityRules(db.scope),
    new HeroRules(db.scope),
    new TaskRules(db.scope, new UserRules(db.scope)),
    new ReportService(db.scope, new MailService(db.scope)),
    random,
  );
  const tick = new TroopTick(
    db.scope,
    lang,
    new CityRules(db.scope),
    new HeroRules(db.scope),
    new ReportService(db.scope, new MailService(db.scope)),
    new ScoutService(
      db.scope,
      lang,
      new ReportService(db.scope, new MailService(db.scope)),
      new TaskRules(db.scope, new UserRules(db.scope)),
      new CityRules(db.scope),
      random,
      arrival,
      new BattleEngineService(db.scope, random),
    ),
    arrival,
    new TaskRules(db.scope, new UserRules(db.scope)),
    random,
  );
  return { tick, db };
}

const NO = (match: RegExp): Respond => ({ match, rows: [] });
/** Catch-all for the bookkeeping queries (resource refresh, report insert, alarm). */
const TAIL: Respond[] = [
  NO(/from mem_world/i),
  NO(/from sys_city/i),
  NO(/from cfg_world_type/i),
  { match: /select sum\(fooduse\)/i, rows: [] },
  NO(/update mem_city_resource/i),
  NO(/update sys_city_res_add/i),
  NO(/insert into sys_report/i),
  NO(/insert into sys_alarm/i),
  NO(/select sum\(c.food_use/i),
  NO(/.*/),
];

describe('TroopTick.handleTroop', () => {
  it('settles a transport arrival (task 0): resources deposited, troop turned home', async () => {
    const { tick, db } = build([
      {
        match: /from sys_troops\s+where endtime > 0/i,
        rows: [
          {
            id: 1,
            uid: 1001,
            hid: 0,
            cid: 3003,
            targetcid: 5005,
            task: 0,
            state: 0,
            battlefieldid: 0,
            soldiers: '1,1,100',
            resource: '0,50,0,0,0',
            people: 0,
            fooduse: 0,
          },
        ],
      },
      // checkFieldOwner: field is a city (ownercid = targetcid)
      {
        match: /select \* from mem_world where wid = \?/i,
        rows: [{ wid: 1, type: 0, ownercid: 5005 }],
      },
      { match: /select uid from sys_city where cid = \?/i, rows: [{ uid: 1001 }] },
      // checkInwar: self → relation 0, result true
      { match: /select \* from sys_user where uid = \?/i, rows: [{ union_id: 0 }] },
      { match: /select name from sys_city where cid = \?/i, rows: [{ name: '友城' }] },
      { match: /select c.name from mem_world m/i, rows: [] },
      NO(/update mem_city_resource set wood/i),
      NO(/update sys_troops set state = 1, starttime = unix_timestamp\(\),\s*endtime = pathtime/i),
      ...TAIL,
    ]);
    await tick.handleTroop();
    // Resources deposited into the target and the troop flipped to return.
    expect(
      db.executed.some((q) =>
        /update sys_troops set state = 1,.*resource = 0 where id = \?/is.test(q.sql),
      ),
    ).toBe(true);
  });

  it('settles a return-home troop (state 1): hero home, soldiers back, row deleted', async () => {
    const { tick, db } = build([
      {
        match: /from sys_troops\s+where endtime > 0/i,
        rows: [
          {
            id: 2,
            uid: 1001,
            hid: 42,
            cid: 3003,
            targetcid: 5005,
            task: 0,
            state: 1,
            battlefieldid: 0,
            soldiers: '1,1,100',
            resource: '0',
            people: 0,
            fooduse: 0,
          },
        ],
      },
      {
        match: /select \* from mem_world where wid = \?/i,
        rows: [{ wid: 1, type: 0, ownercid: 5005 }],
      },
      { match: /select uid from sys_city where cid = \?/i, rows: [{ uid: 1001 }] },
      { match: /select \* from sys_user where uid = \?/i, rows: [{ union_id: 0 }] },
      { match: /select name from sys_city where cid = \?/i, rows: [{ name: '城' }] },
      { match: /select c.name from mem_world m/i, rows: [] },
      {
        match: /select name, level, face, sex from sys_city_hero/i,
        rows: [{ name: '关羽', level: 10, face: 1, sex: 1 }],
      },
      // change_hero: exists check
      { match: /select 1 as x from sys_city_hero/i, rows: [{ x: 1 }] },
      NO(/update sys_city_hero set state = \?/i),
      NO(/insert into sys_city_soldier/i),
      NO(/delete from sys_troops where id = \?/i),
      ...TAIL,
    ]);
    await tick.handleTroop();
    expect(db.executed.some((q) => /delete from sys_troops where id = \?/i.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /insert into sys_city_soldier/i.test(q.sql))).toBe(true);
  });

  it('leaves a battlefield 侦察 (task 2, bid != 0) untouched', async () => {
    const { tick, db } = build([
      {
        match: /from sys_troops\s+where endtime > 0/i,
        rows: [
          {
            id: 4,
            uid: 1001,
            hid: 0,
            cid: 3003,
            targetcid: 630367,
            task: 2,
            state: 0,
            battlefieldid: 30,
            soldiers: '1,3,1',
            resource: '0',
            people: 0,
            fooduse: 0,
          },
        ],
      },
      NO(/.*/),
    ]);
    await tick.handleTroop();
    expect(db.executed.every((q) => !/update sys_troops/i.test(q.sql))).toBe(true);
    // Only the batch query ran.
    expect(db.executed).toHaveLength(1);
  });

  it('task 7 战场出征到达: troop parks at the stronghold (state 4, battleid untouched), report filed', async () => {
    const { tick, db } = build([
      {
        match: /from sys_troops\s+where endtime > 0/i,
        rows: [
          {
            id: 7,
            uid: 1001,
            hid: 0,
            cid: 630001,
            targetcid: 630367,
            task: 7,
            state: 0,
            battlefieldid: 30,
            bid: 1001,
            battleunionid: 1,
            startcid: 630001,
            soldiers: '1,1,500',
            resource: '0',
            people: 0,
            fooduse: 0,
          },
        ],
      },
      // checkFieldOwner: battlefield targets have no mem_world row → uid falls back to sys_troops.
      NO(/select \* from mem_world where wid = \?/i),
      { match: /select uid from sys_troops where cid = \? limit 1/i, rows: [{ uid: 0 }] },
      // checkInwar: no owning user → no relation checks, arrival proceeds.
      { match: /select uid from sys_city where cid = \?/i, rows: [] },
      NO(/select \* from sys_user where uid = \?/i),
      // getNamePosition(type 4): the stronghold's name.
      { match: /select name from sys_battle_city where cid = \?/i, rows: [{ name: '虎牢关' }] },
      NO(/update sys_battle_city/i),
      NO(/select \* from cfg_battle_event/i),
      NO(/update sys_troops set cid = \?, state = 4, battleid = 0/i),
      ...TAIL,
    ]);
    await tick.handleTroop();
    const upd = db.executed.find((e) => /update sys_troops set cid = \?, state = 4/i.test(e.sql))!;
    expect(upd.sql).not.toMatch(/battleid/i); // task 7 does NOT reset battleid (task 8 does)
    expect(upd.parameters).toEqual([630367, 7]);
    // No cfg_battle_event trigger pass, no stronghold re-judge on task 7.
    expect(db.executed.some((e) => /from cfg_battle_event/i.test(e.sql))).toBe(false);
    expect(db.executed.some((e) => /update sys_battle_city/i.test(e.sql))).toBe(false);
    // The arrival report went out with title type 36 (task 7, state 0).
    const report = db.executed.find((e) => /insert into sys_report/i.test(e.sql))!;
    expect(report.parameters[5]).toBe(36);
  });

  it('task 8 战场调遣到达: battleid reset, both strongholds re-judged, 虎牢关 gate, events, no winpoint write', async () => {
    const { tick, db } = build([
      {
        match: /from sys_troops\s+where endtime > 0/i,
        rows: [
          {
            id: 8,
            uid: 1001,
            hid: 0,
            cid: 630001,
            targetcid: 630367,
            task: 8,
            state: 0,
            battlefieldid: 30,
            bid: 1001,
            battleunionid: 1,
            startcid: 630001,
            soldiers: '1,1,500',
            resource: '0',
            people: 0,
            fooduse: 0,
          },
        ],
      },
      NO(/select \* from mem_world where wid = \?/i),
      { match: /select uid from sys_troops where cid = \? limit 1/i, rows: [{ uid: 0 }] },
      { match: /select uid from sys_city where cid = \?/i, rows: [] },
      NO(/select \* from sys_user where uid = \?/i),
      { match: /select name from sys_battle_city where cid = \?/i, rows: [{ name: '虎牢关' }] },
      // resetBattleFieldUid: no troops left at the origin, garrison at the target is gone → both
      // empty → unionid -1 (the 虎牢关 gate then fails: unionid != 1).
      {
        match: /select \* from sys_troops where cid = \?\s+and \(\(state = 4 or state = 3\)/i,
        rows: [],
      },
      {
        match: /select uid, unionid from sys_battle_city where cid = \?/i,
        rows: [{ uid: 2, unionid: 2 }],
      },
      // No cfg_battle_event rows for this triggerid.
      NO(/select \* from cfg_battle_event/i),
      { match: /select level from sys_user_battle_field where id = \?/i, rows: [{ level: 5 }] },
      ...TAIL,
    ]);
    await tick.handleTroop();
    expect(
      db.executed.some((e) =>
        /update sys_troops set cid = \?, state = 4, battleid = 0\s*where id = \?/i.test(e.sql),
      ),
    ).toBe(true);
    // resetBattleFieldUid ran for cid, then twice for targetcfg (bresult + the winpoint call).
    const judges = db.executed.filter((e) =>
      /select \* from sys_troops where cid = \?\s+and \(\(state = 4 or state = 3\)/i.test(e.sql),
    );
    expect(judges).toHaveLength(3);
    // The event query is keyed by triggerid = targetcid % 1000.
    const events = db.executed.find((e) => /from cfg_battle_event/i.test(e.sql))!;
    expect(events.sql).toMatch(/where triggerid = \? % 1000 and bid = \?\s*and unionid = \?/i);
    expect(events.parameters).toEqual([630367, 1001, 1]);
    // 完整流程收尾：任务级联没有触发（unionid != 1），winpoint 死块保持不写。
    expect(db.executed.some((e) => /replace into sys_user_goal/i.test(e.sql))).toBe(false);
    expect(db.executed.some((e) => /update sys_battle_winpoint/i.test(e.sql))).toBe(false);
  });

  it('state 1 battlefield return (task > 7, cid != startcid): troop parks at the landing stronghold', async () => {
    const { tick, db } = build([
      {
        match: /from sys_troops\s+where endtime > 0/i,
        rows: [
          {
            id: 9,
            uid: 1001,
            hid: 42,
            cid: 630367,
            targetcid: 630001,
            task: 8,
            state: 1,
            battlefieldid: 30,
            bid: 1001,
            battleunionid: 1,
            startcid: 630001,
            soldiers: '1,1,500',
            resource: '0,100,0,0,0',
            people: 0,
            fooduse: 0,
          },
        ],
      },
      NO(/select \* from mem_world where wid = \?/i),
      { match: /select uid from sys_troops where cid = \? limit 1/i, rows: [{ uid: 0 }] },
      { match: /select uid from sys_city where cid = \?/i, rows: [] },
      NO(/select \* from sys_user where uid = \?/i),
      { match: /select name from sys_battle_city where cid = \?/i, rows: [{ name: '虎牢关' }] },
      {
        match: /select \* from sys_troops where cid = \?\s+and \(\(state = 4 or state = 3\)/i,
        rows: [],
      },
      {
        match: /select uid, unionid from sys_battle_city where cid = \?/i,
        rows: [{ uid: 2, unionid: 2 }],
      },
      ...TAIL,
    ]);
    await tick.handleTroop();
    // Parked, battleid cleared — NOT deleted, no soldiers dropped into a city.
    expect(
      db.executed.some((e) =>
        /update sys_troops set state = 4, battleid = 0 where id = \?/i.test(e.sql),
      ),
    ).toBe(true);
    expect(db.executed.some((e) => /delete from sys_troops/i.test(e.sql))).toBe(false);
    expect(db.executed.some((e) => /insert into sys_city_soldier/i.test(e.sql))).toBe(false);
    // The stronghold it left was re-judged; the return report (task 8 state 1 → title 37) filed.
    expect(db.executed.some((e) => /update sys_battle_city/i.test(e.sql))).toBe(true);
    const report = db.executed.find((e) => /insert into sys_report/i.test(e.sql))!;
    expect(report.parameters[5]).toBe(37);
  });
});
