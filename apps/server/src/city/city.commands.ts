import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GameState, GameStateService } from '../core/game-state.service';
import { phpIntval, phpLooseEquals } from '../core/php';
import { DbScope } from '../db/database.module';
import { dbNow } from '../db/sql-fragments';
import { AmfMethod, AmfService, GlobalCommand, type CommandContext } from '../gateway/decorators';
import { SessionService } from '../gateway/session.service';
import { CityBuildingsService } from './city-buildings.service';
import { CityInfoService } from './city-info.service';
import { CityProductionService } from './city-production.service';

/** sys_user.state of a player who lost every city and must found a new one. */
const USER_STATE_NO_CITY = 4;
const USER_STATE_NO_ROLE = 3;

/** CityCommand types: what the main screen polls. */
export const CityInfoType = { Resource: 0, Hero: 1, Army: 2, Defence: 3, Time: 4 } as const;

/** Global commands of CityFunc.php that load a city. */
@Injectable()
export class CityCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly info: CityInfoService,
    private readonly production: CityProductionService,
    private readonly buildings: CityBuildingsService,
  ) {}

  /**
   * `[cid, sign]`: everything about one of the player's cities; also remembers it as the last
   * city. A city that is no longer the player's sends the client to another one.
   */
  @GlobalCommand()
  async getCityInfo(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const db = this.scope.db;
    const uid = ctx.uid;
    const cid = phpIntval(param[0]);
    const owned = await sql`select cid from sys_city where cid = ${cid} and uid = ${uid}`.execute(
      db,
    );
    if (owned.rows.length > 0) {
      const ret = await this.info.allInfo(uid, cid);
      await sql`update sys_user set lastcid = ${cid} where uid = ${uid}`.execute(db);
      return ret;
    }
    const count = await sql<{
      n: number;
    }>`select count(*) as n from sys_city where uid = ${uid}`.execute(db);
    if (Number(count.rows[0]?.n) === 0) {
      await sql`update sys_user set state = ${USER_STATE_NO_CITY}
        where uid = ${uid} and state <> ${USER_STATE_NO_ROLE}`.execute(db);
      throw GameError.lang('getCityInfo.not_your_city');
    }
    const other = await sql<{
      cid: number;
    }>`select cid from sys_city where uid = ${uid} limit 1`.execute(db);
    await sql`update sys_user set lastcid = ${other.rows[0]?.cid ?? null} where uid = ${uid}`.execute(
      db,
    );
    throw GameError.lang('getCityInfo.city_be_invaded');
  }

  /** `[cid]`: the building list, after settling due upgrades and demolitions. */
  @GlobalCommand()
  async getCityBuilding(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.buildings.buildingInfo(ctx.uid, phpIntval(param[0]));
  }

  /** `[cid]`: the breakdown shown by the production dialog. */
  @GlobalCommand()
  async getCityProduct(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const product = await this.production.product(ctx.uid, phpIntval(param[0]));
    return CityProductionService.reply(product);
  }
}

/** Port of CityCommand.php (amfphp service): `[uid, cid, sid, type]` -> `[1, type, data]`. */
@Injectable()
@AmfService('CityCommand')
export class CityCommandService {
  private readonly logger = new Logger(CityCommandService.name);

  constructor(
    private readonly scope: DbScope,
    private readonly state: GameStateService,
    private readonly sessions: SessionService,
    private readonly lang: LangService,
    private readonly info: CityInfoService,
  ) {}

  @AmfMethod()
  async sendCommand(param: unknown[]): Promise<unknown[]> {
    const [uidArg, cidArg, sid, type] = param;
    const ret: unknown[] = [1, type];
    try {
      const uid = await this.sessions.verify(uidArg, sid);
      const cid = phpIntval(cidArg);
      if (!phpLooseEquals(await this.state.value(GameState.ServerOpen), 1)) {
        throw GameError.raw('server_is_updating');
      }
      if (phpLooseEquals(type, CityInfoType.Resource)) {
        ret.push(await this.info.resourceInfo(uid, cid));
        await sql`update sys_online set lastupdate = unix_timestamp() where uid = ${uid}`.execute(
          this.scope.db,
        );
      } else if (phpLooseEquals(type, CityInfoType.Hero)) {
        ret.push(await this.info.heroInfo(uid, cid));
      } else if (phpLooseEquals(type, CityInfoType.Army)) {
        ret.push(await this.info.armyInfo(uid, cid));
      } else if (phpLooseEquals(type, CityInfoType.Defence)) {
        ret.push(await this.info.defenceInfo(uid, cid));
      } else if (phpLooseEquals(type, CityInfoType.Time)) {
        ret.push([await dbNow(this.scope.db)]);
      }
      return ret;
    } catch (err) {
      if (!(err instanceof GameError)) {
        this.logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
      }
      return [0, this.lang.messageOf(err)];
    }
  }
}
