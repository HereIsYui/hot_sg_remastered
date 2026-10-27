import { describe, expect, it, vi } from 'vitest';
import { GoodsRules } from '../core/goods-rules.service';
import type { TaskRules } from '../core/task-rules.service';
import type { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import type { MarketRules } from './market-rules.service';
import { PlayerTradeCommands } from './player-trade.commands';

const ctx = { uid: 1001, cid: 209355, ip: 0, sip: '' };
const no = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[] = []) {
  const db = new FakeDb([...rules, no(/.*/)]);
  const market = {
    tradeUsing: vi.fn(async () => 0),
    marketLevel: vi.fn(async () => 15),
    marketInfo: vi.fn(async () => ['market-info']),
  } as unknown as MarketRules;
  const tasks = { completeTask: vi.fn(async () => {}) } as unknown as TaskRules;
  const users = { logUserAction: vi.fn(async () => {}) } as unknown as UserRules;
  const cmd = new PlayerTradeCommands(db.scope, market, new GoodsRules(db.scope), tasks, users);
  return { cmd, db, market, tasks, users };
}

describe('PlayerTradeCommands.sellToUser', () => {
  it('deducts stock and publishes a sale with its price and distance', async () => {
    const { cmd, db } = build([
      { match: /select \* from mem_city_resource/i, rows: [{ food: 1000 }] },
      { match: /select union_id as v from sys_user/i, rows: [{ v: 0 }] },
    ]);
    expect(await cmd.sellToUser(ctx, [0, 100, 10, 2, 0])).toEqual(['market-info']);
    expect(db.executed.some((q) => /update mem_city_resource set `food`/i.test(q.sql))).toBe(true);
    const insert = db.executed.find((q) => /insert into sys_city_trade/i.test(q.sql));
    expect(insert?.parameters[2]).toBe(100);
    expect(insert?.parameters[3]).toBe(0.1);
    expect(insert?.parameters[4]).toBe(10);
  });

  it('rejects an invalid price without publishing', async () => {
    const { cmd, db } = build([
      { match: /select \* from mem_city_resource/i, rows: [{ food: 1000 }] },
    ]);
    await expect(cmd.sellToUser(ctx, [0, 100, 100, 2, 0])).rejects.toThrow(
      'sellToUser.price_runaway',
    );
    expect(db.executed.some((q) => /insert into sys_city_trade/i.test(q.sql))).toBe(false);
  });
});

describe('PlayerTradeCommands.buyFromUser', () => {
  const trade = {
    id: 7,
    cid: 188128,
    state: 0,
    gold: 10,
    distance: 1e9,
    unionid: 0,
    count: 100,
    restype: 0,
  };
  const happy: Respond[] = [
    { match: /select \* from sys_city_trade where id/i, rows: [trade] },
    { match: /select uid as v from sys_city/i, rows: [{ v: 1002 }] },
    { match: /select \* from mem_city_resource/i, rows: [{ gold: 100 }] },
    { match: /select buycid as v from sys_city_trade/i, rows: [{ v: 209355 }] },
  ];

  it('pays the seller row, creates the caravan and completes both goals', async () => {
    const { cmd, db, tasks, users } = build(happy);
    expect(await cmd.buyFromUser(ctx, [7])).toEqual(['market-info']);
    expect(db.executed.some((q) => /update mem_city_resource set gold = gold -/i.test(q.sql))).toBe(
      true,
    );
    expect(db.executed.some((q) => /replace into mem_city_trade/i.test(q.sql))).toBe(true);
    expect(tasks.completeTask).toHaveBeenCalledWith(1002, 25);
    expect(tasks.completeTask).toHaveBeenCalledWith(1001, 26);
    expect(users.logUserAction).toHaveBeenCalledWith(1001, 20);
  });

  it('rejects an already bought row and buying from yourself', async () => {
    const { cmd: bought } = build([
      { match: /select \* from sys_city_trade where id/i, rows: [{ ...trade, state: 1 }] },
    ]);
    await expect(bought.buyFromUser(ctx, [7])).rejects.toThrow('buyFromUser.bought_by_others');
    const { cmd: own } = build([
      { match: /select \* from sys_city_trade where id/i, rows: [trade] },
      { match: /select uid as v from sys_city/i, rows: [{ v: 1001 }] },
    ]);
    await expect(own.buyFromUser(ctx, [7])).rejects.toThrow('buyFromUser.cant_buy_from_yourself');
  });
});

describe('PlayerTradeCommands list and maintenance', () => {
  it('paginates the buy list and returns sell prices', async () => {
    const { cmd, db } = build([
      { match: /select union_id as v from sys_user/i, rows: [{ v: 0 }] },
      { match: /select count\(\*\) as v from sys_city_trade/i, rows: [{ v: 15 }] },
      { match: /select t\.\*/i, rows: [{ id: 9, restype: 0 }] },
    ]);
    const ret = await cmd.getUserBuyList(ctx, [9, 0, 0, '']);
    expect(ret.slice(0, 4)).toEqual([0, 15, 2, 1]);
    const list = db.executed.find((q) => /select t\.\*/i.test(q.sql));
    expect(list?.parameters.slice(-2)).toEqual([10, 10]);
    expect(await cmd.getUserSellData(ctx)).toEqual([0, 15, 0.1, 0.1, 0.2, 0.25]);
  });

  it('cancels a pending sale and refunds its resource', async () => {
    const { cmd, db } = build([
      {
        match: /select \* from sys_city_trade\s+where id/i,
        rows: [{ id: 7, restype: 1, count: 50 }],
      },
    ]);
    expect(await cmd.cancelSell(ctx, [7])).toEqual(['market-info']);
    expect(db.executed.some((q) => /set `wood` = `wood` \+/i.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /delete from sys_city_trade/i.test(q.sql))).toBe(true);
  });

  it('accelerates both trade clocks and consumes 木牛流马', async () => {
    const { cmd, db } = build([
      { match: /select count from sys_goods/i, rows: [{ count: 1 }] },
      { match: /select cid, buycid from sys_city_trade/i, rows: [{ cid: 209355, buycid: 188128 }] },
    ]);
    expect(await cmd.accelerateSell(ctx, [7])).toEqual(['market-info']);
    expect(
      db.executed.filter((q) => /endtime = \(endtime - unix_timestamp\(\)\) \/ 10/i.test(q.sql)),
    ).toHaveLength(2);
    expect(db.executed.some((q) => /update sys_goods set count = greatest/i.test(q.sql))).toBe(
      true,
    );
  });
});
