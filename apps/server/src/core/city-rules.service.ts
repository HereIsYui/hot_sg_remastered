import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DbScope } from '../db/database.module';
import { cellOf } from '../db/sql-fragments';
import { phpFloatString, phpIntval, phpNum, phpString } from './php';

/** Building ids (common.php ID_BUILDING_*). */
export const Building = {
  Farmland: 1,
  Wood: 2,
  Rock: 3,
  Iron: 4,
  House: 5,
  Government: 6,
  College: 7,
  Ground: 8,
  Army: 9,
  Hotel: 10,
  Office: 11,
  Honglu: 12,
  Market: 13,
  Blacksmith: 14,
  Workshop: 15,
  Barn: 16,
  Store: 17,
  Dak: 18,
  Balefire: 19,
  Wall: 20,
} as const;

/**
 * utils.php::wid2cid. A world id packs 10x10 blocks as `YYXXyx` (block row/column, then the
 * cell inside the block); a city id is `y * 1000 + x`.
 */
export function wid2cid(wid: unknown): number {
  const w = phpIntval(wid);
  const y = Math.floor(w / 10000) * 10 + Math.floor((w % 100) / 10);
  const x = Math.floor((w % 10000) / 100) * 10 + Math.floor(w % 10);
  return y * 1000 + x;
}

/** utils.php::cid2wid */
export function cid2wid(cid: number): number {
  const y = Math.floor(cid / 1000);
  const x = cid % 1000;
  return Math.floor(y / 10) * 10000 + Math.floor(x / 10) * 100 + (y % 10) * 10 + (x % 10);
}

/** gold_max for 官府 levels above 10 (below that it is level*(level+1)*500000). */
const GOLD_MAX_BY_LEVEL: Record<number, number> = {
  11: 66_000_000,
  12: 78_000_000,
  13: 91_000_000,
  14: 105_000_000,
  15: 120_000_000,
};

/** City resource bookkeeping from utils.php. */
@Injectable()
export class CityRules {
  constructor(private readonly scope: DbScope) {}

  /** utils.php::updateCityResourceAdd: flags the owning city for production recalculation. */
  async updateCityResourceAdd(cid: number): Promise<void> {
    const db = this.scope.db;
    const world = await db
      .selectFrom('mem_world')
      .select('ownercid')
      .where('wid', '=', cid2wid(cid))
      .executeTakeFirst();
    const ownercid = phpIntval(cellOf(world, 'ownercid')) || cid;
    if (!ownercid) return;
    await db
      .updateTable('sys_city_res_add')
      .set({ resource_changing: 1 })
      .where('cid', '=', ownercid)
      .execute();
  }

  /** utils.php::addCityResources: negative amounts spend. */
  async addCityResources(
    cid: number,
    wood: number,
    rock: number,
    iron: number,
    food: number,
    gold: number,
  ): Promise<void> {
    const [w, r, i, f, g] = [wood, rock, iron, food, gold].map(phpFloatString);
    await sql`update mem_city_resource set wood = wood + ${w}, rock = rock + ${r},
      iron = iron + ${i}, food = food + ${f}, gold = gold + ${g} where cid = ${cid}`.execute(
      this.scope.db,
    );
  }

  /** utils.php::checkCityResource */
  async checkCityResource(
    cid: number,
    wood: unknown,
    rock: unknown,
    iron: unknown,
    food: unknown,
    gold: unknown,
  ): Promise<boolean> {
    const res = (
      await sql<Record<string, unknown>>`select * from mem_city_resource
        where cid = ${cid}`.execute(this.scope.db)
    ).rows[0];
    if (!res) return false;
    const short = (have: unknown, want: unknown) => phpNum(have) < phpNum(want);
    return !(
      short(res.wood, wood) ||
      short(res.rock, rock) ||
      short(res.iron, iron) ||
      short(res.food, food) ||
      short(res.gold, gold)
    );
  }

  /** utils.php::getCityPeopleFreeCount: people neither working nor building. */
  async cityPeopleFree(cid: number): Promise<unknown> {
    const row = (
      await sql<{ free: unknown }>`select people - people_working - people_building as free
        from mem_city_resource where cid = ${cid}`.execute(this.scope.db)
    ).rows[0];
    return row ? row.free : false;
  }

  /** utils.php::addCityPeople */
  async addCityPeople(cid: number, count: number): Promise<void> {
    await sql`update mem_city_resource set people = people + ${phpFloatString(count)}
      where cid = ${cid}`.execute(this.scope.db);
  }

  /** utils.php::addCitySoldier: also logged as type 9 in log_city_soldier. */
  async addCitySoldier(cid: number, sid: number, count: number): Promise<void> {
    const db = this.scope.db;
    const n = phpFloatString(count);
    await sql`insert into sys_city_soldier (cid, sid, count) values (${cid}, ${sid}, ${n})
      on duplicate key update count = count + ${n}`.execute(db);
    await sql`insert into log_city_soldier (cid, sid, uid, count, type)
      values (${cid}, ${sid}, 0, ${n}, 9)
      on duplicate key update count = count + ${n}`.execute(db);
    await this.updateCityResourceAdd(cid);
  }

