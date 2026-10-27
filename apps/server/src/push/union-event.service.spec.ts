import { describe, expect, it, vi } from 'vitest';
import { PushProc } from '@hot/shared';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import type { PushService } from './push.service';
import { UnionEventService } from './union-event.service';

const no = (match: RegExp): Respond => ({ match, rows: [] });

function build(sent: number, rows: Respond[] = []) {
  const db = new FakeDb([
    {
      match: /select \* from mem_union_event/i,
      rows: [{ unionid: 42, type: 0, content: '欢迎入盟', evttime: 1000 }],
    },
    ...rows,
    no(/.*/),
  ]);
  const push = { broadcast: vi.fn(() => sent) } as unknown as PushService;
  return { db, push, service: new UnionEventService(db.scope, push) };
}

describe('UnionEventService', () => {
  it('broadcasts proc 17 to union members and consumes delivered rows', async () => {
    const { db, push, service } = build(1);
    await service.drain();
    expect(push.broadcast).toHaveBeenCalledWith(
      PushProc.NOTIFY_UNION_EVENT,
      { msg: '欢迎入盟' },
      expect.any(Function),
    );
    expect(db.executed.some((q) => /delete from mem_union_event/i.test(q.sql))).toBe(true);
  });

  it('keeps events while no member is online', async () => {
    const { db, service } = build(0);
    await service.drain();
    expect(db.executed.some((q) => /delete from mem_union_event/i.test(q.sql))).toBe(false);
  });
});
