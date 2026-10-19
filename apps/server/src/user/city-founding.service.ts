import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { Building, CityRules, wid2cid } from '../core/city-rules.service';
import { HeroRules, LORD_HERO_TYPE } from '../core/hero-rules.service';
import { RandomService } from '../core/random.service';
import { DbScope } from '../db/database.module';
import { unixNow } from '../db/sql-fragments';

/** Provinces a new player may be placed in at random (the 13 inner provinces). */
const RANDOM_PROVINCES = 13;
/** New cities are placed within this many cells of an existing player city. */
const PLACEMENT_RANGE = 15;
/** sys_city.type of a player's main city. */
const CITY_TYPE_MAIN = 5;

/** UserFunc.php::doCreateCity */
@Injectable()
export class CityFoundingService {
  constructor(
    private readonly scope: DbScope,
    private readonly random: RandomService,
    private readonly cities: CityRules,
    private readonly heroes: HeroRules,
  ) {}

  /**
   * Founds the player's city on a free flat tile of `requestedProvince` (0 = random), near
   * other players. `useBackup` restores the buildings saved when the previous city fell.
   *
   * Returns null without founding anything when a random province had to be re-rolled:
   * the original only founded on the first roll's branch, and callers store 0 as lastcid.
   */
  async found(
    uid: number,
    cityName: string,
    requestedProvince: number,
    useBackup: boolean,
  ): Promise<number | null> {
    if (cityName.indexOf("'") > 0) throw GameError.lang('changeCityName.name_illegal');

    let province =
      requestedProvince === 0 ? this.random.mtRand(1, RANDOM_PROVINCES) : requestedProvince;
    let freeTiles = await this.countFreeTiles(province);
    if (freeTiles === 0) {
      if (requestedProvince === 0) {
        for (let tries = 0; tries < 10 && freeTiles === 0; tries++) {
          province = this.random.mtRand(1, RANDOM_PROVINCES);
          freeTiles = await this.countFreeTiles(province);
        }
      }
      if (freeTiles === 0) throw GameError.lang('doCreateCity.province_is_full');
      return null;
    }

    const wid = await this.pickTile(province);
    const cid = wid2cid(wid);
    const db = this.scope.db;
    if (await db.selectFrom('sys_city').select('cid').where('cid', '=', cid).executeTakeFirst()) {
      throw GameError.lang('doCreateCity.reType_city_name');
    }
    if (
      await db
        .selectFrom('sys_city')
        .select('cid')
        .where('uid', '=', uid)
        .limit(1)
        .executeTakeFirst()
    ) {
      throw GameError.lang('createRole.cant_duplicate_create');
    }

    await this.clearTile(cid);
    await db
      .updateTable('mem_world')
      .set({ ownercid: cid, type: 0 })
      .where('wid', '=', wid)
      .execute();
    await sql`replace into sys_city (cid, uid, name, type, state, province)
      values (${cid}, ${uid}, ${cityName}, 0, 2, ${province})`.execute(db);
    await this.buildInitialBuildings(uid, cid, useBackup);
    await sql`replace into sys_city_res_add (cid, food_rate, wood_rate, rock_rate, iron_rate, chief_add)
      values (${cid}, 80, 80, 80, 80, 0)`.execute(db);
    await sql`replace into mem_city_resource (cid, people, food, wood, rock, iron, gold,
        food_max, wood_max, rock_max, iron_max, gold_max, food_add, wood_add, rock_add, iron_add, lastupdate)
      values (${cid}, 50, 5000, 5000, 5000, 5000, 5000,
        10000, 10000, 10000, 10000, 1000000, 100, 100, 100, 100, ${unixNow()})`.execute(db);
    // Next random good/bad city events: midnight (UTC+8) after today, plus rand() days.
    await sql`replace into mem_city_schedule (cid, create_time, next_good_event, next_bad_event)
      values (${cid}, unix_timestamp(),
        unix_timestamp() - (unix_timestamp() + 8 * 3600) % 86400 + 86400 + 86400 * rand(),
        unix_timestamp() - (unix_timestamp() + 8 * 3600) % 86400 + 86400 + 86400 * rand())`.execute(
      db,
    );
    await sql`insert into mem_user_schedule (uid, start_new_protect) values (${uid}, unix_timestamp())
      on duplicate key update start_new_protect = unix_timestamp()`.execute(db);

    if (useBackup) {
      await this.cities.updateCityResourceAdd(cid);
      await this.cities.updateCityPeopleMax(cid);
      await this.cities.updateCityGoldMax(cid);
    }
    await this.ensureLordHero(uid, cid);
    await db.updateTable('sys_city').set({ type: CITY_TYPE_MAIN }).where('cid', '=', cid).execute();
    return cid;
  }

