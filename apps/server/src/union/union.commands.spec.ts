import { describe, expect, it } from 'vitest';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { LangService } from '../common/lang.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { TaskRewards } from '../task/task-rewards.service';
import { UnionCommands } from './union.commands';

const lang = new LangService({
  createUnion: {
    already_joined_other_union: '你已经加入了其他联盟。',
    union_name_notNull: '请输入联盟名称。',
    union_name_tooLong: '联盟名称最多8个字符。',
    has_ivalid_char: '联盟名称中含有非法字符。',
    add_union_event_time_near: '一天内已经创建过联盟。',
    level_lessThen_2: '鸿胪寺等级不足2级。',
    gold_not_enough: '黄金不足10000。',
    use_another_name: '该联盟名称已被使用。',
    add_union_event: ' 恭喜【%s】创建【%s联盟】,欢迎各位志同道合的君主加入!',
  },
  applyJoin: {
    no_HongLu_built: '请先建造鸿胪寺。',
    already_joined_other_union: '你已经加入了其他联盟。',
    reset_application: '已申请加入[%s]。',
    union_not_exist: '该联盟不存在。',
    send_application_succ: '申请成功。',
  },
  getUnionApplyInvite: { succ: '】的申请已发出。' },
  actionlog: { createunion: '创建联盟' },
  // the event text of createUnion (createUnion.add_union_event)
  createUnion2: {},
  getUnionApplyInvite: { succ: '】的申请已发出。' },
});

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };
const NO = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const users = new UserRules(db.scope);
  const cmd = new UnionCommands(
    db.scope,
    users,
    new TaskRules(db.scope, users),
    lang,
    new TaskRewards(db.scope, lang, users),
    lang,
  );
  return { cmd, db };
}

const USER = {
  match: /select name, union_id from sys_user/i,
  rows: [{ name: '长乐', union_id: 0 }],
};

