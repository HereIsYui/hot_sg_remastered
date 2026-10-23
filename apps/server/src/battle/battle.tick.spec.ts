import { describe, expect, it } from 'vitest';
import { RandomService } from '../core/random.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { BattleEngineService } from './battle-engine.service';
import { BattleTick } from './battle.tick';

/** Deterministic RNG: the unopposed maneuver below never calls it, so any stub is fine. */
const random = { mtRand: () => 0 } as unknown as RandomService;

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const engine = new BattleEngineService(db.scope, random);
  const tick = new BattleTick(db.scope, engine);
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

  it('leaves due mem_battle rows untouched (time-stepped engine not ported)', async () => {
    const { tick, db } = build([
      NO(/select \* from mem_maneuver where state = 0/i),
      { match: /select id from mem_battle/i, rows: [{ id: 5 }] },
    ]);

    await tick.handleBattle();

    // No write against mem_battle — the scaffold only reads.
    const wrote = db.executed.some((q) => /(update|delete|insert).*mem_battle/i.test(q.sql));
    expect(wrote).toBe(false);
  });
});