  private async countFreeTiles(province: number): Promise<number> {
    const row = await this.scope.db
      .selectFrom('mem_world')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('type', '=', 1)
      .where('ownercid', '=', 0)
      .where('province', '=', province)
      .where('state', '=', 0)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  /** A random free flat tile in one of the 10x10 blocks around a random player city. */
  private async pickTile(province: number): Promise<number> {
    const db = this.scope.db;
    const anchor = await sql<{ cid: number }>`select cid from sys_city
      where uid > 897 and province = ${province} order by rand() limit 1`.execute(db);
    let targetCid = anchor.rows[0]?.cid ?? 0;
    if (!targetCid) {
      let tile = await sql<{ wid: number }>`select wid from mem_world
        where type = 0 and province = ${province} order by rand() limit 1`.execute(db);
      if (!tile.rows[0]?.wid) {
        tile = await sql<{ wid: number }>`select wid from mem_world
          where province = ${province} order by rand() limit 1`.execute(db);
      }
      targetCid = wid2cid(tile.rows[0]?.wid);
    }
    const y = Math.floor(targetCid / 1000);
    const x = Math.floor(targetCid - y * 1000);
    const blocks: number[] = [];
    for (
      let by = Math.floor((y - PLACEMENT_RANGE) / 10);
      by <= Math.floor((y + PLACEMENT_RANGE) / 10);
      by++
    ) {
      for (
        let bx = Math.floor((x - PLACEMENT_RANGE) / 10);
        bx <= Math.floor((x + PLACEMENT_RANGE) / 10);
        bx++
      ) {
        blocks.push((by * 100 + bx) * 100);
      }
    }
    for (let tries = 0; tries < 15; tries++) {
      const minWid = blocks[this.random.mtRand(0, blocks.length - 1)]!;
      const found = await sql<{ wid: number }>`select wid from mem_world
        where type = 1 and province = ${province} and ownercid = 0 and state = 0
          and wid > ${minWid} and wid < ${minWid + 100} order by rand() limit 1`.execute(db);
      const wid = found.rows[0]?.wid;
      if (wid) return wid;
    }
    throw GameError.lang('doCreateCity.reType_city_name');
  }

  /** Moves NPC heroes off the tile and drops NPC troops and leftover wounded/deserters/captives. */
  private async clearTile(cid: number): Promise<void> {
    const db = this.scope.db;
    const heroes = await db
      .selectFrom('sys_city_hero')
      .select('hid')
      .where('uid', '=', 0)
      .where('cid', '=', cid)
      .execute();
    for (const hero of heroes) await this.heroes.throwHeroToField(hero);
    await db
      .deleteFrom('sys_troops')
      .where('uid', '=', 0)
      .where('state', '=', 4)
      .where('cid', '=', cid)
      .execute();
    await db.deleteFrom('mem_city_wounded').where('cid', '=', cid).execute();
    await db.deleteFrom('mem_city_lamster').where('cid', '=', cid).execute();
    await db.deleteFrom('mem_city_captive').where('cid', '=', cid).execute();
  }

  /** A level-1 官府 at position 120, or the backed-up buildings of the player's fallen city. */
  private async buildInitialBuildings(uid: number, cid: number, useBackup: boolean): Promise<void> {
    const db = this.scope.db;
    const government = sql`replace into sys_building (cid, xy, bid, level)
      values (${cid}, 120, ${Building.Government}, 1)`;
    if (useBackup) {
      await sql`replace into sys_building (cid, xy, bid, level)
        (select ${cid}, xy, bid, level from sys_building_backup where uid = ${uid})`.execute(db);
      const count = await db
        .selectFrom('sys_building')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('cid', '=', cid)
        .executeTakeFirstOrThrow();
      if (!Number(count.n)) await government.execute(db);
    } else {
      await db.deleteFrom('sys_building').where('cid', '=', cid).execute();
      await government.execute(db);
    }
  }

  /** Keeps exactly one lord hero, creating it in the new city if missing. */
  private async ensureLordHero(uid: number, cid: number): Promise<void> {
    const db = this.scope.db;
    await this.heroes.demoteDuplicateLord(uid);
    const lord = await db
      .selectFrom('sys_city_hero')
      .select('hid')
      .where('uid', '=', uid)
      .where('herotype', '=', LORD_HERO_TYPE)
      .executeTakeFirst();
    if (lord) return;
    const inserted = await sql`insert into sys_city_hero (uid, name, sex, face, cid, state, level,
        command_base, affairs_base, bravery_base, wisdom_base, loyalty, herotype)
      select uid, name, sex, face, ${cid}, 0, 1, 50, 1, 1, 1, 100, ${LORD_HERO_TYPE}
      from sys_user where uid = ${uid}`.execute(db);
    const hid = Number(inserted.insertId);
    await sql`insert into mem_hero_blood (hid, \`force\`, force_max, energy, energy_max)
      values (${hid}, 150, 150, 150, 150)`.execute(db);
  }
}
