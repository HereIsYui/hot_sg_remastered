import { describe, expect, it } from 'vitest';
import { ExternService } from './extern.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';

const NO = (match: RegExp): Respond => ({ match, rows: [] });

describe('ExternService.getTroopMaxTime', () => {
  it('returns 0 outside the promo window (the only behaviour that ever happens now)', async () => {
    const db = new FakeDb([
      // `between` both windows resolve to not-matching (0).
      { match: /select unix_timestamp\(\) between/i, rows: [{ hit: 0 }] },
      NO(/.*/),
    ]);
    const svc = new ExternService(db.scope);
    expect(await svc.getTroopMaxTime([120, 340])).toBe(0);
    // Only the window check runs; the mem_world / sys_city lookups are skipped.
    expect(db.executed.every((q) => !/from mem_world/i.test(q.sql))).toBe(true);
  });

  it('caps a human-owned tile to 900 while the window is open', async () => {
    const db = new FakeDb([
      { match: /select unix_timestamp\(\) between/i, rows: [{ hit: 1 }] },
      { match: /select ownercid from mem_world where wid = \?/i, rows: [{ ownercid: 5005 }] },
      { match: /select uid from sys_city where cid = \?/i, rows: [{ uid: 1001 }] },
      NO(/.*/),
    ]);
    const svc = new ExternService(db.scope);
    expect(await svc.getTroopMaxTime2(120, 340)).toBe(900);
  });
});
