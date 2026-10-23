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

describe('ExternService.getEnemyTroopSet', () => {
  it('returns the city filter rows', async () => {
    const rows = [
      { cid: 5005, action: 2, count: 100 },
      { cid: 5005, action: 3, count: 50 },
    ];
    const db = new FakeDb([
      { match: /select \* from sys_enemy_troop_filter where cid = \?/i, rows },
      NO(/.*/),
    ]);
    const svc = new ExternService(db.scope);
    expect(await svc.getEnemyTroopSet([5005])).toEqual(rows);
  });

  it('returns an empty list for an un-configured city', async () => {
    const db = new FakeDb([NO(/.*/)]);
    const svc = new ExternService(db.scope);
    expect(await svc.getEnemyTroopSet([5005])).toEqual([]);
  });
});

describe('ExternService.saveEnemyTroopSet', () => {
  it('rejects a 烽火台 below level 5', async () => {
    const db = new FakeDb([
      {
        match: /select level from sys_building\s+where cid = \? and bid = \? limit 1/i,
        rows: [{ level: 4 }],
      },
      NO(/.*/),
    ]);
    const svc = new ExternService(db.scope);
    await expect(svc.saveEnemyTroopSet([5005, [{ action: 2, count: 100 }]])).rejects.toMatchObject({
      key: 'enemyfilter.firelevelhow',
    });
  });

  it('rejects when the 烽火台 is missing entirely', async () => {
    const db = new FakeDb([NO(/select level from sys_building/i), NO(/.*/)]);
    const svc = new ExternService(db.scope);
    await expect(svc.saveEnemyTroopSet([5005, []])).rejects.toMatchObject({
      key: 'enemyfilter.firelevelhow',
    });
  });

  it('upserts each action and marks goal 539 for the owner at level 5+', async () => {
    const db = new FakeDb([
      {
        match: /select level from sys_building\s+where cid = \? and bid = \? limit 1/i,
        rows: [{ level: 5 }],
      },
      NO(/insert into sys_enemy_troop_filter/i),
      { match: /select uid from sys_city where cid = \?/i, rows: [{ uid: 1001 }] },
      NO(/replace into sys_user_goal/i),
      NO(/.*/),
    ]);
    const svc = new ExternService(db.scope);
    await svc.saveEnemyTroopSet([
      5005,
      [
        { action: 2, count: 100 },
        { action: 3, count: 50 },
      ],
    ]);
    const inserts = db.executed.filter((q) => /insert into sys_enemy_troop_filter/i.test(q.sql));
    expect(inserts).toHaveLength(2);
    expect(db.executed.some((q) => /replace into sys_user_goal \(uid, gid\)/i.test(q.sql))).toBe(
      true,
    );
  });
});
