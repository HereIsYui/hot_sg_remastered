import { describe, expect, it } from 'vitest';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { TaskRules } from '../core/task-rules.service';
import { MailCommands } from './mail.commands';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';

const lang = new LangService({
  getSysMail: { fromname: '系统' },
  readInboxMail: { mail_lost: '信件丢失，请与客服联系！' },
  readSysMail: { mail_lost: '信件丢失，请与客服联系！' },
  checkMailFull: { inbox_full: '收件箱已满', outbox_full: '发件箱已满' },
  sendPersonMail: {
    untitled: '无标题',
    no_name: '你要先填写君主名并建立城市才能发信。',
    enemy: '你在对方仇人名单中，无法发信',
    cant_find_addressee: '找不到收信人［%s］！',
    content_illegal: '信件内容包含非法字符，不能发送',
  },
  banned: { word_illegal: '标题包含非法字符' },
  sendUnionMail: {
    untitled: '无标题',
    union: '［联盟］',
    no_name: '你要先填写君主名并建立城市才能发信。',
    not_champion: '你不是盟主或副盟主，不能发联盟群发信！',
  },
});

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };

interface TaskCall {
  fn: 'completeTask' | 'completeTaskWithTaskid';
  uid: number;
  id: number;
}

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const taskCalls: TaskCall[] = [];
  const tasks = {
    completeTask: async (uid: number, goalId: number) => {
      taskCalls.push({ fn: 'completeTask', uid, id: goalId });
    },
    completeTaskWithTaskid: async (uid: number, taskid: number) => {
      taskCalls.push({ fn: 'completeTaskWithTaskid', uid, id: taskid });
    },
  } as unknown as TaskRules;
  const cmd = new MailCommands(db.scope, lang, tasks, new GoodsRules(db.scope));
  return { cmd, db, taskCalls };
}

const COUNT = (match: RegExp, n: number): Respond => ({ match, rows: [{ 'count(*)': n }] });
const NO = (match: RegExp): Respond => ({ match, rows: [] });

describe('MailCommands.getMail', () => {
  it('opens on the inbox (flag 0) when it has unread letters', async () => {
    const { cmd } = build([
      COUNT(/from sys_mail_box where uid = \? and recvstate = 0 and .read. = 0/i, 2),
      COUNT(/count\(\*\) from sys_mail_box where uid = \? and recvstate = 0/i, 2),
      {
        match: /select mid, fromname, contentid, title/i,
        rows: [{ mid: 5, fromname: '张三', title: 'hi', read: 0, posttime: 1 }],
      },
      NO(/.*/),
    ]);
    const ret = await cmd.getMail(ctx);
    // [pageCount, page, rows, flag]
    expect(ret[0]).toBe(1);
    expect(ret[1]).toBe(0);
    expect(Array.isArray(ret[2])).toBe(true);
    expect(ret.at(-1)).toBe(0);
  });

  it('falls back to 系统信 (flag 1) when only those are unread', async () => {
    const { cmd } = build([
      COUNT(/from sys_mail_box where uid = \? and recvstate = 0 and .read. = 0/i, 0),
      COUNT(/from sys_mail_sys_box where uid = \? and .read. = 0/i, 3),
      COUNT(/count\(\*\) from sys_mail_sys_box where uid = \?$/i, 3),
      { match: /select mid, contentid, title, \? as fromname/i, rows: [] },
      NO(/.*/),
    ]);
    const ret = await cmd.getMail(ctx);
    expect(ret.at(-1)).toBe(1);
  });

  it('clears sys_alarm.mail and shows the inbox (flag 0) when nothing is unread', async () => {
    const { cmd, db } = build([
      COUNT(/from sys_mail_box where uid = \? and recvstate = 0 and .read. = 0/i, 0),
      COUNT(/from sys_mail_sys_box where uid = \? and .read. = 0/i, 0),
      NO(/update sys_alarm set mail = /i),
      COUNT(/count\(\*\) from sys_mail_box where uid = \? and recvstate = 0/i, 0),
      NO(/.*/),
    ]);
    const ret = await cmd.getMail(ctx);
    expect(ret.at(-1)).toBe(0);
    expect(db.executed.some((q) => /update sys_alarm set mail = /i.test(q.sql))).toBe(true);
  });
});

