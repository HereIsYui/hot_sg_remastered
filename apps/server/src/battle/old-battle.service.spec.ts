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
import { OldBattleService } from './old-battle.service';

const lang = new LangService({
  report: {
    title: '%s %s %s',
    title_2row: { '0': '', '1': '', '2': '' },
    b_titles: 'round%s %s %s %s %s %s%s',
    armynumss: '%s:%s/-%s ',
    b_adtroopss: '%s:%s ',
    b_count: '%s×%s ',
    b_sbinfo: '%s %s %s %s',
    get: '威望%s 经验%s 伤兵%s%% ',
    detectreport: '%s',
    title_end: '--end--',
    resource: '%s金%s粮%s木%s石%s铁%s',
    troopback: '%s%s%s',
    warming: '!%s!',
    br: '<br/>',
  },
  battle: {
    patrol_report_soldier: { '1': '民夫', '3': '斥候' },
    patrol_report_defence: { '1': '陷阱' },
    none: '无人',
    youend: '--youend--',
    losthero: '损将%s(%s)',
    catchhero: '擒获%s(%s)',
    invademsg: '%s%s被%s占领',
    citytype: '城池',
  },
  soldier: { usepeople: { '1': 1, '3': 1 } },
});

const random = { randRange: () => 0, mtRand: () => 0 } as unknown as RandomService;

function service(rules: Respond[]) {
  const db = new FakeDb(rules);
  const svc = new OldBattleService(
    db.scope,
    lang,
    new CityRules(db.scope),
    new HeroRules(db.scope),
    new TaskRules(db.scope, new UserRules(db.scope)),
    new UserRules(db.scope),
    new ReportService(db.scope, new MailService(db.scope)),
    random,
  );
  return { svc, db };
}

const NO = (match: RegExp): Respond => ({ match, rows: [] });
/** Catch-all so unstubbed bookkeeping writes/reads resolve to empty. */
const TAIL: Respond[] = [NO(/.*/)];

