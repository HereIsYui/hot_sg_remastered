import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { MailService } from '../core/mail.service';
import { phpDate, phpTime } from '../core/php-time';
import { RandomService } from '../core/random.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { cellOf, dbNow, unixNow } from '../db/sql-fragments';
import type { ClientAddress } from '../gateway/client-ip';
import { SessionService } from '../gateway/session.service';

/** sys_user.state: registered, but no role / city created yet. */
export const USER_STATE_NO_ROLE = 3;

/** Players registered before 2010-07-31 are shown the PK rules until they accept them. */
const PK_RULE_CUTOFF = 1280505600;
const SEVEN_DAYS = 86400 * 7;
const WELCOME_COLOR = 14972979;

/** Mails greeting the first players of a fresh server (state 3 at their first login). */
const OPENING_MAILS: ReadonlyArray<[contentid: number, title: string]> = [
  [1001, '新人王活动奖励'],
  [1002, '联盟排行活动奖励'],
  [1003, '野地将活动奖励'],
  [1004, '史诗将活动奖励'],
];

/** utils.php::realLogin and the daily login gift it hands out. */
@Injectable()
export class RealLoginService {
  constructor(
    private readonly scope: DbScope,
    private readonly sessions: SessionService,
    private readonly lang: LangService,
    private readonly mail: MailService,
    private readonly users: UserRules,
    private readonly tasks: TaskRules,
    private readonly random: RandomService,
  ) {}

  /** Opens the session and runs the per-login bookkeeping; returns whether to show the PK rules. */
  async realLogin(uid: number, sid: number | string, client: ClientAddress): Promise<boolean> {
    const db = this.scope.db;
    const banned = await db
      .selectFrom('cfg_baned_ip')
      .select('ip')
      .where('ip', '=', client.ip)
      .executeTakeFirst();
    if (banned) throw GameError.lang('realLogin.ip_blocked');

    await sql`insert into sys_sessions (uid, sid, ip) values (${uid}, ${String(sid)}, ${client.ip})
      on duplicate key update sid = ${String(sid)}, ip = ${client.ip}`.execute(db);
    this.sessions.remember(uid, sid);

    await sql`update sys_online set onlinetime = onlinetime + greatest(0, lastupdate - onlineupdate),
      onlineupdate = unix_timestamp(), lastupdate = unix_timestamp() where uid = ${uid}`.execute(
      db,
    );

    const last = await sql<{ ago: number }>`select unix_timestamp() - time as ago from log_login
      where uid = ${uid} order by time desc limit 1`.execute(db);
    if (Number(last.rows[0]?.ago ?? 0) > SEVEN_DAYS) {
      const city = await db
        .selectFrom('sys_city')
        .select('cid')
        .where('uid', '=', uid)
        .executeTakeFirst();
      if (city) {
        await this.mail.deliver(uid, 15, this.lang.t('utils.7days_not_login'));
        await this.mail.raiseAlarm(uid, 'mail');
      }
    }

    await db
      .insertInto('log_login')
      .values({ uid, ip: client.ip, time: unixNow(), sip: client.sip })
      .execute();

    const user = await db
      .selectFrom('sys_user')
      .selectAll()
      .where('uid', '=', uid)
      .executeTakeFirstOrThrow();
    const allowPk = await db
      .selectFrom('sys_allowpk')
      .select('uid')
      .where('uid', '=', uid)
      .where('allow', '=', 1)
      .executeTakeFirst();
    const showRule = user.regtime < PK_RULE_CUTOFF && !allowPk;

    const ranked = await db
      .selectFrom('rank_user')
      .select('rank')
      .where('uid', '=', uid)
      .executeTakeFirst();
    let rank = Number(cellOf(ranked, 'rank') || 0);
    if (!rank) {
      const total = await db
        .selectFrom('rank_user')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow();
      rank = Number(total.n) + 1;
    }
    await db.updateTable('sys_user').set({ rank }).where('uid', '=', uid).execute();

    await this.giveDalibao(uid);
    if (user.union_id > 0) await this.users.updateUnionRank(user.union_id);

    if (user.state !== USER_STATE_NO_ROLE) {
      await this.users.sendSysInform({
        type: 0,
        inuse: 1,
        starttime: 0,
        endtime: 600,
        interval: 50000,
        scrollcount: 1,
        color: WELCOME_COLOR,
        msg: `欢迎玩家:${user.name}来到热血三国!`,
      });
    } else {
      await this.openingEvents(uid);
    }
    return showRule;
  }

  /** utils.php::giveDalibao: once per calendar day, a gift box and a reset of daily tasks. */
  async giveDalibao(uid: number): Promise<void> {
    const db = this.scope.db;
    const gid = this.random.mtRand(0, 1) === 1 ? 50187 : 50186;
    const record = await db
      .selectFrom('hd_dalibao')
      .selectAll()
      .where('uid', '=', uid)
      .executeTakeFirst();
    if (record) {
      const now = await dbNow(db);
      if (phpDate('Y-m-d', Number(record.time)) === phpDate('Y-m-d', now)) return;
    }
    await sql`insert into sys_goods (uid, gid, count) values (${uid}, ${gid}, 1)
      on duplicate key update count = count + 1`.execute(db);
    await sql`insert into sys_user_task_num (uid, type, num, maxnum) values (${uid}, 1, 0, 100)
      on duplicate key update num = 0, maxnum = 100`.execute(db);
    if (record) {
      await db.updateTable('hd_dalibao').set({ time: unixNow() }).where('uid', '=', uid).execute();
    } else {
      await db.insertInto('hd_dalibao').values({ uid, time: unixNow() }).execute();
    }
    await this.tasks.updateUserDailyTasks(uid);
    if (record) {
      await db
        .updateTable('mem_user_schedule')
        .set({ today_war_count: 0 })
        .where('uid', '=', uid)
        .execute();
    }
  }

  /** First login of a new account: event reward mails, and the 新人王 event starts on the first one. */
  private async openingEvents(uid: number): Promise<void> {
    const db = this.scope.db;
    for (const [contentid, title] of OPENING_MAILS) await this.mail.deliver(uid, contentid, title);
    const act = await db
      .selectFrom('sys_user_act')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirst();
    if (act && (act.state !== 0 || act.time !== 0)) return;
    await db
      .updateTable('sys_user_act')
      .set({ state: 1, con: 0, time: unixNow() })
      .where('id', '=', 1)
      .execute();
    const end = phpTime() + SEVEN_DAYS;
    const endText = `${phpDate('n', end)}月${phpDate('j', end)}日<br/>下午16时`;
    const content =
      '<font color="#FFFF00">---------------公告--------------</font><br/>1、新人王排行已经开始！将于' +
      endText +
      '结束!<br/>2、野地将活动正在进行中第一个招降到<br/>指定将领的玩家将会获得丰富奖励！<br/>3、相关奖励请查看系统信件！';
    await db.updateTable('sys_activity').set({ inuse: 1, content }).where('id', '=', 1).execute();
  }
}
