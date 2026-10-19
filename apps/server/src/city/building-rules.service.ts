import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { Building } from '../core/city-rules.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';

type Row = Record<string, unknown>;

/** sys_city.type of a player's main city (主城). */
export const CITY_TYPE_BIG = 5;

/** utils.php::encodeBuildingPosition */
export function encodeXy(inner: number, x: number, y: number): number {
  return inner * 100 + x * 10 + y;
}

/** cfg_building_condition.pre_type */
const PreType = { Building: 0, Technic: 1, Goods: 2 } as const;

/** interface.php::UpgradeCondition plus the pre_* fields doGetSimpleBuildingInfo adds. */
export interface UpgradeCondition {
  _explicitType: 'UpgradeCondition';
  type: string | null;
  upgradeNeed: string | null;
  currentOwn: string | null;
  canUpgrade: boolean | null;
  pre_type: unknown;
  pre_id: unknown;
  pre_level: unknown;
}

/** interface.php::BuildingInfo: what one level of a building costs and requires. */
export interface BuildingInfo {
  _explicitType: 'BuildingInfo';
  bid: number;
  name: unknown;
  description: unknown;
  levelDescription: unknown;
  level: number;
  woodNeed: number | null;
  rockNeed: number | null;
  ironNeed: number | null;
  foodNeed: number | null;
  goldNeed: number | null;
  peopleNeed: number | null;
  upgradeTime: number | null;
  canUpgrade: boolean;
  conditions: UpgradeCondition[];
}

/** Upgrade costs and conditions of BuildingFunc.php. */
@Injectable()
export class BuildingRules {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly users: UserRules,
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

  async cityType(cid: number): Promise<unknown> {
    return this.cell(sql<Row>`select type from sys_city where cid = ${cid}`);
  }

  /**
   * BuildingFunc.php::getBuildingSpeedRate: time factor from 建筑技术, the governor's 内政
   * (doubled by 文曲星符 at 1.25), the 鬼斧神工 book and the lord's cultivation.
   */
  async speedRate(cid: number): Promise<number> {
    let speedAdd = 0;
    const techLevel = await this.cell(
      sql<Row>`select level from sys_city_technic where cid = ${cid} and tid = 17`,
    );
    if (!phpEmpty(techLevel)) speedAdd += phpNum(techLevel) * 10;
    const chiefhid = phpNum(
      await this.cell(sql<Row>`select chiefhid from sys_city where cid = ${cid}`),
    );
    let attrValue: unknown = 0;
    if (chiefhid > 0) {
      const chief = await this.one(sql<Row>`select * from sys_city_hero where hid = ${chiefhid}`);
      if (chief) {
        const buffered = await this.one(
          sql<Row>`select * from mem_hero_buffer where hid = ${chiefhid} and buftype = 2`,
        );
        const bufadd = buffered ? 1.25 : 1.0;
        speedAdd +=
          (phpNum(chief.affairs_base) + phpNum(chief.affairs_add)) * bufadd +
          phpNum(chief.affairs_add_on);
      }
      attrValue = await this.cell(sql<Row>`select b.attr from sys_user_book a, cfg_book b
        where a.bid = b.id and a.level = b.level and a.bid = 15 and a.hid = ${chiefhid}`);
    }
    if (phpEmpty(attrValue)) attrValue = 0;
    const skillRate = phpNum(attrValue) * 0.01;
    let finalSpeed = (1.0 / (1.0 + 0.01 * speedAdd)) * (1 - skillRate);
    const uid = phpNum(await this.cell(sql<Row>`select uid from sys_city where cid = ${cid}`));
    if (await this.users.checkHeroLevel(uid, 2, 10)) finalSpeed *= 0.8;
    return finalSpeed;
  }

