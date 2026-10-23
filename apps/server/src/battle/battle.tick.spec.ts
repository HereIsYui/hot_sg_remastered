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
  it('settles a pending 演习 to an attacker win and writes state=1,result=0', async () => {
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

    const update = db.executed.find((q) => /update mem_maneuver set state = /i.test(q.sql));
    expect(update).toBeDefined();
    // result (0 = attacker win) and round (1) are bound parameters.
    expect(update!.parameters).toContain(0);
    expect(update!.parameters).toContain(1);
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
