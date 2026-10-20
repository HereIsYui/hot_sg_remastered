import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { Building } from '../core/city-rules.service';
import { isActHero } from '../core/hero-rules.service';
import { phpEmpty, phpIntval, phpNum } from '../core/php';
import { RandomService } from '../core/random.service';
import { DbScope } from '../db/database.module';
import { GAME_SPEED_RATE } from './technic-rules.service';

type Row = Record<string, unknown>;

/** cfg_act.type of the 客栈招将领 events, whose heroes come from cfg_recruit_hero. */
const ACT_RECRUIT_HERO = 2001;
/** log_act.sort of an event hero. */
const LOG_SORT_HERO = 7;
/** log_act.log_type of an event hero refreshed without a 招贤榜. */
const LOG_TYPE_NO_BOARD = 0;
/** Event heroes a day without a 招贤榜. */
const FREE_ACT_HEROES_PER_DAY = 1;
/** The chance (%) of an event hero without a 招贤榜, until the daily one. */
const FREE_ACT_HERO_RATE = 5;
/** Seconds of a recruit-list block at 客栈 level 1; level n refreshes n times as often. */
const RECRUIT_BLOCK_SECONDS = 10800;
/** UTC+8, as the blocks start at Beijing midnight. */
const TIMEZONE_OFFSET = 8 * 3600;
/** getHotelInfo keeps at least this many heroes in the wild pool (cid 0). */
const WILD_POOL_SIZE = 1000;

/** interface.php::HeroRecruit: a hero the 客栈 offers. */
export interface HeroRecruit {
  _explicitType: 'HeroRecruit';
  id: unknown;
  hname: unknown;
  sex: number;
  face: number;
  cid: unknown;
  level: unknown;
  affairs_base: unknown;
  bravery_base: unknown;
  wisdom_base: unknown;
  affairs_add: unknown;
  bravery_add: unknown;
  wisdom_add: unknown;
  loyalty: unknown;
  gold_need: unknown;
  isActHero: boolean;
  command_base: unknown;
  command_add: unknown;
}

interface NewRecruit {
  name: unknown;
  sex: number;
  face: number;
  level: number;
  exp: unknown;
  affairs_base: number;
  bravery_base: number;
  wisdom_base: number;
  command_base: number;
  affairs_add: number;
  bravery_add: number;
  wisdom_add: number;
  command_add: number;
  loyalty: number;
  herotype: unknown;
}