describe('MailCommands.readInboxMail', () => {
  it('returns the body, marks it read and refreshes the unread flag', async () => {
    const { cmd, db } = build([
      {
        match: /from sys_mail_box i left join sys_mail_content/i,
        rows: [{ mid: 5, name: '', fromname: '张三', title: 'hi', posttime: 1, content: '正文' }],
      },
      NO(/update sys_mail_box set .read. = 1/i),
      COUNT(/from sys_mail_box where uid = \? and recvstate = 0 and .read. = 0/i, 0),
      COUNT(/from sys_mail_sys_box where uid = \? and .read. = 0/i, 0),
      NO(/.*/),
    ]);
    const ret = await cmd.readInboxMail(ctx, [5]);
    expect((ret[0] as Record<string, unknown>).content).toBe('正文');
    expect(db.executed.some((q) => /update sys_mail_box set .read. = 1/i.test(q.sql))).toBe(true);
  });

  it('throws mail_lost when the letter is gone', async () => {
    const { cmd } = build([
      { match: /from sys_mail_box i left join sys_mail_content/i, rows: [] },
      NO(/.*/),
    ]);
    await expect(cmd.readInboxMail(ctx, [5])).rejects.toThrow('readInboxMail.mail_lost');
  });
});

describe('MailCommands.sendPersonMail', () => {
  it('refuses a role without a 君主名', async () => {
    const { cmd } = build([
      { match: /select state from sys_user/i, rows: [{ state: 3 }] },
      NO(/.*/),
    ]);
    await expect(cmd.sendPersonMail(ctx, ['me', 'you', 't', 'c'])).rejects.toThrow(
      'sendPersonMail.no_name',
    );
  });

  it('refuses when the addressee does not exist', async () => {
    const { cmd } = build([
      { match: /select state from sys_user/i, rows: [{ state: 0 }] },
      COUNT(/count\(\*\) from sys_mail_box where uid = \? and recvstate = 0/i, 0),
      COUNT(/count\(\*\) from sys_mail_box where fromuid = \? and sendstate = 0/i, 0),
      NO(/cfg_baned_mail_content where instr/i),
      { match: /select name from sys_user where uid/i, rows: [{ name: '我' }] },
      { match: /select uid from sys_user where name/i, rows: [] },
      NO(/.*/),
    ]);
    await expect(cmd.sendPersonMail(ctx, ['me', '不存在', 't', 'c'])).rejects.toThrow(
      'sendPersonMail.cant_find_addressee',
    );
  });

  it('inserts the letter and raises the addressee alarm on success', async () => {
    const { cmd, db } = build([
      { match: /select state from sys_user/i, rows: [{ state: 0 }] },
      COUNT(/count\(\*\) from sys_mail_box where uid = \? and recvstate = 0/i, 0),
      COUNT(/count\(\*\) from sys_mail_box where fromuid = \? and sendstate = 0/i, 0),
      NO(/cfg_baned_mail_content where instr/i),
      { match: /select name from sys_user where uid/i, rows: [{ name: '我' }] },
      { match: /select uid from sys_user where name/i, rows: [{ uid: 1002 }] },
      NO(/from sys_user_relation/i),
      { match: /select content from cfg_baned_mail_content/i, rows: [] },
      { match: /insert into .?sys_mail_content/i, rows: [], insertId: 77 },
      NO(/.*/),
    ]);
    const ret = await cmd.sendPersonMail(ctx, ['me', 'you', '标题', '正文']);
    expect(ret).toEqual([]);
    expect(db.executed.some((q) => /insert into sys_mail_box/i.test(q.sql))).toBe(true);
    expect(
      db.executed.some(
        (q) => /insert into sys_alarm .* mail/i.test(q.sql) && q.parameters.includes(1002),
      ),
    ).toBe(true);
  });
});

