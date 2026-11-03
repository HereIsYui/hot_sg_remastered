import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PushProc } from '@hot/shared';
import { sql } from 'kysely';
import { phpIntval, phpString } from '../core/php';
import { DbScope } from '../db/database.module';
import { PushService } from './push.service';

type Row = Record<string, unknown>;

/**
 * `ChatPanel.onNotifyWarEvent` (proc 52, NOTIFY_WAR_EVENT) sysType codes, from the AS3: the server
 * backend pushed a byte sysType, an int battleUnionId and a UTF message. 100/101/102 drive battle
 * dialogs; a plain war-chat line uses any other sysType. These are the codes the engine (parallel
 * wave) raises; exported so it can call `notifyWarEvent` without reaching into the socket layer.
 */
export const WarEventType = {
  /** A generic war-chat / war-event line shown in the 战况 channel. */
  Message: 0,
  /** 战场内聊天气泡 (BattleFiledViewDialog chat). */
  FieldChat: 100,
  /** 战斗结束提示 + refresh getUserBattleInfo. */
  BattleEnd: 101,
  /** 顶栏公告切换 (topPanel.changeNotice). */
  Notice: 102,
} as const;

export type WarEventTypeId = (typeof WarEventType)[keyof typeof WarEventType];

/** The `{sysType, battleUnionId, msg}` payload of a proc-52 war event (the AS3 frame fields). */
export interface WarEvent {
  sysType: WarEventTypeId | number;
  battleUnionId: number;
  msg: string;
}

/**
 * The war-push surface the battle engine (parallel wave, tables mem_battle* / sys_report) calls to
 * reach online clients in real time — kept small and engine-facing so the engine does not touch
 * the socket layer. Three things the main client (`BloodWar` / `ChatPanel`) listens for:
 *
 *  - `notifyEnemyAlarm`  — a 烽火台 enemy-incoming alarm: the DB flag (`sys_alarm.enemy=1`) is the
 *    source of truth (written by StartTroop / HandleTroop), and this is the matching live nudge so
 *    an online target sees the 军情 indicator without waiting for the next poll. Proc 52, sysType 0.
 *  - `notifyWarEvent`    — a battle/war event line (proc 52), for battle start/end and war chat.
 *  - `notifyReportUnread`— a new 战报 just filed; the DB flag (`sys_alarm.report=1`) is authoritative
 *    (written by `ReportService.sendReport`), this wakes an online client's unread blink. Proc 52.
 *
 * All delivery is best-effort: an offline player simply reads the DB flag at the next poll / login.
 */
@Injectable()
export class WarEventService {
  private readonly logger = new Logger(WarEventService.name);
  private running = false;

  constructor(
    private readonly scope: DbScope,
    private readonly push: PushService,
  ) {}

  /** Push one proc-52 war event to a single online player. Returns the sockets delivered to. */
  notifyWarEvent(uid: number, event: WarEvent): number {
    return this.push.notify(uid, PushProc.NOTIFY_WAR_EVENT, event);
  }

  /** Broadcast a proc-52 war event (e.g. a battlefield-wide notice). */
  broadcastWarEvent(event: WarEvent, filter?: (uid: number) => boolean): number {
    return this.push.broadcast(PushProc.NOTIFY_WAR_EVENT, event, filter);
  }

  /**
   * 敌军来袭 alarm: the live counterpart of `sys_alarm.enemy=1`. `message` is the already-localised
   * 军情 text the engine built (empty for a bare indicator refresh).
   */
  notifyEnemyAlarm(uid: number, message = ''): number {
    return this.notifyWarEvent(uid, {
      sysType: WarEventType.Message,
      battleUnionId: 0,
      msg: message,
    });
  }

  /**
   * 新战报 flag: the live counterpart of `sys_alarm.report=1`. Wakes an online client's 战报 unread
   * blink the moment a report is filed, rather than at the next resource poll.
   */
  notifyReportUnread(uid: number, message = ''): number {
    return this.notifyWarEvent(uid, {
      sysType: WarEventType.Message,
      battleUnionId: 0,
      msg: message,
    });
  }

  /**
   * Drain `mem_war_event` into proc-52 frames — the port-side replacement for the original
   * backend's standalone chat/push server. In the PHP package that server is absent (the PHP only
   * ever INSERTs into `mem_war_event` — BattleFunc.php:4046/4061/4422, OLdBattleCron.php:1336/1378;
   * no `select`/`delete` exists), and the AS3 `ChatPanel.onNotifyWarEvent` (ChatPanel.as:1860)
   * received its frames over TCP. Here the engine and the battlefield commands keep writing the
   * table exactly like the PHP, and this loop consumes it, so writers never touch the socket layer
   * (same split as `UnionEventService` / mem_union_event).
   *
   * Recipients are the players currently in that battlefield instance — `sys_user_battle_state`
   * rows with `state=0`, the same predicate the PHP uses to count participants
   * (BattleFunc.php:1003). Rows for a battlefield nobody is in any more can never be delivered
   * (the original push was realtime-only; offline players read the 战况 tab through
   * getBattleNews/log_battle_news instead), so they are dropped to keep the queue from growing
   * stale; rows whose recipients are merely offline are retried next pass.
   *
   * `sysType` is the raw `mem_war_event.type` passed through: the engine writes 1/2, which the AS3
   * handler treats like any non-100/101/102 code (a plain 战况 line), and a value ≥100 lets a
   * writer address the battle dialogs (FieldChat/BattleEnd/Notice) directly through the queue.
   */
  @Interval(1000)
  async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const rows = (await sql<Row>`select * from mem_war_event order by id`.execute(this.scope.db))
        .rows;
      for (const row of rows) await this.deliver(row);
    } finally {
      this.running = false;
    }
  }

  private async deliver(row: Row): Promise<void> {
    const battleid = phpIntval(row.battleid);
    try {
      const members = await sql<{ uid: unknown }>`select uid from sys_user_battle_state
        where battlefieldid = ${battleid} and state = 0`.execute(this.scope.db);
      const ids = new Set(members.rows.map((m) => phpIntval(m.uid)));
      if (ids.size === 0) {
        await sql`delete from mem_war_event where id = ${phpIntval(row.id)}`.execute(this.scope.db);
        return;
      }
      const sent = this.push.broadcast(
        PushProc.NOTIFY_WAR_EVENT,
        {
          sysType: phpIntval(row.type),
          battleUnionId: phpIntval(row.unionid),
          msg: phpString(row.content),
        },
        (uid) => ids.has(uid),
      );
      if (sent === 0) return;
      await sql`delete from mem_war_event where id = ${phpIntval(row.id)}`.execute(this.scope.db);
    } catch (error) {
      this.logger.warn(`battlefield ${battleid}: war event delivery failed: ${String(error)}`);
    }
  }
}
