import { PushProc, type PushProcId } from '@hot/shared';
import { describe, expect, it, vi } from 'vitest';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { ChatService } from './chat.service';
import type { PushRequestHandler } from './push.service';

function build(rules: Respond[] = []) {
  const db = new FakeDb([
    ...rules,
    { match: /forbiend > unix_timestamp/i, rows: [{ v: 0 }] },
    { match: /select name as v from sys_user/i, rows: [{ v: '甲' }] },
    { match: /select uid as v from sys_user where name/i, rows: [{ v: 1002 }] },
    { match: /select union_id as v from sys_user/i, rows: [{ v: 7 }] },
    { match: /select uid from sys_user where union_id/i, rows: [{ uid: 1001 }, { uid: 1002 }] },
    { match: /select word from sys_chat_word/i, rows: [{ word: '敏感' }] },
    { match: /.*/, rows: [] },
  ]);
  const handlers = new Map<PushProcId, PushRequestHandler>();
  const push = {
    handle: vi.fn((proc: PushProcId, handler: PushRequestHandler) => handlers.set(proc, handler)),
    notify: vi.fn(),
    broadcast: vi.fn(),
  };
  const service = new ChatService(push as never, db.scope);
  service.onModuleInit();
  const call = (proc: PushProcId, uid: number, data: unknown = {}) =>
    handlers.get(proc)!(uid, data) as Promise<Record<string, unknown>>;
  return { db, push, call };
}

describe('ChatService channels and keywords', () => {
  it('routes private messages to the target and replies once to the sender', async () => {
    const { push, call } = build();
    const reply = await call(PushProc.CHAT_PRIVATE_CHAT, 1001, {
      touser: '乙',
      msg: '你好',
    });
    expect(reply).toMatchObject({ ok: 1, fromuid: 1001, fromuser: '甲', touser: '乙' });
    expect(push.notify).toHaveBeenCalledTimes(1);
    expect(push.notify).toHaveBeenCalledWith(
      1002,
      PushProc.NOTIFY_PRIVATE_CHAT,
      expect.objectContaining({ msg: '你好' }),
    );
  });

  it('rejects missing private targets, blank text and muted senders', async () => {
    const { push, call } = build([
      { match: /select uid as v from sys_user where name/i, rows: [] },
      { match: /forbiend > unix_timestamp/i, rows: [{ v: 1 }] },
    ]);
    expect(await call(PushProc.CHAT_PRIVATE_CHAT, 1001, { touser: '无', msg: 'hi' })).toEqual({
      forbidden: 1,
    });
    expect(await call(PushProc.CHAT_PUBLIC_CHAT, 1001, { msg: ' 　\n' })).toEqual({
      forbidden: 1,
    });
    expect(push.notify).not.toHaveBeenCalled();
    expect(push.broadcast).not.toHaveBeenCalled();
  });

  it('returns nouser for an unknown private target', async () => {
    const { push, call } = build([
      { match: /select uid as v from sys_user where name/i, rows: [] },
    ]);
    expect(await call(PushProc.CHAT_PRIVATE_CHAT, 1001, { touser: '无', msg: 'hi' })).toEqual({
      nouser: 1,
    });
    expect(push.notify).not.toHaveBeenCalled();
  });

  it('broadcasts union messages only to other members and controls channels', async () => {
    const { push, call } = build();
    expect(await call(PushProc.CHAT_UNION_CHAT, 1001, { msg: '盟聊' })).toMatchObject({ ok: 1 });
    const filter = push.broadcast.mock.calls[0]![2] as (uid: number) => boolean;
    expect([filter(1001), filter(1002), filter(1003)]).toEqual([false, true, false]);
    expect(await call(PushProc.CHAT_CONTROL_CHANNEL, 1001, { channel: 2, enabled: 0 })).toEqual({
      channel: 2,
      enabled: false,
    });
    expect(await call(PushProc.CHAT_CONTROL_CHANNEL, 1001, { channel: 8 })).toEqual({ error: 1 });
  });

  it('loads keywords and restricts changes to administrators', async () => {
    const { db, call } = build();
    expect(await call(PushProc.CHAT_LOGIN, 1001)).toMatchObject({ keywords: ['敏感'] });
    expect(await call(PushProc.NOTIFY_ADD_KEY_WORD, 1001, { word: '新词' })).toEqual({ denied: 1 });
    expect(db.executed.some((q) => /insert into sys_chat_word/i.test(q.sql))).toBe(false);

    const admin = build([{ match: /`group` = 0/i, rows: [{ v: 1 }] }]);
    expect(await admin.call(PushProc.NOTIFY_ADD_KEY_WORD, 1001, { word: '新词' })).toEqual({
      keywords: ['敏感'],
      ok: 1,
    });
    expect(admin.db.executed.some((q) => /insert into sys_chat_word/i.test(q.sql))).toBe(true);
    expect(admin.push.broadcast).toHaveBeenCalledWith(PushProc.NOTIFY_ADD_KEY_WORD, {
      word: '新词',
    });
    await admin.call(PushProc.NOTIFY_DEL_KEY_WORD, 1001, { word: '敏感' });
    expect(admin.db.executed.some((q) => /delete from sys_chat_word/i.test(q.sql))).toBe(true);
  });
});
