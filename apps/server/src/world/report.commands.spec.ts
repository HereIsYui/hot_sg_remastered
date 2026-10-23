import { describe, expect, it } from 'vitest';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { ReportCommands } from './report.commands';

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  return { cmd: new ReportCommands(db.scope), db };
}

const COUNT = (match: RegExp, n: number): Respond => ({ match, rows: [{ 'count(*)': n }] });

describe('ReportCommands.getUnreadReport', () => {
  it('clears the report alarm and returns [pageCount, page, rows]', async () => {
    const { cmd, db } = build([
      COUNT(/count\(\*\) from sys_report where uid = \? and .read. = 0 and state = 0/i, 23),
      {
        match:
          /select id, origincid.*from sys_report\s+where uid = \? and .read. = 0 and state = 0/is,
        rows: [{ id: 50, title: 2, read: 0 }],
      },
    ]);
    const ret = await cmd.getUnreadReport(ctx, [-1, 0]);
    expect(ret[0]).toBe(3); // ceil(23/10)
    expect(ret[1]).toBe(0);
    expect(Array.isArray(ret[2])).toBe(true);
    expect(db.executed.some((q) => /update sys_alarm set report = 0/i.test(q.sql))).toBe(true);
  });

  it('clamps an out-of-range page down to the last page', async () => {
    const { cmd } = build([
      COUNT(/count\(\*\) from sys_report/i, 5),
      { match: /select id, origincid/i, rows: [] },
    ]);
    const ret = await cmd.getUnreadReport(ctx, [-1, 9]);
    expect(ret[0]).toBe(1);
    expect(ret[1]).toBe(0); // clamped from 9 to pageCount-1 = 0
  });

  it('returns an empty row array when there are no reports', async () => {
    const { cmd } = build([COUNT(/count\(\*\) from sys_report/i, 0)]);
    const ret = await cmd.getUnreadReport(ctx, [-1, 0]);
    expect(ret).toEqual([0, 0, []]);
  });
});

describe('ReportCommands.getReport', () => {
  it('delegates to getUnreadReport when type is negative', async () => {
    const { cmd, db } = build([
      COUNT(/count\(\*\) from sys_report where uid = \? and .read. = 0 and state = 0/i, 0),
    ]);
    await cmd.getReport(ctx, [-1, 0]);
    expect(db.executed.some((q) => /update sys_alarm set report = 0/i.test(q.sql))).toBe(true);
  });

  it('filters by type and paginates newest-first', async () => {
    const { cmd, db } = build([
      COUNT(/count\(\*\) from sys_report\s+where uid = \? and type = \? and state = 0/i, 12),
      {
        match:
          /select id, origincid.*where uid = \? and type = \? and state = 0\s+order by .id. desc/is,
        rows: [{ id: 3, title: 1 }],
      },
    ]);
    const ret = await cmd.getReport(ctx, [1, 0]);
    expect(ret[0]).toBe(2); // ceil(12/10)
    const listQuery = db.executed.find((q) =>
      /from sys_report\s+where uid = \? and type = \?/i.test(q.sql),
    );
    expect(listQuery?.parameters).toContain(1); // type
  });
});

describe('ReportCommands.delReport', () => {
  it('soft-deletes the ids then re-reads the tab', async () => {
    const { cmd, db } = build([
      { match: /update sys_report set state = 1/i, rows: [] },
      COUNT(/count\(\*\) from sys_report where uid = \? and type = \?/i, 0),
    ]);
    await cmd.delReport(ctx, [[3, 4], 1, 0]);
    const del = db.executed.find((q) => /update sys_report set state = 1/i.test(q.sql));
    expect(del).toBeDefined();
    expect(del?.parameters).toEqual([3, 4, 1001]);
  });

  it('does not run a delete for an empty id list', async () => {
    const { cmd, db } = build([COUNT(/count\(\*\) from sys_report/i, 0)]);
    await cmd.delReport(ctx, [[], 1, 0]);
    expect(db.executed.some((q) => /update sys_report set state = 1/i.test(q.sql))).toBe(false);
  });
});

describe('ReportCommands.getReportDetail', () => {
  it('returns [] for a non-battle report (battleid <= 0)', async () => {
    const { cmd, db } = build([]);
    expect(await cmd.getReportDetail(ctx, [0])).toEqual([]);
    expect(db.executed).toHaveLength(0);
  });

  it('reads sys_battle_report rounds ordered by round', async () => {
    const { cmd, db } = build([
      {
        match: /select \* from sys_battle_report where battleid = \? order by round/i,
        rows: [{ round: 1, report: '<b>r1</b>' }],
      },
    ]);
    const ret = await cmd.getReportDetail(ctx, [42]);
    expect(Array.isArray(ret[0])).toBe(true);
    expect(db.executed[0]?.parameters).toContain(42);
  });
});

describe('ReportCommands.readReportAll', () => {
  it('marks all reports read and returns [1]', async () => {
    const { cmd, db } = build([{ match: /update sys_report set .read. = 1/i, rows: [] }]);
    expect(await cmd.readReportAll(ctx)).toEqual([1]);
    expect(db.executed[0]?.parameters).toContain(1001);
  });
});
