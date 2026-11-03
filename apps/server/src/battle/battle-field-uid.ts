/**
 * BattleFunc.php helpers shared by the 战场 (BloodBattle) settlement sites:
 *   - resetBattleFieldUid (:4152-4229) — re-judge a stronghold's owning uid/union once troops have
 *     arrived or left. Four outcomes: no `sys_battle_city` row (zeroed result, no write), 空白据点
 *     (uid=-1/unionid=-1/hasuser=0), 争夺中 (mixed camps → uid=0/unionid=0 and `return 0`), and the
 *     two same-camp shapes (同人 → uid kept + ownerunionid; 异人 → uid=0, unionid kept).
 *   - checkBattleResult / check1001 (:3624-3641) — the targettype-3 event gate: bid 1001 (黄巾之乱)
 *     wins when no 张角三兄弟 (hid 1001/1002/1005) NPC troops remain on the battlefield instance.
 *   - battleid2cid (utils.php:1558) + createSoldier (utils.php:1563) — the cfg_battle_troop →
 *     sys_troops NPC rebuild the cfg_battle_event 增兵 trigger runs.
 *   - applyBattlefieldWinPoint (cfg_js.php:594-600 == OLdBattleCron.php:1408-1414) — the
 *     sys_battle_winpoint加减, kept including its never-firing guard (see the function comment).
 */

import { sql } from 'kysely';
import { phpIntval, phpLooseEquals, phpNum } from '../core/php';
import type { Database } from '../db/database.module';

type Row = Record<string, unknown>;

/** The reads/writes resetBattleFieldUid and friends need. */
export interface BattleFieldUidDeps {
  db: Database;
  query(q: ReturnType<typeof sql<Row>>): Promise<Row[]>;
}

/**
 * BattleFunc.php::resetBattleFieldUid — 军队离开某个据点以后重新判定据点的归属. Returns the result
 * array, or the scalar `0` for the contested (mixed-camp) case — the original's literal `return 0;`.
 */
export async function resetBattleFieldUid(deps: BattleFieldUidDeps, cid: number): Promise<Row | 0> {
  const result: Row = { oriuid: 0, oriunionid: 0, uid: 0, unionid: 0 };

  // 在这个据点里战斗的部队或者驻守的部队 都算作这个据点的部队
  const troops = await deps.query(sql<Row>`select * from sys_troops where cid = ${cid}
    and ((state = 4 or state = 3) or targetcid = ${cid})`);

  const oricidinfo = (
    await deps.query(sql<Row>`select uid, unionid from sys_battle_city where cid = ${cid}`)
  )[0];
  if (!oricidinfo) {
    return result;
  }
  result.oriuid = phpNum(oricidinfo.uid);
  result.oriunionid = phpNum(oricidinfo.unionid);

  if (troops.length === 0) {
    // 空白据点
    result.uid = -1;
    result.unionid = -1;
    await sql`update sys_battle_city set uid = -1, unionid = -1, hasuser = 0 where cid = ${cid}`.execute(
      deps.db,
    );
    return result;
  }

  let uid = -1;
  let unionid = -1;
  let sameUid = true;
  let hasuser = 0;
  let first = true;
  for (const troop of troops) {
    if (first) {
      uid = phpIntval(troop.uid);
      unionid = phpIntval(troop.battleunionid);
      first = false;
    } else {
      if (phpIntval(troop.battleunionid) !== unionid) {
        // 不属于同一阵营的驻扎
        await sql`update sys_battle_city set uid = 0, unionid = 0 where cid = ${cid}`.execute(
          deps.db,
        );
        return 0;
      }
      if (phpIntval(troop.uid) !== uid) {
        if (phpIntval(troop.uid) > 0 && uid > 0) {
          // 属于同一阵营但是uid不同,并且都不是NPC军队
          sameUid = false;
        }
        uid = phpIntval(troop.uid);
        unionid = phpIntval(troop.battleunionid);
      }
    }
    if (phpIntval(troop.uid) > 0) {
      // 是否有玩家部队（原注释写 NPC，判定却是 uid > 0）
      hasuser = 1;
    }
  }

  // 所有的都是同一阵营
  if (sameUid) {
    // 属于同一个用户
    await sql`update sys_battle_city set uid = ${uid}, ownerunionid = ${unionid},
      unionid = ${unionid}, hasuser = ${hasuser} where cid = ${cid}`.execute(deps.db);
    result.uid = uid;
    result.unionid = unionid;
  } else {
    // 同一阵营的不同用户
    await sql`update sys_battle_city set uid = 0, unionid = ${unionid},
      hasuser = ${hasuser} where cid = ${cid}`.execute(deps.db);
    result.uid = 0;
    result.unionid = unionid;
  }
  return result;
}

/** BattleFunc.php::checkBattleResult — 判断战场结束时候阵营是否胜利 (1 = 胜, 2 = 未, 0 = 非黄巾). */
export async function checkBattleResult(
  deps: BattleFieldUidDeps,
  bid: number,
  battlefieldid: number,
): Promise<number> {
  if (phpNum(bid) === 1001) {
    return check1001(deps, battlefieldid);
  }
  return 0;
}

