import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { LangService } from '../common/lang.service';
import { DbScope } from '../db/database.module';
import { cellOf, unixNow } from '../db/sql-fragments';
import { phpEmpty, phpIntval } from './php';

/** utils.php::MakeTimeLeft, e.g. "1小时2分3秒". */
export function makeTimeLeft(lang: LangService, seconds: number): string {
  const hour = Math.floor(seconds / 3600);
  const minute = Math.floor((seconds - hour * 3600) / 60);
  const second = Math.trunc(seconds) % 60;
  const h = lang.t('MakeTimeLeft.hour');
  const m = lang.t('MakeTimeLeft.min');
  const s = lang.t('MakeTimeLeft.sec');
  if (hour > 0) return `${hour}${h}${minute}${m}${second}${s}`;
  if (minute > 0) return `${minute}${m}${second}${s}`;
  return `${second}${s}`;
}

export interface SysInform {
  /** 0 chat box, 1 scrolling banner. */
  type: number;
  inuse: number;
  /** Seconds from now. */
  starttime: number;
  /** Seconds from now. */
  endtime: number;
  interval: number;
  scrollcount: number;
  color: number;
  msg: string;
}

/** Player-level rules from utils.php. */
@Injectable()
export class UserRules {
  constructor(private readonly scope: DbScope) {}

  /** utils.php::getBufferNobility: nobility raised by an active 推恩令 buff (types 16/18). */
  async bufferNobility(uid: number, realNobility: unknown): Promise<number> {
    const row = await this.scope.db
      .selectFrom('mem_user_buffer')
      .select('bufparam')
      .where('uid', '=', uid)
      .where('buftype', 'in', [16, 18])
      .orderBy('bufparam', 'desc')
      .limit(1)
      .executeTakeFirst();
    const bufparam = cellOf(row, 'bufparam');
    const real = phpIntval(realNobility);
    if (!phpEmpty(bufparam)) {
      const param = Number(bufparam);
      let nobility = real + param;
      if (param === 5 && nobility > 19) nobility = 19;
      if (param === 2 && nobility > 18) nobility = 18;
      if (nobility > real) return nobility;
    }
    return real;
  }

  /** utils.php::updateUnionRank */
  async updateUnionRank(unionId: number): Promise<void> {
    const db = this.scope.db;
    const prestigeRow = await sql<{ v: number | null }>`
      select sum(prestige) as v from sys_user where union_id = ${unionId}`.execute(db);
    let prestige = Number(prestigeRow.rows[0]?.v ?? 0);
    if (prestige < 0) prestige = 2147483640;
    await db.updateTable('sys_union').set({ prestige }).where('id', '=', unionId).execute();
    const donateRow = await sql<{ v: number | null }>`
      select sum(donate) as v from sys_user_donate
      where unionid = ${unionId} and uid in (select uid from sys_user where union_id = ${unionId})`.execute(
      db,
    );
    const donate = Number(donateRow.rows[0]?.v ?? 0);
    await db.updateTable('sys_union').set({ donate }).where('id', '=', unionId).execute();
    const rankRow = await sql<{ v: number }>`
      select count(*) + 1 as v from sys_union where prestige > ${prestige}`.execute(db);
    await db
      .updateTable('sys_union')
      .set({ rank: Number(rankRow.rows[0]?.v) })
      .where('id', '=', unionId)
      .execute();
  }

  /** utils.php::sendSysInform */
  async sendSysInform(inform: SysInform): Promise<void> {
    await this.scope.db
      .insertInto('sys_inform')
      .values({
        type: inform.type,
        inuse: inform.inuse,
        starttime: sql<number>`${unixNow()} + ${inform.starttime}`,
        endtime: sql<number>`${unixNow()} + ${inform.endtime}`,
        interval: inform.interval,
        scrollcount: inform.scrollcount,
        color: inform.color,
        msg: inform.msg,
      })
      .execute();
  }
}
