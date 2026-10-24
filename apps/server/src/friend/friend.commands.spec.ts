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
