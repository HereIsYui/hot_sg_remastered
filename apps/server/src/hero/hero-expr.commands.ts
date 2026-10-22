import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum } from '../core/php';
import { RandomService } from '../core/random.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { DialogCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** HeroFunc.php::beginExprHero: the 将领 whose base state must be 空闲. */
const HERO_STATE_FREE = 0;
/** HeroFunc.php: a hero on expr is marked state 10 (历练中), 11 once cancelled. */
const HERO_STATE_EXPR = 10;
const HERO_STATE_CANCELLED = 11;
/** herotype of the 君主将; it cannot be sent on expr. */
const LORD_HERO_TYPE = 1000;
/** 招贤令-style buffer that lifts the per-city expr slots from 2 to 5. */
const BUFFER_EXPR_SLOTS = 100;
/** 通关文书 (speeds a running expr) and 急召令 (ends it now for exp). */
const GOODS_TONGGUAN = 143;
const GOODS_JIZHAO = 144;
/** fasterHeroExpr: never shorten by less than 30 minutes. */
const MIN_REDUCE_TIME = 1800;
/** 完成历练 task (completeTaskWithTaskid). */
const TASK_BEGIN_EXPR = 312;
/** addMoney reasons: 120 paying for an expr, 121 getting carried gold back. */
const MONEY_PAY_EXPR = 120;
const MONEY_REFUND_CARRY = 121;
/** log_user_action id of a 将领历练 (logged on start, counted back on cancel). */
const ACTION_HERO_EXPR = 21;
/** The 2011 history freeze beginExprHero still carries (now always in the past). */
const EXP_FREEZE_START = 1301043600;
const EXP_FREEZE_END = 1301472000;

/**
 * The 将领历练 (hero training) commands of HeroFunc.php, reached from the 官府 (Office) dialog.
 * Each `function f($uid, $cid, $param)` is a @DialogCommand so the city id arrives in `ctx.cid`.
 */
