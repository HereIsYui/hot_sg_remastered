import { describe, expect, it } from 'vitest';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { RandomService } from '../core/random.service';
import { ReportService } from '../core/report.service';
import { MailService } from '../core/mail.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { BattleEngineService } from './battle-engine.service';
import { BattleTick } from './battle.tick';
import { OldBattleService } from './old-battle.service';

/** Deterministic RNG: the unopposed maneuver below never calls it, so any stub is fine. */
const random = { mtRand: () => 0, randRange: () => 0 } as unknown as RandomService;

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const engine = new BattleEngineService(db.scope, random);
  const lang = new LangService({});
  const mail = new MailService(db.scope);
  const users = new UserRules(db.scope);
  const old = new OldBattleService(
    db.scope,
    lang,
    new CityRules(db.scope),
    new HeroRules(db.scope),
    new TaskRules(db.scope, users),
    users,
    new ReportService(db.scope, mail),
    random,
  );
  const tick = new BattleTick(db.scope, engine, old);
  return { tick, db };
}

const NO = (match: RegExp): Respond => ({ match, rows: [] });

describe('BattleTick.handleBattle', () => {
  it('leaves an unopposed 演习 unsettled, as legacy upManeuver wrote nothing on an early-out', async () => {
    const { tick, db } = build([
      // one pending maneuver (state 0): 100 attacker scouts, empty field.
      {
        match: /select \* from mem_maneuver where state = 0/i,
        rows: [{ id: 1, attacksoldiers: '1,3,100', resistsoldiers: '0', wallhp: 0 }],
      },
      // the per-id reload inside settleManeuver
      {
        match: /select \* from mem_maneuver where id = /i,
        rows: [{ id: 1, attacksoldiers: '1,3,100', resistsoldiers: '0', wallhp: 0 }],
      },
      NO(/select .* as v from mem_maneuver/i),
      NO(/from mem_battle/i),
    ]);

    await tick.handleBattle();

    // Legacy `upManeuver($id, 0)`'s `update mem_maneuver` sits inside the real-battle `else`,
    // which an empty-defender early-out skips — it writes NOTHING, leaving the row at state=0.
    const update = db.executed.find((q) => /update mem_maneuver set state = /i.test(q.sql));
    expect(update).toBeUndefined();
  });

  it('deletes a due mem_battle whose sys_battle is already finished (state 1)', async () => {
    const { tick, db } = build([
      NO(/select \* from mem_maneuver where state = 0/i),
      {
        match: /select \* from mem_battle where nexttime <= unix_timestamp\(\)/i,
        rows: [{ id: 5 }],
      },
      // HandleBattle's `select state from sys_battle` → 1 (finished) → delete the mem_battle row.
      { match: /select state as v from sys_battle where id = /i, rows: [{ v: 1 }] },
      NO(/delete from mem_battle where id = /i),
    ]);

    await tick.handleBattle();

    // A finished battle's mem_battle row is removed (not advanced).
    expect(db.executed.some((q) => /delete from mem_battle where id = /i.test(q.sql))).toBe(true);
    // updateBattle was NOT entered (no round read).
    expect(db.executed.some((q) => /select \* from mem_battle where id = /i.test(q.sql))).toBe(
      false,
    );
  });
});
