import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { CityInfoService } from '../city/city-info.service';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules, LORD_HERO_TYPE } from '../core/hero-rules.service';
import {
  mbStrlen,
  phpCompare,
  phpEmpty,
  phpIntval,
  phpLooseEquals,
  phpNum,
  phpString,
  phpTrim,
} from '../core/php';
import { RandomService } from '../core/random.service';
import { TaskRules } from '../core/task-rules.service';
import { makeTimeLeft } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** Hero type of a child grown into a hero (喜结良缘). */
const CHILD_HERO_TYPE = 10001;
/** 洗髓丹: one per 10 levels clears the trained points. */
const GOODS_XISHUIDAN = 22;
/** 洛神玉佩: worn with its special active, raises the loyalty cap. */
const LUOSHEN_PENDANT = 12010;
/** common.php MAX_HERO_NAME */
const MAX_HERO_NAME = 4;
/** Seconds between two rewards to the same hero. */
const LARGESS_INTERVAL = 900;
/** Loyalty from 珍珠 (gid 30) up to 夜明珠 (gid 38). */
const GOODS_LOYALTY_ADD = [5, 10, 15, 20, 25, 30, 40, 50, 60];
/** log_goods reason of a reward given to a hero. */
const LOG_LARGESS = 7;
/** Task goals of upgrading a hero and of spending its points; the 武曲 task of a 珍珠 reward. */
const GOAL_UPGRADE = 86;
const GOAL_ADD_POINT = 87;
const TASK_WUQU = 319;
/** Famous heroes (cfg_npc_hero) that can reach level 125. */
const BIG_HEROES = new Set([
  36, 102, 107, 114, 118, 177, 186, 241, 255, 285, 320, 321, 340, 347, 357, 360, 362, 381, 382, 409,
  456, 484, 518, 541, 562, 580, 620, 677, 699, 725, 780, 801, 856, 861, 870, 894, 900, 901, 902,
  903, 904, 905, 906,
]);

/** HeroFunc.php::isHeroInCity: free, city chief, general or adviser. */
function isHeroInCity(state: unknown): boolean {
  return [0, 1, 7, 8].some((s) => phpLooseEquals(state, s));
}

/** GoodsFunc.php::getMaxHeroLevel */
function getMaxHeroLevel(npcid: unknown): number {
  return BIG_HEROES.has(phpNum(npcid)) ? 125 : 120;
}

