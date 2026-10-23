import { describe, expect, it } from 'vitest';
import { LangService } from '../common/lang.service';
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
});

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const tasks = {
    completeTask: async () => {},
    completeTaskWithTaskid: async () => {},
  } as unknown as TaskRules;
  const cmd = new MailCommands(db.scope, lang, tasks);
  return { cmd, db };
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
      { match: /insert into sys_mail_content/i, rows: [], insertId: 77 },
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
  it('reports 暂未开放 while the 联盟 module is unported', async () => {
    const { cmd } = build([NO(/.*/)]);
    await expect(cmd.sendUnionMail()).rejects.toThrow(/联盟群发信暂未开放/);
  });
});
