import { Injectable, type OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { PushProc } from '@hot/shared';
import { DbScope } from '../db/database.module';
import { phpIntval, phpNum, phpString } from '../core/php';
import type { PushSocket } from './push.service';
import { PushService } from './push.service';

/** ChatPanel's channels over the JSON push gateway; the single-player package has no chat server. */
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
    this.push.handle(PushProc.CHAT_GET_KEY_WORDS, () => this.keywordReply());
    this.push.handle(PushProc.CHAT_CONTROL_CHANNEL, (_uid, data) => this.controlChannel(data));
    this.push.handle(PushProc.NOTIFY_ADD_KEY_WORD, (uid, data) =>
      this.changeKeyword(uid, data, true),
    );
    this.push.handle(PushProc.NOTIFY_DEL_KEY_WORD, (uid, data) =>
      this.changeKeyword(uid, data, false),
    );
  }

  private async login(uid: number): Promise<unknown> {
    const name = await this.userName(uid);
    return { fromuser: name, msg: '', fromdesignation: '', keywords: await this.keywords() };
  }

  private async publicChat(uid: number, data: unknown): Promise<unknown> {
    if (await this.forbidden(uid)) return { forbidden: 1 };
    const payload = await this.payload(uid, data);
    if (!payload) return { empty: 1 };
    this.push.broadcast(PushProc.NOTIFY_PUBLIC_CHAT, payload.chan, (id) => id !== uid);
    return payload.reply;
  }

  private async privateChat(uid: number, data: unknown): Promise<unknown> {
    if (await this.forbidden(uid)) return { forbidden: 1 };
    const body = (data ?? {}) as Record<string, unknown>;
    const to = phpString(body.touser ?? '').trim();
    const target = await this.uidByName(to);
    if (!target) return { nouser: 1 };
    const payload = await this.payload(uid, data);
    if (!payload) return { empty: 1 };
    const frame = { ...payload.chan, touid: target, touser: to };
    if (target !== uid) this.push.notify(target, PushProc.NOTIFY_PRIVATE_CHAT, frame);
    return { ...payload.reply, touid: target, touser: to };
  }

  private async unionChat(uid: number, data: unknown): Promise<unknown> {
    if (await this.forbidden(uid)) return { forbidden: 1 };
    const unionid = phpIntval(
      (
        await sql<{ v: unknown }>`select union_id as v from sys_user where uid = ${uid}`.execute(
          this.scope.db,
        )
      ).rows[0]?.v,
    );
    if (!unionid) return { nounion: 1 };
    const payload = await this.payload(uid, data);
    if (!payload) return { empty: 1 };
    const members = await sql<{
      uid: number;
    }>`select uid from sys_user where union_id = ${unionid}`.execute(this.scope.db);
    const ids = new Set(members.rows.map((r) => Number(r.uid)));
    this.push.broadcast(
      PushProc.NOTIFY_UNION_CHAT,
      payload.chan,
      (id) => id !== uid && ids.has(id),
    );
    return payload.reply;
  }

  private controlChannel(data: unknown): Record<string, unknown> {
    const body = (data ?? {}) as Record<string, unknown>;
    const channel = phpIntval(body.channel);
    if (channel < 0 || channel > 4) return { error: 1 };
    return { channel, enabled: body.enabled === true || phpIntval(body.enabled) === 1 };
  }

  private async changeKeyword(uid: number, data: unknown, add: boolean): Promise<unknown> {
    if (!(await this.isAdmin(uid))) return { denied: 1 };
    const word = phpString((data as Record<string, unknown> | null)?.word ?? '').trim();
    if (!word) return { empty: 1 };
    if (add) {
      await sql`insert into sys_chat_word (word) values (${word})
        on duplicate key update word = values(word)`.execute(this.scope.db);
      this.push.broadcast(PushProc.NOTIFY_ADD_KEY_WORD, { word });
    } else {
      await sql`delete from sys_chat_word where word = ${word}`.execute(this.scope.db);
      this.push.broadcast(PushProc.NOTIFY_DEL_KEY_WORD, { word });
    }
    return this.keywordReply();
  }

  private async keywordReply(): Promise<Record<string, unknown>> {
    return { keywords: await this.keywords(), ok: 1 };
  }

  private async keywords(): Promise<string[]> {
    const rows = await sql<{ word: string }>`select word from sys_chat_word order by id`.execute(
      this.scope.db,
    );
    return rows.rows.map((row) => row.word).filter(Boolean);
  }

  private async isAdmin(uid: number): Promise<boolean> {
    const row = (
      await sql<{
        v: unknown;
      }>`select 1 as v from sys_user where uid = ${uid} and \`group\` = 0`.execute(this.scope.db)
    ).rows[0];
    return phpNum(row?.v) === 1;
  }

  private async payload(
    uid: number,
    data: unknown,
  ): Promise<{ chan: Record<string, unknown>; reply: Record<string, unknown> } | null> {
    const body = (data ?? {}) as Record<string, unknown>;
    const msg = phpString(body.msg ?? '')
      .replace(/[\r\n]/g, '')
      .slice(0, 100);
    if (!msg.replace(/[ \u3000]/g, '')) return null;
    const name = await this.userName(uid);
    const chan = { fromuid: uid, fromuser: name, msg, fromdesignation: '' };
    return { chan, reply: { ...chan, ok: 1 } };
  }

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

export type ChatSocket = PushSocket;
