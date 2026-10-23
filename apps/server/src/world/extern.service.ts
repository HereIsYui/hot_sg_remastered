import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { phpEmpty, phpIntval, phpNum } from '../core/php';
import { DbScope } from '../db/database.module';
import { AmfMethod, AmfService } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** 烽火台 building id (common.php ID_BUILDING_BALEFIRE). */
const ID_BUILDING_BALEFIRE = 19;

/**
 * ExternService.php::getTroopMaxTime: the 出征面板 asks for a per-target march-time cap. The
 * original only ever caps (to 900s) while a hardcoded 2011 promo window is open and returns 0
 * everywhere else, so in practice it returns 0 for every call — but the window check is kept so
 * the differential test matches the legacy result byte for byte.
 *
 * The wild-field NPC check is also part of the original comment but, like there, only matters
 * inside the promo window.
 */
@Injectable()
@AmfService('ExternService')
export class ExternService {
  constructor(private readonly scope: DbScope) {}

  /** `ExternService::getTroopMaxTime($x,$y)` → `getTroopMaxTime2`. */
  @AmfMethod()
  async getTroopMaxTime(param: unknown[]): Promise<number> {
    const x = phpIntval(param[0]);
    const y = phpIntval(param[1]);
    return this.getTroopMaxTime2(x, y);
  }

  /**
   * `ExternService::getTroopMaxTime2`: 900s cap for a human-owned (uid > 1000) target tile, else
   * 0, but only while the 2011 promo window is open; otherwise 0. StartTroop calls this directly.
   */
  async getTroopMaxTime2(x: number, y: number): Promise<number> {
    const inWindow =
      (await this.between('2011-06-11 19:00:00', '2011-06-11 23:00:00')) ||
      (await this.between('2011-06-12 19:00:00', '2011-06-12 23:00:00'));
    if (!inWindow) return 0;

    const wid = Math.floor(y / 10) * 10000 + Math.floor(x / 10) * 100 + (y % 10) * 10 + (x % 10);
    const cid = await this.cell(sql<Row>`select ownercid from mem_world where wid = ${wid}`);
    if (!cid) return 0;
    const uid = await this.cell(sql<Row>`select uid from sys_city where cid = ${cid}`);
    return phpNum(uid) > 1000 ? 900 : 0;
  }

  /**
   * `ExternService::getEnemyTroopSet($cid)`: the 敌军过滤 panel reads a city's per-action minimum
   * troop sizes from `sys_enemy_troop_filter`. A read with no 烽火台-level guard here (the write is
   * what the original gates); an un-configured city simply returns an empty list.
   */
  @AmfMethod()
  async getEnemyTroopSet(param: unknown[]): Promise<Row[]> {
    const cid = phpIntval(param[0]);
    return this.rows(sql<Row>`select * from sys_enemy_troop_filter where cid = ${cid}`);
  }

  /**
   * `ExternService::saveEnemyTroopSet($cid, $actions)`: save the 敌军过滤 thresholds. Requires the
   * city's 烽火台 at level ≥ 5 (an absent or lower level throws `enemyfilter.firelevelhow`), then
   * upserts each `{action, count}` row and marks goal 539 done for the city's owner. `$actions`
   * arrives as a list of objects over the wire.
   */
  @AmfMethod()
  async saveEnemyTroopSet(param: unknown[]): Promise<void> {
    const cid = phpIntval(param[0]);
    const actions = Array.isArray(param[1]) ? (param[1] as Row[]) : [];
    const level = await this.cell(sql<Row>`select level from sys_building
      where cid = ${cid} and bid = ${ID_BUILDING_BALEFIRE} limit 1`);
    if (phpEmpty(level) || phpNum(level) < 5) {
      throw GameError.lang('enemyfilter.firelevelhow');
    }
    for (const action of actions) {
      const act = phpIntval((action as Row).action);
      const cnt = phpIntval((action as Row).count);
      await sql`insert into sys_enemy_troop_filter (cid, action, \`count\`)
        values (${cid}, ${act}, ${cnt})
        on duplicate key update \`count\` = ${cnt}`.execute(this.scope.db);
    }
    const uid = await this.cell(sql<Row>`select uid from sys_city where cid = ${cid}`);
    await sql`replace into sys_user_goal (uid, gid) values (${phpIntval(uid)}, 539)`.execute(
      this.scope.db,
    );
  }

  /** `ExternService::between`: now within [begin, end], both parsed by the DB clock. */
  private async between(begin: string, end: string): Promise<boolean> {
    const row = (
      await sql<{ hit: number }>`select unix_timestamp() between unix_timestamp(${begin})
        and unix_timestamp(${end}) as hit`.execute(this.scope.db)
    ).rows[0];
    return phpIntval(row?.hit) === 1;
  }

  private async rows(query: ReturnType<typeof sql<Row>>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows;
  }

  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = (await query.execute(this.scope.db)).rows[0];
    return row ? Object.values(row)[0] : false;
  }
}
