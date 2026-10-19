import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { LangService } from '../common/lang.service';
import { DbScope } from '../db/database.module';
import { cellOf, unixNow } from '../db/sql-fragments';
import { phpEmpty, phpIntval, phpNum } from './php';
import { phpDate } from './php-time';

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

  /**
   * utils.php::dogetCurYear: the current holder of 洛阳 this week, which starts on
   * Wednesday 23:00.
   */
  async currentYear(): Promise<unknown> {
    const db = this.scope.db;
    const clock = await sql<{ now: number; today: number }>`select unix_timestamp() as now,
      unix_timestamp(curdate()) as today`.execute(db);
    const now = Number(clock.rows[0]!.now);
    const cur23 = Number(clock.rows[0]!.today) + 82800;
    const weekday = Number(phpDate('N', now));
    let start: number;
    if (weekday < 3) start = cur23 - (weekday + 4) * 86400;
    else if (weekday > 3) start = cur23 - (weekday - 3) * 86400;
    else start = now >= cur23 ? cur23 : cur23 - (weekday + 4) * 86400;
    const holder = await sql`select u.name, b.count from sys_user u, log_luoyang_belong b
      where u.uid = b.uid and b.time >= ${start} limit 1`.execute(db);
    return holder.rows[0] ?? { count: 0 };
  }

  /** The `designations` / `curDesigName` / `curDesigid` fields added to the user row. */
  async designationFields(uid: number): Promise<Record<string, unknown>> {
    const db = this.scope.db;
    const designations = (
      await sql`select * from cfg_designation a left join sys_user_designation b on a.did = b.did
        where b.uid = ${uid}`.execute(db)
    ).rows;
    const current = await sql<{ name: string }>`select a.name from cfg_designation a
      left join sys_user_designation b on a.did = b.did
      where b.uid = ${uid} and b.ison = '1' and b.state = '1'`.execute(db);
    const currentId = await db
      .selectFrom('sys_user_designation')
      .select('did')
      .where('uid', '=', uid)
      .where('ison', '=', 1)
      .where('state', '=', 1)
      .executeTakeFirst();
    return {
      designations,
      curDesigName: current.rows[0] ? current.rows[0].name : false,
      curDesigid: cellOf(currentId, 'did'),
    };
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

  /** utils.php::logUserAction */
  async logUserAction(uid: number, aid: number): Promise<void> {
    const db = this.scope.db;
    await sql`insert into log_user_action (uid, aid, time)
      values (${uid}, ${aid}, unix_timestamp())`.execute(db);
    await sql`insert into log_action_count (uid, aid, count) values (${uid}, ${aid}, 1)
      on duplicate key update count = count + 1`.execute(db);
  }

  /** utils.php::logActionCountback: an undone action (e.g. a cancelled build). */
  async logActionCountback(uid: number, aid: number): Promise<void> {
    const db = this.scope.db;
    await sql`insert into log_user_action (uid, aid, time)
      values (${uid}, ${aid}, unix_timestamp())`.execute(db);
    await sql`insert into log_action_count (uid, aid, count) values (${uid}, ${aid}, 1)
      on duplicate key update count = count - 1`.execute(db);
  }

  /** HeroFunc.php::checkHeroLevel: 君主 cultivation level and the lord hero's level. */
  async checkHeroLevel(uid: number, userLevel: number, heroLevel: number): Promise<boolean> {
    const db = this.scope.db;
    const user = await sql<{ level: unknown }>`select level from sys_user_level
      where uid = ${uid}`.execute(db);
    const hero = await sql<{ level: unknown }>`select level from sys_city_hero
      where uid = ${uid} and herotype = 1000`.execute(db);
    const mUserLevel = phpEmpty(user.rows[0]?.level) ? 0 : phpNum(user.rows[0]?.level);
    const mHeroLevel = phpEmpty(hero.rows[0]?.level) ? 0 : phpNum(hero.rows[0]?.level);
    return mHeroLevel >= heroLevel && mUserLevel >= userLevel;
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