  /** BuildingFunc.php::isUsingKaoGongJi: 考工记 buffs cut costs by 30% up to their level cap. */
  async isUsingKaoGongJi(uid: number, dstlevel: number): Promise<boolean> {
    const types = dstlevel <= 5 ? [12, 13, 14] : dstlevel <= 8 ? [13, 14] : [14];
    const row = await this.scope.db
      .selectFrom('mem_user_buffer')
      .select('endtime')
      .where('uid', '=', uid)
      .where('buftype', 'in', types)
      .where('endtime', '>', sql<number>`unix_timestamp()`)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** BuildingFunc.php::getBuildingMaxLevel */
  static maxLevel(cityType: unknown, bid: number): number {
    let maxlevel = 10;
    if (bid < 5) {
      if (phpLooseEquals(cityType, 1)) maxlevel = 12;
      else if (phpLooseEquals(cityType, 2) || phpLooseEquals(cityType, 5)) maxlevel = 15;
      else if (phpLooseEquals(cityType, 3)) maxlevel = 18;
      else if (phpLooseEquals(cityType, 4)) maxlevel = 20;
    } else if (phpLooseEquals(cityType, 5)) {
      maxlevel = 15;
    }
    return maxlevel;
  }

  /** cfg_building_condition rows of a level; main-city buildings above 10 also need the 官府. */
  async conditionRows(bid: number, level: number, cityType: unknown): Promise<Row[]> {
    const conditions = await this.rows(sql<Row>`select * from cfg_building_condition
      where bid = ${bid} and levelid = ${level} order by pre_type`);
    if (phpLooseEquals(cityType, CITY_TYPE_BIG) && level >= 11 && bid !== Building.Government) {
      conditions.push({
        bid,
        levelid: level,
        pre_type: 0,
        pre_id: Building.Government,
        pre_level: level,
      });
    }
    return conditions;
  }

  /** BuildingFunc.php::doGetSimpleBuildingInfo */
  async simpleInfo(
    uid: number,
    cid: number,
    building: Row,
    dstlevel: number,
    hasKaoGongJi: boolean,
    cityType: unknown,
  ): Promise<BuildingInfo> {
    const bid = phpIntval(building.bid);
    const info: BuildingInfo = {
      _explicitType: 'BuildingInfo',
      bid,
      name: building.name,
      description: building.description,
      levelDescription: null,
      level: dstlevel,
      woodNeed: null,
      rockNeed: null,
      ironNeed: null,
      foodNeed: null,
      goldNeed: null,
      peopleNeed: null,
      upgradeTime: null,
      canUpgrade: true,
      conditions: [],
    };
    let maxlevel = BuildingRules.maxLevel(cityType, bid);
    if (phpLooseEquals(cityType, 0) && bid < 5) maxlevel = 12;
    if (
      phpLooseEquals(cityType, 0) &&
      (bid === Building.Ground || bid === Building.Wall || bid === Building.Workshop) &&
      (await this.users.checkHeroLevel(uid, 4, 30))
    ) {
      maxlevel = 15;
    }
    const rate = hasKaoGongJi ? 0.7 : 1;
    const need =
      dstlevel <= maxlevel
        ? await this.one(sql<Row>`select * from cfg_building_level
            where bid = ${bid} and level = ${dstlevel}`)
        : false;
    if (need) {
      const speedRate = await this.speedRate(cid);
      info.woodNeed = phpIntval(need.upgrade_wood) * rate;
      info.rockNeed = phpIntval(need.upgrade_rock) * rate;
      info.ironNeed = phpIntval(need.upgrade_iron) * rate;
      info.foodNeed = phpIntval(need.upgrade_food) * rate;
      info.goldNeed = phpIntval(need.upgrade_gold) * rate;
      info.peopleNeed = phpIntval(need.upgrade_people);
      info.upgradeTime = Math.ceil(phpNum(need.upgrade_time) * speedRate);
      info.levelDescription = need.description;
    } else if (dstlevel > 0) {
      info.canUpgrade = false;
    }
    const res = await this.one(sql<Row>`select * from mem_city_resource where cid = ${cid}`);
    if (!res) throw GameError.raw('');
    const short = (have: unknown, want: number | null) => want !== null && phpNum(have) < want;
    if (
      short(res.wood, info.woodNeed) ||
      short(res.rock, info.rockNeed) ||
      short(res.iron, info.ironNeed) ||
      short(res.food, info.foodNeed) ||
      short(res.gold, info.goldNeed) ||
      short(res.people, info.peopleNeed)
    ) {
      info.canUpgrade = false;
    }
    const levelText = this.lang.t('doGetSimpleBuildingInfo.level');
    for (const condition of await this.conditionRows(bid, dstlevel, cityType)) {
      const cond: UpgradeCondition = {
        _explicitType: 'UpgradeCondition',
        type: null,
        upgradeNeed: null,
        currentOwn: null,
        canUpgrade: null,
        pre_type: condition.pre_type,
        pre_id: condition.pre_id,
        pre_level: condition.pre_level,
      };
      const preLevel = phpNum(condition.pre_level);
      if (phpLooseEquals(condition.pre_type, PreType.Building)) {
        cond.type = this.lang.t('doGetSimpleBuildingInfo.pre_building');
        const current = await this.cell(sql<Row>`select max(level) from sys_building
          where cid = ${cid} and bid = ${condition.pre_id}`);
        cond.canUpgrade = !(phpEmpty(current) || phpNum(current) < preLevel);
        if (!cond.canUpgrade) info.canUpgrade = false;
        const name = await this.cell(
          sql<Row>`select name from cfg_building where bid = ${condition.pre_id}`,
        );
        cond.upgradeNeed = `${phpString(name)}(${levelText}${phpString(condition.pre_level)})`;
        cond.currentOwn = `${levelText}${phpEmpty(current) ? 0 : phpString(current)}`;
      } else if (phpLooseEquals(condition.pre_type, PreType.Technic)) {
        cond.type = this.lang.t('doGetSimpleBuildingInfo.pre_technic');
        const current = await this.cell(sql<Row>`select max(level) from sys_technic
          where uid = ${uid} and tid = ${condition.pre_id}`);
        cond.canUpgrade = !(phpEmpty(current) || phpNum(current) < preLevel);
        if (!cond.canUpgrade) info.canUpgrade = false;
        const name = await this.cell(
          sql<Row>`select name from cfg_technic where tid = ${condition.pre_id}`,
        );
        cond.upgradeNeed = `${phpString(name)}(${levelText}${phpString(condition.pre_level)})`;
        cond.currentOwn = `${levelText}${phpEmpty(current) ? 0 : phpString(current)}`;
      } else if (phpLooseEquals(condition.pre_type, PreType.Goods)) {
        const countText = this.lang.t('doGetSimpleBuildingInfo.count');
        cond.type = this.lang.t('doGetSimpleBuildingInfo.pre_thing');
        const current = await this.cell(sql<Row>`select count from sys_goods
          where uid = ${uid} and gid = ${condition.pre_id}`);
        cond.canUpgrade = !(phpEmpty(current) || phpNum(current) < preLevel);
        if (!cond.canUpgrade) info.canUpgrade = false;
        const name = await this.cell(
          sql<Row>`select name from cfg_goods where gid = ${condition.pre_id}`,
        );
        cond.upgradeNeed = `${phpString(name)}(${countText}${phpString(condition.pre_level)})`;
        cond.currentOwn = `${countText}${phpEmpty(current) ? 0 : phpString(current)}`;
      }
      info.conditions.push(cond);
    }
    return info;
  }
}
