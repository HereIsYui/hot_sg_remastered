import { describe, expect, it, vi } from 'vitest';
import { LangService } from '../common/lang.service';
import type { CityRules } from '../core/city-rules.service';
import type { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { LeaveCommands } from './leave.commands';
import type { UnionRules } from './union-rules.service';

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };
const no = (match: RegExp): Respond => ({ match, rows: [] });
const lang = new LangService({ leaveUnion: { addUnionEvent: '%s 退盟' } });

function build(rules: Respond[]) {
  const db = new FakeDb([...rules, no(/.*/)]);
  const union = {
    canUserLeaveUnion: vi.fn(async () => {}),
    notifyUnionChange: vi.fn(async () => {}),
    addUnionEvent: vi.fn(async () => {}),
  } as unknown as UnionRules;
  const users = { updateUnionRank: vi.fn(async () => {}) } as unknown as UserRules;
  const cities = { updateCityResourceAdd: vi.fn(async () => {}) } as unknown as CityRules;
  const cmd = new LeaveCommands(db.scope, union, users, cities, lang);
  return { cmd, db, union, users };
}

describe('LeaveCommands.leaveUnion', () => {
  it('dissolves the union when the leader is the last member', async () => {
    const { cmd, db, union } = build([
      {
        match: /select name, union_id, union_pos from sys_user/i,
        rows: [{ name: '盟主', union_id: 42, union_pos: 5 }],
      },
      { match: /select \* from sys_union where id/i, rows: [{ leader: 1001, member: 1 }] },
      { match: /select member as v from sys_union/i, rows: [{ v: 1 }] },
    ]);
    expect(await cmd.leaveUnion(ctx)).toEqual([]);
    expect(db.executed.some((q) => /delete from sys_union where id/i.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /delete from sys_union_relation/i.test(q.sql))).toBe(true);
    expect(union.addUnionEvent).toHaveBeenCalledWith(42, 1, '盟主 退盟');
  });

  it('removes a normal member and updates the member count and rank', async () => {
    const { cmd, db, union, users } = build([
      {
        match: /select name, union_id, union_pos from sys_user/i,
        rows: [{ name: '成员', union_id: 42, union_pos: 0 }],
      },
      { match: /select \* from sys_union where id/i, rows: [{ leader: 1002, member: 2 }] },
      { match: /select count\(\*\) as v from sys_city where uid = \? and type/i, rows: [{ v: 0 }] },
      { match: /select cid from sys_city where uid = \?/i, rows: [] },
      { match: /select id, cid, targetcid from sys_troops/i, rows: [] },
    ]);
    expect(await cmd.leaveUnion(ctx)).toEqual([]);
    expect(db.executed.some((q) => /update sys_union set member = member - 1/i.test(q.sql))).toBe(
      true,
    );
    expect(users.updateUnionRank).toHaveBeenCalledWith(42);
    expect(union.addUnionEvent).toHaveBeenCalledWith(42, 1, '成员 退盟');
  });
});
