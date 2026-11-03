/**
 * utils.php:1558-1591 — the two battlefield helpers shared by every 战场 slice
 * (`battlefield-lifecycle` needs them for createBattle; the tick/dispatch slices reuse them).
 */

import { phpIntval, phpMod, phpNum } from '../core/php';

/** utils.php::battleid2cid — a 战场 strongpoint's sys_battle_city cid. */
export function battleid2cid(battleid: number, citypos: number): number {
  return (battleid + 600) * 1000 + citypos;
}

/**
 * utils.php::createSoldier's `$soldiervalue` table — the per-sid combat value a rolled soldier
 * count is divided by. Index 0 unused (soldier sids start at 1; 13-22 are the regional/NPC sids).
 */
export const SOLDIER_VALUE: number[] = [
  0, 23, 31, 70, 90, 135, 140, 298, 285, 875, 1000, 1375, 2900, 31, 90, 135, 140, 285, 26, 89, 127,
  128, 263,
];

/**
 * utils.php::createSoldier — roll an NPC garrison's soldiers string for one cfg_battle_troop row.
 *
 * The result format is `typecount,sid,count,sid,count,` — WITH the trailing comma the original's
 * string concatenation produced (createBattle writes it into sys_troops.soldiers verbatim).
 *
 * `rand` is PHP `rand()` (RandomService.rand). The draw count must match the original exactly
 * (the 差分固定点): one draw per cfg_battle_troop.soldiers element until `$totalRnd >= 10`, even
 * when a roll lands 0 (the element is then skipped but the draw was still spent) — with a full
 * soldier list the loop keeps drawing `rand() % 1` (always 0) for the remaining types.
 */
export function createSoldier(
  rand: () => number,
  npcValue: number,
  soldiers: string,
  level: number,
): string {
  const times = Math.pow(2, level);
  const value = phpNum(npcValue) * times;
  const soldiersarray = soldiers.split(',');
  let totalRnd = 0;
  const valueMap = new Map<number, number>();
  let typecount = 0;
  for (const sidStr of soldiersarray) {
    // `$rnd = rand() % (10 - $totalRnd)` — the divisor stays >= 1 because the loop breaks as soon
    // as totalRnd reaches 10, before the next draw.
    let rnd = phpMod(rand(), 10 - totalRnd);
    rnd = totalRnd + rnd > 10 ? 10 - totalRnd : rnd;
    if (rnd !== 0) {
      // PHP's numeric-string array keys ($valueMap[$sid]) become int keys.
      valueMap.set(phpIntval(sidStr), rnd);
      totalRnd += rnd;
      typecount++;
    }
    if (totalRnd >= 10) break;
  }
  let npcSoldiers = '';
  for (const [k, v] of valueMap) {
    npcSoldiers += `${k},`;
    // `$soldiervalue[$k]` — cfg soldier sids always fall inside the table (an out-of-range sid
    // would hit PHP's division-by-zero path; assert the in-range read).
    npcSoldiers += `${Math.ceil((value * v * 0.1) / SOLDIER_VALUE[k]!)},`;
  }
  return `${typecount},${npcSoldiers}`;
}