@Injectable()
export class HeroExprCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly tasks: TaskRules,
    private readonly random: RandomService,
    private readonly users: UserRules,
  ) {}

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async row(query: RawBuilder<unknown>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  private async cell(query: RawBuilder<unknown>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : false;
  }

  /** utils.php::addMoney: logs the change and applies it; a loss also bumps log_day_money. */
  private async addMoney(uid: number, money: number, type: number): Promise<void> {
    if (money === 0) return;
    const db = this.scope.db;
    await sql`insert into log_money (uid, count, time, type)
      values (${uid}, ${money}, unix_timestamp(), ${type})`.execute(db);
    await sql`update sys_user set money = money + ${money} where uid = ${uid}`.execute(db);
    if (money < 0) {
      const now = phpNum(await this.cell(sql`select unix_timestamp()`));
      const today = now - ((now + 8 * 3600) % 86400);
      await sql`insert into log_day_money (day, money) values (${today}, ${money})
        on duplicate key update money = money + ${money}`.execute(db);
    }
  }

  /**
   * HeroFunc.php::getExprHeros: `[now, heros, types]` — the city's expr-eligible heroes (free,
   * training or cancelled, uninjured) joined to their running expr, and the two startable types.
   */
  @DialogCommand()
  async getExprHeros(ctx: CommandContext): Promise<unknown[]> {
    const { uid, cid } = ctx;
    const heros = await this.rows(sql`select a.name as heroname, unix_timestamp() as curtime,
        a.hid, a.cid, a.uid, a.state, a.hero_health, a.herotype, b.starttime, b.endtime, b.hours,
        c.name as exprname, level
      from sys_city_hero a
      left join sys_hero_expr b on a.hid = b.hid
      left join cfg_hero_expr_types c on b.type = c.type
      where a.cid = ${cid} and a.uid = ${uid} and a.state in (0, 10, 11) and a.hero_health = 0`);
    const types = await this.rows(sql`select * from cfg_hero_expr_types where type in (1, 2)`);
    const now = await this.cell(sql`select unix_timestamp()`);
    return [now, heros, types];
  }

  /**
   * HeroFunc.php::getRestHeros: `[now, restHeros, hurtHeros]` — injured heroes and their rest
   * timers; the 休养 panel. (`logUserAction` is a non-ported analytics write.)
   */
  @DialogCommand()
  async getRestHeros(ctx: CommandContext): Promise<unknown[]> {
    const { uid, cid } = ctx;
    const restHeros = await this.rows(sql`select * from sys_city_hero h
      left join mem_hero_blood m on m.hid = h.hid
      left join sys_hero_rest r on m.hid = r.hid
      where h.cid = ${cid} and h.uid = ${uid} and h.hero_health != 0
      order by h.hero_health desc, r.endtime desc`);
    const hurtHeros = await this.rows(sql`select * from sys_city_hero h
      left join mem_hero_blood m on m.hid = h.hid
      where h.cid = ${cid} and h.uid = ${uid} and h.hero_health = 2`);
    const now = await this.cell(sql`select unix_timestamp()`);
    return [now, restHeros, hurtHeros];
  }

  /**
   * HeroFunc.php::beginExprHero: `[hid, cid, type, hours, carrymoney]` — pays the gold (level ×
   * hours × hour_gold) and the money (hours × hour_money + carried), then queues the expr and
   * marks the hero state 10. `[0]` on success, `[1, msg]` when the 2-slot soft cap is hit.
   */
  @DialogCommand()
  async beginExprHero(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      // The historical freeze window (2011); kept faithfully, always in the past now.
      const nowTime = phpNum(await this.cell(sql`select unix_timestamp()`));
      if (nowTime <= EXP_FREEZE_END && nowTime >= EXP_FREEZE_START) {
        throw GameError.lang('update.exp_update_alert');
      }
      const vacend = await this.cell(sql`select vacend from sys_user_state where uid = ${uid}`);
      if (!phpEmpty(vacend) && phpIntval(vacend) > nowTime) return [];

      const hid = phpIntval(param[0]);
      const cid = phpIntval(param[1]);
      const exprType = phpIntval(param[2]);
      const hours = phpIntval(param[3]);
      const carrymoney = phpIntval(param[4]);
      if (hours < 1) throw GameError.lang('waigua.invalid');

      const hero = await this.row(sql`select state, level, herotype from sys_city_hero
        where hid = ${hid}`);
      const heroState = hero?.state;
      const heroLevel = phpNum(hero?.level);
      const heroType = phpNum(hero?.herotype);
      if (!phpLooseEquals(heroState, HERO_STATE_FREE)) {
        throw GameError.lang('heroexpr.hero_expr_hero_not_kong');
      }
      if (heroType === LORD_HERO_TYPE) throw GameError.lang('user_hero.cannot_expr');

      let maxHeroCount = 2;
      if (
        !phpEmpty(
          await this.cell(sql`select count(1) from mem_user_buffer
            where buftype = ${BUFFER_EXPR_SLOTS} and uid = ${uid}`),
        )
      ) {
        maxHeroCount = 5;
      }
      const heroCount = phpNum(
        await this.cell(sql`select count(1) from sys_hero_expr where cid = ${cid}`),
      );
      if (heroCount === 5) throw GameError.lang('heroexpr.hero_expr_count_reach_max');
      if (heroCount >= maxHeroCount) return [1, this.lang.t('heroexpr.toomany_hero_expr')];

      const typeData = await this.row(sql`select * from cfg_hero_expr_types
        where type = ${exprType}`);
      if (phpEmpty(typeData)) throw GameError.raw('waigua gua le!');
      const needMoney = hours * phpIntval(typeData!.hour_money);
      const needGold = heroLevel * hours * phpIntval(typeData!.hour_gold);
      if (hours > phpNum(typeData!.max_hour) || hours < phpNum(typeData!.min_hour)) {
        throw GameError.lang(
          'heroexpr.hero_expr_time_error',
          typeData!.name,
          typeData!.min_hour,
          typeData!.max_hour,
        );
      }
      const cityGold = await this.cell(sql`select gold from mem_city_resource where cid = ${cid}`);
      if (phpNum(cityGold) < needGold) throw GameError.lang('heroexpr.hero_expr_not_enough_gold');
      const haveMoney = await this.cell(sql`select money from sys_user where uid = ${uid}`);
      if (phpNum(haveMoney) < carrymoney + needMoney || carrymoney < 0) {
        throw GameError.lang('heroexpr.hero_expr_not_enough_money');
      }
      await sql`update mem_city_resource set gold = gold - ${needGold}
        where cid = ${cid}`.execute(db);
      await this.addMoney(uid, -(carrymoney + needMoney), MONEY_PAY_EXPR);
      await this.users.logUserAction(uid, ACTION_HERO_EXPR);
      await sql`insert into sys_hero_expr (uid, cid, hid, type, starttime, endtime, hours,
          carrymoney, accTimes, state)
        values (${uid}, ${cid}, ${hid}, ${exprType}, unix_timestamp(),
          unix_timestamp() + 3600 * ${hours}, ${hours}, ${carrymoney}, 0, 0)`.execute(db);
      await sql`update sys_city_hero set state = ${HERO_STATE_EXPR}
        where hid = ${hid}`.execute(db);
      await this.tasks.completeTaskWithTaskid(uid, TASK_BEGIN_EXPR);
      return [0];
    });
  }

  /**
   * HeroFunc.php::cancelHeroExpr: `[hid]` — flags the expr state 1 (early return) and brings the
   * end time forward; under half the booked hours the hero returns in the time already served.
   */
  @DialogCommand()
  async cancelHeroExpr(ctx: CommandContext, param: unknown[]): Promise<void> {
    const { uid } = ctx;
    const hid = phpIntval(param[0]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const item = await this.row(sql`select b.hour_expr * (unix_timestamp() - starttime) / 3600
          as exp_add, (unix_timestamp() - starttime) / 3600 as hours
        from sys_hero_expr a, cfg_hero_expr_types b
        where a.type = b.type and hid = ${hid}`);
      if (phpEmpty(item)) return;
      await this.users.logActionCountback(uid, ACTION_HERO_EXPR);
      await sql`update sys_hero_expr set state = 1,
          endtime = if(unix_timestamp() - starttime > hours * 1800, endtime,
            2 * unix_timestamp() - starttime)
        where hid = ${hid}`.execute(db);
      await sql`update sys_city_hero set state = ${HERO_STATE_CANCELLED}
        where hid = ${hid} and state = ${HERO_STATE_EXPR}`.execute(db);
    });
  }

  /**
   * HeroFunc.php::fasterHeroExpr: `[hid]` — 通关文书 cuts a running expr's remaining time by 30%
   * (at least 30 minutes); 急召令 ends a cancelled one now, refunding carried gold and granting
   * `exp_add + 10·rand(hours, 2·hours)` experience.
   */
  @DialogCommand()
  async fasterHeroExpr(ctx: CommandContext, param: unknown[]): Promise<void> {
    const { uid } = ctx;
    const hid = phpIntval(param[0]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const item = await this.row(sql`select * from sys_hero_expr where hid = ${hid}`);
      if (phpEmpty(item)) return;
      if (phpLooseEquals(item!.state, 0)) {
        // 通关文书
        if (!(await this.goods.checkGoods(uid, GOODS_TONGGUAN))) {
          throw GameError.raw(`not_enough_goods${GOODS_TONGGUAN}`);
        }
        const oldEndTime = phpNum(item!.endtime);
        const curTime = phpNum(await this.cell(sql`select unix_timestamp()`));
        let reduceTime = phpIntval(Math.floor((oldEndTime - curTime) * 0.3));
        if (reduceTime < MIN_REDUCE_TIME) reduceTime = MIN_REDUCE_TIME;
        const newEndTime = curTime + (oldEndTime - curTime - reduceTime);
        await sql`update sys_hero_expr set endtime = ${newEndTime}, accTimes = accTimes + 1
          where hid = ${hid}`.execute(db);
        await this.goods.reduceGoods(uid, GOODS_TONGGUAN, 1);
      } else {
        // 急召令
        if (!(await this.goods.checkGoods(uid, GOODS_JIZHAO))) {
          throw GameError.raw(`not_enough_goods${GOODS_JIZHAO}`);
        }
        const carrymoney = phpNum(item!.carrymoney);
        if (carrymoney > 0) await this.addMoney(uid, carrymoney, MONEY_REFUND_CARRY);
        await this.goods.reduceGoods(uid, GOODS_JIZHAO, 1);
        const hours = phpNum(item!.hours);
        const expAdd = phpIntval(item!.exp_add) + 10 * this.random.randRange(hours, 2 * hours);
        await sql`delete from sys_hero_expr where hid = ${hid}`.execute(db);
        await sql`update sys_city_hero set state = 0, exp = exp + ${expAdd}
          where hid = ${hid}`.execute(db);
      }
    });
  }
}