describe('MailCommands.sendUnionMail', () => {
  const ARGS = ['长乐', 0, '群发', '内容'];
  // A 副盟主 (union_pos 4) of 盟 7 who passes every guard before the broadcast; `horn` is the
  // sender's 传音符 (gid 1) count, or null for a missing sys_goods row.
  const BASE = (horn: number | null): Respond[] => [
    { match: /select state from sys_user where uid/i, rows: [{ state: 1 }] },
    { match: /select name from sys_user where uid/i, rows: [{ name: '盟主甲' }] },
    NO(/cfg_baned_mail_content where instr/i),
    COUNT(/count\(\*\) from sys_mail_box where uid = \? and recvstate = 0/i, 0),
    COUNT(/count\(\*\) from sys_mail_box where fromuid = \? and sendstate = 0/i, 0),
    { match: /select union_id, union_pos from sys_user/i, rows: [{ union_id: 7, union_pos: 4 }] },
    NO(/select leader from sys_union/i),
    {
      match: /select `count` from sys_goods where uid = \? and gid = \?/i,
      rows: horn === null ? [] : [{ count: horn }],
    },
  ];

  it('refuses a role with no 君主名 (state 3)', async () => {
    const { cmd } = build([
      { match: /select state from sys_user where uid/i, rows: [{ state: 3 }] },
      NO(/.*/),
    ]);
    await expect(cmd.sendUnionMail(ctx, ARGS)).rejects.toThrow('sendUnionMail.no_name');
  });

  it('rejects a non-champion before the broadcast', async () => {
    const { cmd } = build([
      { match: /select state from sys_user where uid/i, rows: [{ state: 1 }] },
      NO(/from cfg_baned_mail_content/i), // title passes the banned check
      COUNT(/count\(\*\) from sys_mail_box where uid = \? and recvstate = 0/i, 0),
      COUNT(/count\(\*\) from sys_mail_box where fromuid = \? and sendstate = 0/i, 0),
      { match: /select union_id, union_pos from sys_user/i, rows: [{ union_id: 0, union_pos: 0 }] },
      NO(/select leader from sys_union/i),
      NO(/.*/),
    ]);
    await expect(cmd.sendUnionMail(ctx, ARGS)).rejects.toThrow('sendUnionMail.not_champion');
  });

  it('demands the missing 传音符 when the sender owns fewer than 2 (gid 1)', async () => {
    const { cmd, db } = build([
      ...BASE(1),
      NO(/.*/), // nothing after the shortage throw
    ]);
    await expect(cmd.sendUnionMail(ctx, ARGS)).rejects.toThrow('not_enough_goods1#1');
    expect(db.executed.some((q) => /insert into sys_mail_box/i.test(q.sql))).toBe(false);
    expect(db.executed.some((q) => /insert into sys_goods/i.test(q.sql))).toBe(false);
  });

  it('counts a missing sys_goods row as 0 传音符 (PHP null < 2), so 2 are missing', async () => {
    const { cmd } = build([...BASE(null), NO(/.*/)]);
    await expect(cmd.sendUnionMail(ctx, ARGS)).rejects.toThrow('not_enough_goods1#2');
  });

  it('logs and rejects content carrying a banned word (sendPersonMail 文案)', async () => {
    const { cmd, db } = build([
      ...BASE(9),
      {
        match: /select content from cfg_baned_mail_content/i,
        rows: [{ content: '外挂' }, { content: '' }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.sendUnionMail(ctx, ['长乐', 0, '群发', '这里有外挂'])).rejects.toThrow(
      'sendPersonMail.content_illegal',
    );
    const log = db.executed.find((q) => /insert into log_illegal_user/i.test(q.sql));
    expect(log?.parameters).toEqual([1001, '盟主甲']); // the initial count 1 is literal SQL
    expect(db.executed.some((q) => /insert into sys_mail_box/i.test(q.sql))).toBe(false);
  });

  it('fans one type-2 letter out to 盟 7, raises alarms, spends 2 传音符 and finishes task 80', async () => {
    const { cmd, db, taskCalls } = build([
      ...BASE(9),
      { match: /select content from cfg_baned_mail_content/i, rows: [{ content: '外挂' }] },
      { match: /insert into .?sys_mail_content/i, rows: [], insertId: 77 },
      NO(/.*/),
    ]);
    const ret = await cmd.sendUnionMail(ctx, ['长乐', 0, '', '正常内容']);
    expect(ret).toEqual([]);

    // The single insert-select delivers to every member of union 7; the stored title got the
    // ［联盟］ prefix and the 无标题 default, while the banned scan saw the raw empty title.
    const box = db.executed.find((q) => /insert into sys_mail_box/i.test(q.sql));
    expect(box?.sql).toMatch(
      /\(select uid, name, \?, \?, \?, \?, 0, 0, 0, unix_timestamp\(\), 2\s+from sys_user where union_id = \?\)/i,
    );
    expect(box?.parameters).toEqual([1001, '盟主甲', 77, '［联盟］无标题', 7]);
    expect(
      db.executed.some(
        (q) =>
          /cfg_baned_mail_content where instr\(\?, content\)/i.test(q.sql) &&
          q.parameters[0] === '',
      ),
    ).toBe(true);

    const alarm = db.executed.find((q) => /insert into sys_alarm/i.test(q.sql));
    expect(alarm?.sql).toMatch(
      /select uid, 1 from sys_user where union_id = \?\)\s+on duplicate key update mail = 1/i,
    );
    expect(alarm?.parameters).toEqual([7]);

    const goods = db.executed.find((q) => /insert into sys_goods/i.test(q.sql));
    expect(goods?.parameters).toEqual([1001, 1, -2, -2]);
    const goodsLog = db.executed.find((q) => /insert into `?log_goods`?/i.test(q.sql));
    expect(goodsLog?.parameters[1]).toBe(1);
    expect(goodsLog?.parameters[2]).toBe(-2);
    expect(goodsLog?.parameters[3]).toBe(0);

    expect(taskCalls).toEqual([{ fn: 'completeTask', uid: 1001, id: 80 }]);
    expect(db.executed.some((q) => /insert into log_illegal_user/i.test(q.sql))).toBe(false);
  });
});
