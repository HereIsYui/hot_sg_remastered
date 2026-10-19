import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DbScope } from '../db/database.module';
import { unixNow } from '../db/sql-fragments';
import { wid2cid } from './city-rules.service';
import { phpIntval } from './php';

/** Hero type of the player's own lord hero (君主将). */
export const LORD_HERO_TYPE = 1000;

/** common.php HERO_EXP_RATE */
const HERO_EXP_RATE = 0.1;

/** ActFunc.php::isActHero: heroes handed out by events. */
export function isActHero(heroType: unknown): boolean {
  const t = phpIntval(heroType);
  return t > 10 && t !== 100 && t < 20000;
}

/** global.php::isCardHero */
export function isCardHero(heroType: unknown): boolean {
  const t = phpIntval(heroType);
  return t >= 21250 && t <= 24250;
}

/** The sys_city_hero columns throwHeroToField reads; callers often pass only `hid`. */
export interface ThrownHero {
  hid: number;
  herotype?: unknown;
  npcid?: unknown;
  name?: unknown;
  sex?: unknown;
  face?: unknown;
  level?: unknown;
  exp?: unknown;
  affairs_add?: unknown;
  bravery_add?: unknown;
  wisdom_add?: unknown;
  affairs_base?: unknown;
  bravery_base?: unknown;
  wisdom_base?: unknown;
}

type RecruitSource = Omit<ThrownHero, 'hid' | 'herotype'>;

/** Hero helpers from utils.php. */
@Injectable()
export class HeroRules {
  constructor(private readonly scope: DbScope) {}

  /** utils.php::addHeroExp: HERO_EXP_RATE of `exp`; lord heroes gain none. */
  async addHeroExp(hid: number, exp: number): Promise<void> {
    const expadd = Math.floor(exp * HERO_EXP_RATE);
    await sql`update sys_city_hero set exp = exp + ${expadd}
      where herotype != ${LORD_HERO_TYPE} and hid = ${hid}`.execute(this.scope.db);
  }

  /**
   * utils.php::throwHeroToField: strips the hero's gear and moves it to a random free wild
   * field as an NPC hero, replacing a non-famous NPC already there; after the last attempt
   * a non-famous hero goes back to the recruit pool instead.
   */
  async throwHeroToField(hero: ThrownHero): Promise<void> {
    const db = this.scope.db;
    const hid = hero.hid;
    await db.deleteFrom('mem_hero_blood').where('hid', '=', hid).execute();
    await db.deleteFrom('sys_hero_armor').where('hid', '=', hid).execute();
    await db.updateTable('sys_user_armor').set({ hid: 0 }).where('hid', '=', hid).execute();
    await db.updateTable('sys_user_book').set({ hid: 0 }).where('hid', '=', hid).execute();

    const famous = phpIntval(hero.npcid) > 0;
    let attempts = 10;
    if (isActHero(hero.herotype) || isCardHero(hero.herotype)) attempts = 0;
    else if (famous) attempts = 40;

    while (attempts > 0) {
      attempts--;
      const field = famous
        ? await sql<{ wid: number }>`select wid from mem_world
            where ownercid = 0 and province <= 13 and type > 1 and state = 0 order by rand() limit 1`.execute(
            db,
          )
        : await sql<{ wid: number }>`select wid from mem_world
            where ownercid = 0 and type > 1 and state = 0 order by rand() limit 1`.execute(db);
      const newcid = wid2cid(field.rows[0]?.wid);
      const occupant = await db
        .selectFrom('sys_city_hero')
        .selectAll()
        .where('uid', '=', 0)
        .where('cid', '=', newcid)
        .executeTakeFirst();
      if (!occupant) {
        await this.moveToField(hid, newcid);
        break;
      }
      if (phpIntval(occupant.npcid) > 0) continue;

      await this.moveToField(hid, newcid);
      await db.deleteFrom('sys_city_hero').where('hid', '=', occupant.hid).execute();
      await db.deleteFrom('mem_hero_blood').where('hid', '=', occupant.hid).execute();
      if (!isActHero(hero.herotype)) await this.toRecruitPool(occupant);
      const troop = await db
        .selectFrom('sys_troops')
        .select('id')
        .where('uid', '=', 0)
        .where('cid', '=', newcid)
        .where('hid', '=', occupant.hid)
        .executeTakeFirst();
      if (troop) {
        await db.updateTable('sys_troops').set({ hid }).where('id', '=', troop.id).execute();
      }
      break;
    }

    // A hero placed on the final attempt also lands here (attempts already 0), as in PHP.
    if (attempts === 0) {
      if (famous) return;
      await db.updateTable('sys_troops').set({ hid: 0 }).where('hid', '=', hid).execute();
      await db.deleteFrom('sys_city_hero').where('hid', '=', hid).execute();
      if (!isActHero(hero.herotype) || !isCardHero(hero.herotype)) await this.toRecruitPool(hero);
    }
  }

  /** Keeps a single lord hero: with two, the lower-level one becomes an ordinary hero. */
  async demoteDuplicateLord(uid: number): Promise<void> {
    const db = this.scope.db;
    const lords = await db
      .selectFrom('sys_city_hero')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('uid', '=', uid)
      .where('herotype', '=', LORD_HERO_TYPE)
      .executeTakeFirstOrThrow();
    if (Number(lords.n) <= 1) return;
    const lowest = await db
      .selectFrom('sys_city_hero')
      .select('hid')
      .where('uid', '=', uid)
      .where('herotype', '=', LORD_HERO_TYPE)
      .orderBy('level', 'asc')
      .limit(1)
      .executeTakeFirstOrThrow();
    await db
      .updateTable('sys_city_hero')
      .set({ herotype: 0 })
      .where('hid', '=', lowest.hid)
      .execute();
  }

  private async moveToField(hid: number, cid: number): Promise<void> {
    await this.scope.db
      .updateTable('sys_city_hero')
      .set({ cid, state: 4, uid: 0, loyalty: 70 })
      .where('hid', '=', hid)
      .execute();
  }

  /** Missing columns go in as '' like PHP's interpolation of unset keys (0 under loose sql_mode). */
  private async toRecruitPool(hero: RecruitSource): Promise<void> {
    const v = (value: unknown) => (value === undefined || value === null ? '' : value);
    await sql`insert into sys_recruit_hero (name, npcid, sex, face, cid, level, exp,
        affairs_add, bravery_add, wisdom_add, affairs_base, bravery_base, wisdom_base,
        loyalty, gold_need, gen_time)
      values (${v(hero.name)}, ${v(hero.npcid)}, ${v(hero.sex)}, ${v(hero.face)}, 0,
        ${v(hero.level)}, ${v(hero.exp)}, ${v(hero.affairs_add)}, ${v(hero.bravery_add)},
        ${v(hero.wisdom_add)}, ${v(hero.affairs_base)}, ${v(hero.bravery_base)},
        ${v(hero.wisdom_base)}, 66, 0, ${unixNow()})`.execute(this.scope.db);
  }
}
