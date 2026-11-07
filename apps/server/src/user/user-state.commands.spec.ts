import { describe, expect, it, vi } from 'vitest';
import { LangService } from '../common/lang.service';
import { CityRelocation } from '../core/city-relocation.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { RandomService, ScriptedRandom } from '../core/random.service';
import { UserProtection } from '../core/user-protection.service';
import { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { TaskRewards } from '../task/task-rewards.service';
import { UserStateCommands } from './user-state.commands';

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };
const lang = new LangService({
  changeCityPosition: {
    lijian_succ: 'ok',
    no_adv_QianChengLing: 'missing',
    invalid_target_city: 'invalid',
  },
  changeUserState: { vacation_limit: 'days', army_out: 'army', xiujia: 'vacation' },
  sellGoods: { not_enough_goods_mianzhan: 'need %d' },
});
function build(rules: Respond[] = []) {
  const db = new FakeDb(rules),
    goods = new GoodsRules(db.scope),
    random = new RandomService(new ScriptedRandom());
  const heroes = { throwHeroToField: vi.fn() } as unknown as HeroRules;
  const relocation = new CityRelocation(db.scope, heroes, new UserRules(db.scope), lang);
  const rewards = { addMoney: vi.fn() } as unknown as TaskRewards;
  const protection = new UserProtection(db.scope, lang, goods, rewards);
  return {
    db,
    goods,
    relocation,
    protection,
    cmd: new UserStateCommands(db.scope, goods, random, relocation, protection, lang),
  };
}
describe('W4 UserFunc compatibility without a database', () => {
  it('validates pointing bounds before inventory and inventory before ownership', async () => {
    const { cmd, db } = build();
    await expect(cmd.changeCityPositionPointing(ctx, [-1, 2, 1002])).rejects.toMatchObject({
      key: 'changeCityPosition.invalid_target_city',
    });
    expect(db.executed).toHaveLength(0);
    await expect(cmd.changeCityPositionPointing(ctx, [500, 500, 1002])).rejects.toMatchObject({
      key: 'changeCityPosition.no_adv_QianChengLing',
    });
    expect(db.executed).toHaveLength(1);
    expect(db.executed[0]!.parameters).toEqual([1001, 82]);
  });
  it('selects random migration target before checking inventory', async () => {
    const { cmd, db } = build([
      { match: /select count\(\*\) from mem_world/, rows: [{ n: 1 }] },
      { match: /select wid from mem_world/, rows: [{ wid: 10101 }] },
    ]);
    await expect(cmd.changeCityPosition(ctx, [2, 1002])).rejects.toMatchObject({
      key: 'changeCityPosition.no_QianChengLing',
    });
    expect(db.executed.map((q) => q.sql).join(';')).toMatch(
      /select wid.*select count from sys_goods/s,
    );
  });
  it('keeps false and caps only counts above one in loadMianZhanEndTime', async () => {
    const { cmd, db } = build();
    expect(await cmd.loadMianZhanEndTime(ctx)).toEqual([false, false]);
    db.setRules([
      { match: /select endtime from/, rows: [{ endtime: '123' }] },
      { match: /select count from sys_user_action_log/, rows: [{ count: '4' }] },
    ]);
    expect(await cmd.loadMianZhanEndTime(ctx)).toEqual(['123', 1]);
  });
  it('retains the original global loyalty reduction and goods log reason', async () => {
    const { cmd, db } = build([
      { match: /select \* from sys_city where/, rows: [{ cid: 2003 }] },
      { match: /select count from sys_goods/, rows: [{ count: 1 }] },
      { match: /select union_id from/, rows: [{ union_id: 2 }] },
      { match: /select hid from/, rows: [{ hid: 42 }] },
    ]);
    expect(await cmd.useLiJianFu(ctx, [3, 2, 160036])).toEqual(['ok']);
    const update = db.executed.find((q) => q.sql.startsWith('update sys_city_hero'))!;
    expect(update.sql).not.toMatch(/where/i);
    expect(update.parameters).toEqual([3]);
    expect(
      db.executed.find((q) => q.sql.startsWith('insert into `log_goods`'))!.parameters,
    ).toEqual([1001, 160036, -1, 7]);
  });
  it('validates vacation days before troops, and troops before technology', async () => {
    const { cmd, db } = build([{ match: /select uid from sys_troops/, rows: [{ uid: 1001 }] }]);
    await expect(cmd.changeUserState(ctx, [2, 1])).rejects.toMatchObject({
      key: 'changeUserState.vacation_limit',
    });
    expect(db.executed).toHaveLength(0);
    await expect(cmd.changeUserState(ctx, [2, 2])).rejects.toThrow('armyvacation');
    expect(db.executed).toHaveLength(1);
  });
  it('allowPK returns no value and unconditionally upserts allow=1', async () => {
    const { cmd, db } = build();
    expect(await cmd.allowPK(ctx)).toBeUndefined();
    expect(db.executed[0]!.sql).toMatch(/on duplicate key update allow=1/);
  });
  it('keeps queues/resources and clears destination state in PHP transfer order', async () => {
    const { relocation, db } = build([
      { match: /select type from mem_world/, rows: [{ type: 1 }] },
      { match: /select province from mem_world/, rows: [{ province: 2 }] },
    ]);
    await relocation.move(1001, 1002, 2003);
    const statements = db.executed.map((q) => q.sql);
    expect(statements.some((q) => q.includes('update `mem_city_resource` set cid='))).toBe(true);
    expect(statements.some((q) => q.includes('update `mem_building_upgrading` set cid='))).toBe(
      true,
    );
    expect(statements.some((q) => q.includes('field_food_add=0'))).toBe(true);
    expect(statements.indexOf('delete from `mem_city_resource` where cid=?')).toBeLessThan(
      statements.indexOf('update `mem_city_resource` set cid=? where cid=?'),
    );
  });
  it('uses two cards after repeated shield use but leaves action count uncapped', async () => {
    const { protection, db } = build([
      { match: /select endtime-unix_timestamp\(\) from/, rows: [{ left: 100 }] },
      { match: /select count,id from/, rows: [{ count: 4, id: 50 }] },
      { match: /select count from sys_goods/, rows: [{ count: 2 }] },
    ]);
    await protection.use(1001, 1);
    expect(
      db.executed.find((q) => q.sql.startsWith('insert into `log_goods`'))!.parameters,
    ).toEqual([1001, 12, -2, 0]);
    expect(db.executed.some((q) => /count=count\+1,time=unix_timestamp/.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /endtime=endtime\+43200/.test(q.sql))).toBe(true);
  });
  it('paid shield removes both cooldowns before reads and spends with reason 731', async () => {
    const { protection, db } = build();
    await protection.use(1001, 3);
    expect(db.executed.slice(0, 4).map((q) => q.sql)).toEqual([
      'select value from mem_state where state=197',
      'select 1 from sys_user where uid=? and money<300',
      'delete from mem_user_buffer where uid=? and buftype=8',
      'delete from mem_user_buffer where uid=? and buftype=913',
    ]);
    expect(db.executed.some((q) => q.sql.includes('log_goods'))).toBe(false);
  });
});
