import { describe, expect, it, vi } from 'vitest';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { ReportService } from '../core/report.service';
import { TaskRules } from '../core/task-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { TaskRewards } from '../task/task-rewards.service';
import { UnionRules } from '../union/union-rules.service';
import { WorldCommands } from './world.commands';
import { WorldStubCommands } from './world-stub.commands';
const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };
function build(rules: Respond[] = []) {
  const db = new FakeDb(rules);
  const lang = new LangService({
    MakeEndTime: { year: '年', month: '月', day: '日' },
    startWar: { succ_caution: '%s %s %s', succ_report: '%s %s %s' },
    start_war: { union_msg: '%s %s' },
    trickBuXuanErZhan: { succ_report: '%s %s %s %s', succ_caution: '%s %s %s', succ: '%s %s' },
    MakeTimeLeft: { hour: 'h', min: 'm', sec: 's' },
    world: { assit_succ: 'ok' },
  });
  const reports = { sendReport: vi.fn() },
    tasks = { completeTaskGoalBySortandType: vi.fn() },
    rewards = { addMoney: vi.fn() },
    world = { getWorldCityInfo: vi.fn().mockResolvedValue([{ cid: 2003 }]) };
  const unions = new UnionRules(db.scope);
  const cmd = new WorldStubCommands(
    db.scope,
    lang,
    reports as unknown as ReportService,
    unions,
    rewards as unknown as TaskRewards,
    tasks as unknown as TaskRules,
    new GoodsRules(db.scope),
    world as unknown as WorldCommands,
  );
  return { cmd, db, reports, tasks, rewards, world };
}
describe('W4 war actions without a database', () => {
  it('checks existing war before either user and even when expired', async () => {
    const { cmd, db } = build([{ match: /select \* from mem_user_inwar/, rows: [{ endtime: 1 }] }]);
    await expect(cmd.startWar(ctx, [1002, 2003])).rejects.toMatchObject({
      key: 'startWar.war_is_declared',
    });
    expect(db.executed).toHaveLength(1);
    expect(db.executed[0]!.sql).not.toContain('endtime');
  });
  it('reports both sides, writes both union event tables and reloads every target city', async () => {
    const { cmd, db, reports, world } = build([
      { match: /select name,state,lastcid from/, rows: [{ name: 'me', state: 0, lastcid: 1002 }] },
      {
        match: /select name,state,lastcid,union_id/,
        rows: [{ name: 'them', state: 0, lastcid: 2003, union_id: 9 }],
      },
      { match: /select unix_timestamp/, rows: [{ now: 100 }] },
      { match: /select group_concat/, rows: [{ cities: '2003,3004' }] },
    ]);
    expect(await cmd.startWar(ctx, [1002, 2003])).toEqual([{ cid: 2003 }]);
    expect(reports.sendReport.mock.calls.map((c) => c.slice(0, 4))).toEqual([
      [1002, 22, 1002, 2003],
      [1001, 22, 1002, 2003],
    ]);
    expect(world.getWorldCityInfo).toHaveBeenCalledWith(ctx, [2, '2003', '3004']);
    expect(db.executed.filter((q) => /insert into (sys|mem)_union_event/.test(q.sql))).toHaveLength(
      2,
    );
    expect(db.executed.find((q) => q.sql.startsWith('insert into mem_user_inwar'))!.sql).toContain(
      'unix_timestamp()+8*3600',
    );
  });
  it('checks the decree before existing war', async () => {
    const { cmd, db } = build();
    await expect(cmd.useTaoNiShengZhi(ctx, [1002, 2003])).rejects.toThrow('not_enough_goods157#1');
    expect(db.executed).toHaveLength(1);
  });
  it('checks the supplied uid but declares trickwar on the city owner, without reducing prestige', async () => {
    const { cmd, db, reports, tasks } = build([
      { match: /select count from sys_goods/, rows: [{ count: 1 }] },
      { match: /select name,state,lastcid from/, rows: [{ name: 'me', state: 0, lastcid: 1002 }] },
      { match: /select name,state,lastcid,union_id/, rows: [{ name: 'supplied', state: 0 }] },
      {
        match: /select name,prestige,lastcid from/,
        rows: [{ name: 'me', prestige: 10000, lastcid: 1002 }],
      },
      { match: /select uid from sys_city/, rows: [{ uid: 1003 }] },
      { match: /select name,prestige from/, rows: [{ name: 'owner', prestige: 1000 }] },
    ]);
    await cmd.useTaoNiShengZhi(ctx, [1002, 2003]);
    expect(
      db.executed.find((q) => q.sql.startsWith('insert into mem_user_trickwar'))!.parameters,
    ).toEqual([1001, 1003, 28800, 28800]);
    expect(reports.sendReport.mock.calls[1]![0]).toBe(1003);
    expect(tasks.completeTaskGoalBySortandType).toHaveBeenCalledWith(1001, 53, 9);
    expect(db.executed.some((q) => /update sys_user set.*prestige/.test(q.sql))).toBe(false);
  });
  it('checks city existence before rank and rank before union equality', async () => {
    const { cmd, db } = build();
    await expect(cmd.unionAssit(ctx, [2003])).rejects.toMatchObject({
      key: 'useGoods.city_not_exists',
    });
    expect(db.executed).toHaveLength(1);
    db.setRules([{ match: /select \* from sys_city/, rows: [{ uid: 1002 }] }]);
    await expect(cmd.unionAssit(ctx, [2003])).rejects.toMatchObject({
      key: 'world.union_pos_lower',
    });
  });
  it('extends existing immunity by two hours and charges the leader with reason 913', async () => {
    const { cmd, db, rewards } = build([
      { match: /select \* from sys_city/, rows: [{ uid: 1002 }] },
      { match: /select union_id,union_pos/, rows: [{ union_id: 4, union_pos: 5 }] },
      { match: /select u.union_id/, rows: [{ union_id: 4 }] },
      { match: /select money from/, rows: [{ money: 200 }] },
      { match: /select unix_timestamp/, rows: [{ now: 100 }] },
    ]);
    expect(await cmd.unionAssit(ctx, [2003])).toEqual(['ok']);
    expect(rewards.addMoney).toHaveBeenCalledWith(1001, -200, 913);
    const buffer = db.executed.find((q) => q.sql.startsWith('insert into mem_user_buffer'))!;
    expect(buffer.sql).toContain('endtime=endtime+7200');
    expect(buffer.parameters).toEqual([1002, 7300]);
  });
});
