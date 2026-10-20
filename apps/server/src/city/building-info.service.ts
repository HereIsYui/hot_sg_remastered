import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { Building } from '../core/city-rules.service';
import { phpIntval, phpNum } from '../core/php';
import { DbScope } from '../db/database.module';
import { BuildingRules } from './building-rules.service';
import { DefenceRules } from './defence-rules.service';
import { SoldierRules } from './soldier-rules.service';
import { TechnicRules } from './technic-rules.service';

type Row = Record<string, unknown>;

/** BuildingFunc.php::doGetBuildingInfo: what a building's dialog shows. */
@Injectable()
export class BuildingInfoService {
  constructor(
    private readonly scope: DbScope,
    private readonly rules: BuildingRules,
    private readonly technics: TechnicRules,
    private readonly soldiers: SoldierRules,
    private readonly defences: DefenceRules,
  ) {}

  /**
   * The current and the next level; the buildings with their own dialogs append that dialog's
   * data (书院 its technics, 兵营 its soldiers, queue and conversions, 城墙 its defences, queue
   * and space). The other dialogs' data is added as those dialogs are ported.
   */
  async buildingInfo(
    uid: number,
    cid: number,
    xy: number,
    bid: number,
    level: number,
  ): Promise<unknown[]> {
    const building =
      (await sql<Row>`select * from cfg_building where bid = ${bid}`.execute(this.scope.db))
        .rows[0] ?? {};
    const hasKaoGongJi = await this.rules.isUsingKaoGongJi(uid, level + 1);
    const cityType = await this.rules.cityType(cid);
    const ret: unknown[] = [
      await this.rules.simpleInfo(uid, cid, building, level, false, cityType),
      await this.rules.simpleInfo(uid, cid, building, level + 1, hasKaoGongJi, cityType),
    ];
    if (bid === Building.College) ret.push(await this.technics.technicInfo(uid, cid));
    else if (bid === Building.Army) {
      ret.push(await this.soldiers.soldierInfo(uid, cid, xy));
      ret.push(await this.soldiers.draftQueue(cid, xy));
      ret.push(await this.soldiers.convertInfo(cid));
    } else if (bid === Building.Wall) {
      ret.push(await this.defences.defenceInfo(uid, cid));
      ret.push(await this.defences.reinforceQueue(cid));
      ret.push(await this.defences.cityArea(cid));
      ret.push(await this.defences.cityAreaOccupied(cid));
    }
    return ret;
  }

  /** DefenceFunc.php::getWallInfo: the 城墙 after a command. */
  async wallInfo(uid: number, cid: number): Promise<unknown[]> {
    const wall = (
      await sql<Row>`select * from sys_building
        where cid = ${cid} and bid = ${Building.Wall}`.execute(this.scope.db)
    ).rows[0];
    if (!wall) throw GameError.lang('getWallInfo.no_wall');
    return this.buildingInfo(uid, cid, 0, Building.Wall, phpNum(wall.level));
  }

  /** TechnicFunc.php::getCollegeInfo: the city's highest 书院 after a command. */
  async collegeInfo(uid: number, cid: number): Promise<unknown[]> {
    const college = (
      await sql<Row>`select * from sys_building
        where cid = ${cid} and bid = ${Building.College} order by level desc limit 1`.execute(
        this.scope.db,
      )
    ).rows[0];
    if (!college) throw GameError.lang('getCollegeInfo.no_college_built');
    return this.buildingInfo(
      uid,
      cid,
      phpIntval(college.xy),
      Building.College,
      phpNum(college.level),
    );
  }

  /** SoldierFunc.php::getArmyInfo: the 兵营 at `xy` after a command. */
  async armyInfo(uid: number, cid: number, xy: number): Promise<unknown[]> {
    const army = (
      await sql<Row>`select * from sys_building
        where cid = ${cid} and xy = ${xy} and bid = ${Building.Army}`.execute(this.scope.db)
    ).rows[0];
    if (!army) throw GameError.lang('getArmyInfo.no_barracks_built');
    return this.buildingInfo(uid, cid, xy, Building.Army, phpNum(army.level));
  }
}