  /** utils.php::addCitySoldiers: adds (or with `add` false, takes) several soldier types. */
  async addCitySoldiers(cid: number, soldiers: Map<number, number>, add: boolean): Promise<void> {
    const db = this.scope.db;
    for (const [sid, count] of soldiers) {
      const n = phpFloatString(count);
      if (add) {
        await sql`insert into sys_city_soldier (cid, sid, count) values (${cid}, ${sid}, ${n})
          on duplicate key update count = count + ${n}`.execute(db);
      } else {
        await sql`insert into sys_city_soldier (cid, sid, count) values (${cid}, ${sid}, ${`-${n}`})
          on duplicate key update count = count - ${n}`.execute(db);
      }
    }
    await this.updateCityResourceAdd(cid);
  }

  /**
   * cfg_js.php::getNamePosition: `名称（x,y）`, the name being a wild field's terrain for type 0,
   * a battlefield city for type 4 (as ` 战场【名称】`), otherwise the city's.
   */
  async getNamePosition(cid: number, type: number): Promise<string> {
    const db = this.scope.db;
    const cell = async (query: ReturnType<typeof sql<{ name: unknown }>>) =>
      phpString((await query.execute(db)).rows[0]?.name);
    if (type === 4 && cid > 1000000) {
      const name = await cell(sql`select name from sys_battle_city where cid = ${cid}`);
      return ` 战场【${name}】`;
    }
    const name =
      type === 0
        ? await cell(sql`select c.name from mem_world m left join cfg_world_type c
            on c.type = m.type where m.wid = ${cid2wid(cid)}`)
        : await cell(sql`select name from sys_city where cid = ${cid}`);
    return `${name}（${cid % 1000},${Math.floor(cid / 1000)}）`;
  }

  /**
   * utils.php::refreshFoodArmyUsers: food eaten by the city's soldiers, plus twice that of the
   * troops stationed on its last owned field (the original keeps only the last field's cid).
   */
  async refreshFoodArmyUsers(cid: number): Promise<void> {
    const db = this.scope.db;
    const cell = async (query: ReturnType<typeof sql<{ v: unknown }>>) =>
      phpNum((await query.execute(db)).rows[0]?.v);
    let use = 0;
    const fields = (
      await sql<{ wid: number }>`select wid from mem_world where ownercid = ${cid}`.execute(db)
    ).rows;
    const last = fields.at(-1);
    if (last) {
      use = await cell(sql<{ v: unknown }>`select sum(fooduse) * 2 as v from sys_troops
        where targetcid in (${wid2cid(last.wid)}) and state in (2, 3, 4, 5, 6) and uid > 1000`);
    }
    use += await cell(sql<{ v: unknown }>`select sum(c.food_use * s.count) as v
      from sys_city_soldier s, cfg_soldier c where s.cid = ${cid} and s.sid = c.sid`);
    use *= 2 / 3;
    await sql`update mem_city_resource set food_army_use = ${phpFloatString(use)}
      where cid = ${cid}`.execute(db);
  }

  /** utils.php::updateCityPeopleStable: people_max * morale%. */
  async updateCityPeopleStable(cid: number): Promise<void> {
    await sql`update mem_city_resource
      set people_stable = people_max * morale * 0.01 where cid = ${cid}`.execute(this.scope.db);
  }

  /** utils.php::updateCityPeopleMax: each 民房 of level N holds N*(N+1)*50 people. */
  async updateCityPeopleMax(cid: number): Promise<void> {
    const db = this.scope.db;
    const row = await sql<{ v: number | null }>`
      select sum(level * (level + 1) * 50) as v from sys_building
      where cid = ${cid} and bid = ${Building.House}`.execute(db);
    const peopleMax = Number(row.rows[0]?.v ?? 0);
    await db
      .updateTable('mem_city_resource')
      .set({ people_max: peopleMax })
      .where('cid', '=', cid)
      .execute();
    await this.updateCityPeopleStable(cid);
  }

  /** utils.php::updateCityGoldMax */
  async updateCityGoldMax(cid: number): Promise<void> {
    const db = this.scope.db;
    const building = await db
      .selectFrom('sys_building')
      .select('level')
      .where('cid', '=', cid)
      .where('bid', '=', Building.Government)
      .executeTakeFirst();
    const level = phpIntval(cellOf(building, 'level'));
    const goldMax = GOLD_MAX_BY_LEVEL[level] ?? level * (level + 1) * 500000;
    await db
      .updateTable('mem_city_resource')
      .set({ gold_max: goldMax })
      .where('cid', '=', cid)
      .execute();
  }
}