/** BattleFunc.php::check1001 — 黄巾之乱：战场里是否还有张角三兄弟的军队. */
async function check1001(deps: BattleFieldUidDeps, battlefieldid: number): Promise<number> {
  const result = await deps.query(sql<Row>`select * from sys_troops where uid = 0
    and battlefieldid = ${phpNum(battlefieldid)} and hid in (1001, 1002, 1005)`);
  if (result.length === 0) return 1;
  return 2;
}

/** utils.php::battleid2cid: a cfg_battle_city xy on battlefield `battleid` → the world cid. */
export function battleid2cid(battleid: number, citypos: number): number {
  return (battleid + 600) * 1000 + citypos;
}

/** utils.php::createSoldier's hardcoded `$soldiervalue` local (NOT $GLOBALS['soldier']). */
const SOLDIER_VALUE = [
  0, 23, 31, 70, 90, 135, 140, 298, 285, 875, 1000, 1375, 2900, 31, 90, 135, 140, 285, 26, 89, 127,
  128, 263,
];

/**
 * utils.php::createSoldier — 随机创建部队: split `npcvalue * 2^level` across the cfg_battle_troop
 * soldier list in random 1..9 shares, then convert each share into soldier counts. `rand` is the
 * raw PHP `rand()` draw (scripted for the difftest). The output keeps the original's TRAILING
 * comma: `typecount,sid,cnt,sid,cnt,...,`.
 *
 * Note on the original's `>10 → clamp` and `>= 10 → break` guards: since `$rnd = rand() %
 * (10 - $totalRnd)` always yields `$rnd < 10 - $totalRnd`, `$totalRnd` can never reach 10 and both
 * guards are unreachable on the legacy server too — kept for line-for-line parity.
 */
export function createSoldier(
  npcValue: number,
  soldiers: string,
  level: number,
  rand: () => number,
): string {
  const times = Math.pow(2, phpNum(level));
  const value = phpNum(npcValue) * times;
  const soldiersarray = soldiers.split(',');
  let totalRnd = 0;
  const valueMap: Array<[number, number]> = [];
  let typecount = 0;
  for (const sidRaw of soldiersarray) {
    const sid = phpIntval(sidRaw);
    let rnd = rand() % (10 - totalRnd);
    if (totalRnd + rnd > 10) rnd = 10 - totalRnd;
    if (rnd !== 0) {
      valueMap.push([sid, rnd]);
      totalRnd += rnd;
      typecount++;
    }
    if (totalRnd >= 10) break;
  }
  let npcSoldiers = '';
  for (const [sid, v] of valueMap) {
    npcSoldiers += `${sid},`;
    // PHP: an out-of-table sid reads NULL and the division warning yields FALSE → (int)ceil → 0.
    const base = SOLDIER_VALUE[sid];
    npcSoldiers += `${base ? Math.ceil((value * v * 0.1) / base) : 0},`;
  }
  return `${typecount},${npcSoldiers}`;
}

/**
 * The sys_battle_winpoint加减 both 战场 settlement sites run after their last resetBattleFieldUid
 * call (cfg_js.php:594-600 for the task-8 arrival, OLdBattleCron.php:1408-1414 for the type-4
 * terminal).
 *
 * FAITHFUL DEAD CODE: the guard is `if ($unionid == $battleunionid)` where $unionid is
 * resetBattleFieldUid's return — an ARRAY in every success path (or the contested scalar 0). PHP
 * never loosely-equals an array with an int, so the legacy winpoint update can only ever fire for a
 * troop whose battleunionid is 0 hitting the contested path. The port keeps the comparison with the
 * same loose semantics instead of rewriting it into what the code "meant" — the 官渡军粮 points stay
 * frozen exactly as on the legacy server.
 */
export async function applyBattlefieldWinPoint(
  deps: BattleFieldUidDeps,
  cid: number,
  battlefieldid: number,
  battleunionid: number,
): Promise<void> {
  const unionid = await resetBattleFieldUid(deps, cid);
  if (Array.isArray(unionid) ? false : phpLooseEquals(unionid, battleunionid)) {
    const wonUnion = unionid as number;
    const tunionid = phpLooseEquals(wonUnion, 3) ? 4 : 3;
    const turn = (
      await deps.query(sql<Row>`select winpoint, losepoint from sys_battle_city where cid = ${cid}`)
    )[0];
    await sql`update sys_battle_winpoint set point = LEAST(10000, point + ${phpNum(turn?.winpoint)})
      where battlefieldid = ${battlefieldid} and unionid = ${wonUnion}`.execute(deps.db);
    await sql`update sys_battle_winpoint set point = GREATEST(0, point - ${phpNum(turn?.losepoint)})
      where battlefieldid = ${battlefieldid} and unionid = ${tunionid}`.execute(deps.db);
  }
}
