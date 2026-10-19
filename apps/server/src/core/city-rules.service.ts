import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DbScope } from '../db/database.module';
import { cellOf } from '../db/sql-fragments';
import { phpIntval } from './php';

/** Building ids (common.php ID_BUILDING_*). */
export const Building = {
  House: 5,
  Government: 6,
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
