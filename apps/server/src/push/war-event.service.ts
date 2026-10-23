import { Injectable } from '@nestjs/common';
import { PushProc } from '@hot/shared';
import { PushService } from './push.service';

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
  constructor(private readonly push: PushService) {}

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
}
