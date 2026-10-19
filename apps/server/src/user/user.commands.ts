import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { GameState, GameStateService } from '../core/game-state.service';
import { GoodsRules } from '../core/goods-rules.service';
import { LORD_HERO_TYPE } from '../core/hero-rules.service';
import { MailService } from '../core/mail.service';
import { addslashes, mbStrlen, phpEmpty, phpIntval, phpString, phpTrim } from '../core/php';
import { phpDate, phpMktime, phpTime } from '../core/php-time';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { cellOf, dbNow } from '../db/sql-fragments';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { CityFoundingService } from './city-founding.service';

/** common.php limits, in characters. */
const MAX_USER_NAME = 8;
const MAX_CITY_NAME = 8;
const MAX_FLAG_CHAR = 1;

/** sys_user.state */
const UserState = {
  Normal: 0,
  Newbie: 1,
  NoRole: 3,
} as const;

/** Log reason code of items granted at role creation. */
const GRANT_NEW_ROLE = 4;
/** 1级新手礼包 */
const STARTER_PACK_GID = 50101;
/** Tasks every new role starts with; 291 starts completed. */
const STARTING_TASKS = [1, 80, 290];
const COMPLETED_STARTING_TASK = 291;

/** Lord names: CJK or ASCII letters/digits only, no whitespace (UserFunc.php::validateUserName). */
const NAME_WHITESPACE = /[\u3000 \t\n\v\f\r]/;
const NAME_CHARS = /^(?:[\u2e80-\u9fff]|[A-Za-z0-9])+$/;

/** Anti-cheat throttle: the client always sends a sign; clients that do not are logged. */
const CHEAT_LOG_MIN_INTERVAL = 60;
const CHEAT_SESSION_GAP = 600;

/** Global commands of UserFunc.php needed to log in and create a role. */
@Injectable()
export class UserCommands {
  private readonly cheatLogTouched = new Map<number, number>();

