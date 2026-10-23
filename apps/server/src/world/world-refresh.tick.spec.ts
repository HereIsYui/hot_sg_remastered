import type { SchedulerRegistry } from '@nestjs/schedule';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/app-config';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { WORLD_REFRESH_STATE, WorldRefreshService } from './world-refresh.tick';

const scheduler = {} as unknown as SchedulerRegistry;

const NO = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const config = loadConfig({ WORLD_REFRESH_INTERVAL_MS: String(8 * 3600 * 1000) });
  const svc = new WorldRefreshService(config, db.scope, scheduler);
  return { svc, db };
}

describe('WorldRefreshService.refresh', () => {
  it('stamps the run time, regrows abandoned fields and clears their NPC schedule', async () => {
    const now = 2_000_000_000;
    const { svc, db } = build([NO(/.*/)]);
    const touched = await svc.refresh(now);
    expect(touched).toBe(0); // FakeDb reports no affected rows

    const stamp = db.executed.find((q) => /update mem_state set value = \?/i.test(q.sql));
    expect(stamp?.parameters).toContain(now);
    expect(stamp?.parameters).toContain(WORLD_REFRESH_STATE);

    expect(
      db.executed.some(
        (q) =>
          /update mem_world set level = level \+ 1/i.test(q.sql) &&
          /ownercid = 0 and state = 0 and level < maxlevel/i.test(q.sql),
      ),
    ).toBe(true);

    expect(
      db.executed.some((q) => /update mem_world_schedule set last_create_npc = 0/i.test(q.sql)),
    ).toBe(true);
  });
});

describe('WorldRefreshService.tick', () => {
  it('skips when the 8-hour window has not elapsed', async () => {
    const now = 2_000_000_000;
    const { svc, db } = build([
      { match: /select unix_timestamp\(\) as now/i, rows: [{ now }] },
      { match: /select value from mem_state/i, rows: [{ value: now - 3600 }] }, // 1h ago
      NO(/.*/),
    ]);
    expect(await svc.tick()).toBeNull();
    expect(db.executed.some((q) => /update mem_world set level/i.test(q.sql))).toBe(false);
  });

  it('runs when the window has elapsed', async () => {
    const now = 2_000_000_000;
    const { svc, db } = build([
      { match: /select unix_timestamp\(\) as now/i, rows: [{ now }] },
      { match: /select value from mem_state/i, rows: [{ value: now - 9 * 3600 }] }, // 9h ago
      NO(/.*/),
    ]);
    expect(await svc.tick()).toBe(0);
    expect(db.executed.some((q) => /update mem_world set level/i.test(q.sql))).toBe(true);
  });
});
