import { describe, expect, it } from 'vitest';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { FriendCommands } from './friend.commands';

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };
const NO = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const cmd = new FriendCommands(
    db.scope,
    new TaskRules(db.scope, new UserRules(db.scope)),
    new UserRules(db.scope),
  );
  return { cmd, db };
}

describe('FriendCommands.getUserRelation', () => {
  it('returns [] without relations', async () => {
    const { cmd } = build([{ match: /from sys_user_relation u/i, rows: [] }]);
    expect(await cmd.getUserRelation(ctx)).toEqual([]);
  });

  it('buffers the nobility and formats the time of each relation', async () => {
    const { cmd } = build([
      {
        match: /from sys_user_relation u/i,
        rows: [
          {
            tuid: 1002,
            tname: '张三',
            type: 0,
            unionName: '盟',
            nobility: 2,
            time: 86400,
            cid: 1,
            tcid: 2,
          },
        ],
      },
      // getBufferNobility: no 推恩令 buff
      { match: /from `mem_user_buffer` where `uid` = \? and `buftype` in/i, rows: [] },
      { match: /select from_unixtime\(\?\) as v/i, rows: [{ v: '1970-01-02 00:00:00' }] },
    ]);
    const res = (await cmd.getUserRelation(ctx)) as unknown[][];
    expect(res[0]).toEqual([
      {
        tuid: 1002,
        tname: '张三',
        type: 0,
        unionName: '盟',
        nobility: 2,
        time: '1970-01-02 00:00:00',
        cid: 1,
        tcid: 2,
      },
    ]);
  });
});

describe('FriendCommands.addFriendsTaskFinish', () => {
  it('completes every goal of the friend task 313', async () => {
    const { cmd, db } = build([
      { match: /cfg_task_goal/i, rows: [{ id: 102486 }] },
      NO(/replace into sys_user_goal/i),
      NO(/.*/),
    ]);
    await cmd.addFriendsTaskFinish(ctx);
    const goals = db.executed.find((q) => /cfg_task_goal/i.test(q.sql));
    expect(goals!.parameters).toEqual([313]);
    const goal = db.executed.filter((q) => /replace into sys_user_goal/i.test(q.sql));
    expect(goal.length).toBeGreaterThan(0);
  });
});

describe('FriendCommands.addUserRelation', () => {
  it('rejects a type beyond 仇人 with an empty message', async () => {
    const { cmd } = build([NO(/.*/)]);
    const err = await cmd.addUserRelation(ctx, ['张三', 2]).catch((e: unknown) => e as Error);
    expect(err.message).toBe('');
  });

  it('rejects an unknown target user and the 20-relation cap', async () => {
    const { cmd } = build([{ match: /select uid as v from sys_user/i, rows: [] }, NO(/.*/)]);
    const err = await cmd.addUserRelation(ctx, ['张三', 0]).catch((e: unknown) => e as Error);
    expect(err.message).toBe('');
    const { cmd: cmd2 } = build([
      { match: /select uid as v from sys_user/i, rows: [{ v: 1002 }] },
      { match: /select count\(\*\) as v from sys_user_relation/i, rows: [{ v: 20 }] },
      NO(/.*/),
    ]);
    const err2 = await cmd2.addUserRelation(ctx, ['张三', 0]).catch((e: unknown) => e as Error);
    expect(err2.message).toBe('');
  });

  it('inserts the relation (tname column dropped) and completes task 313 for friends', async () => {
    const { cmd, db } = build([
      { match: /select uid as v from sys_user/i, rows: [{ v: 1002 }] },
      { match: /select count\(\*\) as v from sys_user_relation/i, rows: [{ v: 3 }] },
      { match: /cfg_task_goal/i, rows: [{ id: 102486 }] },
      NO(/insert into sys_user_relation/i),
      NO(/replace into sys_user_goal/i),
      NO(/.*/),
    ]);
    expect(await cmd.addUserRelation(ctx, ['张三', 0])).toEqual([1002, '张三', 0]);
    const insert = db.executed.find((q) => /insert into sys_user_relation/i.test(q.sql));
    expect(insert!.sql).not.toMatch(/tname/);
    expect(insert!.parameters[0]).toBe(1001);
    expect(db.executed.some((q) => /replace into sys_user_goal/i.test(q.sql))).toBe(true);
  });
});

describe('FriendCommands.removeRelation', () => {
  it('deletes by the target name scoped to the caller', async () => {
    const { cmd, db } = build([NO(/.*/)]);
    expect(await cmd.removeRelation(ctx, ['张三', 0])).toEqual(['张三', 0]);
    expect(db.executed[0]!.sql).toMatch(/delete u from sys_user_relation u join sys_user s/i);
    expect(db.executed[0]!.parameters).toEqual([1001, '张三', 0]);
  });
});