  constructor(
    private readonly scope: DbScope,
    private readonly state: GameStateService,
    private readonly lang: LangService,
    private readonly mail: MailService,
    private readonly users: UserRules,
    private readonly tasks: TaskRules,
    private readonly goods: GoodsRules,
    private readonly founding: CityFoundingService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Static tables and server settings the client caches after login. */
  @GlobalCommand()
  async loadGlobalData(): Promise<unknown[]> {
    const db = this.scope.db;
    const rows = async (query: ReturnType<typeof sql>) => (await query.execute(db)).rows;
    return [
      await dbNow(db),
      await rows(sql`select bid, name, description from cfg_building order by bid`),
      await rows(sql`select tid, name from cfg_technic order by tid`),
      await rows(sql`select * from cfg_soldier order by sid`),
      await rows(sql`select * from cfg_defence order by did`),
      await rows(sql`select level, upgrade_exp, total_exp from cfg_hero_level order by level`),
      await rows(sql`select tid, name from cfg_things where inuse = 1`),
      await rows(sql`select \`count\`, \`desc\` from cfg_count_desc order by \`count\` desc`),
      await rows(sql`select id, name from cfg_office_pos order by id`),
      await rows(sql`select id, name from cfg_nobility order by id`),
      this.config.CHAT_HOST,
      this.config.CHAT_PORT,
      this.config.SERVER_MARK,
      this.config.SERVER_NAME,
      false,
      this.config.CHIBI_CHAT_HOST,
      this.config.CHIBI_CHAT_PORT,
      false,
      null,
      null,
      await this.state.value(GameState.Operator),
      await this.state.value(GameState.AdultContent),
    ];
  }

  /**
   * `[sign]` (client clock). Returns `[user, userState, cities, gotDailyReward, kingLevel,
   * lordHeroLevel, serverTime, luoyangYear]`.
   */
  @GlobalCommand()
  async loadUserInfo(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const db = this.scope.db;
    const uid = ctx.uid;
    if (phpEmpty(param[0])) await this.logCheatClient(uid, ctx.sip);

    const userRows = await sql<Record<string, unknown>>`select u.*, n.name as unionname
      from sys_user u left join sys_union n on n.id = u.union_id where u.uid = ${uid}`.execute(db);
    const user: Record<string, unknown> = { ...userRows.rows[0] };
    user.real_nobility = '';
    const nobility = await this.users.bufferNobility(uid, user.nobility);
    if (nobility !== phpIntval(user.nobility)) {
      user.real_nobility = user.nobility;
      user.nobility = nobility;
    }
    user.openIndex = await this.state.value(GameState.MinorityRegionOpen);
    Object.assign(user, await this.users.designationFields(uid));

    const userState = await db
      .selectFrom('sys_user_state')
      .selectAll()
      .where('uid', '=', uid)
      .executeTakeFirst();
    const cities = await this.users.userCities(uid);

    const reward = await sql<{ last: string | null; today: string }>`select
        (select substr(from_unixtime(getrewardtime), 1, 10) from sys_user_level where uid = ${uid}) as last,
        substr(now(), 1, 10) as today`.execute(db);
    const { last, today } = reward.rows[0]!;
    const gotDailyReward = !phpEmpty(last) && last === today;

    const level = await db
      .selectFrom('sys_user_level')
      .select('level')
      .where('uid', '=', uid)
      .executeTakeFirst();
    const lord = await db
      .selectFrom('sys_city_hero')
      .select('level')
      .where('uid', '=', uid)
      .where('herotype', '=', LORD_HERO_TYPE)
      .executeTakeFirst();

    return [
      user,
      userState ?? false,
      cities,
      gotDailyReward,
      phpEmpty(cellOf(level, 'level')) ? 0 : cellOf(level, 'level'),
      cellOf(lord, 'level'),
      await dbNow(db),
      await this.users.currentYear(),
    ];
  }

  /** Per province: player count, occupied cities, total city slots (for the province picker). */
  @GlobalCommand()
  async loadProvinceInfo(): Promise<unknown[]> {
    const db = this.scope.db;
    const column = async (query: ReturnType<typeof sql<{ v: unknown }>>) =>
      (await query.execute(db)).rows.map((r) => r.v);
    return [
      await column(sql`select count(distinct(uid)) as v from sys_city
        where province > 0 group by province order by province`),
      // Precedence as in the original: type=0 OR (type=1 AND ownercid>0 AND province>0).
      await column(sql`select count(*) as v from mem_world
        where type = 0 or (type = 1 and ownercid > 0) and province > 0 group by province order by province`),
      await column(sql`select count(*) as v from mem_world
        where type < 2 and province > 0 group by province order by province`),
    ];
  }

  /** `[lordName, cityName, province (0 = random), flagChar, sex, face, code]` */
  @GlobalCommand()
  async createRole(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const username = phpTrim(param[0]);
    const cityName = phpTrim(param[1]);
    const province = phpIntval(param[2]);
    const flagChar = phpString(param[3]);
    const sex = phpIntval(param[4]);
    const face = phpIntval(param[5]);

    const db = this.scope.db;
    const account = await db
      .selectFrom('sys_user')
      .select('state')
      .where('uid', '=', uid)
      .executeTakeFirst();
    if (account?.state !== UserState.NoRole)
      throw GameError.lang('createRole.cant_duplicate_create');

    if (mbStrlen(username) < 1) throw GameError.lang('createRole.city_holder_name_notNull');
    if (mbStrlen(username) > MAX_USER_NAME)
      throw GameError.lang('createRole.city_holder_name_tooLong');
    if (mbStrlen(cityName) > MAX_CITY_NAME) throw GameError.lang('createRole.city_name_tooLong');
    if (/[<'\\]/.test(username)) throw GameError.lang('createRole.no_illege_char');
    if (await this.containsBannedWord(username)) throw GameError.lang('createRole.invalid_char');
    await this.checkCityName(cityName);
    const flagLength = mbStrlen(addslashes(flagChar));
    if (flagLength === 0) throw GameError.lang('createRole.enter_flag_char');
    if (flagLength > MAX_FLAG_CHAR) throw GameError.lang('createRole.single_char');
    const taken = await db
      .selectFrom('sys_user')
      .select('uid')
      .where('name', '=', username)
      .where('uid', '<>', uid)
      .executeTakeFirst();
    if (taken) throw GameError.lang('createRole.used_city_holder_name');
    if (phpEmpty(username)) throw GameError.lang('createRole.no_illege_char');
    if (NAME_WHITESPACE.test(username) || !NAME_CHARS.test(username)) {
      throw GameError.lang('username.rules');
    }

    return this.scope.transaction(async () => {
      const cid = await this.founding.found(uid, cityName, province, false);
      const tx = this.scope.db;
      await tx
        .updateTable('sys_user')
        .set({
          state: UserState.Newbie,
          lastcid: cid ?? 0,
          name: username,
          face,
          sex,
          flagchar: flagChar,
        })
        .where('uid', '=', uid)
        .execute();
      await tx
        .updateTable('sys_city_hero')
        .set({ name: username, face, sex })
        .where('uid', '=', uid)
        .where('herotype', '=', LORD_HERO_TYPE)
        .execute();
      await this.sendWelcomeMails(uid);
      await this.mail.raiseAlarm(uid, 'mail');
      for (const tid of STARTING_TASKS) {
        await sql`insert into sys_user_task (uid, tid, state) values (${uid}, ${tid}, 0)
          on duplicate key update state = state`.execute(tx);
      }
      await this.tasks.completeTaskWithTaskid(uid, COMPLETED_STARTING_TASK);
      await this.goods.addGoods(uid, STARTER_PACK_GID, 1, GRANT_NEW_ROLE);
      await this.grantNewRoleDrops(uid);
      return [];
    });
  }

  /** `[cityName, province]`: rebuilds the capital of a player whose cities were all taken. */
  @GlobalCommand()
  async createCity(ctx: CommandContext, param: unknown[]): Promise<void> {
    const uid = ctx.uid;
    const cityName = phpString(param[0]);
    const province = phpIntval(param[1]);
    if (mbStrlen(cityName) > MAX_CITY_NAME) throw GameError.lang('createCity.city_name_tooLong');
    await this.checkCityName(cityName);
    const owned = await this.scope.db
      .selectFrom('sys_city')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('uid', '=', uid)
      .executeTakeFirstOrThrow();
    if (Number(owned.n) > 0) throw GameError.lang('createRole.cant_duplicate_create');

    await this.scope.transaction(async () => {
      const cid = await this.founding.found(uid, cityName, province, true);
      await this.scope.db
        .updateTable('sys_user')
        .set({ state: UserState.Normal, lastcid: cid ?? 0 })
        .where('uid', '=', uid)
        .execute();
      await this.mail.deliver(uid, 2, this.lang.t('sys.restart_mail_title'));
      await this.mail.raiseAlarm(uid, 'mail');
    });
  }

  private async checkCityName(cityName: string): Promise<void> {
    if (/['\\]/.test(cityName) || (await this.containsBannedWord(cityName))) {
      throw GameError.lang('changeCityName.name_illegal');
    }
  }

  private async containsBannedWord(text: string): Promise<boolean> {
    const hit =
      await sql`select 1 from cfg_baned_name where instr(${text}, name) > 0 limit 1`.execute(
        this.scope.db,
      );
    return hit.rows.length > 0;
  }

  private async sendWelcomeMails(uid: number): Promise<void> {
    const db = this.scope.db;
    const account = await db
      .selectFrom('sys_user')
      .select('passtype')
      .where('uid', '=', uid)
      .executeTakeFirst();
    if (account?.passtype === 'tw') {
      await this.mail.deliver(uid, 1, 'temp');
    } else {
      await this.mail.deliver(uid, 12, this.lang.t('user.customer_help'));
      await this.mail.deliver(uid, 13, this.lang.t('user.welcometo_bloodwar'));
      await this.mail.deliver(uid, 14, this.lang.t('user.game_instructions'));
      await this.mail.deliver(uid, 5, this.lang.t('user.new_player_remind'));
    }
    await this.sendSpecialSoldierMail(uid);
    const antiAddiction = await this.state.value(GameState.AntiAddiction);
    if (antiAddiction !== false && antiAddiction >= 1) {
      await this.mail.deliver(uid, 3, this.lang.t('user.adult_info'));
    }
  }

  /**
   * Special-soldier cities: once they have appeared, the mail lists them per province;
   * before that it announces when they will appear (16:00, 7 days after the server opened).
   */
  private async sendSpecialSoldierMail(uid: number): Promise<void> {
    const db = this.scope.db;
    const appeared = await db
      .selectFrom('cfg_soldier_special_city')
      .select((eb) => eb.fn.count<number>('cid').as('n'))
      .where('type', '=', 0)
      .executeTakeFirstOrThrow();
    if (!Number(appeared.n)) {
      const opened = Number(await this.state.value(GameState.OpenTime));
      const at = phpMktime(
        16,
        0,
        0,
        Number(phpDate('m', opened)),
        Number(phpDate('d', opened)) + 7,
        Number(phpDate('Y', opened)),
      );
      await this.mail.send(
        uid,
        this.lang.t('spacialcity.mail_title'),
        this.lang.t('spacialcity.mail_content', phpDate('Y-m-d H:i:s', at)),
      );
      return;
    }
    const setting = async (name: string) => {
      const row = await db
        .selectFrom('cfg_name')
        .select('value')
        .where('name', '=', name)
        .executeTakeFirst();
      return phpString(cellOf(row, 'value'));
    };
    const title = await setting('spacial_city_mail_title');
    const content = await setting('spacial_city_mail_content');
    const cities = await sql<{
      cid: number;
      province: number;
      provincename: string;
      name: string | null;
    }>`
      select s.cid, s.province, s.provincename, c.name from cfg_soldier_special_city s
      left join sys_city c on s.cid = c.cid order by s.province`.execute(db);
    let list = '';
    let lastProvince = -1;
    for (const city of cities.rows) {
      if (lastProvince !== city.province) {
        list += `<br/>${city.provincename}:`;
        lastProvince = city.province;
      }
      const x = city.cid % 1000;
      const y = (city.cid - x) / 1000;
      list += `${city.name ?? ''}(${x},${y}),   `;
    }
    await this.mail.send(uid, title, list + content);
  }

  /** cfg_goods_drop rows with act=0 are extra gifts for every new role. */
  private async grantNewRoleDrops(uid: number): Promise<void> {
    const drops = await this.scope.db
      .selectFrom('cfg_goods_drop')
      .selectAll()
      .where('act', '=', 0)
      .execute();
    for (const drop of drops) {
      if (drop.type === 1)
        await this.goods.addGoods(uid, drop.gid, drop.count ?? 0, GRANT_NEW_ROLE);
      else if (drop.type === 2)
        await this.goods.addThings(uid, drop.gid, drop.count ?? 0, GRANT_NEW_ROLE);
      else if (drop.type === 3) {
        // The original passed the armor id where addArmor expects a cfg_armor row and failed.
        throw new Error(`cfg_goods_drop act=0 armor drop ${drop.gid} is not supported`);
      }
    }
  }

  /** The player's cities with population, government hall level and hero count. */
  @GlobalCommand()
  async getUserCities(ctx: CommandContext): Promise<unknown[]> {
    return this.users.userCities(ctx.uid);
  }

  /** UserFunc.php::logWaigUserInfo: sessions of clients that did not send the sign. */
  private async logCheatClient(uid: number, ip: string): Promise<void> {
    const now = phpTime();
    const touched = this.cheatLogTouched.get(uid);
    if (touched !== undefined && now - touched < CHEAT_LOG_MIN_INTERVAL) return;
    const db = this.scope.db;
    const last = await db
      .selectFrom('log_waigua_online')
      .select((eb) => eb.fn.max('update_time').as('t'))
      .where('uid', '=', uid)
      .executeTakeFirst();
    const lastUpdate = Number(last?.t ?? 0);
    if (now - lastUpdate > CHEAT_SESSION_GAP) {
      await db
        .insertInto('log_waigua_online')
        .values({ uid, login_time: now, update_time: now, ip })
        .execute();
    } else {
      await db
        .updateTable('log_waigua_online')
        .set({ update_time: now })
        .where('uid', '=', uid)
        .where('update_time', '=', lastUpdate)
        .execute();
    }
    this.cheatLogTouched.set(uid, now);
  }
}
