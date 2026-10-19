import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Building } from '../core/city-rules.service';
import { DbScope } from '../db/database.module';
import { BuildingRules } from './building-rules.service';
import { TechnicRules } from './technic-rules.service';

type Row = Record<string, unknown>;

/** BuildingFunc.php::doGetBuildingInfo: what a building's dialog shows. */
@Injectable()
export class BuildingInfoService {
  constructor(
    private readonly scope: DbScope,
    private readonly rules: BuildingRules,
    private readonly technics: TechnicRules,
  ) {}

  /**
   * The current and the next level; the buildings with their own dialogs append that dialog's
   * data (书院 its technics). The other dialogs' data is added as those dialogs are ported.
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
    return ret;
  }
}
