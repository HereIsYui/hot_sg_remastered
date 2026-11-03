import { describe, expect, it, vi } from 'vitest';
import { PushProc } from '@hot/shared';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { PushService } from './push.service';
import { WarEventService } from './war-event.service';

const no = (match: RegExp): Respond => ({ match, rows: [] });

function build(sent: number, rows: Respond[] = []) {
  const db = new FakeDb([
    {
      match: /select \* from mem_war_event/i,
      rows: [
        {
          id: 7,
          battleid: 5,
          unionid: 2,
          type: 2,
          content: '黄巾军 程远志 部 在 广宗 击败了 汉军 刘备 部。',
          evttime: 1000,
        },
      ],
    },
    ...rows,
    no(/.*/),
  ]);
  const push = { broadcast: vi.fn(() => sent) } as unknown as PushService;
  return { db, push, service: new WarEventService(db.scope, push) };
}

describe('WarEventService.drain', () => {
  it('broadcasts proc 52 to the battlefield participants and consumes delivered rows', async () => {
    const { db, push, service } = build(
      1,
      // 载体：战场 5 里还有 state=0 的参战者 uid 1001（BattleFunc.php:1003 的口径）。
      [{ match: /select uid from sys_user_battle_state/i, rows: [{ uid: 1001 }] }],
    );
    await service.drain();
    expect(push.broadcast).toHaveBeenCalledWith(
      PushProc.NOTIFY_WAR_EVENT,
      { sysType: 2, battleUnionId: 2, msg: '黄巾军 程远志 部 在 广宗 击败了 汉军 刘备 部。' },
      expect.any(Function),
    );
    const broadcast = push.broadcast as ReturnType<typeof vi.fn>;
    const call = broadcast.mock.calls[0];
    expect(call).toBeDefined();
    const filter = call?.[2] as (uid: number) => boolean;
    expect(filter(1001)).toBe(true);
    expect(filter(9999)).toBe(false);
    expect(db.executed.some((q) => /delete from mem_war_event where id/i.test(q.sql))).toBe(true);
  });

  it('keeps rows while participants exist but none is online', async () => {
    const { db, push, service } = build(0, [
      { match: /select uid from sys_user_battle_state/i, rows: [{ uid: 1001 }] },
    ]);
    await service.drain();
    expect(push.broadcast).toHaveBeenCalled();
    expect(db.executed.some((q) => /delete from mem_war_event where id/i.test(q.sql))).toBe(false);
  });

  it('drops rows for a battlefield nobody is in any more', async () => {
    const { db, push, service } = build(0, [
      { match: /select uid from sys_user_battle_state/i, rows: [] },
    ]);
    await service.drain();
    expect(push.broadcast).not.toHaveBeenCalled();
    expect(db.executed.some((q) => /delete from mem_war_event where id/i.test(q.sql))).toBe(true);
  });

  it('passes a battle-dialog sysType (≥100) through untouched', async () => {
    const db = new FakeDb([
      {
        match: /select \* from mem_war_event/i,
        rows: [{ id: 9, battleid: 5, unionid: 3, type: 101, content: '战场结束', evttime: 1000 }],
      },
      { match: /select uid from sys_user_battle_state/i, rows: [{ uid: 1001 }] },
      no(/.*/),
    ]);
    const push = { broadcast: vi.fn(() => 1) } as unknown as PushService;
    const service = new WarEventService(db.scope, push);
    await service.drain();
    expect(push.broadcast).toHaveBeenCalledWith(
      PushProc.NOTIFY_WAR_EVENT,
      { sysType: 101, battleUnionId: 3, msg: '战场结束' },
      expect.any(Function),
    );
  });
});
