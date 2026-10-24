import { Injectable, type OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { PushProc } from '@hot/shared';
import { DbScope } from '../db/database.module';
import { phpIntval, phpNum, phpString } from '../core/php';
import type { PushSocket } from './push.service';
import { PushService } from './push.service';

/**
 * The chat channels of Chat/ChatPanel.as, carried by the push gateway. The proc numbers are the
 * original's (protocol/push.ts); the legacy binary payload becomes JSON with the same field
 * names (fromuser / msg / fromdesignation, ChatPanel.as's readUTF order). The original's chat
 * server is an external deployment absent from the 单机包, so there is no legacy baseline —
 * the channel semantics follow the client handlers instead.
 */
@Injectable()
export class ChatService implements OnModuleInit {
  constructor(
    private readonly push: PushService,
    private readonly scope: DbScope,
  ) {}

  onModuleInit(): void {
    this.push.handle(PushProc.CHAT_LOGIN, (uid) => this.login(uid));
    this.push.handle(PushProc.CHAT_PUBLIC_CHAT, (uid, data) => this.publicChat(uid, data));
    this.push.handle(PushProc.CHAT_PRIVATE_CHAT, (uid, data) => this.privateChat(uid, data));
    this.push.handle(PushProc.CHAT_UNION_CHAT, (uid, data) => this.unionChat(uid, data));
  }

  /** `CHAT_LOGIN`: greets the channel with the sender's own name (the client's join echo). */
  private async login(uid: number): Promise<unknown> {
    const name = await this.userName(uid);
    return { fromuser: name, msg: '', fromdesignation: '' };
  }

  /** 世界频道: broadcasts to every connected player. */
  private async publicChat(uid: number, data: unknown): Promise<unknown> {
    if (await this.forbidden(uid)) return { forbidden: 1 };
    const payload = await this.payload(uid, data);
    // the sender gets the Reply echo only (the original delivered the broadcast to others)
    this.push.broadcast(PushProc.NOTIFY_PUBLIC_CHAT, payload.chan, (id) => id !== uid);
    return payload.reply;
  }

  /** 私聊: routes to the named target when online. */
  private async privateChat(uid: number, data: unknown): Promise<unknown> {
    if (await this.forbidden(uid)) return { forbidden: 1 };
    const body = (data ?? {}) as Record<string, unknown>;
    const to = phpString(body.touser ?? '');
    const target = await this.uidByName(to);
    const payload = await this.payload(uid, data);
    const frame = { ...payload.chan, touser: to };
    if (target) this.push.notify(target, PushProc.NOTIFY_PRIVATE_CHAT, frame);
    this.push.notify(uid, PushProc.NOTIFY_PRIVATE_CHAT, frame);
    return payload.reply;
  }

  /** 联盟频道: broadcasts to the sender's unionmates (a no-op until the 联盟 module lands). */
  private async unionChat(uid: number, data: unknown): Promise<unknown> {
    if (await this.forbidden(uid)) return { forbidden: 1 };
    const unionid = phpIntval(
      (
        await sql<{ v: unknown }>`select union_id as v from sys_user where uid = ${uid}`.execute(
          this.scope.db,
        )
      ).rows[0]?.v,
    );
    if (!unionid) return { nouser: 1 };
    const payload = await this.payload(uid, data);
    const members = await sql<{
      uid: number;
    }>`select uid from sys_user where union_id = ${unionid}`.execute(this.scope.db);
    const ids = new Set(members.rows.map((r) => Number(r.uid)));
    this.push.broadcast(PushProc.NOTIFY_UNION_CHAT, payload.chan, (id) => ids.has(id));
    return payload.reply;
  }

  /**
   * The shared message frame: `{fromuser, msg, fromdesignation}` (ChatPanel.as's readUTF order;
   * the designation is the 官职 name). The sender's own display state is checked against
   * sys_user_state's 封禁 window (forbiend) — a banned player's message goes nowhere.
   */
  private async payload(
    uid: number,
    data: unknown,
  ): Promise<{ chan: Record<string, unknown>; reply: Record<string, unknown> }> {
    const body = (data ?? {}) as Record<string, unknown>;
    const name = await this.userName(uid);
    const msg = phpString(body.msg ?? '').slice(0, 100);
    const chan = { fromuser: name, msg, fromdesignation: '' };
    return { chan, reply: { ...chan, ok: 1 } };
  }

  /** sys_user_state.forbiend: the 封禁 window also silences the chat channels. */
  private async forbidden(uid: number): Promise<boolean> {
    const row = (
      await sql<{ v: unknown }>`select forbiend > unix_timestamp() as v from sys_user_state
        where uid = ${uid}`.execute(this.scope.db)
    ).rows[0];
    return phpNum(row?.v) === 1;
  }

  private async userName(uid: number): Promise<string> {
    return phpString(
      (
        await sql<{ v: unknown }>`select name as v from sys_user where uid = ${uid}`.execute(
          this.scope.db,
        )
      ).rows[0]?.v,
    );
  }

  private async uidByName(name: string): Promise<number | undefined> {
    const row = (
      await sql<{ v: unknown }>`select uid as v from sys_user where name = ${name}`.execute(
        this.scope.db,
      )
    ).rows[0];
    const uid = phpIntval(row?.v);
    return uid > 0 ? uid : undefined;
  }
}

/** The client-facing socket type mirror (the gateway's ws socket satisfies it). */
export type ChatSocket = PushSocket;