/** The 将领 dialog commands of HeroFunc.php; each answers with the city's hero list. */
@Injectable()
export class HeroCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly info: CityInfoService,
    private readonly cityRules: CityRules,
    private readonly goods: GoodsRules,
    private readonly heroes: HeroRules,
    private readonly tasks: TaskRules,
    private readonly random: RandomService,
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

  private cityHero(uid: number, cid: number, hid: number): Promise<Row | undefined> {
    return this.row(sql`select * from sys_city_hero
      where cid = ${cid} and uid = ${uid} and hid = ${hid}`);
  }

  /** `[cid, hid]`: a free hero leaves for the wilds; gear has to come off first. */
  @GlobalCommand()
  async dismissHero(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const hid = phpIntval(param[1]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const hero = await this.cityHero(uid, cid, hid);
      if (!hero) throw GameError.lang('dismissHero.cant_dissmiss_this');
      if (!phpLooseEquals(hero.state, 0)) {
        throw GameError.lang('dismissHero.only_dissmiss_free_hero');
      }
      if (phpLooseEquals(hero.herotype, LORD_HERO_TYPE)) {
        throw GameError.lang('user_hero.cannot_dismiss');
      }
      const armor = await this.rows(sql`select * from sys_user_armor
        where uid = ${uid} and hid = ${hid}`);
      if (armor.length > 0) throw GameError.lang('dismissHero.has_armor');
      await this.deleteHeroBaseAdd(hid);

      if (phpIntval(hero.herotype) === CHILD_HERO_TYPE) {
        const child = await this.cell(sql`select hid from sys_user_child where out_hid = ${hid}`);
        const childHid = phpString(child);
        await sql`delete from sys_user_child where uid = ${uid} and hid = ${childHid}`.execute(db);
        await sql`update mem_marry_relation set state = '2'
          where shid = ${childHid} and uid = ${uid}`.execute(db);
        await sql`insert into log_child_status (hid, uid, out_hid, state, time)
          values (${childHid}, ${uid}, ${hid}, '2', unix_timestamp())
          on duplicate key update state = '2', time = unix_timestamp()`.execute(db);
      }
      await this.heroes.throwHeroToField({ ...hero, hid });

      if (!phpLooseEquals(hero.npcid, 0)) {
        // The original matched sys_lionize.npcid against the hero id.
        await sql`insert into log_lionize (uid, npcid, type, count, time)
          select uid, npcid, 11, 0, unix_timestamp() from sys_lionize
          where uid = ${uid} and npcid = ${hid}`.execute(db);
        await sql`delete from sys_lionize where uid = ${uid} and npcid = ${hid}`.execute(db);
        // The hero's own task chain, cleared for whoever held it.
        const taskmin = 10 * (phpNum(hero.npcid) + 40000);
        await sql`delete from sys_user_task
          where tid > ${taskmin} and tid < ${taskmin + 10}`.execute(db);
        await sql`delete from sys_user_goal
          where gid > ${taskmin} and gid < ${taskmin + 10}`.execute(db);
        await sql`delete from sys_attack_position
          where tid > ${taskmin} and tid < ${taskmin + 10}`.execute(db);
      }
      await this.heroes.updateCityHeroChange(uid, cid);
      return this.info.heroInfo(uid, cid);
    });
  }

  /**
   * HeroFunc.php::deleteHeroBaseAdd: takes back the base attributes items added, ends the
   * hero's timed buffers and marks those items as usable again.
   */
  private async deleteHeroBaseAdd(hid: number): Promise<void> {
    const db = this.scope.db;
    const row = await this.row(sql`select sum(command_base_add_on) as command,
        sum(affairs_base_add_on) as affairs, sum(bravery_base_add_on) as bravery,
        sum(wisdom_base_add_on) as wisdom
      from sys_city_hero_base_add where hid = ${hid}`);
    await sql`update sys_city_hero set bravery_base = bravery_base + ${-phpIntval(row?.bravery)},
        wisdom_base = wisdom_base + ${-phpIntval(row?.wisdom)},
        affairs_base = affairs_base + ${-phpIntval(row?.affairs)},
        command_base = command_base + ${-phpIntval(row?.command)}
      where hid = ${hid}`.execute(db);
    await sql`delete from sys_city_hero_base_add where hid = ${hid}`.execute(db);
    await sql`update mem_hero_buffer set endtime = unix_timestamp() where hid = ${hid}`.execute(db);
    await sql`insert into log_act (uid, actid, sort, type, count, log_type, time)
      select 0, ${hid}, 2, gid, 1, 4, unix_timestamp() from cfg_goods
      where gid between 10150 and 10155`.execute(db);
  }

  /** `[cid, hid]`: one level up once the experience suffices. */
  @GlobalCommand()
  async upgradeHero(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const hid = phpIntval(param[1]);
    const reply = await this.scope.transaction(async () => {
      const db = this.scope.db;
      let hero = await this.cityHero(uid, cid, hid);
      if (!hero) throw GameError.lang('upgradeHero.cant_upgrade_this');
      if (!isHeroInCity(hero.state)) throw GameError.lang('upgradeHero.cant_upgrade_out_hero');

      let maxLevel = getMaxHeroLevel(hero.npcid);
      if (phpLooseEquals(hero.herotype, LORD_HERO_TYPE)) {
        maxLevel = (await this.heroes.checkHeroLevel(uid, 10, 100)) ? 125 : 100;
      }
      if (phpNum(hero.level) >= maxLevel) {
        // A level above the cap is put back, and that stands although the upgrade fails.
        if (phpNum(hero.level) > maxLevel) {
          await sql`update sys_city_hero set level = ${maxLevel} where hid = ${hid}`.execute(db);
        }
        return GameError.lang('upgradeHero.level_100');
      }

      hero = (await this.row(sql`select * from sys_city_hero where hid = ${hid}`))!;
      const totalExp = await this.cell(sql`select total_exp from cfg_hero_level
        where level = ${hero.level}`);
      const upgradeExp = await this.cell(sql`select upgrade_exp from cfg_hero_level
        where level = ${phpNum(hero.level) + 1}`);
      if (phpCompare(phpNum(hero.exp) - phpNum(totalExp), upgradeExp) < 0) {
        throw GameError.lang('upgradeHero.no_enough_exp');
      }
      await sql`update sys_city_hero set level = level + 1 where hid = ${hid}`.execute(db);
      if (phpLooseEquals(hero.herotype, LORD_HERO_TYPE)) {
        await sql`update mem_assemble set level = ${phpNum(hero.level) + 1}
          where uid = ${uid}`.execute(db);
      }
      await this.heroes.regenerateHeroAttri(uid, hid);
      await this.tasks.completeTask(uid, GOAL_UPGRADE);
      await this.heroes.updateCityHeroChange(uid, cid);
      return this.info.heroInfo(uid, cid);
    });
    if (reply instanceof GameError) throw reply;
    return reply;
  }

  /**
   * `[cid, hid, affairs, bravery, wisdom]`: the new totals, spending at most the hero's
   * potential (its level; three per level and 50 more for a lord hero). Spent points stay.
   */
  @GlobalCommand()
  async addHeroPoint(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const [cid, hid, affairs, bravery, wisdom] = [0, 1, 2, 3, 4].map((i) => phpIntval(param[i]));
    return this.scope.transaction(async () => {
      const hero = await this.cityHero(uid, cid!, hid!);
      if (!hero) throw GameError.lang('addHeroPoint.cant_find_hero');
      if (!isHeroInCity(hero.state)) throw GameError.lang('addHeroPoint.cant_add_out_hero');
      const lord = phpLooseEquals(hero.herotype, LORD_HERO_TYPE);
      let levelAdd = lord ? 3 * phpNum(hero.level) : phpNum(hero.level);
      if ((await this.heroes.checkHeroLevel(uid, 8, 70)) && lord) levelAdd += 50;

      const base = (attr: string) => phpNum(hero[`${attr}_base`]);
      if (
        affairs! + bravery! + wisdom! >
        base('affairs') + base('bravery') + base('wisdom') + levelAdd
      ) {
        throw GameError.lang('addHeroPoint.no_extra_potential');
      }
      const affairsAdd = affairs! - base('affairs');
      const braveryAdd = bravery! - base('bravery');
      const wisdomAdd = wisdom! - base('wisdom');
      if (
        phpNum(hero.affairs_add) > affairsAdd ||
        phpNum(hero.bravery_add) > braveryAdd ||
        phpNum(hero.wisdom_add) > wisdomAdd
      ) {
        throw GameError.lang('hero.xidian_unvalid');
      }
      await sql`update sys_city_hero set affairs_add = ${affairsAdd},
          bravery_add = ${braveryAdd}, wisdom_add = ${wisdomAdd}
        where hid = ${hid}`.execute(this.scope.db);
      await this.heroes.regenerateHeroAttri(uid, hid!);
      await this.heroes.updateCityHeroChange(uid, cid);
      const chief = await this.cell(sql`select chiefhid from sys_city where cid = ${cid}`);
      if (phpLooseEquals(chief, hid)) await this.cityRules.updateCityResourceAdd(cid!);
      await this.tasks.completeTask(uid, GOAL_ADD_POINT);
      return this.info.heroInfo(uid, cid!);
    });
  }

  /** `[cid, hid]`: 洗髓丹 (one per 10 levels) frees all spent points. */
  @GlobalCommand()
  async clearHeroPoint(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const hid = phpIntval(param[1]);
    return this.scope.transaction(async () => {
      const hero = await this.cityHero(uid, cid, hid);
      if (!hero) throw GameError.lang('clearHeroPoint.cant_find_hero');
      if (!isHeroInCity(hero.state)) throw GameError.lang('clearHeroPoint.cant_clean_out_hero');
      const need = Math.ceil(phpNum(hero.level) / 10);
      const count = await this.cell(sql`select count from sys_goods
        where uid = ${uid} and gid = ${GOODS_XISHUIDAN}`);
      if ((phpEmpty(count) ? 0 : phpNum(count)) < need) {
        throw GameError.raw(`not_enough_goods${GOODS_XISHUIDAN}#${need}`);
      }
      await sql`update sys_city_hero set affairs_add = 0, bravery_add = 0, wisdom_add = 0
        where hid = ${hid}`.execute(this.scope.db);
      await this.goods.reduceGoods(uid, GOODS_XISHUIDAN, need);
      await this.heroes.regenerateHeroAttri(uid, hid);
      await this.heroes.updateCityHeroChange(uid, cid);
      return this.info.heroInfo(uid, cid);
    });
  }

  /** `[cid, hid, name]`: up to four characters; famous and some event heroes keep theirs. */
  @GlobalCommand()
  async changeHeroName(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const hid = phpIntval(param[1]);
    const name = phpTrim(param[2]);
    if (mbStrlen(name) > MAX_HERO_NAME) throw GameError.lang('changeHeroName.name_too_long');
    if (name.includes("'") || name.includes('\\')) {
      throw GameError.lang('changeHeroName.invalid_char');
    }
    if (name.length === 0) throw GameError.lang('changeHeroName.input_valid_name');
    const lower = name.replace(/[A-Z]/g, (c) => c.toLowerCase());
    return this.scope.transaction(async () => {
      const banned = await this.rows(sql`select * from cfg_baned_name
        where instr(${lower}, name) > 0`);
      if (banned.length > 0) throw GameError.lang('changeHeroName.invalid_char');
      const hero = await this.cityHero(uid, cid, hid);
      if (!hero) throw GameError.lang('changeHeroName.cant_find_hero');
      const herotype = phpNum(hero.herotype);
      if (herotype === CHILD_HERO_TYPE) {
        throw GameError.lang('marrySystem.child_name_not_change_here');
      }
      if (!isHeroInCity(hero.state)) throw GameError.lang('changeHeroName.cant_change_out_hero');
      if (!phpLooseEquals(hero.npcid, 0)) {
        throw GameError.lang('changeHeroName.cant_change_famous_hero');
      }
      if (herotype === 142 || herotype === 144 || herotype === 145) {
        throw GameError.lang('hero.canot_change_name');
      }
      if (herotype > 145 && herotype < 5000) throw GameError.lang('hero.canot_change_name');
      await sql`update sys_city_hero set name = ${name} where hid = ${hid}`.execute(this.scope.db);
      return this.info.heroInfo(uid, cid);
    });
  }

  /**
   * `[cid, hid, type]`: gold (type 0; five times the pay, a random loyalty gain that shrinks
   * with the pay) or one jewel (types 1-9, gid 30-38) for loyalty, every 15 minutes.
   */
  @GlobalCommand()
  async largessHero(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const hid = phpIntval(param[1]);
    const typeidx = param[2];
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const hero = await this.cityHero(uid, cid, hid);
      if (!hero) throw GameError.lang('largessHero.cant_find_hero');
      if (phpIntval(hero.herotype) === LORD_HERO_TYPE) {
        throw GameError.lang('useGoods.king_cannot_use');
      }
      if (!isHeroInCity(hero.state)) throw GameError.lang('largessHero.cant_largess_out_hero');
      const now = phpNum(await this.cell(sql`select unix_timestamp()`));
      const last = phpNum(
        await this.cell(sql`select last_largess from mem_hero_schedule where hid = ${hid}`),
      );
      if (now - last < LARGESS_INTERVAL) {
        const wait = makeTimeLeft(this.lang, LARGESS_INTERVAL - (now - last));
        throw GameError.lang('largessHero.wait_duration', wait);
      }
      const pendants = await this.cell(sql`select count(*) from sys_user_armor a,
          sys_hero_armor b
        where a.sid = b.sid and b.hid = ${hid} and b.armorid = ${LUOSHEN_PENDANT}
          and a.active_special = 1`);
      const capAdd = phpNum(pendants) === 1 ? 20 : phpNum(pendants) === 2 ? 50 : 0;

      let loyaltyAdd = 0;
      if (phpLooseEquals(typeidx, 0)) {
        const gold = await this.cell(sql`select gold from mem_city_resource where cid = ${cid}`);
        const over = (attr: string) =>
          Math.max(phpNum(hero[`${attr}_base`]) + phpNum(hero[`${attr}_add`]) - 90, 0);
        const salary =
          phpNum(hero.level) * 20 + (over('affairs') + over('bravery') + over('wisdom')) * 50;
        const largessGold = salary * 5;
        if (phpNum(gold) < largessGold) throw GameError.lang('largessHero.no_enough_gold');
        if (salary < 3500) loyaltyAdd = this.random.mtRand(1, 20);
        else if (salary < 6500) loyaltyAdd = this.random.mtRand(1, 10);
        else if (phpNum(hero.loyalty) < 30) loyaltyAdd = this.random.mtRand(1, 5);
        else throw GameError.lang('largessHero.no_need_gold');
        await sql`update mem_city_resource set gold = gold - ${largessGold}
          where cid = ${cid}`.execute(db);
      } else if (phpCompare(typeidx, 10) < 0) {
        const gid = phpNum(typeidx) + 29;
        const count = await this.cell(sql`select count from sys_goods
          where uid = ${uid} and gid = ${gid}`);
        if (phpEmpty(count) || phpNum(count) <= 0) {
          throw GameError.lang('largessHero.no_this_prop');
        }
        await this.goods.addGoods(uid, gid, -1, LOG_LARGESS);
        loyaltyAdd = GOODS_LOYALTY_ADD[Math.trunc(phpNum(typeidx)) - 1] ?? 0;
        if (gid === 30) await this.tasks.completeTaskWithTaskid(uid, TASK_WUQU);
      }
      const cap = (phpIntval(hero.herotype) === CHILD_HERO_TYPE ? 300 : 100) + capAdd;
      await sql`update sys_city_hero set loyalty = least(${cap}, loyalty + ${loyaltyAdd})
        where hid = ${hid}`.execute(db);
      await sql`insert into mem_hero_schedule (hid, last_trick, last_largess)
        values (${hid}, 0, ${now}) on duplicate key update last_largess = ${now}`.execute(db);
      return this.info.heroInfo(uid, cid);
    });
  }
}
