import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { LangService } from '../common/lang.service';
import { Building, cid2wid } from '../core/city-rules.service';
import { OwnershipService } from '../core/ownership.service';
import { phpEmpty, phpFloat, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { DbScope } from '../db/database.module';
import type { TechnicCondition } from './technic-rules.service';

type Row = Record<string, unknown>;

/** cfg_defence_condition.pre_type */
export const DefencePreType = { Building: 0, Technic: 1 } as const;

/** interface.php::WallDefenceState: a defence type as the 城墙 lists it. */
export interface WallDefenceState {
  _explicitType: 'WallDefenceState';
  did: unknown;
  dname: unknown;
  count: unknown;
  description: unknown;
  hp: unknown;
  ap: unknown;
  dp: unknown;
  range: unknown;
  speed: unknown;
  carry: unknown;
  can_reinforce: boolean;
  woodNeed: unknown;
  rockNeed: unknown;
  ironNeed: unknown;
  foodNeed: unknown;
  goldNeed: unknown;
  areaNeed: unknown;
  reinforce_time: number;
  conditions: TechnicCondition[];
}

/** interface.php::WallReinforceState: one entry of the 城墙's build queue. */
export interface WallReinforceState {
  _explicitType: 'WallReinforceState';
  qid: unknown;
  did: unknown;
  dname: unknown;
  count: unknown;
  state: unknown;
  time_left: unknown;
  accmark: unknown;
}

/** mem_world.state of a city on the map, whose sys_city_area also takes wall space. */
const WORLD_STATE_CITY = 1;

/** Build speed, the 城墙 lists and the wall space of DefenceFunc.php and utils.php. */
@Injectable()
export class DefenceRules {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly ownership: OwnershipService,
  ) {}

  private async rows(query: ReturnType<typeof sql<Row>>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows;
  }

  private async one(query: ReturnType<typeof sql<Row>>): Promise<Row | false> {
    return (await this.rows(query))[0] ?? false;
  }

  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = await this.one(query);
    return row === false ? false : Object.values(row)[0];
  }

  /**
   * DefenceFunc.php::getDefenceSpeedRate: 建筑技术, the 城守's 内政 (×1.25 with 文曲星符) and
   * the 城守's 城防加固 book.
   */
  async speedRate(cid: number): Promise<number> {
    let speedAdd = 0;
    const techLevel = await this.cell(
      sql<Row>`select level from sys_city_technic where cid = ${cid} and tid = 17`,
    );
    if (!phpEmpty(techLevel)) speedAdd += 10 * phpNum(techLevel);
    const chiefhid = await this.cell(sql<Row>`select chiefhid from sys_city where cid = ${cid}`);
    let skillRate = 0;
    if (phpNum(chiefhid) > 0) {
      const chief = await this.one(sql<Row>`select * from sys_city_hero where hid = ${chiefhid}`);
      if (chief) {
        const buffered = await this.one(
          sql<Row>`select * from mem_hero_buffer where hid = ${chiefhid} and buftype = 2`,
        );
        const bufadd = buffered ? 1.25 : 1.0;
        speedAdd += (phpNum(chief.affairs_base) + phpNum(chief.affairs_add)) * bufadd;
      }
      const attr = await this.cell(sql<Row>`select b.attr from sys_user_book a, cfg_book b
        where a.bid = b.id and a.level = b.level and a.bid = 17 and a.hid = ${chiefhid}`);
      skillRate = phpNum(phpEmpty(attr) ? 0 : attr) * 0.01;
    }
    return (1.0 / (1.0 + 0.01 * speedAdd)) * (1 - skillRate);
  }

  async conditionRows(did: number): Promise<Row[]> {
    return this.rows(
      sql<Row>`select * from cfg_defence_condition where did = ${did} order by pre_type`,
    );
  }

  /** A condition's current level: the city's best building, or the lord's technic. */
  async conditionCurrent(uid: number, cid: number, condition: Row): Promise<unknown> {
    if (phpLooseEquals(condition.pre_type, DefencePreType.Building)) {
      return this.cell(sql<Row>`select max(level) from sys_building
        where cid = ${cid} and bid = ${condition.pre_id}`);
    }
    return this.cell(sql<Row>`select max(level) from sys_technic
      where uid = ${uid} and tid = ${condition.pre_id}`);
  }

  /** DefenceFunc.php::doGetDefenceInfo: every defence type with the city's count of each. */
  async defenceInfo(uid: number, cid: number): Promise<WallDefenceState[]> {
    await this.ownership.checkCityExist(cid, uid);
    const defences = await this.rows(sql<Row>`select d.*, c.count from cfg_defence d
      left join sys_city_defence c on c.cid = ${cid} and c.did = d.did order by d.did`);
    const speedAdd = await this.speedRate(cid);
    const levelText = this.lang.t('doGetDefenceInfo.level');
    const ret: WallDefenceState[] = [];
    for (const defence of defences) {
      const state: WallDefenceState = {
        _explicitType: 'WallDefenceState',
        did: defence.did,
        dname: defence.name,
        count: phpEmpty(defence.count) ? 0 : defence.count,
        description: defence.description,
        hp: defence.hp,
        ap: defence.ap,
        dp: defence.dp,
        range: defence.range,
        speed: defence.speed,
        carry: defence.carry,
        can_reinforce: true,
        woodNeed: defence.wood_need,
        rockNeed: defence.rock_need,
        ironNeed: defence.iron_need,
        foodNeed: defence.food_need,
        goldNeed: defence.gold_need,
        areaNeed: defence.area_need,
        reinforce_time: phpFloat(Math.max(1, phpNum(defence.time_need) * speedAdd)),
        conditions: [],
      };
      for (const condition of await this.conditionRows(phpIntval(defence.did))) {
        const cond: TechnicCondition = {
          _explicitType: 'UpgradeCondition',
          type: null,
          upgradeNeed: null,
          currentOwn: null,
          canUpgrade: null,
        };
        const isBuilding = phpLooseEquals(condition.pre_type, DefencePreType.Building);
        if (isBuilding || phpLooseEquals(condition.pre_type, DefencePreType.Technic)) {
          const current = await this.conditionCurrent(uid, cid, condition);
          cond.type = this.lang.t(
            `doGetDefenceInfo.${isBuilding ? 'pre_building' : 'pre_technic'}`,
          );
          cond.canUpgrade = !(phpEmpty(current) || phpNum(current) < phpNum(condition.pre_level));
          if (!cond.canUpgrade) state.can_reinforce = false;
          const name = isBuilding
            ? await this.cell(
                sql<Row>`select name from cfg_building where bid = ${condition.pre_id}`,
              )
            : await this.cell(
                sql<Row>`select name from cfg_technic where tid = ${condition.pre_id}`,
              );
          cond.upgradeNeed = `${phpString(name)}(${levelText}${phpString(condition.pre_level)})`;
          cond.currentOwn = `${levelText}${phpEmpty(current) ? 0 : phpString(current)}`;
        }
        state.conditions.push(cond);
      }
      ret.push(state);
    }
    return ret;
  }

  /** DefenceFunc.php::doGetReinforceQueue: the entry being built first, then by queue time. */
  async reinforceQueue(cid: number): Promise<WallReinforceState[]> {
    const queues = await this.rows(sql<Row>`select r.*, d.name as dname,
        unix_timestamp() as nowtime
      from sys_city_reinforcequeue r left join cfg_defence d on d.did = r.did
      where r.cid = ${cid} order by r.state desc, r.queuetime, r.id`);
    return queues.map((queue) => {
      let timeLeft: unknown = queue.needtime;
      if (phpLooseEquals(queue.state, 1)) {
        const left = phpNum(queue.state_starttime) + phpNum(timeLeft) - phpNum(queue.nowtime);
        timeLeft = left === 0 ? 1 : left;
      }
      return {
        _explicitType: 'WallReinforceState',
        qid: queue.id,
        did: queue.did,
        dname: queue.dname,
        count: queue.count,
        state: queue.state,
        time_left: timeLeft,
        accmark: queue.accmark,
      };
    });
  }

  /** utils.php::getCityArea: the wall's capacity at its level, 0 without a wall. */
  async cityArea(cid: number): Promise<unknown> {
    const level = await this.cell(
      sql<Row>`select level from sys_building where cid = ${cid} and bid = ${Building.Wall}`,
    );
    if (phpEmpty(level)) return 0;
    return this.cell(sql<Row>`select area from cfg_wall where level = ${level}`);
  }

  /** utils.php::getCityAreaOccupied: built and queued defences, plus sys_city_area on the map. */
  async cityAreaOccupied(cid: number): Promise<number> {
    let curr = phpNum(
      await this.cell(sql<Row>`select sum(c.count * d.area_need) from sys_city_defence c,
        cfg_defence d where c.did = d.did and c.cid = ${cid}`),
    );
    const reinforcing = phpNum(
      await this.cell(sql<Row>`select sum(c.count * d.area_need) from sys_city_reinforcequeue c,
        cfg_defence d where c.did = d.did and c.cid = ${cid}`),
    );
    const state = phpIntval(
      await this.cell(sql<Row>`select state from mem_world where wid = ${cid2wid(cid)}`),
    );
    if (state === WORLD_STATE_CITY) {
      curr += phpIntval(
        await this.cell(sql<Row>`select area from sys_city_area where cid = ${cid}`),
      );
    }
    return curr + reinforcing;
  }

  /** utils.php::addCityDefence */
  async addCityDefence(cid: unknown, did: unknown, count: number): Promise<void> {
    await sql`insert into sys_city_defence (cid, did, count) values (${cid}, ${did}, ${count})
      on duplicate key update count = count + ${count}`.execute(this.scope.db);
  }
}
