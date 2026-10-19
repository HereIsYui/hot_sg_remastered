import { PushFrameType, PushProc } from '@hot/shared';
import { describe, expect, it } from 'vitest';
import { type PushSocket, PushService } from './push.service';

function socket(open = true): PushSocket & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    readyState: open ? 1 : 3,
    sent,
    send: (data: string) => sent.push(JSON.parse(data)),
    close: () => undefined,
  };
}

describe('PushService', () => {
  it('notifies every open socket of a user', () => {
    const push = new PushService();
    const [a, b, closed] = [socket(), socket(), socket(false)];
    push.attach(1001, a);
    push.attach(1001, b);
    push.attach(1001, closed);
    expect(push.notify(1001, PushProc.NOTIFY_INFORM, { text: 'hi' })).toBe(2);
    expect(a.sent).toEqual([
      { type: PushFrameType.Notify, proc: PushProc.NOTIFY_INFORM, data: { text: 'hi' } },
    ]);
    expect(push.notify(9999, PushProc.NOTIFY_INFORM, null)).toBe(0);
  });

  it('broadcasts with an optional filter and tracks presence', () => {
    const push = new PushService();
    const [a, b] = [socket(), socket()];
    push.attach(1, a);
    push.attach(2, b);
    expect(push.broadcast(PushProc.NOTIFY_PUBLIC_CHAT, 'x', (uid) => uid === 2)).toBe(1);
    expect(a.sent).toHaveLength(0);
    push.detach(b);
    expect(push.isOnline(2)).toBe(false);
    expect(push.onlineUids()).toEqual([1]);
  });

  it('replies to requests with the handler result', async () => {
    const push = new PushService();
    const s = socket();
    push.attach(7, s);
    push.handle(PushProc.CHAT_PUBLIC_CHAT, (uid, data) => ({ uid, echo: data }));
    await push.receive(
      s,
      JSON.stringify({ type: PushFrameType.Request, proc: PushProc.CHAT_PUBLIC_CHAT, data: 'yo' }),
    );
    await push.receive(s, 'not json');
    await push.receive(
      s,
      JSON.stringify({ type: PushFrameType.Notify, proc: PushProc.CHAT_PUBLIC_CHAT, data: 1 }),
    );
    expect(s.sent).toEqual([
      { type: PushFrameType.Reply, proc: PushProc.CHAT_PUBLIC_CHAT, data: { uid: 7, echo: 'yo' } },
    ]);
    expect(() => push.handle(PushProc.CHAT_PUBLIC_CHAT, () => null)).toThrow(/already handled/);
  });
});
