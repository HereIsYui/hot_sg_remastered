import { describe, expect, it } from 'vitest';
import { LangService } from '../common/lang.service';
import type { ReportService } from '../core/report.service';
import type { TaskRules } from '../core/task-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { TradeTick } from './trade.tick';

const no = (match: RegExp): Respond => ({ match, rows: [] });
const lang = new LangService({ report: { resources: ['黄金', '粮食', '木材', '石料', '铁锭'] } });

function build(rows: Record<string, unknown>[]) {
  const db = new FakeDb([
    { match: /select \* from sys_city_trade/i, rows },
    { match: /select .*uid.*value.*from sys_city/i, params: [209355], rows: [{ value: 1001 }] },
    { match: /select .*uid.*value.*from sys_city/i, params: [200350], rows: [{ value: 1002 }] },
    { match: /select .*name.*value.*from sys_city/i, params: [209355], rows: [{ value: '主城' }] },
    { match: /select .*name.*value.*from sys_city/i, params: [200350], rows: [{ value: '分城' }] },
    no(/.*/),
  ]);
  const goals: number[][] = [];
  const tasks = {
    completeTask: async (uid: number, goal: number) => goals.push([uid, goal]),
  } as unknown as TaskRules;
  const reports: unknown[][] = [];
  const report = {
    sendReport: async (...args: unknown[]) => reports.push(args),
  } as unknown as ReportService;
  return { db, tick: new TradeTick(db.scope, lang, tasks, report), goals, reports };
}

const row = {
  id: 71,
  cid: 209355,
  buycid: 200350,
  gold: 25,
  restype: 0,
  count: 100,
};

describe('TradeTick.handleTrade', () => {
  it('does nothing when no caravan is due', async () => {
    const { db, tick } = build([]);
    await tick.handleTrade();
    expect(db.executed).toHaveLength(1);
  });

  it.each([
    [0, 'food', '粮食'],
    [1, 'wood', '木材'],
    [2, 'rock', '石料'],
    [3, 'iron', '铁锭'],
    [4, 'gold', '黄金'],
  ])('delivers resource type %i to %s and files both reports', async (restype, column, name) => {
    const { db, tick, goals, reports } = build([{ ...row, restype }]);
    await tick.handleTrade();

    expect(db.executed.some((q) => q.sql.includes(`set \`${column}\``))).toBe(true);
    expect(db.executed.some((q) => /delete from mem_city_trade/i.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /delete from sys_city_trade/i.test(q.sql))).toBe(true);
    expect(goals).toEqual([
      [1001, 25],
      [1002, 26],
    ]);
    expect(reports).toHaveLength(2);
    expect(reports[0]?.slice(0, 4)).toEqual([1001, 15, 209355, 200350]);
    expect(reports[1]?.slice(0, 4)).toEqual([1002, 15, 209355, 200350]);
    expect(reports[0]?.[4]).toContain(`出售：${name} 100`);
    expect(reports[0]?.[4]).toContain('主城(355,209)');
    expect(reports[1]?.[4]).toContain(`购买：${name} 100`);
    expect(reports[1]?.[4]).toContain('分城(350,200)');
  });
});
