import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { DbScope } from '../db/database.module';
import { unixNow } from '../db/sql-fragments';
import { wid2cid } from './city-rules.service';
import {
  phpCompare,
  phpEmpty,
  phpFloat,
  phpFloatString,
  phpIntval,
  phpLooseEquals,
  phpMod,
  phpNum,
  phpString,
} from './php';

/** Hero type of the player's own lord hero (君主将). */
export const LORD_HERO_TYPE = 1000;

/** common.php HERO_EXP_RATE */
const HERO_EXP_RATE = 0.1;

/** cfg_attribute.type of the attributes regenerateHeroAttri sums up. */
const AttrType = {
  Command: 1,
  Affairs: 2,
  Bravery: 3,
  Wisdom: 4,
  Force: 5,
  Energy: 6,
  Attack: 8,
  Defence: 9,
  Speed: 11,
} as const;

/** mem_hero_buffer.buftype read by regenerateHeroAttri. */
const HeroBuffer = { Bravery: 3, Wisdom: 4, Whip: 19057, BloodWhip: 19058 } as const;

/** 虎符 / 兵书 style buffers: a percentage of the trained attribute. */
const BUFFER_BONUSES: [buftype: number, type: number, rate: number][] = [
  [160040, AttrType.Command, 10],
  [160041, AttrType.Command, 20],
  [160042, AttrType.Command, 30],
  [160043, AttrType.Affairs, 20],
  [160044, AttrType.Affairs, 10],
  [160045, AttrType.Affairs, 5],
  [160046, AttrType.Wisdom, 20],
  [160047, AttrType.Wisdom, 10],
  [160048, AttrType.Wisdom, 5],
  [160049, AttrType.Bravery, 20],
  [160050, AttrType.Bravery, 10],
  [160051, AttrType.Bravery, 5],
];

/** Skill books (cfg_book.id) that raise an attribute by their `attr`. */
const BOOK_ATTRIBUTES: Record<number, number> = {
  4: AttrType.Command,
  5: AttrType.Bravery,
  6: AttrType.Affairs,
  7: AttrType.Wisdom,
  14: AttrType.Speed,
};

/** Points each strengthening level spreads over the gear's attributes, highest first. */
const STRONG_LEVEL_VALUES = [0, 2, 2, 2, 2, 2, 2, 3, 3, 3, 6, 3, 3, 5, 5, 7];

/** 热血金枪: two worn with their special active add 1 speed. */
const GOLD_SPEAR = 12018;

/**
 * HeroFunc.php::sortArmorAttr: the gear's attribute types by value, highest first (a bubble
 * sort, so equal values keep their order); a repeated type keeps its first place.
 */
