import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { Building, CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { OwnershipService } from '../core/ownership.service';
import { phpEmpty, phpFloatString, phpIntval, phpLooseEquals, phpNum } from '../core/php';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { DialogCommand, GlobalCommand, type CommandContext } from '../gateway/decorators';
import { BuildingInfoService } from './building-info.service';
import {
  BuildingRules,
  CITY_TYPE_BIG,
  encodeXy,
  type BuildingInfo,
} from './building-rules.service';
import { CityBuildingsService } from './city-buildings.service';

type Row = Record<string, unknown>;

/** `Define.GAME_SPEED_RATE`. */
const GAME_SPEED_RATE = 1;

/** log_user_action ids. */
const Action = { Build: 26, Upgrade: 27 } as const;

/** 火药筒: demolishes a building completely. */
const GOODS_FIRE_BARREL = 83;

/** 地变符: turns a resource field into another kind, keeping its level. */
const GOODS_LAND_CHANGE = 161504;

/** startChangeBuilding's rebuild time in seconds. */
const CHANGE_TIME = 5;

/** Buildings a city may have more than one of. */
const MULTIPLE_BUILDINGS = [1, 2, 3, 4, 5, 9, 17];

/** Slots a building may be placed on (encodeBuildingPosition), the government at 120. */
const BUILDING_XY = [
  1, 2, 10, 11, 12, 13, 21, 22, 23, 24, 31, 32, 33, 34, 35, 41, 42, 43, 44, 45, 46, 51, 52, 53, 54,
  55, 56, 60, 61, 62, 63, 64, 65, 70, 71, 72, 73, 81, 82, 100, 101, 102, 103, 104, 105, 110, 111,
  112, 113, 114, 115, 120, 122, 123, 124, 125, 132, 133, 134, 135, 140, 141, 142, 143, 144, 145,
  150, 151, 152, 153, 154, 155, 199,
];

/** startUpgradeBuilding's field grid per government level 1-15 (levels above 10 repeat 10). */
const VALID_GRID_ROWS = [
  '01000010000111111000001111',
  '010000110001111111000011111',
  '010000110001111111000011111000000111',
  '0100001100011111111000111111000001111',
  '0100001100111111111001111111000011111',
  '0100001100111111111001111111000011111000000111',
  '01000011001111111110011111111000111111000001111',
  '010000110011111111100111111110001111110000011110000000111',
  '010000110011111111101111111110011111110000111110000000111',
  '010000110011111111101111111110011111110000111110000001111000000011',
];

function validField(governmentLevel: number, x: number, y: number): boolean {
  const row = VALID_GRID_ROWS[Math.min(governmentLevel, 10) - 1];
  const index = y * 10 + x;
  return governmentLevel <= 15 && row !== undefined && index >= 0 && row[index] === '1';
}

/** The first `count` arguments through intval, missing ones as 0. */
function intParams<N extends 4 | 5>(
  param: unknown[],
  count: N,
): N extends 4 ? [number, number, number, number] : [number, number, number, number, number] {
  return Array.from({ length: count }, (_, i) => phpIntval(param[i])) as never;
}

/** The commands of BuildingFunc.php: create, upgrade and demolish buildings. */
@Injectable()
export class BuildingCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly rules: BuildingRules,
    private readonly buildings: CityBuildingsService,
    private readonly ownership: OwnershipService,
    private readonly users: UserRules,
    private readonly goods: GoodsRules,
    private readonly cityRules: CityRules,
    private readonly info: BuildingInfoService,
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

  /** `[inner]`: what can be built on an empty slot (0 fields, 1 inside the walls, 2 the wall). */
  @DialogCommand()
  async getAllValidBuilding(ctx: CommandContext, param: unknown[]): Promise<BuildingInfo[]> {
    if (param.length === 0) {
      throw GameError.raw('no param indicate whether get inner city building list.');
    }
    const { uid, cid } = ctx;
    const inner = param[0];
    let buildings: Row[];
    if (phpLooseEquals(inner, 2)) {
      buildings = await this.rows(sql<Row>`select * from cfg_building where bid = 20`);
    } else if (phpLooseEquals(inner, 1)) {
      buildings = await this.rows(sql<Row>`select * from cfg_building b
        where b.\`inner\` = 1 and b.bid <> 20 and (b.bid = 5 or b.bid = 9 or b.bid = 17
          or (select count(*) from sys_building s where s.cid = ${cid} and s.bid = b.bid) = 0)
        order by b.bid`);
    } else {
      buildings = await this.rows(
        sql<Row>`select * from cfg_building where \`inner\` = 0 order by bid`,
      );
    }
    const hasKaoGongJi = await this.rules.isUsingKaoGongJi(uid, 1);
    const cityType = await this.rules.cityType(cid);
    const ret: BuildingInfo[] = [];
    for (const building of buildings) {
      ret.push(await this.rules.simpleInfo(uid, cid, building, 1, hasKaoGongJi, cityType));
    }
    return ret;
  }

  /** `[inner, x, y, bid]`: the current and the next level of a building, plus its dialog's data. */
  @DialogCommand()
  async getBuildingInfo(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid, cid } = ctx;
    const [inner, x, y, bid] = intParams(param, 4);
    const xy = encodeXy(inner, x, y);
    const current = await this.one(sql<Row>`select * from sys_building
      where cid = ${cid} and xy = ${xy} and bid = ${bid}`);
    if (!current) throw GameError.lang('getBuildingInfo.nobuilding');
    return this.info.buildingInfo(uid, cid, xy, bid, phpNum(current.level));
  }

  /** How many buildings may be under construction at once: 2, 5 with 徭役令, 7 with the 高级 one. */
  private async queueLimit(uid: number): Promise<{ limit: number; advanced: boolean }> {
    const buff = (type: number) =>
      this.cell(sql<Row>`select endtime from mem_user_buffer
        where uid = ${uid} and buftype = ${type} and endtime > unix_timestamp() limit 1`);
    let limit = 2;
    if (!phpEmpty(await buff(11))) limit = 5;
    const advanced = !phpEmpty(await buff(166));
    if (advanced) limit = 7;
    return { limit, advanced };
  }

  private async upgradingCount(cid: number): Promise<number> {
    return phpNum(
      await this.cell(sql<Row>`select count(*) from sys_building where cid = ${cid} and state > 0`),
    );
  }

  private async checkBuildingKind(bid: number, inner: number): Promise<void> {
    const kind = await this.one(sql<Row>`select * from cfg_building
      where bid = ${bid} and \`inner\` = ${inner}`);
    if (!kind) throw GameError.lang('getBuildingInfo.nobuilding');
  }

  /** `[cid, inner, x, y, bid]`: builds a new building or starts the next level of one. */
  @GlobalCommand()
  async startUpgradeBuilding(ctx: CommandContext, param: unknown[]): Promise<Row[]> {
    const db = this.scope.db;
    const uid = ctx.uid;
    const cid = phpIntval(param[0]);
    const inner = phpIntval(param[1]) ? 1 : 0;
    const x = phpIntval(param[2]);
    const y = phpIntval(param[3]);
    const bid = phpIntval(param[4]);
    await this.ownership.checkCityExist(cid, uid);
    await this.checkBuildingKind(bid, inner);
    const xy = encodeXy(inner, x, y);
    let dstbid = bid;
    let dstlevel = 1;
    if (!BUILDING_XY.includes(xy)) {
      throw GameError.raw('郑重提醒你：再用外挂，一切责任自负，我们概不负责恢复或者修改');
    }
    const existing = await this.one(sql<Row>`select * from sys_building
      where cid = ${cid} and xy = ${xy} and bid = ${bid}`);
    if (existing) {
      if (!phpLooseEquals(existing.state, 0)) throw GameError.lang('getBuildingInfo.upgrading');
      dstbid = phpIntval(existing.bid);
      dstlevel = phpNum(existing.level) + 1;
    } else if (
      await this.one(sql<Row>`select * from sys_building where cid = ${cid} and xy = ${xy}`)
    ) {
      throw GameError.lang('getBuildingInfo.building_error');
    }
    let cityType: unknown = null;
    if (dstlevel === 1) {
      const same = await this.one(sql<Row>`select * from sys_building
        where bid not in (${sql.join(MULTIPLE_BUILDINGS)}) and bid = ${bid} and cid = ${cid}`);
      if (same) throw GameError.lang('getBuildingInfo.same_building_has_build');
    } else {
      cityType = await this.rules.cityType(cid);
      let maxlevel = BuildingRules.maxLevel(cityType, bid);
      if (phpLooseEquals(cityType, 0) && bid < 5) {
        const plan = await this.one(sql<Row>`select * from mem_city_buffer
          where cid = ${cid} and buftype = 10001 and endtime >= unix_timestamp()`);
        if (plan) maxlevel = 12;
      }
      if (
        phpLooseEquals(cityType, 0) &&
        (bid === Building.Ground || bid === Building.Wall || bid === Building.Workshop) &&
        (await this.users.checkHeroLevel(uid, 4, 30))
      ) {
        maxlevel = 15;
      }
      if (dstlevel > maxlevel) throw GameError.lang('getBuildingInfo.no_AdvancedConstructionPlan');
    }

    const need = await this.one(sql<Row>`select * from cfg_building_level
      where bid = ${dstbid} and level = ${dstlevel}`);
    if (need && !phpEmpty(need.upgrade_time)) {
      let wood = phpNum(need.upgrade_wood);
      let rock = phpNum(need.upgrade_rock);
      let iron = phpNum(need.upgrade_iron);
      let food = phpNum(need.upgrade_food);
      const gold = phpNum(need.upgrade_gold);
      if (await this.rules.isUsingKaoGongJi(uid, dstlevel)) {
        wood = Math.floor(wood * 0.7);
        rock = Math.floor(rock * 0.7);
        iron = Math.floor(iron * 0.7);
        food = Math.floor(food * 0.7);
      }
      const res = await this.one(sql<Row>`select * from mem_city_resource where cid = ${cid}`);
      if (
        !res ||
        phpNum(res.wood) < wood ||
        phpNum(res.rock) < rock ||
        phpNum(res.iron) < iron ||
        phpNum(res.food) < food ||
        phpNum(res.gold) < gold
      ) {
        throw GameError.lang('getBuildingInfo.resource_not_enough');
      }
      const people = await this.cell(
        sql<Row>`select people from mem_city_resource where cid = ${cid}`,
      );
      if (phpNum(people) < phpNum(need.upgrade_people)) {
        throw GameError.lang('getBuildingInfo.people_not_enough');
      }
      const governmentLevel = phpNum(
        await this.cell(sql<Row>`select level from sys_building
          where cid = ${cid} and bid = ${Building.Government}`),
      );
      if (inner === 0 && !validField(governmentLevel, x, y)) {
        throw GameError.lang('getBuildingInfo.government_not_enough');
      }
      const { limit, advanced } = await this.queueLimit(uid);
      if ((await this.upgradingCount(cid)) >= limit) {
        if (advanced) throw GameError.lang('getBuildingInfo.upgrading_queue_full');
        if (limit === 2) throw GameError.raw('ask_to_use_yaoyiling');
        if (limit === 5) throw GameError.raw('ask_to_use_yaoyiling2');
      }
      for (const condition of await this.rules.conditionRows(dstbid, dstlevel, cityType)) {
        const preLevel = phpNum(condition.pre_level);
        if (phpLooseEquals(condition.pre_type, 0)) {
          const current = await this.cell(sql<Row>`select max(level) from sys_building
            where cid = ${cid} and bid = ${condition.pre_id}`);
          if (phpEmpty(current) || phpNum(current) < preLevel) {
            throw GameError.lang('getBuildingInfo.no_pre_building');
          }
        } else if (phpLooseEquals(condition.pre_type, 1)) {
          const current = await this.cell(sql<Row>`select max(level) from sys_technic
            where uid = ${uid} and tid = ${condition.pre_id}`);
          if (phpEmpty(current) || phpNum(current) < preLevel) {
            throw GameError.lang('getBuildingInfo.no_pre_technic');
          }
        } else if (phpLooseEquals(condition.pre_type, 2)) {
          const current = await this.cell(sql<Row>`select count from sys_goods
            where uid = ${uid} and gid = ${condition.pre_id}`);
          if (phpEmpty(current) || phpNum(current) < preLevel) {
            throw GameError.lang('getBuildingInfo.no_pre_thing');
          }
          await this.goods.addGoods(uid, phpIntval(condition.pre_id), -preLevel, 0);
        }
      }

      const timeNeed = phpFloatString(
        (phpNum(need.upgrade_time) * (await this.rules.speedRate(cid))) / GAME_SPEED_RATE,
      );
      await this.cityRules.addCityResources(cid, -wood, -rock, -iron, -food, -gold);
      let lastid: unknown;
      if (existing) {
        await sql`update sys_building set bid = ${bid}, state = '1',
            state_starttime = unix_timestamp(), state_endtime = unix_timestamp() + ${timeNeed}
          where cid = ${cid} and xy = ${xy}`.execute(db);
        lastid = existing.id;
      } else {
        await sql`insert into sys_building (cid, xy, bid, level, state, state_starttime, state_endtime)
          values (${cid}, ${xy}, ${bid}, 0, 1, unix_timestamp(), unix_timestamp() + ${timeNeed})`.execute(
          db,
        );
        lastid = await this.cell(sql<Row>`select last_insert_id()`);
      }
      await sql`insert into mem_building_upgrading (id, cid, xy, bid, level, state_endtime)
        values (${lastid}, ${cid}, ${xy}, ${bid}, ${dstlevel}, unix_timestamp() + ${timeNeed})
        on duplicate key update state_endtime = unix_timestamp() + ${timeNeed}`.execute(db);
      await this.users.logUserAction(uid, dstlevel === 1 ? Action.Build : Action.Upgrade);
    }
    return this.buildings.buildingInfo(uid, cid);
  }

  /** `[cid, inner, x, y, bid]`: cancels an upgrade and refunds 66% of its cost. */
  @GlobalCommand()
  async stopUpgradeBuilding(ctx: CommandContext, param: unknown[]): Promise<Row[]> {
    const db = this.scope.db;
    const uid = ctx.uid;
    const [cid, inner, x, y, bid] = intParams(param, 5);
    await this.ownership.checkCityExist(cid, uid);
    await this.checkBuildingKind(bid, inner);
    const xy = encodeXy(inner, x, y);
    const building = await this.one(sql<Row>`select * from sys_building
      where cid = ${cid} and xy = ${xy} and state = 1`);
    if (!building) throw GameError.lang('getBuildingInfo.nobuilding');
    const dstbid = phpIntval(building.bid);
    const dstlevel = phpNum(building.level) + 1;
    const need = await this.one(sql<Row>`select * from cfg_building_level
      where bid = ${dstbid} and level = ${dstlevel}`);
    if (need) {
      if (phpLooseEquals(building.level, 0)) {
        await sql`delete from sys_building where cid = ${cid} and xy = ${xy}`.execute(db);
        await this.users.logActionCountback(uid, Action.Build);
      } else {
        await sql`update sys_building set state = '0' where cid = ${cid} and xy = ${xy}`.execute(
          db,
        );
        await this.users.logActionCountback(uid, Action.Upgrade);
      }
      await sql`delete from mem_building_upgrading where id = ${building.id}`.execute(db);
      await this.cityRules.addCityResources(
        cid,
        phpNum(need.upgrade_wood) * 0.66,
        phpNum(need.upgrade_rock) * 0.66,
        phpNum(need.upgrade_iron) * 0.66,
        phpNum(need.upgrade_food) * 0.66,
        phpNum(need.upgrade_gold) * 0.66,
      );
      if (phpLooseEquals(await this.rules.cityType(cid), CITY_TYPE_BIG)) {
        const goods = await this.rows(sql<Row>`select * from cfg_building_condition
          where bid = ${dstbid} and levelid = ${dstlevel} and pre_type = 2`);
        for (const g of goods) {
          await this.goods.addGoods(
            uid,
            phpIntval(g.pre_id),
            Math.ceil(phpNum(g.pre_level) * 0.66),
            0,
          );
        }
      }
    }
    return this.buildings.buildingInfo(uid, cid);
  }

  /** `[cid, inner, x, y, bid]`: demolishes one level, taking half the build time. */
  @GlobalCommand()
  async startDestroyBuilding(ctx: CommandContext, param: unknown[]): Promise<Row[]> {
    const db = this.scope.db;
    const uid = ctx.uid;
    const [cid, inner, x, y, bid] = intParams(param, 5);
    await this.ownership.checkCityExist(cid, uid);
    if (
      phpLooseEquals(await this.rules.cityType(cid), CITY_TYPE_BIG) &&
      bid === Building.Government
    ) {
      throw GameError.lang('bigcity.destrotybigcity');
    }
    const xy = encodeXy(inner, x, y);
    const building = await this.destroyable(cid, xy, bid);
    const { limit, advanced } = await this.queueLimit(uid);
    if ((await this.upgradingCount(cid)) >= limit) {
      throw GameError.lang(
        advanced ? 'getBuildingInfo.upgrading_queue_full' : 'getBuildingInfo.upgrading_queue_full2',
      );
    }
    const dstbid = phpIntval(building.bid);
    const dstlevel = phpNum(building.level);
    if (dstbid === Building.Government && dstlevel === 1) {
      throw GameError.lang('getBuildingInfo.govenment_1_destroy');
    }
    const need = await this.one(sql<Row>`select * from cfg_building_level
      where bid = ${dstbid} and level = ${dstlevel}`);
    const timeNeed = Math.floor(
      (phpNum(need ? need.upgrade_time : null) * 0.5 * (await this.rules.speedRate(cid))) /
        GAME_SPEED_RATE,
    );
    if (!need) throw GameError.lang('getBuildingInfo.nobuilding');
    await sql`update sys_building set state = '2', state_starttime = unix_timestamp(),
        state_endtime = unix_timestamp() + ${timeNeed}
      where cid = ${cid} and xy = ${xy}`.execute(db);
    await sql`insert into mem_building_destroying (id, cid, xy, bid, level, state_endtime)
      values (${building.id}, ${cid}, ${xy}, ${bid}, ${dstlevel - 1}, unix_timestamp() + ${timeNeed})
      on duplicate key update state_endtime = unix_timestamp() + ${timeNeed}`.execute(db);
    return this.buildings.buildingInfo(uid, cid);
  }

  /** A building that exists and is idle, or the error the demolish commands report. */
  private async destroyable(cid: number, xy: number, bid: number): Promise<Row> {
    const building = await this.one(sql<Row>`select * from sys_building
      where cid = ${cid} and xy = ${xy} and bid = ${bid}`);
    if (!building) throw GameError.lang('getBuildingInfo.nobuilding');
    if (phpLooseEquals(building.state, 1)) throw GameError.lang('getBuildingInfo.upgrading');
    if (phpLooseEquals(building.state, 2)) throw GameError.lang('getBuildingInfo.destroying');
    return building;
  }

  /**
   * `[cid, inner, x, y, bid]`: cancels a demolition. The original skipped the ownership check
   * and would have answered with any city's buildings.
   */
  @GlobalCommand()
  async stopDestroyBuilding(ctx: CommandContext, param: unknown[]): Promise<Row[]> {
    const db = this.scope.db;
    const [cid, inner, x, y] = intParams(param, 4);
    await this.ownership.checkCityExist(cid, ctx.uid);
    const xy = encodeXy(inner, x, y);
    await sql`delete from mem_building_destroying where id = (select id from sys_building
      where cid = ${cid} and xy = ${xy} and state = 2)`.execute(db);
    await sql`update sys_building set state = '0'
      where cid = ${cid} and xy = ${xy} and state = 2`.execute(db);
    return this.buildings.buildingInfo(ctx.uid, cid);
  }

  /** `[cid, inner, x, y, bid]`: demolishes a building to the ground with a 火药筒. */
  @GlobalCommand()
  async startDestroyBuildingAll(ctx: CommandContext, param: unknown[]): Promise<Row[]> {
    const db = this.scope.db;
    const uid = ctx.uid;
    const [cid, inner, x, y, bid] = intParams(param, 5);
    await this.ownership.checkCityExist(cid, uid);
    if (bid === Building.Government) throw GameError.lang('getBuildingInfo.govenment_all_destroy');
    const xy = encodeXy(inner, x, y);
    const building = await this.destroyable(cid, xy, bid);
    await this.useFireBarrel(uid, building, cid, xy);
    if (bid === Building.Honglu) {
      await sql`update sys_city_hero set state = 2 where hid in (select distinct hid
        from sys_troops as t where t.targetcid = ${cid} and t.task = 1 and t.state = 4)`.execute(
        db,
      );
      await sql`update sys_troops set state = 1, endtime = pathtime + unix_timestamp(),
          starttime = unix_timestamp()
        where targetcid = ${cid} and task = 1 and state = 4`.execute(db);
    }
    return this.buildings.buildingInfo(uid, cid);
  }

  /**
   * `[cid, inner, x, y, targetBid, bid]`: rebuilds an idle field as another kind with a 地变符.
   * The original took any target bid; only the four resource fields are accepted here.
   */
  @GlobalCommand()
  async startChangeBuilding(ctx: CommandContext, param: unknown[]): Promise<Row[]> {
    const db = this.scope.db;
    const uid = ctx.uid;
    const [cid, inner, x, y, targetBid, bid] = Array.from({ length: 6 }, (_, i) =>
      phpIntval(param[i]),
    ) as [number, number, number, number, number, number];
    const xy = encodeXy(inner ? 1 : 0, x, y);
    await this.ownership.checkCityExist(cid, uid);
    const building = await this.one(sql<Row>`select * from sys_building
      where cid = ${cid} and xy = ${xy} and bid = ${bid}`);
    if (!building) throw GameError.lang('getBuildingInfo.building_error');
    if (!phpLooseEquals(building.state, 0)) throw GameError.lang('getBuildingInfo.upgrading');
    if (!(await this.goods.checkGoods(uid, GOODS_LAND_CHANGE))) {
      throw GameError.raw(`not_enough_goods${GOODS_LAND_CHANGE}`);
    }
    if (bid < 1 || bid > 4 || targetBid < 1 || targetBid > 4) {
      throw GameError.lang('getBuildingInfo.building_error');
    }
    await sql`update sys_building set bid = ${targetBid}, state = '1',
        state_starttime = unix_timestamp(), state_endtime = unix_timestamp() + ${CHANGE_TIME}
      where cid = ${cid} and xy = ${xy} and bid = ${bid}`.execute(db);
    await sql`insert into mem_building_upgrading (id, cid, xy, bid, level, state_endtime)
      values (${building.id}, ${cid}, ${xy}, ${targetBid}, ${building.level},
        unix_timestamp() + ${CHANGE_TIME})
      on duplicate key update state_endtime = unix_timestamp() + ${CHANGE_TIME}`.execute(db);
    await sql`update sys_city_res_add set resource_changing = 1 where cid = ${cid}`.execute(db);
    await sql`update mem_city_resource set changing = 1 where cid = ${cid}`.execute(db);
    await this.goods.reduceGoods(uid, GOODS_LAND_CHANGE, 1);
    return this.buildings.buildingInfo(uid, cid);
  }

  /** GoodsFunc.php::useFireBarrel */
  private async useFireBarrel(uid: number, building: Row, cid: number, xy: number): Promise<void> {
    const db = this.scope.db;
    if (!(await this.goods.checkGoods(uid, GOODS_FIRE_BARREL))) {
      throw GameError.raw(`not_enough_goods${GOODS_FIRE_BARREL}`);
    }
    await sql`update sys_building set state = '2', state_starttime = unix_timestamp(),
        state_endtime = unix_timestamp() + 0
      where cid = ${cid} and xy = ${xy}`.execute(db);
    await sql`insert into mem_building_destroying (id, cid, xy, bid, level, state_endtime)
      values (${building.id}, ${cid}, ${xy}, ${building.bid}, 0, unix_timestamp() + 0)
      on duplicate key update state_endtime = unix_timestamp() + 0`.execute(db);
    if (phpLooseEquals(building.bid, Building.Wall)) {
      await sql`delete from sys_city_defence where cid = ${cid}`.execute(db);
      await sql`delete from mem_city_reinforce where cid = ${cid}`.execute(db);
    }
    await this.goods.reduceGoods(uid, GOODS_FIRE_BARREL, 1);
  }
}
