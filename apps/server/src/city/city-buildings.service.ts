import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Building, CityRules } from '../core/city-rules.service';
import { phpNum } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { DbScope } from '../db/database.module';
import { dbNow } from '../db/sql-fragments';
import { CityProductionService } from './city-production.service';

type Row = Record<string, unknown>;

/** sys_building.state */
export const BuildingState = { Normal: 0, Upgrading: 1, Destroying: 2 } as const;

/** sys_user.state once the 官府 reaches level 5 (leaves the newbie stage). */
const USER_STATE_NORMAL = 0;

/** Finished buildings and their side effects (utils.php). */
@Injectable()
export class CityBuildingsService {
  constructor(
    private readonly scope: DbScope,
    private readonly cityRules: CityRules,
    private readonly tasks: TaskRules,
    private readonly production: CityProductionService,
  ) {}

  /**
   * utils.php::getCityBuildingInfo: settles finished upgrades and demolitions, then lists the
   * city's buildings with their names, level descriptions and seconds left.
   */
  async buildingInfo(uid: number, cid: number): Promise<Row[]> {
    const db = this.scope.db;
    await this.finishUpgrades(uid, cid);
    await sql`update sys_building set state = 0, level = (level - 1)
      where state = 2 and cid = ${cid} and state_endtime <= unix_timestamp()`.execute(db);
    await sql`delete from mem_building_destroying
      where cid = ${cid} and state_endtime <= unix_timestamp()`.execute(db);
    await sql`delete from sys_building where cid = ${cid} and level = '0' and state = '0'`.execute(
      db,
    );
    const rows = (
      await sql<Row>`select b.*, c.name as bname, c.description as buildingDescription,
          l.description as level_description, l.using_people
        from cfg_building c, sys_building b
          left join cfg_building_level l on l.bid = b.bid and l.level = b.level
        where b.cid = ${cid} and c.bid = b.bid`.execute(db)
    ).rows;
    for (const row of rows) row.state_timeleft = phpNum(row.state_endtime) - (await dbNow(db));
    return rows;
  }

  /** utils.php::getBuildingTasks: levels up finished buildings and completes growth goals. */
  async finishUpgrades(uid: number, cid: number): Promise<void> {
    const db = this.scope.db;
    const done = (
      await sql<Row>`select * from sys_building
        where state = '1' and cid = ${cid} and state_endtime <= unix_timestamp()`.execute(db)
    ).rows;
    if (done.length === 0) return;
    // startChangeBuilding queues its field at the level it already has; the original levelled it
    // up all the same.
    const changed = new Set(
      (
        await sql<Row>`select b.id from sys_building b
          join mem_building_upgrading m on m.id = b.id and m.level = b.level
          where b.state = '1' and b.cid = ${cid} and b.state_endtime <= unix_timestamp()`.execute(
          db,
        )
      ).rows.map((row) => String(row.id)),
    );
    const levelUp = done.filter((b) => !changed.has(String(b.id)));
    if (levelUp.length > 0) {
      await sql`update sys_building set state = '0', level = (level + '1')
        where id in (${sql.join(levelUp.map((b) => b.id))})`.execute(db);
    }
    if (changed.size > 0) {
      await sql`update sys_building set state = '0'
        where id in (${sql.join([...changed])})`.execute(db);
    }
    await sql`delete from mem_building_upgrading
      where cid = ${cid} and state_endtime <= unix_timestamp()`.execute(db);
    for (const building of done) {
      const bid = phpNum(building.bid);
      if (bid < 5) await this.production.updateUsersCityResource(uid, cid);
      if (!changed.has(String(building.id))) {
        await this.onLevelUp(uid, cid, bid, phpNum(building.level) + 1);
      }
    }
  }

