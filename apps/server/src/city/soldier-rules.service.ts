import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { LangService } from '../common/lang.service';
import { Building, cid2wid } from '../core/city-rules.service';
import { OwnershipService } from '../core/ownership.service';
import { phpEmpty, phpFloat, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { DbScope } from '../db/database.module';
import type { TechnicCondition } from './technic-rules.service';

type Row = Record<string, unknown>;

/** cfg_soldier_condition.pre_type */
export const SoldierPreType = { Building: 0, Technic: 1 } as const;

/** 地理优势 soldiers, drafted only in their special cities. */
export function isSpecialSoldier(sid: number): boolean {
  return sid >= 45 && sid <= 50;
}

/** interface.php::ArmySoldierState: a soldier type as the 兵营 lists it. */
export interface ArmySoldierState {
  _explicitType: 'ArmySoldierState';
  sid: unknown;
  sname: unknown;
  count: unknown;
  description: unknown;
  hp: unknown;
  ap: unknown;
  dp: unknown;
  range: unknown;
  speed: unknown;
  carry: unknown;
  can_draft: boolean;
  food_use: unknown;
  woodNeed: unknown;
  rockNeed: unknown;
  ironNeed: unknown;
  foodNeed: unknown;
  goldNeed: unknown;
  peopleNeed: unknown;
  draft_time: number;
  conditions: TechnicCondition[] | null;
}

/** interface.php::ArmyDraftState: one entry of a 兵营's draft queue. */
export interface ArmyDraftState {
  _explicitType: 'ArmyDraftState';
  qid: unknown;
  sid: unknown;
  sname: unknown;
  count: unknown;
  state: unknown;
  time_left: unknown;
  accmark: unknown;
}

/** Draft speed and the 兵营 lists of SoldierFunc.php. */
@Injectable()
export class SoldierRules {
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
   * SoldierFunc.php::getSoldierSpeedRate: 制造技术 for siege engines or 练兵技巧 for soldiers,
   * the 勇武 of the 城守, else the 主将, else the 军师 (×1.25 with 武曲星符), the 城守's 招兵买马
   * book and the 司隶 discount; `speedfactor` is the double-cost rush.
   */
  async speedRate(cid: number, sid: number, speedfactor = 0): Promise<number> {
    let speedAdd = 0;
    const tid = sid >= 9 && sid <= 12 ? 5 : sid <= 8 || isSpecialSoldier(sid) ? 8 : 0;
    if (tid) {
      const level = await this.cell(
        sql<Row>`select level from sys_city_technic where cid = ${cid} and tid = ${tid}`,
      );
      if (!phpEmpty(level)) speedAdd += 10 * phpNum(level);
    }
    const city = await this.one(
      sql<Row>`select chiefhid, generalid, counsellorid from sys_city where cid = ${cid}`,
    );
    let hid = 0;
    if (city) {
      if (phpNum(city.generalid) > 0) hid = phpIntval(city.generalid);
      else if (phpNum(city.chiefhid) > 0) hid = phpIntval(city.chiefhid);
      else if (phpNum(city.counsellorid) > 0) hid = phpIntval(city.counsellorid);
    }
    if (hid > 0) {
      const hero = await this.one(sql<Row>`select * from sys_city_hero where hid = ${hid}`);
      if (hero) {
        const buffered = await this.one(
          sql<Row>`select * from mem_hero_buffer where hid = ${hid} and buftype = 3`,
        );
        const bufadd = buffered ? 1.25 : 1.0;
        speedAdd +=
          (phpNum(hero.bravery_base) + phpNum(hero.bravery_add)) * bufadd +
          phpNum(hero.bravery_add_on);
      }
    }
    let skillRate = 0;
    const general = await this.cell(sql<Row>`select generalid from sys_city where cid = ${cid}`);
    if (!phpEmpty(general)) {
      const attr = await this.cell(sql<Row>`select b.attr from sys_user_book a, cfg_book b
        where a.bid = b.id and a.level = b.level and a.bid = 18 and a.hid = ${general}`);
      skillRate = phpNum(phpEmpty(attr) ? 0 : attr) * 0.01;
    }
    let finalSpeed = 1 / (1.0 + 0.01 * speedAdd + speedfactor);
    finalSpeed *= 1 - skillRate;
    const siliOn = await this.cell(sql<Row>`select value from mem_state where state = 198`);
    if (phpLooseEquals(siliOn, 1)) {
      const province = await this.cell(
        sql<Row>`select province from mem_world where wid = ${cid2wid(cid)}`,
      );
      if (phpLooseEquals(province, 1)) finalSpeed *= 0.7;
    }
    return finalSpeed;
  }

  /** The draftable soldiers (fromcity = 1) with the city's count of each. */
  private async citySoldiers(cid: number): Promise<Row[]> {
    return this.rows(sql<Row>`select s.*, c.count from cfg_soldier s
      left join sys_city_soldier c on c.cid = ${cid} and c.sid = s.sid
      where s.fromcity = 1 order by s.sid`);
  }

  async conditionRows(sid: number): Promise<Row[]> {
    return this.rows(
      sql<Row>`select * from cfg_soldier_condition where sid = ${sid} order by pre_type`,
    );
  }

  /** A condition's current level: the 兵营 at `xy` itself, else the best building / technic. */
  async conditionCurrent(uid: number, cid: number, xy: number, condition: Row): Promise<unknown> {
    if (phpLooseEquals(condition.pre_type, SoldierPreType.Building)) {
      if (phpLooseEquals(condition.pre_id, Building.Army)) {
        return this.cell(sql<Row>`select level from sys_building
          where cid = ${cid} and bid = ${condition.pre_id} and xy = ${xy}`);
      }
      return this.cell(sql<Row>`select max(level) from sys_building
        where cid = ${cid} and bid = ${condition.pre_id}`);
    }
    return this.cell(sql<Row>`select max(level) from sys_technic
      where uid = ${uid} and tid = ${condition.pre_id}`);
  }

  async isSpecialSoldierCity(cid: number, sid: number): Promise<boolean> {
    return !!(await this.one(sql<Row>`select * from cfg_soldier_special_city
      where cid = ${cid} and sid = ${sid} limit 1`));
  }

  /** utils.php::getSpacialSoldierId: the special soldier of a city, 0 for none. */
  async specialSoldierId(cid: number): Promise<unknown> {
    const sid = await this.cell(sql<Row>`select sid from cfg_soldier_special_city
      where cid = ${cid} and type <> '4'`);
    return phpEmpty(sid) ? 0 : sid;
  }

  /** SoldierFunc.php::doGetSoldierInfo: every draftable soldier of the 兵营 at `xy`. */
  async soldierInfo(uid: number, cid: number, xy: number): Promise<ArmySoldierState[]> {
    await this.ownership.checkCityExist(cid, uid);
    const levelText = this.lang.t('doGetSoldierInfo.level');
    const ret: ArmySoldierState[] = [];
    for (const soldier of await this.citySoldiers(cid)) {
      const sid = phpIntval(soldier.sid);
      const speedRate = await this.speedRate(cid, sid);
      const state = this.soldierState(soldier);
      state.draft_time = Math.max(1, Math.floor(phpNum(soldier.time_need) * speedRate));
      state.conditions = [];
      for (const condition of await this.conditionRows(sid)) {
        const cond: TechnicCondition = {
          _explicitType: 'UpgradeCondition',
          type: null,
          upgradeNeed: null,
          currentOwn: null,
          canUpgrade: null,
        };
        const current = await this.conditionCurrent(uid, cid, xy, condition);
        const isBuilding = phpLooseEquals(condition.pre_type, SoldierPreType.Building);
        if (isBuilding || phpLooseEquals(condition.pre_type, SoldierPreType.Technic)) {
          cond.type = isBuilding
            ? this.lang.t('building.pre_building')
            : this.lang.t('doGetSoldierInfo.pre_technic');
          cond.canUpgrade = !(phpEmpty(current) || phpNum(current) < phpNum(condition.pre_level));
          if (!cond.canUpgrade) state.can_draft = false;
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
      if (isSpecialSoldier(sid)) {
        const special = await this.isSpecialSoldierCity(cid, sid);
        // `pre_city_yes` is misspelt in the original strings, so a special city shows nothing.
        state.conditions.push({
          _explicitType: 'UpgradeCondition',
          type: this.lang.t('building.pre_city'),
          upgradeNeed: this.lang.t('building.pre_city_need'),
          currentOwn: this.lang.tOrNull(`building.${special ? 'pre_city_yes' : 'pre_city_no'}`),
          canUpgrade: special,
        });
        if (!special) state.can_draft = false;
      }
      ret.push(state);
    }
    return ret;
  }

  /** An ArmySoldierState before time and conditions; costs times `resourcefactor` if given. */
  soldierState(soldier: Row, resourcefactor?: number): ArmySoldierState {
    const cost = (v: unknown) =>
      resourcefactor === undefined ? v : phpFloat(phpNum(v) * resourcefactor);
    return {
      _explicitType: 'ArmySoldierState',
      sid: soldier.sid,
      sname: soldier.name,
      count: phpEmpty(soldier.count) ? 0 : soldier.count,
      description: soldier.description,
      hp: soldier.hp,
      ap: soldier.ap,
      dp: soldier.dp,
      range: soldier.range,
      speed: soldier.speed,
      carry: soldier.carry,
      can_draft: true,
      food_use: soldier.food_use,
      woodNeed: cost(soldier.wood_need),
      rockNeed: cost(soldier.rock_need),
      ironNeed: cost(soldier.iron_need),
      foodNeed: cost(soldier.food_need),
      goldNeed: cost(soldier.gold_need),
      peopleNeed: soldier.people_need,
      draft_time: 0,
      conditions: null,
    };
  }

  /** SoldierFunc.php::doGetDraftQueue: the training entry first, then by queue time. */
  async draftQueue(cid: number, xy: number): Promise<ArmyDraftState[]> {
    const queues = await this.rows(sql<Row>`select d.*, s.name as sname,
        unix_timestamp() as nowtime
      from sys_city_draftqueue d left join cfg_soldier s on s.sid = d.sid
      where d.cid = ${cid} and d.xy = ${xy} order by d.state desc, d.queuetime, d.id`);
    return queues.map((queue) => {
      let timeLeft: unknown = queue.needtime;
      if (phpLooseEquals(queue.state, 1)) {
        const left = phpNum(queue.state_starttime) + phpNum(timeLeft) - phpNum(queue.nowtime);
        timeLeft = left === 0 ? 1 : left;
      }
      return {
        _explicitType: 'ArmyDraftState',
        qid: queue.id,
        sid: queue.sid,
        sname: queue.sname,
        count: queue.count,
        state: queue.state,
        time_left: timeLeft,
        accmark: queue.accmark,
      };
    });
  }

  /** SoldierFunc.php::getConvertInfo: `[[value, convert], the conversion ratio table]`. */
  async convertInfo(cid: number): Promise<[unknown, unknown[][]]> {
    const convert = (await this.one(
      sql<Row>`select value, \`convert\` from sys_soldier_convert where cid = ${cid}`,
    )) || [0, 0];
    return [convert, await this.convertTable()];
  }

  /**
   * cfg_soldier_convert: row `from - 1`, column `to - 1` holds the `from:to` ratio. The columns
   * are named 0..11, which PHP turns into list keys.
   */
  async convertTable(): Promise<unknown[][]> {
    const rows = await this.rows(sql<Row>`select * from cfg_soldier_convert`);
    return rows.map((row) => Object.keys(row).map((_, i) => row[String(i)]));
  }
}
