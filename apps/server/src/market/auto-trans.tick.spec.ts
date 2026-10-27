import { describe, expect, it } from 'vitest';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { AutoTransTick } from './auto-trans.tick';

const no = (match: RegExp): Respond => ({ match, rows: [] });

function build(rows: Record<string, unknown>[], food = 1000) {
  const db = new FakeDb([
    { match: /select \* from mem_city_autotrans/i, rows },
    { match: /select food from mem_city_resource/i, rows: [{ food }] },
    no(/.*/),
  ]);
  return { db, tick: new AutoTransTick(db.scope) };
}

const row = {
  id: 91,
  uid: 1001,
  fromcid: 209355,
  tocid: 200350,
  trans_type: 0,
  res_type: 0,
  count: 100,
  distance: 12.5,
  end_time: 1700000000,
};

describe('AutoTransTick.handleAutoTrans', () => {
  it('does nothing when no transport is due', async () => {
    const { db, tick } = build([]);
    await tick.handleAutoTrans();
    expect(db.executed).toHaveLength(1);
  });

  it('removes a single transport, deducts food and creates its caravan', async () => {
    const { db, tick } = build([row]);
    await tick.handleAutoTrans();

    expect(db.executed.some((q) => /delete from mem_city_autotrans where id/i.test(q.sql))).toBe(
      true,
    );
    const insert = db.executed.find((q) => /insert into sys_city_trade/i.test(q.sql));
    expect(insert?.parameters).toEqual([209355, 0, 100, 12.5, 1700000000, 200350]);
  });

  it('advances a daily transport and preserves the original all-types-deduct-food quirk', async () => {
    const { db, tick } = build([{ ...row, trans_type: 1, res_type: 3 }]);
    await tick.handleAutoTrans();

    const daily = db.executed.find((q) => /update mem_city_autotrans set start_time/i.test(q.sql));
    expect(daily).toBeDefined();
    expect(db.executed.some((q) => /set food = greatest/i.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /set iron/i.test(q.sql))).toBe(false);
    expect(db.executed.find((q) => /insert into sys_city_trade/i.test(q.sql))?.parameters[1]).toBe(
      3,
    );
  });

  it('stops the whole handler on insufficient food after updating the schedule', async () => {
    const { db, tick } = build([row, { ...row, id: 92 }], 99);
    await tick.handleAutoTrans();

    expect(db.executed.some((q) => /delete from mem_city_autotrans/i.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /update mem_city_resource/i.test(q.sql))).toBe(false);
    expect(db.executed.some((q) => /insert into sys_city_trade/i.test(q.sql))).toBe(false);
    expect(
      db.executed.filter((q) => /select food from mem_city_resource/i.test(q.sql)),
    ).toHaveLength(1);
  });
});
