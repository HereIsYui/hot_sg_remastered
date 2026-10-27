import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { BuildingInfoService } from '../city/building-info.service';
import { Building } from '../core/city-rules.service';
import { phpIntval, phpNum } from '../core/php';
import { DbScope } from '../db/database.module';

export const RESOURCE_PRICES = [0.1, 0.1, 0.2, 0.25] as const;
export const GRID_DISTANCE = 60000;
export const MERCHANT_MOVE_SPEED = 360;

type Row = Record<string, unknown>;

/** utils.php::getCityDistance. */
export function cityDistance(cid1: number, cid2: number): number {
  const x1 = cid1 % 1000;
  const y1 = Math.floor(cid1 / 1000);
  const x2 = cid2 % 1000;
  const y2 = Math.floor(cid2 / 1000);
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

@Injectable()
export class MarketRules {
  constructor(
    private readonly scope: DbScope,
    private readonly info: BuildingInfoService,
  ) {}

  async marketLevel(cid: number): Promise<number | false> {
    const value = (
      await sql<{ v: unknown }>`select level as v from sys_building where cid = ${cid}
        and bid = ${Building.Market} limit 1`.execute(this.scope.db)
    ).rows[0]?.v;
    return value === undefined ? false : phpIntval(value);
  }

  /** MarketFunc.php::getCityTradeUsing. */
  async tradeUsing(cid: number): Promise<number> {
    return phpNum(
      (
        await sql<{ v: unknown }>`select count(*) as v from sys_city_trade
          where cid = ${cid} or (buycid = ${cid} and state != 2)`.execute(this.scope.db)
      ).rows[0]?.v,
    );
  }

  /** MarketFunc.php::getMarketInfo: the highest market and its active caravans. */
  async marketInfo(uid: number, cid: number): Promise<unknown[]> {
    const market = (
      await sql<Row>`select * from sys_building where cid = ${cid} and bid = ${Building.Market}
        order by level desc limit 1`.execute(this.scope.db)
    ).rows[0];
    if (!market) throw GameError.lang('getMarketInfo.no_market_built');
    return this.info.buildingInfo(
      uid,
      cid,
      phpIntval(market.xy),
      Building.Market,
      phpNum(market.level),
    );
  }
}
