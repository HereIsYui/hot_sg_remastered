import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { phpIntval, phpNum } from '../core/php';
import { DbScope } from '../db/database.module';
import { AmfMethod, AmfService } from '../gateway/decorators';

type Row = Record<string, unknown>;

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

  /** `ExternService::between`: now within [begin, end], both parsed by the DB clock. */
  private async between(begin: string, end: string): Promise<boolean> {
    const row = (
      await sql<{ hit: number }>`select unix_timestamp() between unix_timestamp(${begin})
        and unix_timestamp(${end}) as hit`.execute(this.scope.db)
    ).rows[0];
    return phpIntval(row?.hit) === 1;
  }

  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = (await query.execute(this.scope.db)).rows[0];
    return row ? Object.values(row)[0] : false;
  }
}
