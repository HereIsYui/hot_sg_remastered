import { Injectable, Logger } from '@nestjs/common';
import { PushFrameType, type PushMessage, type PushProcId } from '@hot/shared';

/** The subset of a ws WebSocket the push layer needs (keeps tests free of real sockets). */
export interface PushSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const OPEN = 1;

export type PushRequestHandler = (uid: number, data: unknown) => unknown;

/**
 * Tracks connected players and delivers `{type, proc, data}` messages; replaces the chat /
 * notification server on TCP 5308 of the original backend.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly sockets = new Map<number, Set<PushSocket>>();
  private readonly owners = new Map<PushSocket, number>();
  private readonly handlers = new Map<PushProcId, PushRequestHandler>();

  attach(uid: number, socket: PushSocket): void {
    let set = this.sockets.get(uid);
    if (!set) this.sockets.set(uid, (set = new Set()));
    set.add(socket);
    this.owners.set(socket, uid);
  }

  detach(socket: PushSocket): void {
    const uid = this.owners.get(socket);
    if (uid === undefined) return;
    this.owners.delete(socket);
    const set = this.sockets.get(uid);
    set?.delete(socket);
    if (set?.size === 0) this.sockets.delete(uid);
  }

  isOnline(uid: number): boolean {
    return this.sockets.has(uid);
  }

  onlineUids(): number[] {
    return [...this.sockets.keys()];
  }

  /** Registers the handler for client requests with the given proc (e.g. chat messages). */
  handle(proc: PushProcId, handler: PushRequestHandler): void {
    if (this.handlers.has(proc)) throw new Error(`push proc ${proc} already handled`);
    this.handlers.set(proc, handler);
  }

  notify<T>(uid: number, proc: PushProcId, data: T): number {
    return this.deliver(this.sockets.get(uid) ?? [], { type: PushFrameType.Notify, proc, data });
  }

  broadcast<T>(proc: PushProcId, data: T, filter?: (uid: number) => boolean): number {
    let sent = 0;
    for (const [uid, set] of this.sockets) {
      if (!filter || filter(uid))
        sent += this.deliver(set, { type: PushFrameType.Notify, proc, data });
    }
    return sent;
  }

  /** Handles one raw frame from a client; requests get a Reply with the same proc. */
  async receive(socket: PushSocket, raw: string): Promise<void> {
    const uid = this.owners.get(socket);
    if (uid === undefined) return;
    let msg: PushMessage;
    try {
      msg = JSON.parse(raw) as PushMessage;
    } catch {
      this.logger.debug(`uid ${uid}: ignoring non-JSON frame`);
      return;
    }
    if (msg.type !== PushFrameType.Request) return;
    const handler = this.handlers.get(msg.proc);
    if (!handler) {
      this.logger.debug(`uid ${uid}: no handler for proc ${msg.proc}`);
      return;
    }
    try {
      const data = await handler(uid, msg.data);
      this.deliver([socket], { type: PushFrameType.Reply, proc: msg.proc, data: data ?? null });
    } catch (err) {
      this.logger.error(
        `proc ${msg.proc} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private deliver(sockets: Iterable<PushSocket>, msg: PushMessage): number {
    const payload = JSON.stringify(msg);
    let sent = 0;
    for (const s of sockets) {
      if (s.readyState === OPEN) {
        s.send(payload);
        sent++;
      }
    }
    return sent;
  }
}
