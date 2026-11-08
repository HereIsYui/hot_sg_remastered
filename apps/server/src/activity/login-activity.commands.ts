import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { TaskRules } from '../core/task-rules.service';
import { makeTimeLeft } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { TaskRewards } from '../task/task-rewards.service';

type Row = Record<string, unknown>;

/** W8: RewardFunc / CityFunc / BufferFunc / RankFunc and offline platform compatibility. */
@Injectable()
export class LoginActivityCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly tasks: TaskRules,
    private readonly rewards: TaskRewards,
    private readonly random: RandomService,
  ) {}

  /** RewardFunc.php:70 + ReportFunc.php:89. Missing announcement auto-vivifies index 0. */
  @GlobalCommand()
  async getLoginInfo(ctx: CommandContext): Promise<unknown[]> {
    const announcements = await this.rows(sql<Row>`select * from sys_login_announce where id = 1`);
    const alarm = await this.rows(
      sql<Row>`select * from sys_alarm where enemy = 1 and uid = ${ctx.uid}`,
    );
    announcements[0] = { ...announcements[0], newestreport: alarm.length > 0 ? 1 : 0 };
    return [...announcements, await this.getSignState(ctx)];
  }

  @GlobalCommand()
  async finishOpenAnnounce(ctx: CommandContext): Promise<null> {
    await this.tasks.completeTaskWithTaskid(ctx.uid, 292);
    return null;
  }

  /** RewardFunc.php:7 returns before validating parameters or granting anything. */
  @GlobalCommand()
  getLoginReward(): null {
    return null;
  }

  /** PHP date fields are strings; weekday is Sunday=0; history compares month/day only. */
  @GlobalCommand()
  async getSignState(ctx: CommandContext): Promise<unknown[]> {
    const date = (
      await this.rows(sql<Row>`select date_format(now(), '%y') as year,
      date_format(now(), '%m') as month, date_format(now(), '%d') as day,
      cast(dayofweek(now()) - 1 as char) as weekday`)
    )[0];
    const history = await this.rows(sql<Row>`select from_unixtime(time, '%m%d') as day, state
      from sys_user_sign where uid = ${ctx.uid} order by time desc limit 21`);
    return [[date?.year, date?.month, date?.day, date?.weekday], history];
  }

  @GlobalCommand()
  async doSign(ctx: CommandContext): Promise<unknown[]> {
    return this.scope.transaction(async () => {
      const uid = ctx.uid;
      const count = await this.cell(sql<Row>`select count(1) as v from sys_user_sign
        where uid = ${uid} and from_unixtime(time, '%m%d') = from_unixtime(unix_timestamp(), '%m%d')`);
      if (phpNum(count) > 0) throw GameError.lang('dailySign.do_sign');
      const span = await this.cell(sql<Row>`select unix_timestamp() - time as v from log_login
        where uid = ${uid} order by time desc limit 1`);
      if (phpNum(span) <= 900) {
        throw GameError.raw(
          this.lang.t('dailySign.do_sign_2') +
            makeTimeLeft(this.lang, 900 - phpNum(span)) +
            this.lang.t('dailySign.do_sign_3'),
        );
      }
      await this.cleanOldSigns(uid);
      await sql`insert into sys_user_sign (uid, time) values (${uid}, unix_timestamp())`.execute(
        this.scope.db,
      );
      const lastId = await this.cell(sql<Row>`select id as v from sys_user_sign where uid = ${uid}
        and from_unixtime(time, '%m%d') = from_unixtime(unix_timestamp(), '%m%d')`);
      const name = await this.cell(sql<Row>`select name as v from cfg_goods where gid = 10961`);
      let reward = '[ ' + phpString(name) + '*3 ';
      await this.goods.addGoods(uid, 10961, 3, 70);
      const cid = await this.cell(sql<Row>`select lastcid as v from sys_user where uid = ${uid}`);
      const nobility = await this.cell(
        sql<Row>`select nobility as v from sys_user where uid = ${uid}`,
      );
      if (phpNum(nobility) >= 1) reward += await this.dropSignGoods(uid, cid, phpNum(span));
      reward += ']';
      const flag = this.random.mtRand(1, 7);
      await sql`update sys_user_sign set state = ${flag} where uid = ${uid} and id = ${lastId}`.execute(
        this.scope.db,
      );
      return [
        this.lang.t('dailySign.get_reward_1') + this.lang.t('dailySign.get_reward_2') + reward,
        await this.getSignState(ctx),
      ];
    });
  }

  /** CityFunc.php:1676: intentionally retains its odd month-boundary/day-difference tests. */
  private async cleanOldSigns(uid: number): Promise<void> {
    const oldId = await this.cell(sql<Row>`select id as v from sys_user_sign
      where time < unix_timestamp() - 3600 * 30 * 24 and uid = ${uid} order by time asc limit 1`);
    if (phpEmpty(oldId)) return;
    const signs = await this.rows(sql<Row>`select id, from_unixtime(time, '%Y') as signyear,
      from_unixtime(time, '%m') as signmonth, from_unixtime(time, '%d') as signday
      from sys_user_sign where uid = ${uid} and id >= ${oldId} order by time asc limit 4`);
    for (let i = 1; i < signs.length; i++) {
      const previous = signs[i - 1]!;
      const current = signs[i]!;
      if (
        phpNum(previous.signmonth) !== phpNum(current.signmonth) &&
        phpNum(previous.signday) === 1
      ) {
        const days = new Date(
          Date.UTC(phpIntval(current.signyear), phpIntval(current.signmonth), 0),
        ).getUTCDate();
        if (days !== phpNum(current.signday)) break;
      } else if (Math.abs(phpNum(previous.signday) - phpNum(current.signday)) !== 1) break;
      await sql`delete from sys_user_sign where id = ${current.id}`.execute(this.scope.db);
    }
    // SQL's oldest-id query guarantees a first row in the absence of concurrent deletion.
    if (signs[0])
      await sql`delete from sys_user_sign where id = ${signs[0].id}`.execute(this.scope.db);
  }

  /** TaskFunc.php:2652 dropTaskGood(actiontype=1), using existing reward and RNG services. */
  private async dropSignGoods(uid: number, cid: unknown, span: number): Promise<string> {
    const active = await this.rows(sql<Row>`select cfg_act_task_good_drop.* from cfg_act
      left join cfg_act_task_good_drop on cfg_act_task_good_drop.actid = cfg_act.actid
      where cfg_act.starttime < unix_timestamp() and cfg_act.endtime > unix_timestamp()
      and cfg_act_task_good_drop.actiontype = 1`);
    const always = await this.rows(sql<Row>`select * from cfg_act_task_good_drop where actid = 0
      and starttime < unix_timestamp() and endtime > unix_timestamp() and actiontype = 1`);
    let message = '';
    for (const drop of [...active, ...always]) {
      if (
        (phpNum(drop.param) === 0 || span > phpNum(drop.param)) &&
        this.random.randRange(1, 100) < phpNum(drop.rate)
      ) {
        await this.rewards.giveReward(uid, cid, drop);
        message += '  ' + phpString(drop.name);
      }
    }
    return message;
  }

  @GlobalCommand()
  async getActivityList(): Promise<Row[]> {
    return this.rows(
      sql<Row>`select content, link, \`interval\` from sys_activity where inuse = 1 order by id`,
    );
  }

  @GlobalCommand()
  async getCraftBuffer(ctx: CommandContext): Promise<unknown[]> {
    const now = await this.cell(sql<Row>`select unix_timestamp() as v`);
    const buffs = await this.rows(sql<Row>`select * from mem_user_buffer where uid = ${ctx.uid}
      and buftype not in (8, 23, 10321, 130527) and endtime > ${now}`);
    const unionId = await this.cell(
      sql<Row>`select union_id as v from sys_user where uid = ${ctx.uid}`,
    );
    const leader = await this.cell(
      sql<Row>`select leader as v from sys_union where id = ${unionId}`,
    );
    const unionNow = await this.cell(sql<Row>`select unix_timestamp() as v`);
    const unionBuffs = await this.rows(sql<Row>`select * from mem_user_buffer where uid = ${leader}
      and endtime > ${unionNow} and buftype = 161501`);
    // PHP splices while incrementing i: adjacent 161501 entries can be skipped.
    for (let i = 0; i < buffs.length; i++) {
      if (phpNum(buffs[i]!.buftype) === 161501) buffs.splice(i, 1);
    }
    return [now, [...buffs, ...unionBuffs]];
  }

  @GlobalCommand()
  async getHuangJinProgress(_ctx: CommandContext, param: unknown[]): Promise<Row[] | null> {
    const group = [11000, 12000, 13000, 14000][phpIntval(param.shift())];
    if (group === undefined) return null;
    return this
      .rows(sql<Row>`select tid, name, maxvalue, curvalue, maxvalue - curvalue as remainvalue
      from huangjin_progress where \`group\` = ${group} order by tid`);
  }

  @GlobalCommand()
  async getDongZhuoProgress(_ctx: CommandContext, param: unknown[]): Promise<Row[] | null> {
    const group = [15000, 15100, 15200, 15300, 15400, 15500][phpIntval(param.shift())];
    if (group === undefined) return null;
    return this
      .rows(sql<Row>`select tid, name, maxvalue, curvalue, maxvalue - curvalue as remainvalue
      from dongzhuo_progress where \`group\` = ${group} order by tid`);
  }

  @GlobalCommand()
  async getAllHeroList(ctx: CommandContext): Promise<unknown[]> {
    return [
      await this.rows(sql<Row>`select hid, name, level,
      (command_base + command_add_on) as command,
      (affairs_base + affairs_add + affairs_add_on) as affairs,
      (bravery_base + bravery_add + bravery_add_on) as bravery,
      (wisdom_base + wisdom_add + wisdom_add_on) as wisdom
      from sys_city_hero where uid = ${ctx.uid} order by level desc`),
    ];
  }

  /** ShaChangFunc.php's false-network-result branches; never contact the retired server. */
  @GlobalCommand()
  getCrossShaChangInfo(): unknown[] {
    return [{ status: -1 }];
  }

  @GlobalCommand()
  getCrossShaChangReward(): unknown[] {
    // ShaChangFunc.php:117 `include("../../server_info.php")` — the file is absent from the
    // extracted single-machine deployment, so the legacy error handler aborts sendCommand with
    // the bare error envelope (verified against the live PHP gateway).
    throw GameError.raw(
      'include(../../server_info.php): failed to open stream: No such file or directory',
    );
  }

  @GlobalCommand()
  async joinCrossShaChang(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const hid = phpIntval(param.shift());
    const hero = await this.rows(
      sql<Row>`select 1 from sys_city_hero where hid = ${hid} and uid = ${ctx.uid}`,
    );
    if (hero.length === 0) throw GameError.lang('addHeroPoint.cant_find_hero');
    return [0, 'net_error'];
  }

  /** VipFunc.php:63 has no return; offline compatibility deliberately has no external I/O. */
  @GlobalCommand()
  sendCloseMsg(): null {
    return null;
  }

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows;
  }

  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const row = (await this.rows(query))[0];
    return row === undefined ? false : Object.values(row)[0];
  }
}
