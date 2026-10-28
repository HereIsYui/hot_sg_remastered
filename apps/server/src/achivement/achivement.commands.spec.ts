import { describe, expect, it } from 'vitest';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { AchivementCommands } from './achivement.commands';

const ctx = { uid: 1001, cid: 209355, ip: 0, sip: '' };
const NO = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const cmd = new AchivementCommands(db.scope);
  return { cmd, db };
}

describe('AchivementCommands.getOverviewStat', () => {
  it('returns [point, recent two, per-group totals] and merges the finish counts', async () => {
    const { cmd } = build([
      { match: /achivement_point from sys_user/i, rows: [{ achivement_point: 30 }] },
      {
        match: /achieveGetTime[\s\S]*order by time desc limit 2/i,
        rows: [
          {
            id: 12,
            name: '地大物博',
            content: '占领80个野地',
            point: 10,
            achieveGetTime: 1700000000,
            image: 5,
          },
          {
            id: 1,
            name: '麻雀',
            content: '在世界频道说话',
            point: 10,
            achieveGetTime: '--',
            image: 0,
          },
        ],
      },
      {
        match: /group_name/i,
        rows: [
          { group: 1, group_name: '成长', total_count: 27, finish_count: 0 },
          { group: 2, group_name: '全局', total_count: 2, finish_count: 0 },
        ],
      },
      { match: /group by b\.group/i, rows: [{ group: 1, finish_count: 3 }] },
      NO(/.*/),
    ]);
    const res = (await cmd.getOverviewStat(ctx, [1001])) as unknown[];
    expect(res[0]).toBe(30);
    expect(res[1]).toHaveLength(2);
    expect(res[2]).toEqual([
      { group: 1, group_name: '成长', total_count: 27, finish_count: 3 },
      // a group without finished achievements reports 0, like the original's empty() check
      { group: 2, group_name: '全局', total_count: 2, finish_count: 0 },
    ]);
  });

  it('returns false for the point when the user row is missing', async () => {
    const { cmd } = build([NO(/.*/)]);
    const res = (await cmd.getOverviewStat(ctx, [9999])) as unknown[];
    expect(res[0]).toBe(false);
    expect(res[1]).toEqual([]);
    expect(res[2]).toEqual([]);
  });
});

