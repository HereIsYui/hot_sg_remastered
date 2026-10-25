import { describe, expect, it } from 'vitest';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { GoodsRules } from '../core/goods-rules.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { MarketCommands } from './market.commands';

const ctx = { uid: 1001, cid: 209355, ip: 0, sip: '' };
const NOW_TS = 1700000000;
const NO = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const cmd = new MarketCommands(
    db.scope,
    new GoodsRules(db.scope),
    new TaskRules(db.scope, new UserRules(db.scope)),
  );
  return { cmd, db };
}

const NOW: Respond = {
  match: /select unix_timestamp\(\) as v/i,
  rows: [{ v: NOW_TS }],
};
/** addAutoTrans' happy-path reads: own target city, market level 15, an active contract. */
const HAPPY: Respond[] = [
  NOW,
  { match: /cfg_task_goal/i, rows: [{ id: 314001 }] },
  { match: /select \* from sys_city where cid = \? and uid = \?/i, rows: [{ cid: 200350 }] },
  { match: /select level as v from sys_building where cid = \?/i, rows: [{ v: 15 }] },
  { match: /select \* from mem_user_buffer/i, rows: [{ buftype: 17 }] },
  { match: /select buftype as v from mem_user_buffer/i, rows: [{ buftype: 17 }] },
  { match: /select count\(\*\) as v from mem_city_autotrans/i, rows: [{ v: 0 }] },
  NO(/insert into mem_city_autotrans/i),
  NO(/replace into sys_user_goal/i),
];

describe('MarketCommands.addAutoTrans', () => {
  it('rejects a past start time, a foreign target and an over-cap count', async () => {
    const past = build([NOW, NO(/.*/)]);
    await expect(
      past.cmd.addAutoTrans(ctx, [209355, 200350, 1, 1000, 0, (NOW_TS - 10) * 1000]),
    ).rejects.toThrow('auto_trans.not_my_time_error');
    const foreign = build([NOW, { match: /sys_city where cid/i, rows: [] }, NO(/.*/)]);
    await expect(
      foreign.cmd.addAutoTrans(ctx, [209355, 200350, 1, 1000, 0, (NOW_TS + 600) * 1000]),
    ).rejects.toThrow('auto_trans.not_my_city');
    const over = build([
      NOW,
      { match: /sys_city where cid/i, rows: [{ cid: 200350 }] },
      { match: /select level as v from sys_building/i, rows: [{ v: 1 }] },
      NO(/.*/),
    ]);
    await expect(
      over.cmd.addAutoTrans(ctx, [209355, 200350, 1, 999999, 0, (NOW_TS + 600) * 1000]),
    ).rejects.toThrow('auto_trans.max_count');
    void NO;
  });

  it('schedules the transport, computes the distance and completes task 314', async () => {
    const { cmd, db } = build([...HAPPY, NO(/.*/)]);
    await cmd.addAutoTrans(ctx, [209355, 200350, 1, 1000, 0, (NOW_TS + 600) * 1000]);
    const find = (re: RegExp) => db.executed.filter((q) => re.test(q.sql));
    const insert = find(/insert into mem_city_autotrans/i);
    expect(insert).toHaveLength(1);
    // same-city grid (0 distance) → the transport is instantaneous; count 1000 ≤ 15*100000
    expect(insert[0]!.parameters).toContain(0);
    expect(find(/replace into sys_user_goal/i)).toHaveLength(1); // task 314
  });

  it('consumes a 商队契约 when none is active', async () => {
    const { cmd, db } = build([
      NOW,
      { match: /sys_city where cid/i, rows: [{ cid: 200350 }] },
      { match: /select level as v from sys_building/i, rows: [{ v: 15 }] },
      { match: /select \* from mem_user_buffer/i, rows: [] }, // no contract yet
      { match: /select count from sys_goods/i, rows: [{ count: 5 }] }, // owns item 120
      { match: /select buftype as v from mem_user_buffer/i, rows: [{ buftype: 17 }] },
      { match: /select count\(\*\) as v from mem_city_autotrans/i, rows: [{ v: 0 }] },
      NO(/insert into mem_user_buffer/i),
      NO(/insert into sys_goods/i),
      NO(/delete from sys_goods/i),
      NO(/insert into mem_city_autotrans/i),
      NO(/replace into sys_user_goal/i),
      NO(/.*/),
    ]);
    await cmd.addAutoTrans(ctx, [209355, 200350, 1, 1000, 0, (NOW_TS + 600) * 1000]);
    expect(db.executed.some((q) => /insert into mem_user_buffer/i.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /update sys_goods set count = greatest/i.test(q.sql))).toBe(
      true,
    );
  });
});

describe('MarketCommands.hasAutoTrans', () => {
  it('reports the contract state and rejects at the 10-transport cap', async () => {
    const active = build([
      { match: /select \* from mem_user_buffer/i, rows: [{ buftype: 17 }] },
      { match: /select count\(\*\) as v from mem_city_autotrans/i, rows: [{ v: 3 }] },
      NO(/.*/),
    ]);
    expect(await active.cmd.hasAutoTrans(ctx)).toEqual([true]);
    const capped = build([
      { match: /select \* from mem_user_buffer/i, rows: [{ buftype: 17 }] },
      { match: /select count\(\*\) as v from mem_city_autotrans/i, rows: [{ v: 10 }] },
      NO(/.*/),
    ]);
    await expect(capped.cmd.hasAutoTrans(ctx)).rejects.toThrow('auto_trans.max_auto_trans');
  });
});

describe('MarketCommands.removeAutoTrans / getAutoTrans', () => {
  it('removes by id and lists with the city names', async () => {
    const rm = build([NO(/.*/)]);
    expect(await rm.cmd.removeAutoTrans(ctx, [77])).toEqual([77]);
    const list = build([
      {
        match: /from mem_city_autotrans a/i,
        rows: [{ id: 77, fromcity: '长乐宫', tocity: '新城池', count: 1000 }],
      },
      NO(/.*/),
    ]);
    expect(await list.cmd.getAutoTrans(ctx)).toHaveLength(1);
  });
});