function sortArmorAttr(attributes: [type: string, value: string][]): string[] {
  const list = attributes.map(([type, value]) => ({ type, value }));
  for (let i = 0; i < list.length; i++) {
    for (let j = list.length - 1; j >= i + 1; j--) {
      if (phpCompare(list[j - 1]!.value, list[j]!.value) < 0) {
        [list[j - 1], list[j]] = [list[j]!, list[j - 1]!];
      }
    }
  }
  return [...new Set(list.map((a) => a.type))];
}

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

  /**
   * utils.php::throwUsersHeroField: a deserter loses its gear and settles on a random tile that
   * holds no NPC hero; after 20 occupied picks it goes to the recruit pool instead. Unlike
   * throwHeroToField it keeps its book, and a hero placed on the 20th pick is still removed.
   * The original picked the tile by a mem_world.id column that does not exist, so the query
   * failed and the cron died at the first deserter, its gear already gone.
   */
  async throwUsersHeroField(hero: Record<string, unknown>): Promise<void> {
    const db = this.scope.db;
    const hid = hero.hid;
    await sql`delete from mem_hero_blood where hid = ${hid}`.execute(db);
    await sql`delete from sys_hero_armor where hid = ${hid}`.execute(db);
    await sql`update sys_user_armor set hid = 0 where uid = ${hero.uid} and hid = ${hid}`.execute(
      db,
    );
    await sql`update sys_troops set hid = 0 where hid = ${hid}`.execute(db);
    let findtimes = 20;
    while (findtimes > 0) {
      findtimes--;
      const picked = await sql<{ wid: number }>`select wid from mem_world
        order by rand() limit 1`.execute(db);
      const newcid = wid2cid(picked.rows[0]?.wid);
      const occupant = await sql`select hid from sys_city_hero
        where uid = 0 and cid = ${newcid}`.execute(db);
      if (occupant.rows.length === 0) {
        await sql`update sys_city_hero set cid = ${newcid}, state = 4, uid = 0, loyalty = 70
          where hid = ${hid}`.execute(db);
        break;
      }
    }
    if (findtimes === 0) {
      await sql`delete from sys_city_hero where hid = ${hid}`.execute(db);
      await sql`insert into sys_recruit_hero (name, npcid, sex, face, cid, level, exp,
          affairs_add, bravery_add, wisdom_add, affairs_base, bravery_base, wisdom_base,
          loyalty, gold_need, gen_time)
        values (${hero.name}, ${hero.npcid}, ${hero.sex}, ${hero.face}, 0, ${hero.level},
          ${hero.exp}, ${hero.affairs_add}, ${hero.bravery_add}, ${hero.wisdom_add},
          ${hero.affairs_base}, ${hero.bravery_base}, ${hero.wisdom_base}, 60, 0,
          ${unixNow()})`.execute(db);
    }
  }

  /**
   * utils.php::updateCityHeroChange: the city's hero upkeep, 20 per level plus 50 per point of
   * each base+trained attribute above 90, for heroes neither captive nor away (states 5, 6, 9).
   */
  async updateCityHeroChange(uid: unknown, cid: unknown): Promise<void> {
    const db = this.scope.db;
    const row = await sql<{ fee: unknown }>`select sum(level * 20
        + (greatest(affairs_base + affairs_add - 90, 0) + greatest(bravery_base + bravery_add - 90, 0)
        + greatest(wisdom_base + wisdom_add - 90, 0)) * 50) as fee
      from sys_city_hero where herotype != ${LORD_HERO_TYPE} and cid = ${cid} and uid = ${uid}
        and state != 5 and state != 6 and state != 9`.execute(db);
    const fee = phpFloatString(phpNum(row.rows[0]?.fee));
    await sql`update mem_city_resource set hero_fee = ${fee} where cid = ${cid}`.execute(db);
  }

  /**
   * HeroFunc.php::regenerateHeroAttri: rebuilds the hero's bonus columns and sys_hero_attribute
   * from worn gear (attributes, smelting, strengthening, gems, deification, sets), percentage
   * attributes, 虎符-style buffers, the skill book, whips, the lord level and gear specials, then
   * the force / energy maximums.
   */
  async regenerateHeroAttri(uid: number, hid: number): Promise<void> {
    const db = this.scope.db;
    const rows = async (query: RawBuilder<unknown>) =>
      (await query.execute(db)).rows as Record<string, unknown>[];
    const cell = async (query: RawBuilder<unknown>) => {
      const row = (await rows(query))[0];
      return row ? Object.values(row)[0] : false;
    };
    const hero = (
      await rows(sql`select * from sys_city_hero
      where hid = ${hid} and uid = ${uid}`)
    )[0];
    if (!hero) throw GameError.lang('hero.not_your_hero');
    await sql`delete from sys_hero_attribute where hid = ${hid}`.execute(db);
    const addAttribute = (attid: unknown, value: unknown) =>
      sql`insert into sys_hero_attribute (attid, hid, value) values (${attid}, ${hid}, ${value})
        on duplicate key update value = value + ${value}`.execute(db);

    const armors = await rows(sql`select * from sys_user_armor u
      left join sys_hero_armor h on h.hid = u.hid and h.sid = u.sid
      left join cfg_armor c on c.id = h.armorid
      where u.uid = ${uid} and u.hid = ${hid} and u.hp > 0`);

    const level = phpNum(hero.level);
    const command = level + phpNum(hero.command_base);
    const affairs = phpNum(hero.affairs_base) + phpNum(hero.affairs_add);
    let bravery = phpNum(hero.bravery_base) + phpNum(hero.bravery_add);
    let wisdom = phpNum(hero.wisdom_base) + phpNum(hero.wisdom_add);

    const add: Record<number, number> = {};
    for (const type of Object.values(AttrType)) add[type] = 0;
    /** The `if ($type == 1) $commandAdd += ...` chains; other types count for nothing. */
    const addByType = (type: unknown, value: unknown) => {
      const t = phpNum(type);
      if (t in add && phpLooseEquals(type, t)) add[t]! += phpNum(value);
    };
    /** "n,type,value,..." with n pairs, or nothing when the count does not match. */
    const pairs = (text: unknown): [string, string][] | null => {
      const parts = phpString(text).split(',');
      if (phpNum(parts[0]) * 2 + 1 !== parts.length) return null;
      const out: [string, string][] = [];
      for (let i = 1; i < parts.length; i += 2) out.push([parts[i]!, parts[i + 1]!]);
      return out;
    };

    for (const armor of armors) {
      if (!phpEmpty(armor.combine_level)) {
        const combined = await cell(sql`select attr from cfg_armor_level_attr
          where level = ${armor.combine_level}`);
        if (!phpEmpty(combined)) {
          for (const [type, value] of pairs(combined) ?? []) addByType(type, value);
        }
      }
      const attributes = pairs(armor.attribute);
      if (!attributes) continue;
      for (const [type, value] of attributes) addByType(type, value);

      const sorted = sortArmorAttr(attributes);
      const strongLevel = phpIntval(armor.strong_level);
      for (let i = 1; i <= strongLevel && sorted.length > 0; i++) {
        let strongValue = i <= 15 ? STRONG_LEVEL_VALUES[i]! : 0;
        while (strongValue > 0) {
          for (const type of sorted) {
            if (strongValue <= 0) break;
            addByType(type, 1);
            strongValue--;
          }
        }
      }

      if (!phpEmpty(armor.embed_pearls)) {
        for (const gid of phpString(armor.embed_pearls).split(',')) {
          if (phpLooseEquals(gid, 0)) continue;
          const pearl = (await rows(sql`select * from cfg_goods where gid = ${gid}`))[0];
          if (!pearl || phpLooseEquals(pearl.gid, 0)) continue;
          const attrs = phpString(pearl.attr).split(',');
          for (let i = 0; i < attrs.length; i += 2) addByType(attrs[i], attrs[i + 1]);
        }
      }

      const deify = (
        await rows(sql`select tda.*, ca.type from sys_user_tie_deify_attribute tda
          left join cfg_attribute ca on ca.attid = tda.attid where tda.sid = ${armor.sid}`)
      )[0];
      if (!deify) continue;
      await addAttribute(deify.attid, deify.value);
      addByType(deify.type, deify.value);
    }

    const ties = await rows(sql`select a.tieid from sys_hero_armor ha
      left join cfg_armor a on a.id = ha.armorid where hid = ${hid} group by tieid`);
    for (const { tieid } of ties) {
      if (phpLooseEquals(tieid, 0)) continue;
      const count = await cell(sql`select count(*) from sys_hero_armor ha
        left join cfg_armor a on a.id = ha.armorid left join sys_user_armor ua on ua.sid = ha.sid
        where ha.hid = ${hid} and a.tieid = ${tieid} and ua.hp > 0 and ua.uid = ${uid}`);
      const attrs = await rows(sql`select ta.*, ca.type from cfg_tie_attribute ta
        left join cfg_attribute ca on ca.attid = ta.attid
        where precond <= ${count} and tieid = ${tieid}`);
      for (const attr of attrs) {
        await addAttribute(attr.attid, attr.value);
        addByType(attr.type, attr.value);
      }
    }

    const armorAttributes = await rows(sql`select aa.*, ca.type from cfg_armor_attribute aa
      left join sys_user_armor ua on ua.armorid = aa.armorid
      left join cfg_attribute ca on ca.attid = aa.attid
      where ua.uid = ${uid} and ua.hid = ${hid} and ua.hp > 0`);
    for (const attr of armorAttributes) {
      await addAttribute(attr.attid, attr.value);
      addByType(attr.type, attr.value);
    }

    const percent = async (attid: number) => {
      const value = await cell(sql`select value from sys_hero_attribute
        where attid = ${attid} and hid = ${hid}`);
      return phpEmpty(value) ? 0 : phpNum(value);
    };
    add[AttrType.Command]! += Math.floor((command * (await percent(10001))) / 100);
    add[AttrType.Affairs]! += Math.floor((affairs * (await percent(10002))) / 100);
    add[AttrType.Bravery]! += Math.floor((bravery * (await percent(10003))) / 100);
    add[AttrType.Wisdom]! += Math.floor((wisdom * (await percent(10004))) / 100);
    add[AttrType.Attack]! += Math.floor((bravery * 10 * (await percent(10008))) / 100);
    add[AttrType.Defence]! += Math.floor((wisdom * 10 * (await percent(10009))) / 100);

    const hasBuffer = async (buftype: number) =>
      (
        await rows(sql`select * from mem_hero_buffer
          where hid = ${hid} and buftype = ${buftype} and endtime > unix_timestamp()`)
      ).length > 0;
    for (const [buftype, type, rate] of BUFFER_BONUSES) {
      if (!(await hasBuffer(buftype))) continue;
      const base =
        type === AttrType.Command
          ? command
          : type === AttrType.Affairs
            ? affairs
            : type === AttrType.Wisdom
              ? wisdom
              : bravery;
      add[type]! += (base * rate) / 100;
    }
    if (await hasBuffer(HeroBuffer.Bravery)) bravery = Math.floor(bravery * 1.25);
    if (await hasBuffer(HeroBuffer.Wisdom)) wisdom = Math.floor(wisdom * 1.25);

    const book = (
      await rows(sql`select * from sys_user_book u
        left join cfg_book c on u.bid = c.id and u.level = c.level
        where u.uid = ${uid} and u.hid = ${hid}`)
    )[0];
    const bookType = book ? BOOK_ATTRIBUTES[phpIntval(book.bid)] : undefined;
    if (book && bookType !== undefined) add[bookType]! += phpIntval(book.attr);

    if (await hasBuffer(HeroBuffer.Whip)) add[AttrType.Speed]! += 2;
    if (await hasBuffer(HeroBuffer.BloodWhip)) add[AttrType.Speed]! += 5;
    if (await this.checkHeroLevel(uid, 9, 80)) add[AttrType.Speed]! += 10;

    let forcemax = 100 + Math.floor(level / 5) + Math.floor(bravery / 3);
    let energymax = 100 + Math.floor(level / 5) + Math.floor(wisdom / 3);
    add[AttrType.Force]! += Math.floor((forcemax * (await percent(10005))) / 100);
    add[AttrType.Energy]! += Math.floor((energymax * (await percent(10006))) / 100);
    forcemax +=
      Math.floor((add[AttrType.Bravery]! + phpMod(bravery, 3)) / 3) + add[AttrType.Force]!;
    energymax +=
      Math.floor((add[AttrType.Wisdom]! + phpMod(wisdom, 3)) / 3) + add[AttrType.Energy]!;

    const spears = await cell(sql`select count(*) from sys_user_armor a, sys_hero_armor b
      where a.sid = b.sid and b.hid = ${hid} and b.armorid = ${GOLD_SPEAR} and a.active_special = 1`);
    if (phpNum(spears) >= 2) add[AttrType.Speed]! += 1;

    const addons = await rows(sql`select a.attid, a.value from sys_armor_addon a, sys_hero_armor b
      where a.sid = b.sid and b.hid = ${hid}`);
    for (const { attid, value } of addons) {
      await addAttribute(attid, value);
      if (phpLooseEquals(attid, 10008)) {
        add[AttrType.Attack] = phpIntval(add[AttrType.Attack]! * 0.01 * (100 + phpNum(value)));
      } else if (phpLooseEquals(attid, 10009)) {
        add[AttrType.Defence] = phpIntval(add[AttrType.Defence]! * 0.01 * (100 + phpNum(value)));
      } else if (phpLooseEquals(attid, AttrType.Speed)) {
        add[AttrType.Speed]! += phpNum(value);
      }
    }

    // Numbers as PHP printed them into the SQL; MySQL rounds fractions into the int columns.
    const v = (type: number) => phpFloat(add[type]!);
    await sql`update sys_city_hero set command_add_on = ${v(AttrType.Command)},
        affairs_add_on = ${v(AttrType.Affairs)}, bravery_add_on = ${v(AttrType.Bravery)},
        wisdom_add_on = ${v(AttrType.Wisdom)}, force_max_add_on = ${v(AttrType.Force)},
        energy_max_add_on = ${v(AttrType.Energy)}, speed_add_on = ${v(AttrType.Speed)},
        attack_add_on = ${v(AttrType.Attack)}, defence_add_on = ${v(AttrType.Defence)}
      where hid = ${hid}`.execute(db);
    const force = phpFloat(forcemax);
    const energy = phpFloat(energymax);
    await sql`update mem_hero_blood set force_max = ${force}, energy_max = ${energy},
        \`force\` = least(\`force\`, ${force}), energy = least(energy, ${energy})
      where hid = ${hid}`.execute(db);
  }

  /** HeroFunc.php::checkHeroLevel: the player's level and the lord hero's level both reached. */
  async checkHeroLevel(uid: number, userLevel: number, heroLevel: number): Promise<boolean> {
    const db = this.scope.db;
    const user = await sql<{ level: unknown }>`select level from sys_user_level
      where uid = ${uid}`.execute(db);
    const lord = await sql<{ level: unknown }>`select level from sys_city_hero
      where uid = ${uid} and herotype = ${LORD_HERO_TYPE}`.execute(db);
    return phpNum(lord.rows[0]?.level) >= heroLevel && phpNum(user.rows[0]?.level) >= userLevel;
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
