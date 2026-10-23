import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { phpIntval, phpNum } from '../core/php';
import { RandomService } from '../core/random.service';
import { DbScope } from '../db/database.module';
import { array2troop, troop2array } from './battle-math';
import { type ManeuverResult, type ManeuverRow, upManeuver } from './battle-engine';

type Row = Record<string, unknown>;

/**
 * lang.php `$GLOBALS['sid']['type']`: the combat-type each soldier sid belongs to. Horse/foot/bow
 * share ids with their upgraded variants (13->2, 14->4, …). Copied verbatim from lang.php:241.
 */
const SID_TYPE: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  11: 11,
  12: 12,
  13: 2,
  14: 4,
  15: 5,
  16: 6,
  17: 7,
  18: 2,
  19: 4,
  20: 5,
  21: 6,
  22: 7,
  45: 45,
  46: 46,
  47: 47,
  48: 48,
  49: 49,
  50: 50,
};

/**
 * cfg_js.php::upManeuver's NestJS host. Loads the queued `mem_maneuver` row, builds the attacker /
 * defender stat strings from `cfg_soldier` the way `battleInfo`'s empty-`attackadd` branch does
 * (演习 inserts only the troop strings), runs the pure `upManeuver` loop against the injected
 * `RandomService`, and persists the settled result — the exact writes the original made.
 *
 * `settlePatrol` is the 侦察 (task 2) entry: the caller has already built `attackadd`/`resistadd`
 * via battleAdd/defcityadd, so this only runs the loop and returns the patrol result without
 * touching the DB (the original deletes the maneuver row immediately in the patrol branch).
 */
@Injectable()
export class BattleEngineService {
  constructor(
    private readonly scope: DbScope,
    private readonly random: RandomService,
  ) {}

  private rand = (min: number, max: number): number => this.random.mtRand(min, max);

  /** HandleBattle-adjacent 演习 settlement: settle every pending `mem_maneuver` (state 0). */
  async settlePendingManeuvers(): Promise<number> {
    const rows = (await sql<Row>`select * from mem_maneuver where state = 0`.execute(this.scope.db))
      .rows;
    let settled = 0;
    for (const row of rows) {
      await this.settleManeuver(phpIntval(row.id));
      settled++;
    }
    return settled;
  }

  /** Settle one 演习 row (`$patrol=0`): build stats if needed, run the loop, write the result. */
  async settleManeuver(id: number): Promise<ManeuverResult | null> {
    const db = this.scope.db;
    const row = (
      await sql<Row>`select * from mem_maneuver where id = ${id} and state = 0`.execute(db)
    ).rows[0];
    if (!row) return null;

    const attackadd = await this.ensureAdd(id, 'attackadd', String(row.attacksoldiers ?? ''));
    const resistadd = await this.ensureAdd(id, 'resistadd', String(row.resistsoldiers ?? ''));

    const maneuver: ManeuverRow = {
      attacksoldiers: String(row.attacksoldiers ?? ''),
      resistsoldiers: String(row.resistsoldiers ?? ''),
      attackadd,
      resistadd,
      wallhp: phpNum(row.wallhp),
    };

    // Re-run the full loop to capture the per-side die strings the original persisted (round-40
    // cap collapses to end 2 in both forms; the non-patrol write keeps `result` as 0/1/2).
    const result = upManeuver(maneuver, this.rand);

    await sql`update mem_maneuver set state = 1, result = ${result.end}, round = ${result.round},
      attackdie = ${array2troop(result.attackLost)},
      resistdie = ${array2troop(result.resistLost)} where id = ${id}`.execute(db);
    return result;
  }

  /**
   * Run the loop for the 侦察 patrol branch: inputs already carry `attackadd`/`resistadd`, so no DB
   * read/write happens here (the caller deletes the row). Returns the patrol-shaped result.
   */
  settlePatrol(maneuver: ManeuverRow): ManeuverResult {
    return upManeuver(maneuver, this.rand);
  }

  /**
   * battleInfo's "no precomputed add" branch: when a 演习 row has no `attackadd`/`resistadd`, build
   * it from `cfg_soldier` and persist it, matching the original's `update mem_maneuver set ...`.
   * The attacker's sids are multiplied by 100 downstream (in `battleInfo`), not here.
   */
  private async ensureAdd(
    id: number,
    column: 'attackadd' | 'resistadd',
    soldiers: string,
  ): Promise<string> {
    const db = this.scope.db;
    const existing = (
      await sql<Row>`select ${sql.ref(column)} as v from mem_maneuver where id = ${id}`.execute(db)
    ).rows[0]?.v;
    if (existing !== null && existing !== undefined && existing !== '') return String(existing);

    const soArray = troop2array(soldiers);
    if (soArray.size === 0) return '';
    const sids = [...soArray.keys()];
    const cfg = (
      await sql<Row>`select * from cfg_soldier where sid in (${sql.join(sids)})`.execute(db)
    ).rows;
    const bySid = new Map<number, Row>();
    for (const r of cfg) bySid.set(phpIntval(r.sid), r);

    const parts: string[] = [];
    for (const [sid, cnt] of soArray) {
      if (cnt <= 0) continue;
      const s = bySid.get(sid);
      if (!s) continue;
      const sidtype = SID_TYPE[sid] ?? 0;
      // sid,type,range,ap,dp,hp,speed,ap,dp,hp,uid(0) — the exact field order battleInfo wrote.
      parts.push(
        [
          sid,
          sidtype,
          phpNum(s.range),
          phpNum(s.ap),
          phpNum(s.dp),
          phpNum(s.hp),
          phpNum(s.speed),
          phpNum(s.ap),
          phpNum(s.dp),
          phpNum(s.hp),
          0,
        ].join(','),
      );
    }
    const info = parts.join(';');
    await sql`update mem_maneuver set ${sql.ref(column)} = ${info} where id = ${id}`.execute(db);
    return info;
  }
}
