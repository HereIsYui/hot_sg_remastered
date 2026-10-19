import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GameState, GameStateService } from '../core/game-state.service';
import { HeroRules } from '../core/hero-rules.service';
import { MailService } from '../core/mail.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpString, stripcslashes } from '../core/php';
import { phpDate, phpMktime, phpTime } from '../core/php-time';
import { RandomService } from '../core/random.service';
import { makeTimeLeft, UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { cellOf, dbNow, unixNow } from '../db/sql-fragments';
import { AmfMethod, AmfService, type ServiceContext } from '../gateway/decorators';
import { SessionService } from '../gateway/session.service';
import { RealLoginService, USER_STATE_NO_ROLE } from './real-login.service';

/** doLogin result codes (first element). */
export const LoginResult = {
  Failed: 0,
  Ok: 1,
  /** Client too old for a platform login (loginType 1). */
  Outdated: 2,
} as const;

/** Second element of a successful doLogin. */
export const LoginOutcome = {
  Queued: 1,
  LoggedIn: 2,
} as const;

/** sys_user.state values checked at login. */
const USER_STATE_NEWBIE = 1;
const USER_STATE_LOCKED = 5;

const NEWBIE_PROTECTION_SECONDS = 604800;
/** Gid of 传音符, topped up to 200 on the first login of each day. */
const DAILY_HORN_GID = 1;
const DAILY_HORN_COUNT = 200;

/** Port of Login.php (amfphp service `Login`): local accounts only, no password check. */
@Injectable()
@AmfService('Login')
export class LoginService {
  constructor(
    private readonly scope: DbScope,
    private readonly state: GameStateService,
    private readonly lang: LangService,
    private readonly mail: MailService,
    private readonly users: UserRules,
    private readonly heroes: HeroRules,
    private readonly random: RandomService,
    private readonly sessions: SessionService,
    private readonly realLogins: RealLoginService,
  ) {}

  @AmfMethod()
  async getLoginAnnouncement(): Promise<string> {
    const row = await this.scope.db
      .selectFrom('sys_announce')
      .select('content')
      .where('id', '=', 1)
      .executeTakeFirst();
    return stripcslashes(phpString(cellOf(row, 'content')));
  }

  /**
   * `[version, loginType, passtype, passport]`. Answers `[1, 2, uid, sid, idCard, verifyState,
   * showRule, showVip, lastUpdateId]`, `[1, 1, uid, sid, queuePosition]` when the server is full,
   * or `[0, message]`.
   */
  @AmfMethod()
  async doLogin(param: unknown[], client: ServiceContext): Promise<unknown[]> {
    try {
      return await this.login([...param], client);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      return [LoginResult.Failed, this.lang.messageOf(err)];
    }
  }

  /** `[uid, sid]` from a queued client polling for its turn. */
  @AmfMethod()
  async checkQueue(param: unknown[], client: ServiceContext): Promise<unknown[]> {
    const db = this.scope.db;
    const uid = phpIntval(param[0]);
    const sid = param[1];
    if ((await this.state.value(GameState.ServerOpen)) !== 1) {
      throw GameError.raw('server_is_updating');
    }
    const queue = await sql<{ id: number }>`select id from mem_queue
      where uid = ${uid} and sid = ${phpString(sid)} and ip = ${client.ip}`.execute(db);
    const entry = queue.rows[0];
    if (!entry) return [0];

    const { online, maxUsers } = await this.capacity();
    const ahead = await this.countQueue(entry.id);
    if (maxUsers - online > ahead) {
      await db.deleteFrom('mem_queue').where('id', '=', entry.id).execute();
      await this.realLogins.realLogin(uid, phpString(sid), client);
      return [1, 0];
    }
    await db
      .updateTable('mem_queue')
      .set({ lastupdate: unixNow() })
      .where('id', '=', entry.id)
      .execute();
    return [1, 1, ahead];
  }

  private async login(param: unknown[], client: ServiceContext): Promise<unknown[]> {
    const db = this.scope.db;
    const version = param.shift();
    let loginType = param.shift();
    let passtype = phpString(param.shift());
    if (passtype === 'xiaonei') {
      passtype = 'renren';
      loginType = 1;
    }

    if (!phpLooseEquals(version, await this.state.value(GameState.ClientVersion))) {
      if (phpLooseEquals(loginType, 1)) return [LoginResult.Outdated];
      throw GameError.lang('doLogin.client_version_old');
    }
    const serverState = await this.state.value(GameState.ServerOpen);
    if (phpLooseEquals(serverState, 0)) throw GameError.raw(await this.announcement(2));
    if (serverState === 2) throw GameError.raw(await this.announcement(3));

    const passCfg = await db
      .selectFrom('cfg_pass')
      .select(sql`1`.as('x'))
      .limit(1)
      .executeTakeFirst();
    if (!passCfg) throw GameError.lang('checkConfig.config_is_empty');

    const passport = phpString(param.shift());
    const sid = this.random.rand();
    const existing = await this.findUser(passport, passtype);
    const uid = existing
      ? await this.checkReturningUser(existing.uid, existing.state)
      : await this.register(passport, passtype, sid, client);

    await db.deleteFrom('mem_queue').where('uid', '=', uid).execute();
    await this.checkUserBackTask(uid);

    const { online, maxUsers } = await this.capacity();
    const queueSize = await this.countQueue();
    if (
      online >= maxUsers ||
      queueSize > 100 ||
      (queueSize > 0 && queueSize + online + 200 >= maxUsers)
    ) {
      const queued = await db
        .insertInto('mem_queue')
        .values({ uid, sid, ip: client.ip, lastupdate: unixNow() })
        .executeTakeFirstOrThrow();
      const ahead = await this.countQueue(Number(queued.insertId));
      return [LoginResult.Ok, LoginOutcome.Queued, uid, sid, ahead];
    }

    const lastUpdateId = await this.lastUpdateIdSinceLastLogin(uid);
    await this.giveLoginGoods(uid, passtype);
    const showRule = await this.realLogins.realLogin(uid, sid, client);
    const ret: unknown[] = [LoginResult.Ok, LoginOutcome.LoggedIn, uid, sid];
    // With anti-addiction on, the original appended the id-card fields only for platform
    // passports that set them; local accounts never did.
    if (!(await this.state.isAdultOpen())) ret.push(0, 1);
    ret.push(showRule, false, lastUpdateId);
    return ret;
  }

  private async findUser(passport: string, passtype: string) {
    return this.scope.db
      .selectFrom('sys_user')
      .select(['uid', 'state'])
      .where('passport', '=', passport)
      .where('passtype', '=', passtype)
      .executeTakeFirst();
  }

  private async announcement(id: number): Promise<string> {
    const row = await this.scope.db
      .selectFrom('sys_announce')
      .select('content')
      .where('id', '=', id)
      .executeTakeFirst();
    return phpString(cellOf(row, 'content'));
  }

  /** First login of a passport creates the account in state 3 (no role yet). */
  private async register(
    passport: string,
    passtype: string,
    sid: number,
    client: ServiceContext,
  ): Promise<number> {
    const db = this.scope.db;
    const users = await db
      .selectFrom('sys_user')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('uid', '>', 1000)
      .executeTakeFirstOrThrow();
    if (Number(users.n) >= phpIntval(await this.state.value(GameState.MaxUsers))) {
      throw GameError.lang('doLogin.server_full');
    }
    const inserted = await db
      .insertInto('sys_user')
      .values({
        passtype,
        passport,
        group: 0,
        state: USER_STATE_NO_ROLE,
        money: 88888,
        regtime: unixNow(),
        domainid: 0,
        honour: 1000,
      })
      .executeTakeFirstOrThrow();
    const uid = Number(inserted.insertId);
    await db
      .insertInto('sys_sessions')
      .values({ uid, sid: String(sid), ip: client.ip })
      .execute();
    this.sessions.remember(uid, sid);
    await db
      .insertInto('sys_online')
      .values({ uid, lastupdate: unixNow(), onlineupdate: unixNow(), onlinetime: 0 })
      .execute();
    await db
      .insertInto('sys_user_comming')
      .values({ uid, site_id: 0, page_id: '0', sub_page_id: '0' })
      .execute();
    return uid;
  }

  /** Bans, newbie-protection reminder mails and duplicate lord heroes of an existing account. */
  private async checkReturningUser(uid: number, state: number): Promise<number> {
    const db = this.scope.db;
    const forbidden = await sql<{ delta: number }>`select login - unix_timestamp() as delta
      from sys_user_forbidden where uid = ${uid}`.execute(db);
    const delta = Number(forbidden.rows[0]?.delta ?? 0);
    if (delta > 0) {
      throw GameError.lang('doLogin.account_temp_locked', makeTimeLeft(this.lang, delta));
    }
    const locked = await sql`select uid from sys_user_state
      where uid = ${uid} and forbiend > unix_timestamp()`.execute(db);
    if (state === USER_STATE_LOCKED || locked.rows.length > 0) {
      throw GameError.lang('doLogin.account_locked');
    }

    if (state === USER_STATE_NEWBIE) await this.remindNewbieProtection(uid);
    await this.heroes.demoteDuplicateLord(uid);
    return uid;
  }

  /**
   * One reminder mail per remaining protection day: templates 6..11 count down to the
   * protection's end (template 11 when the schedule row is missing).
   */
  private async remindNewbieProtection(uid: number): Promise<void> {
    const db = this.scope.db;
    const left = await sql<{ v: number }>`select start_new_protect + ${NEWBIE_PROTECTION_SECONDS}
      - unix_timestamp() as v from mem_user_schedule where uid = ${uid}`.execute(db);
    const days = Math.floor(Number(left.rows[0]?.v ?? 0) / 86400);
    const template = 11 - days;
    await this.mail.raiseAlarm(uid, 'task');
    if (template < 6 || template > 11) return;
    const sent = await db
      .selectFrom('sys_mail_sys_box')
      .select('mid')
      .where('contentid', '=', template)
      .where('uid', '=', uid)
      .executeTakeFirst();
    if (sent) return;
    await this.mail.deliver(uid, template, this.lang.t('doLogin.protect_user_info'));
    await this.mail.raiseAlarm(uid, 'mail');
  }

  private async capacity(): Promise<{ online: number; maxUsers: number }> {
    const row = await sql<{ n: number }>`select count(*) as n from sys_online
      where unix_timestamp() - lastupdate < 30`.execute(this.scope.db);
    return {
      online: Number(row.rows[0]?.n ?? 0),
      maxUsers: phpIntval(await this.state.value(GameState.MaxOnline)),
    };
  }

  /** Queue entries ahead of `beforeId`, or the whole queue. */
  private async countQueue(beforeId?: number): Promise<number> {
    let query = this.scope.db
      .selectFrom('mem_queue')
      .select((eb) => eb.fn.countAll<number>().as('n'));
    if (beforeId !== undefined) query = query.where('id', '<', beforeId);
    return Number((await query.executeTakeFirstOrThrow()).n);
  }

  /** Newest cfg_update_history entry the player has not seen (all of them on a first login). */
  private async lastUpdateIdSinceLastLogin(uid: number): Promise<number> {
    const db = this.scope.db;
    const online = await db
      .selectFrom('sys_online')
      .select('lastupdate')
      .where('uid', '=', uid)
      .executeTakeFirst();
    const lastLogin = cellOf(online, 'lastupdate');
    let query = db.selectFrom('cfg_update_history').select((eb) => eb.fn.max('id').as('id'));
    if (!phpEmpty(lastLogin)) query = query.where('time', '>', Number(lastLogin));
    const row = await query.executeTakeFirst();
    return phpEmpty(row?.id) ? 0 : Number(row?.id);
  }

  /** Login.php::giveLoginGoods: tops up 传音符 on the first login of each day. */
  private async giveLoginGoods(uid: number, passtype: string): Promise<void> {
    const db = this.scope.db;
    const schedule = await db
      .selectFrom('mem_user_schedule')
      .select('lastlogingif')
      .where('uid', '=', uid)
      .limit(1)
      .executeTakeFirst();
    const lastGift = phpIntval(cellOf(schedule, 'lastlogingif'));
    const now = await dbNow(db);
    if (phpDate('Y-m-d', lastGift) !== phpDate('Y-m-d', now)) {
      const operator = await this.state.value(GameState.Operator);
      if (operator === 60 && passtype === 'my' && now > 1310108400) return;
      const goods = await db
        .selectFrom('sys_goods')
        .select('count')
        .where('uid', '=', uid)
        .where('gid', '=', DAILY_HORN_GID)
        .executeTakeFirst();
      const count = cellOf(goods, 'count');
      const user = await db
        .selectFrom('sys_user')
        .select('nobility')
        .where('uid', '=', uid)
        .executeTakeFirst();
      if (phpIntval(cellOf(user, 'nobility')) >= 0) {
        if (phpEmpty(count)) {
          await sql`insert into sys_goods (uid, gid, count) values (${uid}, ${DAILY_HORN_GID}, ${DAILY_HORN_COUNT})
            on duplicate key update count = ${DAILY_HORN_COUNT}`.execute(db);
        } else if (Number(count) < DAILY_HORN_COUNT) {
          await db
            .updateTable('sys_goods')
            .set({ count: DAILY_HORN_COUNT })
            .where('uid', '=', uid)
            .where('gid', '=', DAILY_HORN_GID)
            .execute();
        }
      }
    }
    await sql`insert into mem_user_schedule (uid, lastlogingif) values (${uid}, ${now})
      on duplicate key update lastlogingif = ${now}`.execute(db);
  }

  /**
   * Login.php::checkUserBackTask: the April 2011 返乡 event. Outside its window it only
   * removes the event goals (the task delete's reversed range never matched anything).
   */
  private async checkUserBackTask(uid: number): Promise<void> {
    const db = this.scope.db;
    const now = phpTime();
    const start = phpMktime(16, 0, 0, 4, 1, 2011);
    const end = phpMktime(16, 0, 0, 4, 10, 2011);
    if (now > end) {
      await sql`delete from sys_user_task where tid between 103744 and 103741`.execute(db);
      await sql`delete from sys_user_goal where gid between 3101113 and 3101120`.execute(db);
    }
    if (now > end || now < start) return;

    const user = await db
      .selectFrom('sys_user')
      .select('nobility')
      .where('uid', '=', uid)
      .executeTakeFirst();
    if ((await this.users.bufferNobility(uid, cellOf(user, 'nobility'))) < 1) return;
    const away = await sql<{ v: number }>`select unix_timestamp() - lastupdate as v from sys_online
      where uid = ${uid} order by lastupdate desc limit 1`.execute(db);
    const month = 2592000;
    const seconds = Number(away.rows[0]?.v ?? 0);
    let tid = 0;
    if (seconds >= month * 12) tid = 103744;
    else if (seconds >= month * 6) tid = 103743;
    else if (seconds >= month * 3) tid = 103742;
    else if (seconds >= month) tid = 103741;
    if (!tid) return;
    const task = await db
      .selectFrom('cfg_task')
      .select('id')
      .where('id', '=', tid)
      .executeTakeFirst();
    if (!task) return;
    await sql`insert into sys_user_task (uid, tid, state) values (${uid}, ${tid}, 0)
      on duplicate key update tid = ${tid}`.execute(db);
    const goal = await db
      .selectFrom('cfg_task_goal')
      .select('id')
      .where('tid', '=', tid)
      .where('sort', '=', 0)
      .limit(1)
      .executeTakeFirst();
    await sql`insert into sys_user_goal (uid, gid, currentcount) values (${uid}, ${goal?.id ?? null}, 0)
      on duplicate key update gid = ${goal?.id ?? null}`.execute(db);
  }
}