  private async onLevelUp(uid: number, cid: number, bid: number, level: number): Promise<void> {
    const db = this.scope.db;
    const complete = (goal: number) => this.tasks.completeTask(uid, goal);
    switch (bid) {
      case Building.Farmland:
        await complete(15);
        if (level >= 5) await complete(165);
        break;
      case Building.Wood:
        await complete(16);
        if (level > 1) {
          await complete(160);
          await complete(163);
        }
        break;
      case Building.Rock:
        await complete(17);
        if (level > 1) {
          await complete(75);
          await complete(137);
        }
        break;
      case Building.Iron:
        await complete(18);
        if (level > 1 && level < 4) await complete(level + 531);
        break;
      case Building.House: {
        await this.cityRules.updateCityPeopleMax(cid);
        await this.cityRules.updateCityPeopleStable(cid);
        await complete(1);
        if (level > 1) await complete(2);
        const row = await sql<{ v: number | null }>`select sum(level * (level + 1) * 50) as v
          from sys_building where cid = ${cid} and bid = ${Building.House}`.execute(db);
        const peopleMax = phpNum(row.rows[0]?.v);
        if (peopleMax >= 1000) await complete(3);
        if (peopleMax >= 10000) await complete(4);
        if (peopleMax >= 50000) await complete(5);
        break;
      }
      case Building.Government:
        await this.cityRules.updateCityGoldMax(cid);
        await complete(level + 25);
        if (level > 1) await complete(224);
        if (level == 4) await complete(226);
        if (level == 5) {
          await complete(363);
          await sql`update sys_user set state = ${USER_STATE_NORMAL} where uid = ${uid}`.execute(
            db,
          );
          await sql`replace into sys_user_task (uid, tid, state)
            select ${uid}, cfg_task.id, '0' from cfg_task
            where (cfg_task.id > 11000 and cfg_task.id < 15000)
              or (cfg_task.id > 10000 and cfg_task.id < 10500)`.execute(db);
        }
        if (level == 6) await complete(229);
        if (level == 8) await complete(232);
        if (level == 10) await complete(235);
        break;
      case Building.College:
        await complete(level + 35);
        await this.syncUserTechnics(uid);
        break;
      case Building.Ground:
        await complete(90);
        break;
      case Building.Army:
        await complete(level + 90);
        break;
      case Building.Hotel:
        await complete(82);
        break;
      case Building.Office:
        await complete(83);
        if (level > 1) await complete(102500);
        if (level > 2) await complete(2060359);
        break;
      case Building.Honglu:
        await complete(66);
        break;
      case Building.Market:
        await complete(22);
        break;
      case Building.Blacksmith:
        await complete(134);
        if (level >= 2) await complete(135);
        break;
      case Building.Workshop:
        await complete(136);
        break;
      case Building.Barn:
        await complete(166);
        break;
      case Building.Store:
        await complete(164);
        break;
      case Building.Dak:
        await complete(167);
        break;
      case Building.Balefire:
        await complete(level + 169);
        break;
      case Building.Wall:
        await complete(level + 137);
        break;
    }
  }

  /**
   * utils.php::checkUsersTechnic: caps every city's copy of the player's technics at what its
   * 书院 level allows (cfg_technic_condition rows on building 7).
   */
  async syncUserTechnics(uid: number): Promise<void> {
    const db = this.scope.db;
    const cities = (await sql<Row>`select cid from sys_city where uid = ${uid}`.execute(db)).rows;
    for (const city of cities) {
      const technics = (await sql<Row>`select * from sys_technic where uid = ${uid}`.execute(db))
        .rows;
      for (const technic of technics) {
        let minLevel = 10;
        const conditions = (
          await sql<Row>`select pre_id from cfg_technic_condition
            where tid = ${technic.tid} and pre_type = 0 and pre_id = ${Building.College}
            group by pre_id`.execute(db)
        ).rows;
        for (const condition of conditions) {
          const building = (
            await sql<Row>`select level from sys_building where cid = ${city.cid}
              and bid = ${condition.pre_id} order by level desc limit 1`.execute(db)
          ).rows[0];
          const allowed = (
            await sql<Row>`select level from cfg_technic_condition
              where tid = ${technic.tid} and pre_type = 0 and pre_id = ${condition.pre_id}
                and pre_level <= ${building ? String(building.level) : ''}
              order by level desc limit 1`.execute(db)
          ).rows[0];
          const own = (
            await sql<Row>`select level from sys_technic where tid = ${technic.tid}
              and uid = ${uid}`.execute(db)
          ).rows[0];
          const sysLevel = phpNum(own?.level);
          let level = phpNum(allowed?.level);
          if (!sysLevel) level = 0;
          minLevel = Math.min(minLevel, level, sysLevel);
          await sql`replace into sys_city_technic values (${city.cid}, ${technic.tid}, ${minLevel})`.execute(
            db,
          );
          minLevel = level;
        }
      }
    }
  }
}