/** The recruit list of HotelFunc.php and the hero slots of utils.php / OfficeFunc.php. */
@Injectable()
export class HotelRules {
  constructor(
    private readonly scope: DbScope,
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

  /** OfficeFunc.php::doGetOfficeValidPosition: 招贤馆 level minus the city's heroes. */
  async officeValidPosition(uid: number, cid: number): Promise<number> {
    const level = await this.cell(sql`select level from sys_building
      where cid = ${cid} and bid = ${Building.Office}`);
    const count = await this.cell(sql`select count(*) from sys_city_hero
      where uid = ${uid} and cid = ${cid}`);
    return phpNum(level) - phpNum(count);
  }

  /** utils.php::cityHasHeroPosition */
  async cityHasHeroPosition(uid: number, cid: number): Promise<boolean> {
    const level = await this.cell(sql`select level from sys_building
      where cid = ${cid} and bid = ${Building.Office}`);
    if (phpEmpty(level)) return false;
    const count = await this.cell(sql`select count(*) from sys_city_hero
      where cid = ${cid} and uid = ${uid}`);
    return phpNum(level) > phpNum(count);
  }

  /** getHotelInfo's top-up of the wild pool, which feeds the NPC fields. */
  async fillWildPool(): Promise<void> {
    const count = await this.cell(sql`select count(*) from sys_recruit_hero where cid = 0`);
    if (phpNum(count) < WILD_POOL_SIZE) await this.generateRecruitHero(0, 5);
  }

  /**
   * HotelFunc.php::doGetRecruitHero: every elapsed block drops the oldest hero and refills the
   * list to the 客栈's level; a 招贤榜 (last_reset_recruit 0) refreshes it all with the event's
   * own chance of an event hero, otherwise one a day at 5%.
   */
  async recruitHeroes(uid: number, cid: number, level: number): Promise<HeroRecruit[]> {
    if (level <= 0) return [];
    const db = this.scope.db;
    const lastReset = phpNum(
      await this.cell(sql`select last_reset_recruit from mem_city_schedule where cid = ${cid}`),
    );
    if (lastReset === 0) {
      await sql`insert into mem_city_schedule (cid, last_reset_recruit)
        values (${cid}, unix_timestamp())
        on duplicate key update last_reset_recruit = unix_timestamp()`.execute(db);
    }
    const now = phpNum(await this.cell(sql`select unix_timestamp()`));
    const blocksize = RECRUIT_BLOCK_SECONDS / GAME_SPEED_RATE / level;
    const delta =
      Math.floor((now + TIMEZONE_OFFSET) / blocksize) -
      Math.floor((lastReset + TIMEZONE_OFFSET) / blocksize);
    if (delta > 0) {
      const old = await this.rows(sql`select id from sys_recruit_hero
        where cid = ${cid} order by id limit ${delta}`);
      for (const hero of old) {
        await sql`delete from sys_recruit_hero where id = ${hero.id}`.execute(db);
      }
      const heroCount = phpNum(
        await this.cell(sql`select count(*) from sys_recruit_hero where cid = ${cid}`),
      );

      const act = await this.row(sql`select actid, rate from cfg_act
        where type = ${ACT_RECRUIT_HERO} and starttime <= unix_timestamp()
          and endtime >= unix_timestamp() limit 1`);
      let rate = 0;
      if (act) {
        const total = await this.cell(sql`select sum(count) from log_act
          where uid = ${uid} and actid = ${act.actid} and sort = ${LOG_SORT_HERO}
            and log_type = ${LOG_TYPE_NO_BOARD} and time >= unix_timestamp(curdate())`);
        rate = phpNum(total) >= FREE_ACT_HEROES_PER_DAY ? 0 : FREE_ACT_HERO_RATE;
        if (lastReset === 0) rate = phpNum(act.rate);
      }
      if (act && this.random.mtRand(1, 100) <= rate) {
        const idx = heroCount < level ? this.random.mtRand(heroCount, level - 1) : -1;
        for (let i = heroCount; i < level; i++) {
          if (i === idx) await this.generateHeroFromConfig(cid, level, phpIntval(act.actid));
          else await this.generateRecruitHero(cid, level);
        }
        if (lastReset !== 0) {
          await sql`insert into log_act (uid, actid, sort, type, count, log_type, time)
            values (${uid}, ${act.actid}, ${LOG_SORT_HERO}, 0, 1, ${LOG_TYPE_NO_BOARD},
              unix_timestamp())`.execute(db);
        }
      } else {
        for (let i = heroCount; i < level; i++) await this.generateRecruitHero(cid, level);
      }
      await sql`update mem_city_schedule set last_reset_recruit = unix_timestamp()
        where cid = ${cid}`.execute(db);
    }

    const heroes = await this.rows(sql`select * from sys_recruit_hero
      where cid = ${cid} order by id desc`);
    return heroes.map((hero) => ({
      _explicitType: 'HeroRecruit',
      id: hero.id,
      hname: hero.name,
      sex: phpIntval(hero.sex),
      face: phpIntval(hero.face),
      cid: hero.cid,
      level: hero.level,
      affairs_base: hero.affairs_base,
      bravery_base: hero.bravery_base,
      wisdom_base: hero.wisdom_base,
      affairs_add: hero.affairs_add,
      bravery_add: hero.bravery_add,
      wisdom_add: hero.wisdom_add,
      loyalty: hero.loyalty,
      gold_need: hero.gold_need,
      isActHero: isActHero(hero.herotype),
      command_base: hero.command_base,
      command_add: hero.command_add,
    }));
  }

  /**
   * HotelFunc.php::generateRecruitHero: a random hero of level 1..5×客栈 (above level 10, half
   * 1..39 and half 40..50), 50..170 base points split by three random weights, the best with
   * some 统率.
   */
  async generateRecruitHero(cid: number, level: number): Promise<void> {
    const sex = this.random.mtRand(0, 9) === 0 ? 0 : 1;
    const name = await this.heroName(sex);
    const face = this.randomFace(sex);
    let hlevel: number;
    if (level < 11) hlevel = this.random.mtRand(1, level * 5);
    else
      hlevel =
        this.random.mtRand(0, 1) === 0 ? this.random.mtRand(1, 39) : this.random.mtRand(40, 50);

    const affairsRate = this.random.mtRand(300, 900);
    const braveryRate = this.random.mtRand(300, 900);
    const wisdomRate = this.random.mtRand(300, 900);
    const levelInfo = await this.levelInfo(hlevel);

    const allBase = this.random.mtRand(50, 170);
    let commandBase = 0;
    if (allBase > 110 && allBase <= 150) commandBase = this.random.mtRand(1, 5);
    else if (allBase > 150 && allBase <= 170) commandBase = this.random.mtRand(6, 10);
    await this.insertRecruit(cid, {
      name,
      sex,
      face,
      level: hlevel,
      exp: levelInfo.total_exp,
      ...this.splitRandom(hlevel, allBase, affairsRate, braveryRate, wisdomRate),
      command_base: commandBase,
      command_add: 0,
      loyalty: 70,
      herotype: 0,
    });
  }

  /**
   * HotelFunc.php::generateHeroFromConfig: an event hero picked by rate from cfg_recruit_hero;
   * all-zero base ranges mean a random hero under the event's name.
   */
  private async generateHeroFromConfig(cid: number, level: number, actid: number): Promise<void> {
    const configs = await this.rows(sql`select * from cfg_recruit_hero where actid = ${actid}`);
    const sum = configs.reduce((s, r) => s + phpNum(r.rate), 0);
    const pick = sum >= 1 ? this.random.mtRand(1, sum) : 0;
    let cur = 0;
    const hero = configs.find((r) => (cur += phpNum(r.rate)) >= pick);
    if (!hero) return;

    const range = (min: unknown, max: unknown) =>
      this.random.mtRand(phpIntval(min), phpIntval(max));
    let affairsBase = range(hero.min_affairs_base, hero.max_affairs_base);
    let braveryBase = range(hero.min_bravery_base, hero.max_bravery_base);
    let wisdomBase = range(hero.min_wisdom_base, hero.max_wisdom_base);
    const commandBase = range(hero.min_command_base, hero.max_command_base);
    let loyalty = range(hero.min_loyalty, hero.max_loyalty);
    let face = range(hero.min_face, hero.max_face);
    let hlevel = phpIntval(hero.level);
    let sex = phpIntval(hero.sex);
    if (hlevel <= 0) {
      let minLevel = phpIntval(hero.min_level);
      let maxLevel = phpIntval(hero.max_level);
      if (minLevel < 1) minLevel = 1;
      if (maxLevel < minLevel || maxLevel > level * 5) maxLevel = level * 5;
      hlevel = this.random.mtRand(minLevel, maxLevel);
    }
    const levelInfo = await this.levelInfo(hlevel);
    let adds: { affairs_add: number; bravery_add: number; wisdom_add: number };
    if (affairsBase === 0 && braveryBase === 0 && wisdomBase === 0) {
      sex = this.random.mtRand(0, 9) === 0 ? 0 : 1;
      const affairsRate = this.random.mtRand(300, 900);
      const braveryRate = this.random.mtRand(300, 900);
      const wisdomRate = this.random.mtRand(300, 900);
      const allBase = this.random.mtRand(50, 150);
      const split = this.splitRandom(hlevel, allBase, affairsRate, braveryRate, wisdomRate);
      ({ affairs_base: affairsBase, bravery_base: braveryBase, wisdom_base: wisdomBase } = split);
      adds = split;
      loyalty = 70;
    } else {
      const total = affairsBase + braveryBase + wisdomBase;
      const affairsAdd = Math.round((hlevel * affairsBase) / total);
      const braveryAdd = Math.round((hlevel * braveryBase) / total);
      adds = {
        affairs_add: affairsAdd,
        bravery_add: braveryAdd,
        wisdom_add: hlevel - affairsAdd - braveryAdd,
      };
    }
    if (face === 0) face = this.randomFace(sex);
    await this.insertRecruit(cid, {
      name: hero.heroname,
      sex,
      face,
      level: hlevel,
      exp: levelInfo.total_exp,
      affairs_base: affairsBase,
      bravery_base: braveryBase,
      wisdom_base: wisdomBase,
      command_base: commandBase,
      affairs_add: adds.affairs_add,
      bravery_add: adds.bravery_add,
      wisdom_add: adds.wisdom_add,
      command_add: 0,
      loyalty,
      herotype: hero.herotype,
    });
  }

  /** `allBase` points and the level's points split by the three weights. */
  private splitRandom(
    hlevel: number,
    allBase: number,
    affairsRate: number,
    braveryRate: number,
    wisdomRate: number,
  ) {
    const allRate = affairsRate + braveryRate + wisdomRate;
    const affairsAdd = Math.round((hlevel * affairsRate) / allRate);
    const braveryAdd = Math.round((hlevel * braveryRate) / allRate);
    return {
      affairs_base: Math.floor((allBase * affairsRate) / allRate),
      bravery_base: Math.floor((allBase * braveryRate) / allRate),
      wisdom_base: Math.floor((allBase * wisdomRate) / allRate),
      affairs_add: affairsAdd,
      bravery_add: braveryAdd,
      wisdom_add: hlevel - affairsAdd - braveryAdd,
    };
  }

  /** Women have portraits 1..9, men 1001..1070. */
  private randomFace(sex: number): number {
    return sex === 0 ? this.random.mtRand(1, 9) : this.random.mtRand(1001, 1070);
  }

  private async levelInfo(level: number): Promise<Row> {
    const info = await this.row(sql`select * from cfg_hero_level where level = ${level}`);
    if (!info) throw GameError.lang('generateRecruitHero.no_data_of_this_level');
    return info;
  }

  /** HotelFunc.php::generateHeroName: a surname and a given name for the sex. */
  private async heroName(sex: number): Promise<string> {
    const pick = async (table: 'mem_cfg_firstname' | 'mem_cfg_girlname' | 'mem_cfg_boyname') => {
      const count = phpNum(await this.cell(sql`select count(*) from ${sql.table(table)}`));
      const id = this.random.mtRand(1, count);
      const name = await this.cell(sql`select name from ${sql.table(table)} where id = ${id}`);
      return name === false || name === null ? '' : String(name);
    };
    return (
      (await pick('mem_cfg_firstname')) +
      (await pick(sex === 0 ? 'mem_cfg_girlname' : 'mem_cfg_boyname'))
    );
  }

  /** The hiring fee: 20 a level plus 50 a point above 90 in each attribute, ×50. */
  private async insertRecruit(cid: number, h: NewRecruit): Promise<void> {
    const over = (base: number, add: number) => Math.max(base + add - 90, 0);
    const goldNeed =
      (h.level * 20 +
        (over(h.affairs_base, h.affairs_add) +
          over(h.bravery_base, h.bravery_add) +
          over(h.wisdom_base, h.wisdom_add)) *
          50) *
      50;
    await sql`insert into sys_recruit_hero (name, sex, face, cid, level, exp, affairs_base,
        bravery_base, wisdom_base, command_base, affairs_add, bravery_add, wisdom_add,
        command_add, loyalty, gold_need, gen_time, herotype)
      values (${h.name}, ${h.sex}, ${h.face}, ${cid}, ${h.level}, ${h.exp}, ${h.affairs_base},
        ${h.bravery_base}, ${h.wisdom_base}, ${h.command_base}, ${h.affairs_add},
        ${h.bravery_add}, ${h.wisdom_add}, ${h.command_add}, ${h.loyalty}, ${goldNeed},
        unix_timestamp(), ${h.herotype})`.execute(this.scope.db);
  }
}
