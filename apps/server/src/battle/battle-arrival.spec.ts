import { describe, expect, it } from 'vitest';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { MailService } from '../core/mail.service';
import { RandomService } from '../core/random.service';
import { ReportService } from '../core/report.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { BattleArrivalService } from './battle-arrival.service';
import type { ArrivalArgs } from './battle-arrival';

const lang = new LangService({
  report: { troopback: '%s%s%s', warming: '!%s!', resource: '%s金%s粮%s木%s石%s铁%s' },
  battle: { none: '野地空无一人', youend: '--youend--' },
});

const random = { rand: () => 0, randRange: () => 0, mtRand: () => 0 } as unknown as RandomService;

function service(rules: Respond[]) {
  const db = new FakeDb(rules);
  const svc = new BattleArrivalService(
    db.scope,
    lang,
    new CityRules(db.scope),
    new HeroRules(db.scope),
    new TaskRules(db.scope, new UserRules(db.scope)),
    new ReportService(db.scope, new MailService(db.scope)),
    random,
  );
  return { svc, db };
}

const NO = (match: RegExp): Respond => ({ match, rows: [] });

function args(over: Partial<ArrivalArgs>): ArrivalArgs {
  return {
    row: {
      id: 1,
      soldiers: '1,1,100',
      resource: '0',
      battleid: 0,
      battleunionid: 0,
      targettroopid: 0,
      people: 0,
      fooduse: 0,
    },
    uid: 1001,
    hid: 42,
    cid: 3003,
    id: 1,
    targetcid: 5005,
    task: 4,
    state: 0,
    field: { wid: 1, type: 1, level: 0, uid: 0, province: 1, ownercid: 0 },
    type: 0,
    cityname: '本城（3,3）',
    targetcityname: '野地（5,5）',
    happencid: 5005,
    soldierArray: new Map([[1, 100]]),
    content: '标题',
    sProvince: 1,
    ...over,
  };
}

describe('BattleArrival empty-field (占领) early-out', () => {
  it('captures an empty wild field (野地空无一人) and files the report', async () => {
    const { svc, db } = service([
      // no other state-3 troop fighting here
      NO(/select 1 as x from sys_troops/i),
      // no stationed defender troop → targetrow false
      NO(/select \* from sys_troops where state = 4/i),
      // task 4 field-room check: 官府 level 5, 0 fields held → room available → take it.
      {
        match: /select level as v from sys_building where cid = \? and bid = 6/i,
        rows: [{ v: 5 }],
      },
      {
        match: /select count\(ownercid\) as v from mem_world where ownercid = \? and type > 0/i,
        rows: [{ v: 0 }],
      },
      NO(/.*/),
    ]);
    await svc.handle(
      args({
        task: 4,
        type: 0,
        field: { wid: 1, type: 1, level: 1, uid: 0, province: 1, ownercid: 0 },
      }),
    );
    // The empty field is taken over: ownercid set, troop state 4.
    expect(
      db.executed.some((q) =>
        /update mem_world set updatetime = unix_timestamp\(\), ownercid = \? where wid = \?/i.test(
          q.sql,
        ),
      ),
    ).toBe(true);
    expect(
      db.executed.some((q) => /update sys_troops set state = 4 where id = \?/i.test(q.sql)),
    ).toBe(true);
    // The arrival report is filed.
    expect(db.executed.some((q) => /insert into sys_report/i.test(q.sql))).toBe(true);
  });

  it('turns a 掠夺 (task 3) home when the field is empty', async () => {
    const { svc, db } = service([
      NO(/select 1 as x from sys_troops/i),
      NO(/select \* from sys_troops where state = 4/i),
      NO(/.*/),
    ]);
    await svc.handle(
      args({
        task: 3,
        type: 0,
        field: { wid: 1, type: 1, level: 1, uid: 0, province: 1, ownercid: 0 },
      }),
    );
    // 掠夺 against nothing: hero set to 2, troop turned home.
    expect(
      db.executed.some((q) => /update sys_city_hero set state = 2 where hid = \?/i.test(q.sql)),
    ).toBe(true);
    expect(
      db.executed.some((q) => /update sys_troops set state = 1,.*where id = \?/is.test(q.sql)),
    ).toBe(true);
  });
});

describe('BattleArrival starts a battle against a stationed defender', () => {
  it('inserts sys_battle + mem_battle and sets both troops to state 3', async () => {
    const { svc, db } = service([
      NO(/select 1 as x from sys_troops/i),
      // a stationed defender troop exists
      {
        match: /select \* from sys_troops where state = 4/i,
        rows: [
          {
            id: 999,
            uid: 1002,
            hid: 7,
            soldiers: '1,3,500',
            state: 4,
            task: 5,
            resource: '0',
            people: 0,
            fooduse: 0,
            targetcid: 5005,
          },
        ],
      },
      { match: /insert into sys_battle /i, insertId: 77 },
      // soldier stat lookups for battleAdd
      {
        match: /select sid, speed, `range`, hp, ap, dp, type from cfg_soldier/i,
        rows: [
          { sid: 1, speed: 100, range: 50, hp: 100, ap: 50, dp: 30, type: 1 },
          { sid: 3, speed: 200, range: 50, hp: 60, ap: 40, dp: 20, type: 3 },
        ],
      },
      NO(/.*/),
    ]);
    // Attacker value must NOT overwhelm (avoid the 3.5x early win): give the defender 500 sid-3.
    await svc.handle(
      args({
        task: 9,
        type: 0,
        row: {
          id: 1,
          soldiers: '1,1,100',
          resource: '0',
          battleid: 0,
          battleunionid: 0,
          targettroopid: 0,
          people: 0,
          fooduse: 0,
        },
        field: { wid: 1, type: 0, level: 0, uid: 1002, province: 1, ownercid: 5005 },
      }),
    );
    expect(db.executed.some((q) => /insert into sys_battle /i.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /replace into mem_battle /i.test(q.sql))).toBe(true);
    expect(
      db.executed.some((q) => /update sys_troops set state = 3, battleid = \?/i.test(q.sql)),
    ).toBe(true);
    // bak_troops snapshots saved.
    expect(db.executed.some((q) => /insert into bak_troops /i.test(q.sql))).toBe(true);
  });
});
