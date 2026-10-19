import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { cid2wid } from '../core/city-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { OwnershipService } from '../core/ownership.service';
import {
  isPhpNumeric,
  mbStrlen,
  phpEmpty,
  phpFloatString,
  phpIntval,
  phpLooseEquals,
  phpNum,
  phpString,
} from '../core/php';
import { RandomService } from '../core/random.service';
import { TaskRules } from '../core/task-rules.service';
import { makeTimeLeft } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { GAME_SPEED_RATE } from './technic-rules.service';

type Row = Record<string, unknown>;

/** common.php */
const MAX_CITY_NAME = 8;
const FOOD_PRICE = 0.1;
/** Seconds between two levies, and between two pacifications, of one city. */
const COOLDOWN = 900;
/** What one person yields per levy (common.php GLOBAL_*_RATE), by levyResource's resid. */
const LEVY = [
  { column: 'gold', rate: 1, goal: 10 },
  { column: 'food', rate: 10, goal: 11 },
  { column: 'wood', rate: 10, goal: 12 },
  { column: 'rock', rate: 5, goal: 13 },
  { column: 'iron', rate: 4, goal: 14 },
] as const;
/** The one city type above 0 that may still be renamed; the others are famous cities. */
const CAPITAL_TYPE = 5;

/** The 官府's city management commands of CityFunc.php: tax, name, levy and pacification. */
@Injectable()
export class GovernmentCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly ownership: OwnershipService,
    private readonly tasks: TaskRules,
    private readonly heroes: HeroRules,
    private readonly random: RandomService,
  ) {}

  /** `[cid, tax]`: 0..100, the city's morale ceiling dropping with it. */
  @GlobalCommand()
  async changeTax(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const cid = phpIntval(param[0]);
    const tax = phpIntval(param[1]);
    const owner = await this.cell(sql`select uid from sys_city where cid = ${cid}`);
    if (tax < 0 || tax > 100 || !phpLooseEquals(uid, owner)) {
      throw GameError.lang('waigua.invalid');
    }
    await this.scope.transaction(async () => {
      const db = this.scope.db;
      await sql`update mem_city_resource set tax = ${tax} where cid = ${cid}`.execute(db);
      await sql`update mem_city_resource
        set morale_stable = greatest(0, least(100 - tax - complaint, 100))
        where cid = ${cid}`.execute(db);
      if (tax === 20) await this.tasks.completeTask(uid, 20);
      if (tax <= 5 && (await this.taskOpen(uid, 410263))) {
        await this.tasks.completeTask(uid, 410266);
      }
    });
    return [];
  }

  /** `[cid, name]`: once per day (UTC+8), not for famous cities nor 特殊兵种 cities. */
  @GlobalCommand()
  async changeCityName(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const cid = phpIntval(param[0]);
    const name = phpString(param[1]);
    await this.ownership.checkCityOwner(cid, uid);
    const type = phpNum(await this.cell(sql`select type from sys_city where cid = ${cid}`));
    if (type > 0 && type !== CAPITAL_TYPE) throw GameError.lang('changeCityName.bigcity_norename');
    if (mbStrlen(name) > MAX_CITY_NAME) throw GameError.lang('changeCityName.name_too_long');
    if (/['\\<@]/.test(name)) throw GameError.lang('changeCityName.name_illegal');
    const banned = await this.cell(sql`select name from cfg_baned_name
      where instr(${name}, name) > 0 limit 1`);
    if (banned !== false) throw GameError.lang('changeCityName.name_illegal');
    const special = await this.cell(sql`select cid from cfg_soldier_special_city
      where cid = ${cid} and type <> '4' limit 1`);
    if (special !== false) throw GameError.lang('spacialcity.not_changename_city');
    const last = await this.cell(sql`select last_change_name from mem_city_schedule
      where cid = ${cid}`);
    if (!phpEmpty(last)) {
      const now = phpNum(await this.cell(sql`select unix_timestamp()`));
      const day = (t: number) => Math.floor((t + 8 * 3600) / 86400);
      if (day(now) <= day(phpNum(last))) throw GameError.lang('changeCityName.today_changed');
    }
    await this.scope.transaction(async () => {
      const db = this.scope.db;
      await sql`update sys_city set name = ${name} where cid = ${cid}`.execute(db);
      await sql`update mem_city_schedule set last_change_name = unix_timestamp()
        where cid = ${cid}`.execute(db);
      await this.tasks.completeTask(uid, 21);
    });
    return [this.lang.t('changeCityName.change_name_to', name)];
  }

  /**
   * `[cid, resid]`: a tenth of an hour's yield per person of gold, food, wood, rock or iron, for
   * 20 morale; every 15 minutes and only above 20 morale.
   */
  @GlobalCommand()
  async levyResource(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const cid = phpIntval(param[0]);
    const resid = phpIntval(param[1]);
    await this.ownership.checkCityOwner(cid, uid);
    await this.checkCooldown(cid, 'last_levy_resource', 'levyResource.time_limit');
    const city = await this.row(sql`select people, morale from mem_city_resource
      where cid = ${cid}`);
    if (phpNum(city?.morale) <= 20) throw GameError.lang('levyResource.not_enough_morale');
    let desc = '';
    await this.scope.transaction(async () => {
      const db = this.scope.db;
      const levy = LEVY[resid];
      if (levy) {
        const amount = phpNum(city?.people) * GAME_SPEED_RATE * levy.rate * 0.1;
        const column = sql.ref(levy.column);
        await sql`update mem_city_resource set ${column} = ${column} + ${phpFloatString(amount)}
          where cid = ${cid}`.execute(db);
        desc = this.lang.t(`levyResource.${levy.column}`) + phpFloatString(Math.floor(amount));
        await this.tasks.completeTask(uid, levy.goal);
      }
      await sql`update mem_city_resource set morale = greatest(0, morale - 20)
        where cid = ${cid}`.execute(db);
      await this.updatePeopleStable(cid);
      await sql`insert into mem_city_schedule (cid, last_levy_resource)
        values (${cid}, unix_timestamp())
        on duplicate key update last_levy_resource = unix_timestamp()`.execute(db);
    });
    return [this.lang.t('levyResource.succ_levy', desc)];
  }

  /**
   * `[cid, action]`: 赈灾 (food), 祈福 (gold), 祭天 (food and gold; delays the next disaster,
   * one in ten brings a blessing now) or 增丁 (five times the food for 5% more people); each
   * costs per point of the people cap. Every 15 minutes, never while the city is attacked.
   */
  @GlobalCommand()
  async pacifyPeople(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const cid = phpIntval(param[0]);
    const action = phpIntval(param[1]);
    await this.ownership.checkCityOwner(cid, uid);
    await this.checkCooldown(cid, 'last_pacify_people', 'pacifyPeople.wait_more_secs');
    const worldState = phpIntval(
      await this.cell(sql`select state from mem_world where wid = ${cid2wid(cid)}`),
    );
    const attacked = await this.cell(sql`select id from sys_troops
      where targetcid = ${cid} and state = 2 and endtime <= unix_timestamp() limit 1`);
    if (worldState === 1 || attacked !== false) throw GameError.lang('pacifyPeople.city_in_battle');

    await this.scope.transaction(async () => {
      const db = this.scope.db;
      if (action === 0) await this.relief(uid, cid);
      else if (action === 1) await this.prayer(uid, cid);
      else if (action === 2) await this.sacrifice(uid, cid);
      else if (action === 3) await this.recruit(uid, cid);
      await this.updatePeopleStable(cid);
      await sql`insert into mem_city_schedule (cid, last_pacify_people)
        values (${cid}, unix_timestamp())
        on duplicate key update last_pacify_people = unix_timestamp()`.execute(db);
    });
    return [this.lang.t('pacifyPeople.succ_pacify')];
  }

  /** 赈灾: food = people cap; +5 morale, -15 complaint. */
  private async relief(uid: number, cid: number): Promise<void> {
    const delta = await this.cell(sql`select food - people_max * ${GAME_SPEED_RATE}
      from mem_city_resource where cid = ${cid}`);
    if (phpNum(delta) < 0) throw GameError.lang('pacifyPeople.no_enough_food');
    await sql`update mem_city_resource
      set food = greatest(0, food - people_max * ${GAME_SPEED_RATE}),
        morale = least(100, morale + 5), complaint = greatest(0, complaint - 15),
        morale_stable = greatest(0, least(100 - tax - complaint, 100))
      where cid = ${cid}`.execute(this.scope.db);
    await this.tasks.completeTask(uid, 6);
    await this.tasks.completeTask(uid, 2060783);
    if (await this.taskOpen(uid, 407192)) await this.tasks.completeTask(uid, 407192);
    if (await this.taskOpen(uid, 410022)) await this.tasks.completeTask(uid, 410022);
    await this.chiefExp(cid, 1, GAME_SPEED_RATE * FOOD_PRICE);
  }

  /** 祈福: gold = people cap; +25 morale, -5 complaint. */
  private async prayer(uid: number, cid: number): Promise<void> {
    const delta = await this.cell(sql`select gold - people_max * ${GAME_SPEED_RATE}
      from mem_city_resource where cid = ${cid}`);
    if (phpNum(delta) < 0) throw GameError.lang('pacifyPeople.no_enough_gold');
    await sql`update mem_city_resource
      set gold = greatest(0, gold - people_max * ${GAME_SPEED_RATE}),
        morale = least(100, morale + 25), complaint = greatest(0, complaint - 5),
        morale_stable = greatest(0, least(100 - tax - complaint, 100))
      where cid = ${cid}`.execute(this.scope.db);
    await this.tasks.completeTask(uid, 7);
    if (await this.taskOpen(uid, 404931)) await this.tasks.completeTask(uid, 404931);
    if (await this.taskOpen(uid, 410263)) await this.tasks.completeTask(uid, 410267);
    await this.chiefExp(cid, 1, GAME_SPEED_RATE);
  }

  /**
   * 祭天: food = people cap and gold = a tenth of it; the next disaster moves to a random moment
   * within three days after tomorrow's midnight, and one time in ten a blessing comes now.
   */
  private async sacrifice(uid: number, cid: number): Promise<void> {
    const db = this.scope.db;
    const food = await this.cell(sql`select food - people_max * ${GAME_SPEED_RATE}
      from mem_city_resource where cid = ${cid}`);
    const gold = await this.cell(sql`select gold - people_max * 0.1 * ${GAME_SPEED_RATE}
      from mem_city_resource where cid = ${cid}`);
    if (phpNum(food) < 0) throw GameError.lang('pacifyPeople.no_enough_food');
    if (phpNum(gold) < 0) throw GameError.lang('pacifyPeople.no_enough_gold');
    const bad = phpIntval(
      await this.cell(sql`select next_bad_event from mem_city_schedule where cid = ${cid}`),
    );
    const next = bad - ((bad + 8 * 3600) % 86400) + 86400 + this.random.mtRand(0, 259200);
    await sql`update mem_city_schedule set next_bad_event = ${next} where cid = ${cid}`.execute(db);
    if (this.random.mtRand(0, 9) === 0) {
      await sql`update mem_city_schedule set next_good_event = unix_timestamp()
        where cid = ${cid}`.execute(db);
    }
    await sql`update mem_city_resource
      set food = greatest(0, food - people_max * ${GAME_SPEED_RATE}),
        gold = greatest(0, gold - people_max * 0.1 * ${GAME_SPEED_RATE})
      where cid = ${cid}`.execute(db);
    await this.tasks.completeTask(uid, 8);
    if (await this.taskOpen(uid, 404621)) await this.tasks.completeTask(uid, 404621);
    await this.chiefExp(cid, 1, GAME_SPEED_RATE * (FOOD_PRICE + 1));
  }

  /** 增丁: food = 5 x people cap for 5% of the cap in people, never above it. */
  private async recruit(uid: number, cid: number): Promise<void> {
    const delta = await this.cell(sql`select food - people_max * 5 * ${GAME_SPEED_RATE}
      from mem_city_resource where cid = ${cid}`);
    if (phpNum(delta) < 0) throw GameError.lang('pacifyPeople.no_enough_food');
    await sql`update mem_city_resource set food = food - people_max * 5 * ${GAME_SPEED_RATE},
        people = least(people_max, people + floor(people_max * ${GAME_SPEED_RATE} * 0.05))
      where cid = ${cid}`.execute(this.scope.db);
    await this.chiefExp(cid, 5, GAME_SPEED_RATE * FOOD_PRICE);
    await this.tasks.completeTask(uid, 9);
  }

  /** The 城守 earns `people_max * capFactor * rate` experience (before HERO_EXP_RATE). */
  private async chiefExp(cid: number, capFactor: number, rate: number): Promise<void> {
    const hid = phpNum(await this.cell(sql`select chiefhid from sys_city where cid = ${cid}`));
    if (hid <= 0) return;
    const cap = await this.cell(sql`select people_max * ${capFactor} from mem_city_resource
      where cid = ${cid}`);
    await this.heroes.addHeroExp(hid, phpNum(cap) * rate);
  }

  private async checkCooldown(cid: number, column: string, message: string): Promise<void> {
    const delta = await this.cell(sql`select unix_timestamp() - ${sql.ref(column)}
      from mem_city_schedule where cid = ${cid}`);
    if (isPhpNumeric(delta) && phpIntval(delta) <= COOLDOWN) {
      throw GameError.lang(message, makeTimeLeft(this.lang, COOLDOWN - phpNum(delta)));
    }
  }

  private async updatePeopleStable(cid: number): Promise<void> {
    await sql`update mem_city_resource set people_stable = people_max * morale * 0.01
      where cid = ${cid}`.execute(this.scope.db);
  }

  private async taskOpen(uid: number, tid: number): Promise<boolean> {
    const open = await this.cell(sql`select tid from sys_user_task
      where uid = ${uid} and tid = ${tid} and state = 0 limit 1`);
    return open !== false;
  }

  private async row(query: RawBuilder<unknown>): Promise<Row | undefined> {
    return (await query.execute(this.scope.db)).rows[0] as Row | undefined;
  }

  /** `sql_fetch_one_cell`: the first column of the first row, or `false` without rows. */
  private async cell(query: RawBuilder<unknown>): Promise<unknown> {
    const first = await this.row(query);
    return first ? Object.values(first)[0] : false;
  }
}
