import { PushFrameType, type PushMessage, type PushProcId } from '@hot/shared';

/**
 * The push connection (`ws://host/ws?uid=…&sid=…`): JSON frames of `{type, proc, data}` —
 * Request from the client, Reply addressed back with the same proc, Notify broadcast. Replaces
 * the legacy binary `[byte][short][int][payload]` TCP framing of ChatSocket.as with the same
 * proc numbers.
 */
export class PushClient {
  private ws: WebSocket | null = null;
  private readonly receivers = new Map<PushProcId, Set<(data: unknown) => void>>();
  private readonly replies = new Map<PushProcId, Set<(data: unknown) => void>>();

  constructor(
    private readonly url: string,
    private readonly uid: number,
    private readonly sid: string,
  ) {}

  connect(): void {
    if (this.ws) return;
    const ws = new WebSocket(`${this.url}?uid=${this.uid}&sid=${this.sid}`);
    this.ws = ws;
    ws.onmessage = (ev) => {
      let msg: PushMessage;
      try {
        msg = JSON.parse(String(ev.data)) as PushMessage;
      } catch {
        return;
      }
      if (msg.type === PushFrameType.Notify) {
        for (const fn of this.receivers.get(msg.proc) ?? []) fn(msg.data);
      } else if (msg.type === PushFrameType.Reply) {
        for (const fn of this.replies.get(msg.proc) ?? []) fn(msg.data);
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
    };
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  /** Fires a Request proc; the (optional) reply arrives on the same proc's reply channel. */
  request(proc: PushProcId, data: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: PushFrameType.Request, proc, data }));
  }

  /** Registers a Notify listener for a proc; returns the unsubscribe function. */
  on(proc: PushProcId, fn: (data: unknown) => void): () => void {
    let set = this.receivers.get(proc);
    if (!set) this.receivers.set(proc, (set = new Set()));
    set.add(fn);
    return () => set?.delete(fn);
  }

  /** Registers a Reply listener (e.g. the send echo of a chat message). */
  onReply(proc: PushProcId, fn: (data: unknown) => void): () => void {
    let set = this.replies.get(proc);
    if (!set) this.replies.set(proc, (set = new Set()));
    set.add(fn);
    return () => set?.delete(fn);
  }
}