describe('UnionCommands.createUnion', () => {
  it('rejects when already in a union', async () => {
    const { cmd } = build([{ match: USER.match, rows: [{ name: '长乐', union_id: 7 }] }, NO(/.*/)]);
    await expect(cmd.createUnion(ctx, ['新盟'])).rejects.toThrow(
      'createUnion.already_joined_other_union',
    );
  });

  it('rejects a name over 8 chars, a banned name and a taken name', async () => {
    const long = build([USER, NO(/.*/)]);
    await expect(long.cmd.createUnion(ctx, ['一二三四五六七八九'])).rejects.toThrow(
      'createUnion.union_name_tooLong',
    );
    const banned = build([USER, { match: /cfg_baned_name/i, rows: [{ 1: 1 }] }, NO(/.*/)]);
    await expect(banned.cmd.createUnion(ctx, ['系统'])).rejects.toThrow(
      'createUnion.has_ivalid_char',
    );
    const taken = build([
      USER,
      NO(/cfg_baned_name/),
      NO(/sys_user_action_log/),
      { match: /select lastcid as v/i, rows: [{ v: 209355 }] },
      { match: /max\(b\.level\) as v/i, rows: [{ v: 5 }] },
      { match: /select gold as v/i, rows: [{ v: 20000 }] },
      { match: /select 1 as v from sys_union/i, rows: [{ 1: 1 }] },
      NO(/.*/),
    ]);
    await expect(taken.cmd.createUnion(ctx, ['新盟'])).rejects.toThrow(
      'createUnion.use_another_name',
    );
  });

  it('founds the union: pays 10000 gold, registers the leader and lands the event', async () => {
    const { cmd, db } = build([
      USER,
      NO(/cfg_baned_name/),
      NO(/sys_user_action_log where/i),
      { match: /select lastcid as v/i, rows: [{ v: 209355 }] },
      { match: /max\(b\.level\) as v/i, rows: [{ v: 5 }] },
      { match: /select gold as v/i, rows: [{ v: 20000 }] },
      NO(/select 1 as v from sys_union/),
      { match: /insert into sys_union \(name/i, rows: [], insertId: 42 },
      { match: /select name as v from sys_user where uid = \?/i, rows: [{ v: '长乐' }] },
      NO(/.*/),
    ]);
    expect(await cmd.createUnion(ctx, ['新盟'])).toEqual([42, 0, '新盟']);
    const find = (re: RegExp) => db.executed.filter((q) => re.test(q.sql));
    expect(find(/update mem_city_resource set gold = gold - \?/i)[0]!.parameters).toEqual([
      10000, 209355,
    ]);
    expect(find(/update sys_user set union_id = \?, union_pos = \?/i)[0]!.parameters).toEqual([
      42, 5, 1001,
    ]);
    expect(find(/insert into sys_user_donate/i)[0]!.parameters).toEqual([1001, 42, 10000]);
    expect(find(/insert into sys_union_building/i)).toHaveLength(1);
    expect(find(/insert into mem_union_buf/i)).toHaveLength(1);
    expect(find(/replace into sys_user_goal/i)).toHaveLength(1); // completeTask 67
    const evt = find(/insert into sys_union_event/i);
    expect(evt).toHaveLength(1);
    expect(evt[0]!.parameters).toEqual([
      42,
      0,
      ' 恭喜【长乐】创建【新盟联盟】,欢迎各位志同道合的君主加入!',
    ]);
  });
});

describe('UnionCommands.applyJoin', () => {
  it('rejects without a 鸿胪寺, when already in a union, with a pending application or an unknown union', async () => {
    const nohl = build([{ match: /max\(b\.level\) as v/i, rows: [] }, NO(/.*/)]);
    await expect(nohl.cmd.applyJoin(ctx, [7])).rejects.toThrow('applyJoin.no_HongLu_built');
    const joined = build([
      { match: /max\(b\.level\) as v/i, rows: [{ v: 5 }] },
      { match: /select union_id as v/i, rows: [{ v: 7 }] },
      NO(/.*/),
    ]);
    await expect(joined.cmd.applyJoin(ctx, [7])).rejects.toThrow(
      'applyJoin.already_joined_other_union',
    );
    const pending = build([
      { match: /max\(b\.level\) as v/i, rows: [{ v: 5 }] },
      { match: /select union_id as v/i, rows: [{ v: 0 }] },
      { match: /select name as v from sys_union_apply/i, rows: [{ v: '旧盟' }] },
      NO(/.*/),
    ]);
    const err = (await pending.cmd
      .applyJoin(ctx, [7])
      .catch((e: unknown) => e)) as import('../common/game-error').GameError;
    expect(lang.messageOf(err)).toBe('已申请加入[旧盟]。');
    const unknown = build([
      { match: /max\(b\.level\) as v/i, rows: [{ v: 5 }] },
      { match: /select union_id as v/i, rows: [{ v: 0 }] },
      { match: /select name as v from sys_union_apply/i, rows: [] },
      { match: /select name as v from sys_union where id = \?/i, rows: [] },
      NO(/.*/),
    ]);
    await expect(unknown.cmd.applyJoin(ctx, [7])).rejects.toThrow('applyJoin.union_not_exist');
  });

  it('files the application and throws the success text (original throw-as-message)', async () => {
    const { cmd, db } = build([
      { match: /max\(b\.level\) as v/i, rows: [{ v: 5 }] },
      { match: /select union_id as v/i, rows: [{ v: 0 }] },
      { match: /select name as v from sys_union_apply/i, rows: [] },
      { match: /select name as v from sys_union where id = \?/i, rows: [{ v: '新盟' }] },
      NO(/insert into sys_union_apply/i),
      NO(/.*/),
    ]);
    await expect(cmd.applyJoin(ctx, [42])).rejects.toThrow('applyJoin.send_application_succ');
    expect(db.executed.find((q) => /insert into sys_union_apply/i.test(q.sql))!.parameters).toEqual(
      [1001, 42, '新盟'],
    );
  });
});

describe('UnionCommands.getUnionApplyInvite', () => {
  it('returns the membership header for a union member', async () => {
    const { cmd } = build([
      {
        match: /select union_id, union_pos from sys_user/i,
        rows: [{ union_id: 42, union_pos: 5 }],
      },
      { match: /select name as v from sys_union where id = \?/i, rows: [{ v: '新盟' }] },
      NO(/.*/),
    ]);
    expect(await cmd.getUnionApplyInvite(ctx)).toEqual([42, 5, '新盟', '［新盟】的申请已发出。']);
  });

  it('returns the pending application name and the invite rows without a union', async () => {
    const { cmd } = build([
      { match: /select union_id, union_pos from sys_user/i, rows: [{ union_id: 0, union_pos: 0 }] },
      NO(/update sys_alarm/),
      { match: /select name as v from sys_union_apply/i, rows: [{ v: '旧盟' }] },
      { match: /from sys_union_invite i/i, rows: [{ id: 9 }] },
      NO(/.*/),
    ]);
    expect(await cmd.getUnionApplyInvite(ctx)).toEqual([0, 0, '旧盟', [{ id: 9 }]]);
  });
});
