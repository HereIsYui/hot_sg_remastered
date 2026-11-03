import { sql } from 'kysely';
import type { Database } from '../db/database.module';
import { phpIntval } from '../core/php';
import type { RandomService } from '../core/random.service';

type Row = Record<string, unknown>;

/**
 * ActFunc.php:31-40 — the two battle-activity helpers shared by the battlefield commands
 * (quitBattle's 戰場活動 rolls here; the hall / battle-time readers read `cfg_act_battle`
 * separately). Exported as plain functions so the other battlefield slices can import them
 * without a provider hop.
 */

/** ActFunc.php::getAvailableBattleActs — the running 战场活动 rows (`type` 3001-3999). */
export async function getAvailableBattleActs(db: Database): Promise<Row[]> {
  return (
    await sql<Row>`select actid, rate, type from cfg_act
      where type between 3001 and 3999 and starttime <= unix_timestamp()
        and endtime >= unix_timestamp()`.execute(db)
  ).rows as Row[];
}

/**
 * ActFunc.php::isLucky — a hit when `mt_rand(minResult, maxResult)` lands at or below
 * `luckyResult`. Drawn through {@link RandomService} so the differential test can script it.
 */
export function isLucky(
  random: RandomService,
  luckyResult: number,
  maxResult: number,
  minResult = 1,
): boolean {
  const rand = random.mtRand(minResult, maxResult);
  return luckyResult >= rand;
}

/** Reads one `cfg_act_battle` rate for a battlefield quit at `nowtimestamp` (BattleFunc.php:2274). */
export async function battleRate(
  db: Database,
  nowtimestamp: unknown,
  bid: unknown,
): Promise<number> {
  const act = (
    await sql<Row>`select * from cfg_act_battle where state > 0 and
      (((weekday(from_unixtime(${nowtimestamp})) + 1) = actid and
        hour(from_unixtime(${nowtimestamp})) between starthour and endhour - 1) or
       (date > 0 and ${nowtimestamp} between date + starthour * 3600 and date + endhour * 3600))
      limit 1`.execute(db)
  ).rows[0] as Row | undefined;
  if (!act) return 1;
  if (phpIntval(act.state) === 1) return Number(act.rate) || 0;
  // state 2 applies only to the battlefields listed in cfg_act_battle_details.
  const inDetails = (
    await sql<Row>`select count(*) as v from cfg_act_battle_details
      where actid = ${phpIntval(act.actid)} and bid = ${phpIntval(bid)}`.execute(db)
  ).rows[0] as Row | undefined;
  return inDetails && Number(inDetails.v) > 0 ? Number(act.rate) || 0 : 1;
}
