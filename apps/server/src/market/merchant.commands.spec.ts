import { describe, expect, it, vi } from 'vitest';
import type { TaskRules } from '../core/task-rules.service';
import type { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import type { TaskRewards } from '../task/task-rewards.service';
import type { MarketRules } from './market-rules.service';
import { MerchantCommands } from './merchant.commands';

const ctx = { uid: 1001, cid: 209355, ip: 0, sip: '' };
const no = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[] = []) {
  const db = new FakeDb([...rules, no(/.*/)]);
  const market = { marketLevel: vi.fn(async () => 15) } as unknown as MarketRules;
  const tasks = { completeTask: vi.fn(async () => {}) } as unknown as TaskRules;
  const rewards = {
    addMoney: vi.fn(async () => {}),
    addGift: vi.fn(async () => {}),
  } as unknown as TaskRewards;
  const users = { logUserAction: vi.fn(async () => {}) } as unknown as UserRules;
  const cmd = new MerchantCommands(db.scope, market, tasks, rewards, users);
  return { cmd, db, tasks, rewards, users };
}

const rich = [
  {
    match: /select \* from mem_city_resource/i,
    rows: [{ gold: 1000, food: 1000, wood: 1000, rock: 1000, iron: 1000 }],
  },
  { match: /select money, gift from sys_user/i, rows: [{ money: 100, gift: 100 }] },
];

describe('MerchantCommands', () => {
  it('buys from the merchant, writes the log and commits before the success exception', async () => {
    const { cmd, db, tasks, rewards, users } = build(rich);
    await expect(cmd.buyFromMerchant(ctx, [100, 0, 0, 0, 1, 0])).rejects.toThrow(
      'buyFromMerchant.succ',
    );
    expect(rewards.addMoney).toHaveBeenCalledWith(1001, -5, 50);
    expect(users.logUserAction).toHaveBeenCalledWith(1001, 19);
    expect(tasks.completeTask).toHaveBeenCalledWith(1001, 24);
    expect(db.executed.some((q) => /update mem_city_resource set gold = gold -/i.test(q.sql))).toBe(
      true,
    );
    expect(db.executed.some((q) => /insert into log_merchant/i.test(q.sql))).toBe(true);
  });

  it('sells to the merchant with gift and preserves the rock/iron log swap', async () => {
    const { cmd, db, tasks, rewards } = build(rich);
    await expect(cmd.sellToMerchant(ctx, [0, 0, 10, 20, 2, 1])).rejects.toThrow(
      'sellToMerchant.succ',
    );
    expect(rewards.addGift).toHaveBeenCalledWith(1001, -10, 51);
    expect(tasks.completeTask).toHaveBeenCalledWith(1001, 23);
    const log = db.executed.find((q) => /insert into log_merchant/i.test(q.sql));
    expect(log?.parameters.slice(1, 5)).toEqual([0, 0, 40, 20]);
  });

  it('rejects invalid input and insufficient funds without writing', async () => {
    const { cmd, db } = build(rich);
    await expect(cmd.buyFromMerchant(ctx, [0, 0, 0, 0, 1, 0])).rejects.toThrow(
      'buyFromMerchant.input_amount',
    );
    await expect(cmd.sellToMerchant(ctx, [10000, 0, 0, 0, 1, 0])).rejects.toThrow(
      'sellToMerchant.no_enough_food',
    );
    await expect(cmd.buyFromMerchant(ctx, [100, 0, 0, 0, 1, 2])).rejects.toMatchObject({
      message: '',
    });
    expect(db.executed.some((q) => /update mem_city_resource set/i.test(q.sql))).toBe(false);
  });

  it('initializes the daily merchant row and returns price fields', async () => {
    const { cmd, db } = build([{ match: /select \* from sys_city_merchant/i, rows: [] }]);
    const ret = await cmd.getMerchantInfo(ctx);
    expect(ret.food).toBe(100);
    expect(ret.food_buy_price).toBe(0.1);
    expect(ret.iron_buy_price).toBe(0.25);
    expect(db.executed.some((q) => /insert into sys_city_merchant/i.test(q.sql))).toBe(true);
  });
});