describe('getBattleResult via OldBattleService.resultDeps', () => {
  /**
   * A 掠夺 (task 3, type 0) the attacker wins: the attacker troop is turned home (state 1) with its
   * surviving soldiers; the report is filed. We drive getBattleResult directly with a mem_battle
   * row and end=0.
   */
  it('settles a won field 掠夺: attacker turned home, defender troop deleted, report filed', async () => {
    const { svc, db } = service([
      { match: /select \* from sys_battle where id = /i, rows: [{ id: 7, resistdefence: '' }] },
      {
        match: /select \* from bak_troops where battleid = /i,
        rows: [
          {
            id: 101,
            uid: 1001,
            task: 3,
            state: 0,
            cid: 3003,
            soldiers: '1,1,100',
            resource: '0',
            battlefieldid: 0,
            startcid: 3003,
          },
          {
            id: 202,
            uid: 0,
            task: 5,
            state: 4,
            cid: 5005,
            soldiers: '1,3,50',
            resource: '0',
            battlefieldid: 0,
            startcid: 5005,
          },
        ],
      },
      {
        match: /select \* from sys_user where uid = /i,
        rows: [{ uid: 1001, prestige: 100, nobility: 1 }],
      },
      { match: /select \* from mem_world where wid = /i, rows: [{ wid: 1, type: 1, level: 2 }] },
      // hero need-exp lookups, etc. → empty
      ...TAIL,
    ]);

    const mem = {
      id: 7,
      type: 0,
      round: 3,
      attacksoldiers: '1,1,80',
      resistsoldiers: '0',
      state: 0,
      attackcid: 3003,
      resistcid: 5005,
      attackhid: 42,
      resisthid: 0,
    };
    await svc.resultDeps().query; // touch to ensure deps build
    const { getBattleResult } = await import('./battle-result');
    await getBattleResult(svc.resultDeps(), mem, 0);

    // The 掠夺 winner's troop is turned home (state 1) via the task-3 branch.
    expect(
      db.executed.some((q) => /update sys_troops set state = 1,.*where id = \?/is.test(q.sql)),
    ).toBe(true);
    // The defender's stationed troop (troopid2) is deleted.
    expect(db.executed.some((q) => /delete from sys_troops where id = \?/i.test(q.sql))).toBe(true);
    // A report was filed for the attacker.
    expect(db.executed.some((q) => /insert into sys_report/i.test(q.sql))).toBe(true);
  });

  /**
   * A defender win (end=1) on a field battle (type 0): the attacker troop is deleted, the
   * defender's troop restated to 4, the defender hero freed.
   */
  it('settles a lost field battle: attacker troop deleted, defender restated', async () => {
    const { svc, db } = service([
      { match: /select \* from sys_battle where id = /i, rows: [{ id: 8, resistdefence: '' }] },
      {
        match: /select \* from bak_troops where battleid = /i,
        rows: [
          {
            id: 301,
            uid: 1001,
            task: 3,
            state: 0,
            cid: 3003,
            soldiers: '1,1,100',
            resource: '0',
            battlefieldid: 0,
          },
          {
            id: 402,
            uid: 1002,
            task: 5,
            state: 4,
            cid: 5005,
            soldiers: '1,3,50',
            resource: '0',
            battlefieldid: 0,
          },
        ],
      },
      {
        match: /select \* from sys_user where uid = /i,
        rows: [{ uid: 1001, prestige: 100, nobility: 1 }],
      },
      { match: /select \* from mem_world where wid = /i, rows: [{ wid: 1, type: 1 }] },
      ...TAIL,
    ]);
    const mem = {
      id: 8,
      type: 0,
      round: 5,
      attacksoldiers: '0',
      resistsoldiers: '1,3,40',
      state: 0,
      attackcid: 3003,
      resistcid: 5005,
      attackhid: 42,
      resisthid: 7,
    };
    const { getBattleResult } = await import('./battle-result');
    await getBattleResult(svc.resultDeps(), mem, 1);
    // end=1 type 0: delete attacker troop, set defender troop state 4.
    expect(db.executed.some((q) => /delete from sys_troops where id = \?/i.test(q.sql))).toBe(true);
    expect(
      db.executed.some((q) => /update sys_troops set state = 4,.*where id = \?/is.test(q.sql)),
    ).toBe(true);
  });

  /**
   * A 占领 (task 4, type 1) the attacker wins with the morale/nobility gates open: the city is
   * taken over (sys_city.uid reassigned, chiefhid set), its transient tables cleared.
   */
  it('settles a won 占领: city re-owned and garrison cleared', async () => {
    const { svc, db } = service([
      {
        match: /select \* from sys_battle where id = /i,
        rows: [{ id: 9, resistdefence: '1,1,16,0,10' }],
      },
      {
        match: /select \* from bak_troops where battleid = /i,
        rows: [
          {
            id: 501,
            uid: 1001,
            task: 4,
            state: 0,
            cid: 3003,
            soldiers: '1,1,2000',
            resource: '0',
            battlefieldid: 0,
          },
          {
            id: 602,
            uid: 1002,
            task: 5,
            state: 4,
            cid: 5005,
            soldiers: '1,3,50',
            resource: '0',
            battlefieldid: 0,
          },
        ],
      },
      {
        match: /select \* from sys_user where uid = /i,
        rows: [{ uid: 1001, prestige: 100, nobility: 9 }],
      },
      { match: /select \* from mem_world where wid = /i, rows: [{ wid: 1, type: 0, level: 0 }] },
      // the city-capture morale gate: morale already 0 (can = 1), type 0 city.
      {
        match: /select r.morale, r.complaint, c.type, c.name/i,
        rows: [{ morale: 0, complaint: 0, type: 0, name: '乐城', province: 1, jun: 1 }],
      },
      { match: /select count\(cid\) as c from sys_city where uid = /i, rows: [{ c: 2 }] },
      { match: /select \* from sys_city_hero where cid = /i, rows: [] },
      ...TAIL,
    ]);
    const mem = {
      id: 9,
      type: 1,
      round: 7,
      attacksoldiers: '1,1,1500',
      resistsoldiers: '0',
      state: 0,
      attackcid: 3003,
      resistcid: 5005,
      attackhid: 42,
      resisthid: 0,
    };
    const { getBattleResult } = await import('./battle-result');
    await getBattleResult(svc.resultDeps(), mem, 0);
    // City ownership transferred and chief set.
    expect(
      db.executed.some((q) => /update sys_city set uid = \? where cid = \?/i.test(q.sql)),
    ).toBe(true);
    expect(
      db.executed.some((q) => /update sys_city set chiefhid = \? where cid = \?/i.test(q.sql)),
    ).toBe(true);
    // Garrison cleared.
    expect(
      db.executed.some((q) => /delete from `?sys_city_soldier`? where cid = \?/i.test(q.sql)),
    ).toBe(true);
  });

  /**
   * 抓将 on a 占领 (type 1) city win: the winner's city has a free hero slot, so chose_hero picks
   * the defeated city's low-loyalty hero and catchHero captures it — hid moves to the attacker
   * (state 5, loyalty 0) and a sys_hero_captive row is written.
   */
  it('captures the defending hero on a won city 占领 (catchHero → sys_hero_captive)', async () => {
    const { svc, db } = service([
      { match: /select \* from sys_battle where id = /i, rows: [{ id: 10, resistdefence: '' }] },
      {
        match: /select \* from bak_troops where battleid = /i,
        rows: [
          {
            id: 701,
            uid: 1001,
            task: 4,
            state: 0,
            cid: 3003,
            soldiers: '1,1,2000',
            resource: '0',
            battlefieldid: 0,
          },
          {
            id: 802,
            uid: 894,
            task: 5,
            state: 4,
            cid: 5005,
            soldiers: '1,3,50',
            resource: '0',
            battlefieldid: 0,
          },
        ],
      },
      {
        match: /select \* from sys_user where uid = /i,
        rows: [{ uid: 1001, prestige: 100, nobility: 1 }],
      },
      { match: /select \* from mem_world where wid = /i, rows: [{ wid: 1, type: 0, level: 1 }] },
      {
        match: /select r.morale, r.complaint, c.type, c.name/i,
        rows: [{ morale: 0, complaint: 0, type: 0, name: '乐城', province: 1, jun: 1 }],
      },
      { match: /select count\(cid\) as c from sys_city where uid = /i, rows: [{ c: 2 }] },
      // cityHasHeroPosition: the attacker's city has a free counsellor slot.
      {
        match: /select chiefhid, generalid, counsellorid from sys_city where uid = /i,
        rows: [{ chiefhid: 42, generalid: 1, counsellorid: 0 }],
      },
      // chose_hero: one defender hero, loyalty 10 (<=40 → always in the list).
      {
        match: /select \* from sys_city_hero where \(cid = /i,
        rows: [{ hid: 555, uid: 894, cid: 5005, level: 10, loyalty: 10, herotype: 0, npcid: 0 }],
      },
      // catchHero exp lookup.
      { match: /select total_exp as v from cfg_hero_level/i, rows: [{ v: 5000 }] },
      // defcityadd's post-capture hero list for throwHeroToField loop (none).
      { match: /select \* from sys_city_hero where cid = \? and uid = /i, rows: [] },
      ...TAIL,
    ]);
    const mem = {
      id: 10,
      type: 1,
      round: 7,
      attacksoldiers: '1,1,1500',
      resistsoldiers: '0',
      state: 0,
      attackcid: 3003,
      resistcid: 5005,
      attackhid: 42,
      resisthid: 555,
    };
    // mtRand returns 100 so loyalty(10) <= catchRoll(100) → captured.
    const d = svc.resultDeps();
    (d as unknown as { mtRand: () => number }).mtRand = () => 100;
    const { getBattleResult } = await import('./battle-result');
    await getBattleResult(d, mem, 0);
    // hero hid 555 captured: moved to attacker, state 5, loyalty 0.
    expect(
      db.executed.some((q) =>
        /update sys_city_hero set uid = \?, cid = \?, state = 5/i.test(q.sql),
      ),
    ).toBe(true);
    expect(db.executed.some((q) => /replace into sys_hero_captive/i.test(q.sql))).toBe(true);
  });

  /**
   * 抓将 miss → flee: a 占领 (type 0, field) win where the catch roll fails (loyalty > roll). The
   * hero's loyalty drops 3 and, on a wild field with an NPC hero and run>3, it flees
   * (throwHeroToField). Drives catchHero's else branch via applyOutcome's 占领野地 path.
   */
  it('on a missed catch the NPC field hero loyalty-drops and flees', async () => {
    const { svc, db } = service([
      { match: /select \* from sys_battle where id = /i, rows: [{ id: 11, resistdefence: '' }] },
      {
        match: /select \* from bak_troops where battleid = /i,
        rows: [
          {
            id: 901,
            uid: 1001,
            task: 4,
            state: 0,
            cid: 3003,
            soldiers: '1,1,2000',
            resource: '0',
            battlefieldid: 0,
          },
          {
            id: 902,
            uid: 894,
            task: 5,
            state: 4,
            cid: 5005,
            soldiers: '1,3,50',
            resource: '0',
            battlefieldid: 0,
          },
        ],
      },
      {
        match: /select \* from sys_user where uid = /i,
        rows: [{ uid: 1001, prestige: 100, nobility: 1 }],
      },
      { match: /select \* from mem_world where wid = /i, rows: [{ wid: 1, type: 4, level: 2 }] },
      // the 占领野地 branch reads the defeated defender hero (herotype 0).
      {
        match: /select \* from sys_city_hero where hid = \? and herotype = 0/i,
        rows: [{ hid: 556, uid: 894, cid: 5005, level: 8, loyalty: 90, herotype: 0, npcid: 0 }],
      },
      // checkFeildCount: room available.
      {
        match: /select level as v from sys_building where cid = \? and bid = 6/i,
        rows: [{ v: 5 }],
      },
      {
        match: /select count\(ownercid\) as v from mem_world where ownercid = \? and type > 0/i,
        rows: [{ v: 0 }],
      },
      ...TAIL,
    ]);
    const mem = {
      id: 11,
      type: 0,
      round: 7,
      attacksoldiers: '1,1,1500',
      resistsoldiers: '0',
      state: 0,
      attackcid: 3003,
      resistcid: 5005,
      attackhid: 42,
      resisthid: 556,
    };
    // mtRand returns 1 → catchRoll 1 < loyalty 90 → miss; then run = 1... but we want run>3 to flee.
    // The first mtRand in catchHero is the catch roll, the second is `run`. Return 1 then 20.
    const seq = [1, 20];
    let i = 0;
    const d = svc.resultDeps();
    (d as unknown as { mtRand: () => number }).mtRand = () => seq[i++ % seq.length]!;
    const { getBattleResult } = await import('./battle-result');
    await getBattleResult(d, mem, 0);
    // missed: loyalty-3 applied, and throwHeroToField was NOT reached via capture (no captive row).
    expect(
      db.executed.some((q) => /update sys_city_hero set loyalty = loyalty - 3/i.test(q.sql)),
    ).toBe(true);
    expect(db.executed.some((q) => /replace into sys_hero_captive/i.test(q.sql))).toBe(false);
  });
});

describe('OldBattleService.settleDueBattles', () => {
  it('deletes a finished battle (sys_battle.state=1) without advancing it', async () => {
    const { svc, db } = service([
      {
        match: /select \* from mem_battle where nexttime <= unix_timestamp\(\)/i,
        rows: [{ id: 5 }],
      },
      { match: /select state as v from sys_battle where id = /i, rows: [{ v: 1 }] },
      NO(/delete from mem_battle where id = /i),
    ]);
    await svc.settleDueBattles();
    expect(db.executed.some((q) => /delete from mem_battle where id = /i.test(q.sql))).toBe(true);
    // updateBattle was NOT entered.
    expect(db.executed.some((q) => /select \* from mem_battle where id = /i.test(q.sql))).toBe(
      false,
    );
  });

  it('raiseWarEvent inserts a mem_war_event row', async () => {
    const { svc, db } = service([NO(/.*/)]);
    await svc.raiseWarEvent(7, 3, 2, '盟军击败了敌军');
    expect(db.executed.some((q) => /insert into mem_war_event/i.test(q.sql))).toBe(true);
  });
});
