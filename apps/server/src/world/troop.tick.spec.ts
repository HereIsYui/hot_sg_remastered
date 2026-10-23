import { describe, expect, it } from 'vitest';
import { ScoutService } from '../battle/scout';
import { BattleArrivalService } from '../battle/battle-arrival.service';
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

const random = { randRange: () => 0, mtRand: () => 0 } as unknown as RandomService;

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
    ),
    arrival,
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

  it('leaves a battlefield troop (bid != 0) untouched', async () => {
    const { tick, db } = build([
      {
        match: /from sys_troops\s+where endtime > 0/i,
        rows: [
          {
            id: 4,
            uid: 1001,
            hid: 0,
            cid: 3003,
            targetcid: 5005,
            task: 0,
            state: 0,
            battlefieldid: 10001,
            soldiers: '1,1,1',
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
});