describe('AchivementCommands.getAchivementsByGroup', () => {
  const base = (state: unknown, memState: unknown): Respond[] => [
    {
      match: /state from sys_user where uid = \? and state in \(0, 2\)/i,
      rows: state === undefined ? [] : [{ state }],
    },
    {
      match: /value from mem_state where state = 5/i,
      rows: memState === undefined ? [] : [{ value: memState }],
    },
  ];

  it('type 1 (已完成): counts and pages finished achievements ordered by time desc', async () => {
    const rules: Respond[] = [
      ...base(0, 1),
      {
        match: /count\(\*\) from sys_user_achivement a, cfg_achivement b/i,
        rows: [{ 'count(*)': 7 }],
      },
      {
        match: /time as achieveGetTime/i,
        rows: [
          {
            id: 9,
            name: '广纳贤士',
            content: '将领总数达到100个',
            point: 10,
            image: 6,
            achieveGetTime: 1700000100,
          },
        ],
      },
      NO(/.*/),
    ];
    const { cmd, db } = build(rules);
    const res = (await cmd.getAchivementsByGroup(ctx, [1001, 1, 0, 1, 0])) as unknown[];
    expect(res[0]).toBe(7);
    expect(res[1]).toEqual([
      {
        id: 9,
        name: '广纳贤士',
        content: '将领总数达到100个',
        point: 10,
        image: 6,
        achieveGetTime: 1700000100,
      },
    ]);
    // 新手保护 left (state 0) + 黄巾之乱 finished → open_time in (0,1,2), after uid/group/sub_group
    const opens = db.executed.filter((q) => /open_time in/.test(q.sql));
    expect(opens.map((q) => q.parameters)).toEqual([
      [1001, 1, 0, 0, 1, 2],
      [1001, 1, 0, 0, 1, 2, 0, 5],
    ]);
    // page 2 starts at 5
    await cmd.getAchivementsByGroup(ctx, [1001, 1, 0, 1, 2]);
    expect(
      db.executed.some(
        (q) => /limit \?, \?/.test(q.sql) && q.parameters.slice(-2).join(',') === '10,5',
      ),
    ).toBe(true);
  });

  it('type 2 (未完成): left join keeps only unfinished rows, "--" as the get time', async () => {
    const rules: Respond[] = [
      ...base(undefined, undefined),
      { match: /count\(\*\) from cfg_achivement b/i, rows: [{ 'count(*)': 2 }] },
      {
        match: /'--' as achieveGetTime/i,
        rows: [
          {
            id: 3,
            name: '采集高手',
            content: '占领野地去采集',
            point: 10,
            image: 0,
            achieveGetTime: '--',
          },
        ],
      },
      NO(/.*/),
    ];
    const { cmd, db } = build(rules);
    const res = (await cmd.getAchivementsByGroup(ctx, [1001, 1, 0, 2, 0])) as unknown[];
    expect(res[0]).toBe(2);
    expect(res[1]).toEqual([
      {
        id: 3,
        name: '采集高手',
        content: '占领野地去采集',
        point: 10,
        image: 0,
        achieveGetTime: '--',
      },
    ]);
    // neither unlock applies → open_time in (0)
    const opens = db.executed.filter((q) => /open_time in/.test(q.sql));
    expect(opens.map((q) => q.parameters)).toEqual([
      [1001, 1, 0],
      [1001, 1, 0, 0, 5],
    ]);
    expect(db.executed.some((q) => /uid is null/i.test(q.sql))).toBe(true);
  });

  it('type 0 (全部): mixed rows with the case-when get time, ordered by time desc, b.id asc', async () => {
    const { cmd, db } = build([
      ...base(2, 0),
      { match: /count\(\*\) from cfg_achivement b\s*where state = 1/i, rows: [{ 'count(*)': 87 }] },
      {
        match: /case when time is null then '--' else time end as achieveGetTime/i,
        rows: [
          {
            id: 4,
            name: '珠宝世家',
            content: '珠宝500',
            point: 10,
            image: 0,
            achieveGetTime: '--',
          },
        ],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.getAchivementsByGroup(ctx, [1001, 3, 0, 0, 0])) as unknown[];
    expect(res[0]).toBe(87);
    expect(res[1]).toEqual([
      { id: 4, name: '珠宝世家', content: '珠宝500', point: 10, image: 0, achieveGetTime: '--' },
    ]);
    // state 2 still matches (0,2), but mem_state value 0 keeps 黄巾 locked → open_time in (0,1)
    const opens = db.executed.filter((q) => /open_time in/.test(q.sql));
    expect(opens.map((q) => q.parameters)).toEqual([
      [3, 0, 1],
      [1001, 3, 0, 1, 0, 5],
    ]);
  });

  it('returns an empty array for an unknown type, like the original', async () => {
    const { cmd } = build([NO(/.*/)]);
    expect(await cmd.getAchivementsByGroup(ctx, [1001, 1, 0, 9, 0])).toEqual([]);
  });
});

describe('AchivementCommands.getAchivementDetail', () => {
  const CFG_ROW = {
    id: 1,
    name: '麻雀',
    content: '您说的太多了',
    todo: '在世界频道说话1000句',
    image: 0,
    type: 2,
    sql_current_value: 'select count from log_action_count where uid=%s and aid=17',
    target_value: 1000,
  };

  it('unfinished 累积成就 (type 2): executes the in-db template with the uid, blanks it in the reply', async () => {
    const rules: Respond[] = [
      { match: /from cfg_achivement where id = \?/i, rows: [{ ...CFG_ROW }] },
      { match: /select 1 from sys_user_achivement/i, rows: [] },
      { match: /log_action_count where uid=1001 and aid=17/i, rows: [{ count: 500 }] },
      {
        match: /count\(0\) from sys_user_achivement where achivement_id/i,
        rows: [{ 'count(0)': 12 }],
      },
      NO(/.*/),
    ];
    const { cmd, db } = build(rules);
    const res = (await cmd.getAchivementDetail(ctx, [1001, 1])) as unknown[];
    expect(res[0]).toEqual({ ...CFG_ROW, sql_current_value: '' });
    expect(res[1]).toEqual([{ targetValue: 1000, userValue: 500 }]);
    expect(res[2]).toBe(12);
    // the template ran verbatim with the uid substituted, no bound parameters
    const raw = db.executed.find((q) => /log_action_count/.test(q.sql));
    expect(raw?.sql).toBe('select count from log_action_count where uid=1001 and aid=17');
    expect(raw?.parameters).toEqual([]);
  });

  it('finished 累积成就: userValue equals targetValue', async () => {
    const { cmd } = build([
      { match: /from cfg_achivement where id = \?/i, rows: [{ ...CFG_ROW }] },
      { match: /select 1 from sys_user_achivement/i, rows: [{ 1: 1 }] },
      {
        match: /count\(0\) from sys_user_achivement where achivement_id/i,
        rows: [{ 'count(0)': 12 }],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.getAchivementDetail(ctx, [1001, 1])) as unknown[];
    expect(res[1]).toEqual([{ targetValue: 1000, userValue: 1000 }]);
  });

  it('unfinished 分类成就 (type 3): runs each goal template, isDone 0/1', async () => {
    const goals = [
      {
        content: '夜明珠达到500',
        sql_check_goal: 'select 1 from sys_goods where uid=%s and gid=30',
      },
      {
        content: '占有一件战场装备',
        sql_check_goal: 'select 1 from sys_user_armor where uid=%s and armorid=31001 limit 1',
      },
    ];
    const { cmd, db } = build([
      {
        match: /from cfg_achivement where id = \?/i,
        rows: [{ ...CFG_ROW, type: 3, sql_current_value: null, target_value: null }],
      },
      { match: /select 1 from sys_user_achivement/i, rows: [] },
      { match: /a\.sql_check_goal/i, rows: goals },
      { match: /sys_goods where uid=1001 and gid=30/i, rows: [{ 1: 1 }] },
      { match: /sys_user_armor where uid=1001/i, rows: [] },
      {
        match: /count\(0\) from sys_user_achivement where achivement_id/i,
        rows: [{ 'count(0)': 0 }],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.getAchivementDetail(ctx, [1001, 4])) as unknown[];
    expect(res[1]).toEqual([
      { content: '夜明珠达到500', isDone: 1 },
      { content: '占有一件战场装备', isDone: 0 },
    ]);
    expect(db.executed.filter((q) => /sys_goods/.test(q.sql))[0]?.sql).toBe(
      'select 1 from sys_goods where uid=1001 and gid=30',
    );
  });

  it('finished 分类成就: every goal reports isDone 1 without running the templates', async () => {
    const { cmd, db } = build([
      {
        match: /from cfg_achivement where id = \?/i,
        rows: [{ ...CFG_ROW, type: 3, sql_current_value: null }],
      },
      { match: /select 1 from sys_user_achivement/i, rows: [{ 1: 1 }] },
      {
        match: /1 as isDone/i,
        rows: [
          { content: '夜明珠达到500', isDone: 1 },
          { content: '又一个目标', isDone: 1 },
        ],
      },
      {
        match: /count\(0\) from sys_user_achivement where achivement_id/i,
        rows: [{ 'count(0)': 3 }],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.getAchivementDetail(ctx, [1001, 80000])) as unknown[];
    expect(res[1]).toEqual([
      { content: '夜明珠达到500', isDone: 1 },
      { content: '又一个目标', isDone: 1 },
    ]);
    expect(db.executed.some((q) => /sys_goods/.test(q.sql))).toBe(false);
  });

  it('实时成就 (type 1): an empty progress array', async () => {
    const { cmd } = build([
      {
        match: /from cfg_achivement where id = \?/i,
        rows: [{ ...CFG_ROW, type: 1, sql_current_value: null }],
      },
      { match: /select 1 from sys_user_achivement/i, rows: [{ 1: 1 }] },
      {
        match: /count\(0\) from sys_user_achivement where achivement_id/i,
        rows: [{ 'count(0)': 3 }],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.getAchivementDetail(ctx, [1001, 20001])) as unknown[];
    expect(res[1]).toEqual([]);
  });

  it('a missing achievement row auto-vivifies to {sql_current_value: ""} like PHP', async () => {
    const { cmd } = build([
      { match: /from cfg_achivement where id = \?/i, rows: [] },
      { match: /select 1 from sys_user_achivement/i, rows: [] },
      {
        match: /count\(0\) from sys_user_achivement where achivement_id/i,
        rows: [{ 'count(0)': 0 }],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.getAchivementDetail(ctx, [1001, 999999])) as unknown[];
    expect(res[0]).toEqual({ sql_current_value: '' });
    expect(res[1]).toEqual([]);
    expect(res[2]).toBe(0);
  });
});
