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
import { UserRules } from '../core/user-rules.service';
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

  /** `[cid, hid]`: a captive (state 5) is set free into the wilds. */
  @GlobalCommand()
  async releaseHero(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const hid = phpIntval(param[1]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const hero = await this.row(sql`select * from sys_city_hero where hid = ${hid}`);
      if (!hero) throw GameError.lang('releaseHero.hero_not_exist');
      if (!phpLooseEquals(hero.state, 5)) throw GameError.lang('releaseHero.hero_not_captive');
      await this.heroes.throwHeroToField({ ...hero, hid });
      await sql`delete from mem_hero_summon where hid = ${hid}`.execute(db);
      await sql`delete from sys_hero_captive where hid = ${hid}`.execute(db);
      await sql`insert into log_lionize (uid, npcid, type, count, time)
        select uid, npcid, 12, 0, unix_timestamp() from sys_lionize
        where uid = ${uid} and npcid = ${hid}`.execute(db);
      await sql`delete from sys_lionize where npcid = ${hid} and uid = ${uid}`.execute(db);
      return this.info.heroInfo(uid, cid);
    });
  }

  /** `[cid, hid]`: a defector (state 6) is turned away and returns to the wilds. */
  @GlobalCommand()
  async rejectHero(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const hid = phpIntval(param[1]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const hero = await this.row(sql`select * from sys_city_hero where hid = ${hid}`);
      if (!hero) throw GameError.lang('releaseHero.hero_not_exist');
      if (!phpLooseEquals(hero.state, 6)) throw GameError.lang('releaseHero.hero_not_coming');
      await this.heroes.throwHeroToField({ ...hero, hid });
      await sql`delete from mem_hero_summon where hid = ${hid}`.execute(db);
      return this.info.heroInfo(uid, cid);
    });
  }

  /** `[cid, hid]`: the famous hero's cfg_npc_hero row, shown in the 说明 dialog. */
  @GlobalCommand()
  async getNpcIntroduce(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const hid = phpIntval(param[1]);
    const hero = await this.row(sql`select * from sys_city_hero where hid = ${hid}`);
    if (!hero) throw GameError.lang('getNpcIntroduce.no_hero_info');
    if (phpLooseEquals(hero.npcid, 0)) throw GameError.lang('getNpcIntroduce.not_famous_hero');
    const npchero = await this.row(sql`select * from cfg_npc_hero where npcid = ${hero.npcid}`);
    if (!npchero) throw GameError.lang('getNpcIntroduce.not_famous_hero');
    return [npchero];
  }

  /**
   * HeroFunc.php::getHeroSummonGold: the gold to recruit a captive or defector — fifty times
   * the hero's salary (level + attributes above 90).
   */
  private summonGold(hero: Row): number {
    const over = (attr: string) =>
      Math.max(phpNum(hero[`${attr}_base`]) + phpNum(hero[`${attr}_add`]) - 90, 0);
    const salary =
      phpNum(hero.level) * 20 + (over('affairs') + over('bravery') + over('wisdom')) * 50;
    return salary * 50;
  }

  /**
   * HeroFunc.php::makeHeroSummonNeed: rolls the jewels (gid 30-38) a level-50+ hero asks for,
   * worth roughly level²/10, and stores them in mem_hero_summon.
   */
  private async makeSummonNeed(hid: number, level: number): Promise<void> {
    const db = this.scope.db;
    let typeCount = 1 + Math.floor((level - 50) / 10);
    let totalValue = (level * level) / 10;
    const goodsArray = (
      await this.rows(sql`select * from cfg_goods where gid >= 30 and gid <= 38`)
    ).slice();
    if (typeCount > goodsArray.length) typeCount = goodsArray.length;
    while (typeCount > 0 && totalValue > 0) {
      typeCount--;
      const idx = this.random.mtRand(0, goodsArray.length - 1);
      const goods = goodsArray[idx]!;
      const value = phpNum(goods.value);
      const cnt = Math.ceil(totalValue / value);
      let realCnt: number;
      if (typeCount === 0) {
        realCnt = cnt;
      } else {
        realCnt = this.random.mtRand(1, cnt);
        totalValue -= realCnt * value;
      }
      await sql`insert into mem_hero_summon (hid, gid, name, count)
        values (${hid}, ${goods.gid}, ${goods.name}, ${realCnt})`.execute(db);
      goodsArray.splice(idx, 1);
    }
  }

  /**
   * HeroFunc.php::getSummonNeed: the "you need …" prompt — gold plus the jewels (generated the
   * first time for a level-50+ hero). The 活动招将 hook is not ported, so only the normal
   * requirement is listed.
   */
  private async summonNeed(hero: Row): Promise<string> {
    const hid = phpNum(hero.hid);
    let need = this.lang.t('trySummonHero.hero_need');
    need += this.lang.t('trySummonHero.gold') + this.summonGold(hero);
    if (phpNum(hero.level) >= 50) {
      let goods = await this.rows(sql`select * from mem_hero_summon where hid = ${hid}`);
      if (goods.length === 0) {
        await this.makeSummonNeed(hid, phpNum(hero.level));
        goods = await this.rows(sql`select * from mem_hero_summon where hid = ${hid}`);
      }
      for (const good of goods) need += '，' + String(good.name) + String(good.count);
    }
    if (phpNum(hero.npcid) > 0) need += this.lang.t('hero.summon_hero_msg');
    need += '。';
    return need;
  }

  /** `[cid, hid]`: a captive (state 5); answers `[hid, need]` for the confirm prompt. */
  @GlobalCommand()
  async trySummonHero(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const hid = phpIntval(param[1]);
    const hero = await this.row(sql`select * from sys_city_hero where hid = ${hid}`);
    if (!hero) throw GameError.lang('trySummonHero.no_hero_info');
    if (!phpLooseEquals(hero.state, 5)) {
      throw GameError.raw(String(hero.name ?? '') + this.lang.t('trySummonHero.hero_not_captive'));
    }
    await this.checkSummonNobility(uid, hero);
    const need = await this.summonNeed(hero);
    return [hid, need];
  }

  /** The nobility a captive demands: one rank per ten levels, raised by any 推恩令 buff. */
  private async checkSummonNobility(uid: number, hero: Row): Promise<void> {
    const need = Math.floor((phpNum(hero.level) - 1) / 10);
    const real = await this.cell(sql`select nobility from sys_user where uid = ${uid}`);
    const nobility = await this.users.bufferNobility(uid, real);
    if (nobility < need) {
      const name = await this.cell(sql`select name from cfg_nobility where id = ${need}`);
      throw GameError.lang('trySummonHero.no_enough_nobility', name);
    }
  }

  /**
   * `[cid, hid]`: pay the gold and jewels and recruit the captive. A famous hero may resist
   * (10% + 0.9·friend), and succeeds into loyalty 50. The 活动 / 51 / agent hooks are not
   * ported.
   */
  @GlobalCommand()
  async sureSummonHero(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const hid = phpIntval(param[1]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const hero = await this.row(sql`select * from sys_city_hero where hid = ${hid}`);
      if (!phpLooseEquals(hero?.uid, uid)) throw GameError.lang('sureSummonHero.err');
      if (!hero || !phpLooseEquals(hero.cid, cid)) {
        throw GameError.lang('sureSummonHero.hero_not_exist');
      }
      if (!phpLooseEquals(hero.state, 5)) throw GameError.lang('sureSummonHero.hero_not_captive');
      await this.checkSummonNobility(uid, hero);
      await this.spendSummonGoods(uid, cid, hero);

      if (phpNum(hero.npcid) > 0) {
        const friend = phpNum(
          await this.cell(sql`select friend from sys_lionize
            where uid = ${uid} and npcid = ${hid}`),
        );
        const rate = 10 + 0.9 * friend;
        if (this.random.mtRand(1, 100) > rate) {
          await sql`insert into sys_lionize (uid, npcid, friend, state)
            values (${uid}, ${hid}, 0, 3) on duplicate key update friend = friend + 5`.execute(db);
          await sql`insert into log_lionize (uid, npcid, type, count, time)
            select uid, npcid, 2, friend, unix_timestamp() from sys_lionize
            where uid = ${uid} and npcid = ${hid}`.execute(db);
          throw GameError.lang('sureSummonHero.summon_fail');
        }
        const uname = await this.cell(sql`select name from sys_user where uid = ${uid}`);
        await this.users.sendSysInform({
          type: 0,
          inuse: 1,
          starttime: 0,
          endtime: 600,
          interval: 50000,
          scrollcount: 1,
          color: 16738740,
          msg: this.lang.t('summon_hero.npc', hero.name, uname),
        });
        await sql`insert into sys_lionize (uid, npcid, friend, state)
          values (${uid}, ${hid}, 0, 2)
          on duplicate key update friend = 100, state = 2`.execute(db);
        await sql`insert into log_lionize (uid, npcid, type, count, time)
          select uid, npcid, 2, friend, unix_timestamp() from sys_lionize
          where uid = ${uid} and npcid = ${hid}`.execute(db);
      }
      // A 修养 (2) captive drops back to 重伤 (1) before being recruited.
      await sql`update sys_city_hero set hero_health = 1
        where hero_health = 2 and hid = ${hid} limit 1`.execute(db);
      await sql`update sys_city_hero set state = 0, loyalty = 50, uid = ${uid}
        where hid = ${hid}`.execute(db);
      await sql`delete from sys_hero_captive where hid = ${hid}`.execute(db);
      if (phpNum(hero.npcid) > 0) {
        const taskid = 30000 + phpNum(hero.npcid);
        const goalid = await this.cell(sql`select id from cfg_task_goal where tid = ${taskid}`);
        if (goalid !== false && goalid != null) await this.tasks.completeTask(uid, phpNum(goalid));
      }
      await this.heroes.updateCityHeroChange(uid, cid);
      return this.info.heroInfo(uid, cid);
    });
  }

  /** `[cid, hid]`: a defector (state 6); answers `[hid, need]` for the confirm prompt. */
  @GlobalCommand()
  async tryAcceptHero(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const hid = phpIntval(param[1]);
    const hero = await this.row(sql`select * from sys_city_hero where hid = ${hid}`);
    if (!hero) throw GameError.lang('trySummonHero.no_hero_info');
    if (!phpLooseEquals(hero.state, 6)) {
      throw GameError.raw(String(hero.name ?? '') + this.lang.t('tryAcceptHero.hero_not_coming'));
    }
    const need = await this.summonNeed(hero);
    return [hid, need];
  }

  /** `[cid, hid]`: pay the gold and jewels and take in the defector (loyalty 80). */
  @GlobalCommand()
  async sureAcceptHero(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const hid = phpIntval(param[1]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const hero = await this.row(sql`select * from sys_city_hero where hid = ${hid}`);
      if (!hero || !phpLooseEquals(hero.cid, cid)) {
        throw GameError.lang('sureSummonHero.hero_not_exist');
      }
      if (!phpLooseEquals(hero.state, 6)) throw GameError.lang('tryAcceptHero.hero_not_coming');
      await this.spendSummonGoods(uid, cid, hero);
      if (phpNum(hero.npcid) > 0) {
        const groupid = (phpNum(hero.npcid) + 2000) * 10 + 1;
        await sql`delete from sys_hero_task where uid = ${uid} and \`group\` = ${groupid}`.execute(
          db,
        );
        await sql`insert into sys_lionize (uid, npcid, friend, state)
          values (${uid}, ${hid}, 100, 2)
          on duplicate key update friend = 100, state = 2`.execute(db);
      }
      await sql`update sys_city_hero set state = 0, loyalty = 80 where hid = ${hid}`.execute(db);
      await this.heroes.updateCityHeroChange(uid, cid);
      return this.info.heroInfo(uid, cid);
    });
  }

  /**
   * The gold + jewel cost shared by sureSummonHero / sureAcceptHero: checks the city gold and
   * every stored requirement, then spends them.
   */
  private async spendSummonGoods(uid: number, cid: number, hero: Row): Promise<void> {
    const db = this.scope.db;
    const hid = phpNum(hero.hid);
    const goldNeed = this.summonGold(hero);
    const mygold = await this.cell(sql`select gold from mem_city_resource where cid = ${cid}`);
    if (phpNum(mygold) < goldNeed) throw GameError.lang('sureSummonHero.no_enough_gold');
    let goodsList = await this.rows(sql`select * from mem_hero_summon where hid = ${hid}`);
    if (goodsList.length <= 0 && phpNum(hero.level) >= 50) {
      await this.summonNeed(hero);
      goodsList = await this.rows(sql`select * from mem_hero_summon where hid = ${hid}`);
    }
    if (goodsList.length > 0) {
      for (const goods of goodsList) {
        const owned = await this.cell(sql`select count from sys_goods
          where uid = ${uid} and gid = ${goods.gid} and count >= ${goods.count}`);
        if (owned === false || owned == null) {
          throw GameError.lang('sureSummonHero.no_enough_goods', goods.name, hero.name);
        }
      }
      for (const goods of goodsList) {
        await this.goods.addGoods(uid, phpNum(goods.gid), -phpNum(goods.count), LOG_LARGESS);
      }
      await sql`delete from mem_hero_summon where hid = ${hid}`.execute(db);
    }
    await this.cityRules.addCityResources(cid, 0, 0, 0, 0, -goldNeed);
  }

  /**
   * HeroFunc.php::getHeroBuffer — `[cid, hid]`: the hero's active 宝物 buffs for the
   * HeroBufferDialog, `{hid, gid, name, endtime}` each. The 赤壁 goods (buftype 160040-160051 /
   * 160023-160031) name themselves by `buftype`; every other buff names itself by `buftype + 25`
   * (the cfg_goods row of the item that grants it). Read-only; a deterministic `order by` is added
   * over the MyISAM original so both sides compare equal.
   */
  @GlobalCommand()
  async getHeroBuffer(ctx: CommandContext, param: unknown[]): Promise<Row[]> {
    void ctx;
    const hid = phpIntval(param[1]);
    const chibi = await this.rows(sql`select h.hid, c.gid, c.name, h.endtime
      from mem_hero_buffer h left join cfg_goods c on c.gid = h.buftype
      where h.hid = ${hid} and h.endtime > unix_timestamp()
        and ((h.buftype >= 160040 and h.buftype <= 160051)
          or (h.buftype >= 160023 and h.buftype <= 160031))
      order by h.buftype`);
    const world = await this.rows(sql`select h.hid, c.gid, c.name, h.endtime
      from mem_hero_buffer h left join cfg_goods c on c.gid = h.buftype + 25
      where h.buftype <> 5
        and (h.buftype < 160023 or (h.buftype >= 19057 and h.buftype <= 19058))
        and h.hid = ${hid} and h.endtime > unix_timestamp()
      order by h.buftype`);
    return [...chibi, ...world];
  }
}
