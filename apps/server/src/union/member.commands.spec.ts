import { describe, expect, it, vi } from 'vitest';
import { LangService } from '../common/lang.service';
import type { TaskRules } from '../core/task-rules.service';
import type { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { MemberCommands } from './member.commands';
import type { UnionRules } from './union-rules.service';

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };
const no = (match: RegExp): Respond => ({ match, rows: [] });
const lang = new LangService({
  setUnionProvicy: { union_vice_chief: '副盟主', upgrade_level: '%s 提升 %s 为%s' },
  demissionUnion: { union_vice_chief: '副盟主', add_union_event: '%s 辞去%s' },
  upgradePosition: { 2: '%s 升职' },
});

function build(rules: Respond[] = []) {
  const db = new FakeDb([...rules, no(/.*/)]);
  const union = {
    addUnionEvent: vi.fn(async () => {}),
    notifyUnionChange: vi.fn(async () => {}),
    memberMaxCount: vi.fn(async () => 60),
    inviteList: vi.fn(async () => []),
    canUserLeaveUnion: vi.fn(async () => {}),
  } as unknown as UnionRules;
  const users = { updateUnionRank: vi.fn(async () => {}) } as unknown as UserRules;
  const tasks = { completeTask: vi.fn(async () => {}) } as unknown as TaskRules;
  const cmd = new MemberCommands(db.scope, union, users, tasks, lang);
  return { cmd, db, union, users, tasks };
}

describe('MemberCommands applications and offices', () => {
  it('accepts an applicant and updates membership and events', async () => {
    const { cmd, db, union, tasks } = build([
      {
        match: /select name, union_id from sys_user where uid = \?/i,
        rows: [{ name: '新人', union_id: 0 }],
      },
      { match: /max\(b\.level\) as v/i, rows: [{ v: 2 }] },
      {
        match: /select name, union_id, union_pos from sys_user where uid = \?/i,
        params: [1001],
        rows: [{ name: '盟主', union_id: 42, union_pos: 5 }],
      },
      {
        match: /select leader, member, chieforder from sys_union/i,
        rows: [{ leader: 1001, member: 1 }],
      },
      { match: /select uid as v from sys_union_apply/i, rows: [{ v: 1002 }] },
      {
        match: /select union_id, union_pos from sys_user where uid = \?/i,
        rows: [{ union_id: 42, union_pos: 5 }],
      },
      { match: /select count\(\*\) as v from sys_union_apply/i, rows: [{ v: 0 }] },
    ]);
    await cmd.acceptApply(ctx, [0, 1002]);
    expect(db.executed.some((q) => /update sys_user set union_id/i.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /update sys_union set member = member \+ 1/i.test(q.sql))).toBe(
      true,
    );
    expect(tasks.completeTask).toHaveBeenCalledWith(1002, 67);
    expect(union.addUnionEvent).toHaveBeenCalledWith(42, 0, expect.anything());
  });

  it('changes an office and records the promotion', async () => {
    const { cmd, db, union } = build([
      {
        match: /select name, union_id, union_pos from sys_user where uid = \?/i,
        params: [1001],
        rows: [{ name: '官员', union_id: 42, union_pos: 1 }],
      },
      {
        match: /select name, union_id, union_pos from sys_user where uid = \?/i,
        params: [1002],
        rows: [{ name: '成员', union_id: 42, union_pos: 0 }],
      },
    ]);
    expect(await cmd.setUnionProvicy(ctx, [1002, 2])).toEqual([1002, 2]);
    expect(
      db.executed.some((q) => /update sys_user set union_pos = \? where uid = \?/i.test(q.sql)),
    ).toBe(true);
    expect(union.addUnionEvent).toHaveBeenCalledWith(42, 9, '官员 提升 成员 为副盟主');
  });

  it('resigns an officer position but not leadership', async () => {
    const { cmd, union } = build([
      {
        match: /select name, union_id, union_pos from sys_user where uid = \?/i,
        rows: [{ name: '副盟', union_id: 42, union_pos: 2 }],
      },
      { match: /select leader from sys_union/i, rows: [{ leader: 1002 }] },
    ]);
    expect(await cmd.demissionUnion(ctx)).toEqual([]);
    expect(union.addUnionEvent).toHaveBeenCalledWith(42, 10, '副盟 辞去副盟主');
  });

  it('upgrades a position when donation and caps allow it', async () => {
    const { cmd, db, union } = build([
      {
        match: /select union_id, union_pos, name from sys_user where uid = \?/i,
        rows: [{ union_id: 42, union_pos: 1, name: '成员' }],
      },
      {
        match: /select \* from sys_user_donate where unionid = \? and uid = \?/i,
        rows: [{ donate: 500 }],
      },
      { match: /select level as v from sys_union_building/i, rows: [{ v: 10 }] },
      { match: /select min\(a.donate\) as v/i, rows: [] },
    ]);
    expect(await cmd.upgradePosition(ctx, [42])).toEqual(['成员 升职']);
    expect(db.executed.some((q) => /union_pos = least\(5, union_pos \+ 1\)/i.test(q.sql))).toBe(
      true,
    );
    expect(union.addUnionEvent).toHaveBeenCalledWith(42, 4, '成员 升职');
  });

  it('cancels a kick and reads countdowns', async () => {
    const { cmd, db } = build([
      {
        match: /select union_id, union_pos from sys_user where uid = \?/i,
        rows: [{ union_id: 42, union_pos: 4 }],
      },
      {
        match: /select \* from mem_union_remove where unionid = \?/i,
        rows: [{ uid: 1002, douid: 1001, time: 2000 }],
      },
      { match: /select name as v from sys_user where uid = \?/i, rows: [{ v: '成员' }] },
      { match: /select unix_timestamp\(\) as v/i, rows: [{ v: 1000 }] },
    ]);
    expect(await cmd.cancelKickMember(ctx, [1002])).toEqual([]);
    expect(db.executed.some((q) => /delete from mem_union_remove/i.test(q.sql))).toBe(true);
    expect(await cmd.getKickLeavingTime(ctx)).toEqual([
      { doName: '成员', name: '成员', lefttime: 1000, kickuid: 1002 },
    ]);
  });
});
