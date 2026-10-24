/**
 * UtilsExtend.php::checkSodier / createCityDefence — the on-demand NPC garrison respawn for a
 *无主野地 (wild field, type>0) or an NPC city (type==0, uid<1000). The legacy engine calls it from
 * cfg_js.php HandleTroop at two points:
 *
 *   - line 129, a 侦察 (scout) arrival: `if($field['uid']<1000) checkSodier($field);`
 *   - line 404, a 掠夺/占领/攻击 battle arrival: `if($type<4&&$field['uid']<1000)
 *     $hascreat=checkSodier($field);` — the return value is only consulted indirectly (it writes
 *     the garrison the battle then reads; `$hascreat` itself is not branched on anywhere below).
 *
 * The amount respawned scales with the time since the last respawn (mem_world_schedule.
 * last_create_npc) and the field level / city config, and the mix of soldier types is drawn with
 * `mt_rand` (NPC pick) and `rand()` / `mt_rand` inside createmapSoldier. With the difftest scripted
 * RNG armed (s.rng / s.seed) both sides draw the same sequence, so the respawned garrison is
 * byte-identical on both servers.
 *
 * `choseHero` falls back to `order by rand()` only when a city has heroes but none in state 7/1; a
 * wild NPC field has no city heroes, so it resolves hid 0 deterministically (the `order by rand()`
 * branch — which the scripted RNG cannot pin — is never reached for the field/NPC-city cases the
 * difftest drives; see the doc on choseHero).
 */

import { sql } from 'kysely';
import type { Database } from '../db/database.module';
import { phpIntval, phpNum, phpString } from '../core/php';
import { wid2cid } from '../core/city-rules.service';

type Row = Record<string, unknown>;

/** common.php NPC uid constants. */
const NPC_HUANJIN = 894; // 黄巾军
const NPC_SHICHANGSHI = 896; // 十常侍
const NPC_DONGZHUO = 659; // 董卓

/** UtilsExtend.php sodiertype table (province 14..18 → 匈奴/乌丸/羌/南蛮/山越 by level band). */
const SODIER_TYPE: Record<number, [string, string]> = {
  14: ['87,88,89,90,91', '87,88,89,90,91,92,93,94,95'], // 匈奴
  15: ['78,79,80,81,82', '78,79,80,81,82,83,84,85,86'], // 乌丸
  16: ['51,52,53,54,55', '51,52,53,54,55,56,57,58,59'], // 羌
  17: ['60,61,62,63,64', '60,61,62,63,64,65,66,67,68'], // 南蛮
  18: ['69,70,71,72,73', '69,70,71,72,73,74,75,76,77'], // 山越
};

/** createCityDefence per-level `did,count` seed rows (UtilsExtend.php). Level 1 is a no-op in the
 * original (the `$count` var is undefined → the inserted value is empty), reproduced faithfully. */
const CITY_DEFENCE: Record<number, [number, number][]> = {
  2: [[1, 11082], [2, 6212]],
  3: [[1, 12365], [2, 6418], [3, 3980]],
  4: [[1, 13333], [2, 6666], [3, 4445]],
  5: [[1, 12687], [2, 6344], [3, 4229], [4, 2985]],
  6: [[1, 13662], [2, 7631], [3, 5088], [4, 3553]],
  7: [[1, 14644], [2, 7322], [3, 4881], [4, 3381], [5, 2509]],
  8: [[1, 16828], [2, 8414], [3, 5610], [4, 3847], [5, 2826]],
  9: [[1, 19035], [2, 9518], [3, 6345], [4, 4309], [5, 3132]],
  10: [[1, 21265], [2, 10633], [3, 7088], [4, 4767], [5, 3428]],
};

/** Collaborators checkSodier needs, injected so the logic stays testable against a FakeDb. */
export interface CheckSodierDeps {
  db: Database;
  query(q: ReturnType<typeof sql<Row>>): Promise<Row[]>;
  one(q: ReturnType<typeof sql<Row>>): Promise<Row | false>;
  cell(q: ReturnType<typeof sql<Row>>): Promise<unknown>;
  /** `$GLOBALS['soldier']['soldiervalue']` (index 0 unused). */
  soldierValue(): number[];
  addCitySoldiers(cid: number, soldiers: Map<number, number>, add: boolean): Promise<void>;
  /** PHP `rand()` with no args: the raw draw (0..PHP_RAND_MAX). */
  rand(): number;
  /** PHP `mt_rand($min,$max)`, both ends inclusive. */
  mtRand(min: number, max: number): number;
}

/**
 * UtilsExtend.php::checkSodier($field). Respawns / tops up the NPC garrison on a wild field or NPC
 * city. Returns 0 when it produced no soldiers (the original's `return 0`), undefined otherwise —
 * matching the legacy's implicit return.
 */
export async function checkSodier(deps: CheckSodierDeps, field: Row): Promise<number | void> {
  const type = phpIntval(field.type);
  const wid = phpIntval(field.wid);
  const cid = wid2cid(wid);
  const level = phpIntval(field.level);
  let uid = phpIntval(field.uid);
  const hid = await choseHero(deps, cid);

  const sProvince = phpIntval(await deps.cell(sql<Row>`select province from mem_world where wid = ${wid}`));

  if (uid >= 1000) return;

  // Occupied NPC city with a positive level builds its city defence first.
  if (type === 0 && uid < 1000 && level > 0) {
    await createCityDefence(deps, field);
  }

  // Time scale since the last respawn.
  let time = phpNum(
    await deps.cell(
      sql<Row>`select (unix_timestamp() - last_create_npc) / 3600 as v from mem_world_schedule where wid = ${wid}`,
    ),
  );
  if (!time || time > 1) time = 1;
  else if (time <= 0) time = 0.0005;

  let soldierType = '';
  let npcValue: number;

  if (type === 0) {
    // 占领情况 (NPC city).
    if (uid === NPC_HUANJIN) soldierType = '18,19,20,21,22';
    else if (uid === 896 || uid === NPC_SHICHANGSHI) soldierType = '23,24,25,26,27';
    else if (uid === 659 || uid === NPC_DONGZHUO) soldierType = '28,29,30,31,32';
    else {
      if (level < 8) {
        if (sProvince < 14) soldierType = '1,2,3,4,5,6,7';
        if (sProvince > 14) soldierType = SODIER_TYPE[sProvince]?.[0] ?? soldierType;
      } else {
        soldierType = '1,2,3,4,5,6,7,8,9,10,11,12';
        if (sProvince > 14) soldierType = SODIER_TYPE[sProvince]?.[1] ?? soldierType;
      }
    }
    // BUG-FAITHFUL: the original reads cfg_bigcity_npcvalue into $npcValue, then guards the
    // fallback on $npcvalue (lowercase, undefined) — so the city-level fallback ALWAYS runs,
    // overwriting the bigcity value. Mirror that: read bigcity (unused), then always read city.
    void (await deps.cell(sql<Row>`select npcvalue from cfg_bigcity_npcvalue where cid = ${cid}`));
    npcValue = phpNum(
      await deps.cell(sql<Row>`select npcvalue from cfg_city_npcvalue where level = ${level}`),
    );
    const cityType = phpNum(await deps.cell(sql<Row>`select type from sys_city where cid = ${cid}`));
    if (cityType > 0) npcValue *= 3.5;
  } else {
    // 野地情况 (wild field).
    npcValue = phpNum(
      await deps.cell(sql<Row>`select npcvalue from cfg_field_npcvalue where level = ${level}`),
    );
    uid = deps.mtRand(0, 5);
    switch (uid) {
      case 1:
        soldierType = '18,19,20,21,22';
        if (sProvince > 14) soldierType = SODIER_TYPE[sProvince]?.[0] ?? soldierType;
        break;
      case 2:
        soldierType = '23,24,25,26,27';
        if (sProvince > 14) soldierType = SODIER_TYPE[sProvince]?.[0] ?? soldierType;
        break;
      case 3:
        soldierType = '28,29,30,31,32';
        if (sProvince > 14) soldierType = SODIER_TYPE[sProvince]?.[0] ?? soldierType;
        break;
      default:
        soldierType = '13,14,15,16,17';
        if (sProvince > 14) soldierType = SODIER_TYPE[sProvince]?.[0] ?? soldierType;
        break;
    }
    const hasNpcHero = await deps.one(
      sql<Row>`select cid from sys_city_hero where npcid <> 0 and cid = ${cid}`,
    );
    if (hasNpcHero) {
      if (level < 8) {
        soldierType = '1,2,3,4,5,6,7';
        if (sProvince > 14) soldierType = SODIER_TYPE[sProvince]?.[0] ?? soldierType;
      } else {
        soldierType = '1,2,3,4,5,6,7,8,9,10';
        if (sProvince > 14) soldierType = SODIER_TYPE[sProvince]?.[1] ?? soldierType;
      }
    }
    npcValue *= 1.1;
    if (sProvince > 14) npcValue *= 2.1;
  }

  if (!npcValue) npcValue = type === 0 ? 5000 : 500;

  if (type > 0) {
    // Wild field: the stationed NPC troop (sys_troops) is the carrier.
    const oldTroop = await deps.one(
      sql<Row>`select * from sys_troops where cid = ${cid} and uid < 1000 order by id asc limit 1`,
    );
    let soValue = 0;
    if (oldTroop) {
      uid = phpIntval(oldTroop.uid);
      soldierType = checkSoldierType(phpString(oldTroop.soldiers));
      soValue = sol2Value(deps, phpString(oldTroop.soldiers));
    }
    npcValue = (npcValue - soValue) * time;
    const soldierArray = createmapSoldier(deps, npcValue, soldierType, type);
    let soldiers: string;
    if (oldTroop) soldiers = addTroopArray(deps, oldTroop, soldierArray);
    else soldiers = array2troop(soldierArray);
    if (soldiers !== '0' && soldiers !== '') {
      await sql`delete from sys_troops where cid = ${cid} and uid < 1000`.execute(deps.db);
      const value = sol2ValueMap(deps, soldierArray, oldTroop ? troop2arrayMerge(deps, oldTroop, soldierArray) : undefined);
      const resource = v2r(deps, value, type);
      await sql`insert into sys_troops (uid, cid, hid, task, state, soldiers, resource)
        values (${uid}, ${cid}, ${hid}, 5, 4, ${String(soldiers)}, ${resource})`.execute(deps.db);
    } else {
      return 0;
    }
  } else {
    // NPC city: the garrison lives in sys_city_soldier.
    let soValue = 0;
    const oldTroops = await deps.query(
      sql<Row>`select * from sys_city_soldier where cid = ${cid} and count > 0`,
    );
    const oldArray = new Map<number, number>();
    if (oldTroops.length) {
      for (const t of oldTroops) oldArray.set(phpIntval(t.sid), phpNum(t.count));
      soValue = sol2ValueFromMap(deps, oldArray);
    }
    npcValue = (npcValue - soValue) * time;
    const soldierArray = createmapSoldier(deps, npcValue, soldierType, type);
    if (soldierArray.size && !(soldierArray.size === 1 && soldierArray.has(0))) {
      await deps.addCitySoldiers(cid, soldierArray, true);
    } else {
      return 0;
    }
  }

  await sql`insert into mem_world_schedule (wid, last_create_npc) values (${wid}, unix_timestamp())
    on duplicate key update last_create_npc = unix_timestamp()`.execute(deps.db);
}

/** UtilsExtend.php::createCityDefence($field): seed / top up the NPC city defences. */
export async function createCityDefence(deps: CheckSodierDeps, field: Row): Promise<void> {
  const type = phpIntval(field.type);
  const wid = phpIntval(field.wid);
  const cid = wid2cid(wid);
  const level = phpIntval(field.level);
  const uid = phpIntval(field.uid);
  if (!(type === 0 && uid < 1000)) return;

  let time = phpNum(
    await deps.cell(
      sql<Row>`select (unix_timestamp() - last_create_defence) / 3600 as v from mem_world_schedule where wid = ${wid}`,
    ),
  );
  if (!time || time > 1) time = 1;
  else if (time <= 0) time = 0.0005;

  const rows = CITY_DEFENCE[level];
  // Level 1 (or unmapped) builds nothing (the original's `$sql` is an undefined-count no-op).
  if (!rows) return;

  for (const [did, count] of rows) {
    // on duplicate: grow by count*time, clamped to the full count and the 4294967000 overflow cap.
    await sql`insert into sys_city_defence (cid, did, count) values (${cid}, ${did}, ${count})
      on duplicate key update count = case
        when ((count + ${count} * ${time}) > 4294967000) then 0
        when ((count + ${count} * ${time}) > ${count}) then ${count}
        else (count + ${count} * ${time}) end`.execute(deps.db);
  }
  await sql`insert into mem_world_schedule (wid, last_create_defence) values (${wid}, unix_timestamp())
    on duplicate key update last_create_defence = unix_timestamp()`.execute(deps.db);
}

// ───────────────────────── UtilsExtend.php helpers ─────────────────────────

/**
 * UtilsExtend.php::choseHero($cid): a stationed hero in state 7, else state 1, else a random one
 * (`order by rand()`), else 0. The random branch is only reached when a city HAS heroes but none
 * stationed — never for a wild NPC field (no heroes) — so the difftest cases resolve 0 or a fixed
 * state-7/1 hero and never hit the unpinnable `order by rand()`.
 */
async function choseHero(deps: CheckSodierDeps, cid: number): Promise<number> {
  let hid = phpNum(
    await deps.cell(sql<Row>`select hid from sys_city_hero where cid = ${cid} and state = 7 limit 1`),
  );
  if (!hid) {
    hid = phpNum(
      await deps.cell(sql<Row>`select hid from sys_city_hero where cid = ${cid} and state = 1 limit 1`),
    );
  }
  if (!hid) {
    hid = phpNum(
      await deps.cell(sql<Row>`select hid from sys_city_hero where cid = ${cid} order by rand() limit 1`),
    );
  }
  return hid || 0;
}

/** UtilsExtend.php::checkSoldierType: the comma-joined sid list of a troop string. */
function checkSoldierType(soldiers: string): string {
  const arr = troop2array(soldiers);
  return [...arr.keys()].join(',');
}

/** UtilsExtend.php::sol2Value for a troop STRING. */
function sol2Value(deps: CheckSodierDeps, soldiers: string): number {
  return sol2ValueFromMap(deps, troop2array(soldiers));
}

/** UtilsExtend.php::sol2Value for an already-parsed sid→count map. */
function sol2ValueFromMap(deps: CheckSodierDeps, soldiers: Map<number, number>): number {
  const sv = deps.soldierValue();
  let exp = 0;
  for (const [sid, cnt] of soldiers) exp += Math.floor((cnt * (sv[sid] ?? 0)) / 0.784);
  return Math.floor(exp);
}

/** sol2Value over the soldiers that were actually stored (new-only map, or merged with oldTroop). */
function sol2ValueMap(
  deps: CheckSodierDeps,
  fresh: Map<number, number>,
  merged?: Map<number, number>,
): number {
  return sol2ValueFromMap(deps, merged ?? fresh);
}

/** The merged sid→count map an oldTroop + fresh respawn produces (for the resource/value calc). */
function troop2arrayMerge(
  _deps: CheckSodierDeps,
  oldTroop: Row,
  fresh: Map<number, number>,
): Map<number, number> {
  const merged = new Map<number, number>(troop2array(phpString(oldTroop.soldiers)));
  for (const [sid, cnt] of fresh) merged.set(sid, (merged.get(sid) ?? 0) + cnt);
  return merged;
}

/**
 * UtilsExtend.php::createmapSoldier($npcValue, $soldierType, $type). Returns an sid→count map
 * (ksorted). Two RNG regimes mirrored exactly:
 *   - <6 types: `rand()` RAW then `% (100 - totalRnd)` per sid.
 *   - >=6 types: arsort the sid list (desc), then per sid `mt_rand(1,5)==1 && type!=0 ? 0 :
 *     mt_rand(0, 100-totalRnd)`, halved down while >10, last entry filled to 100.
 */
export function createmapSoldier(
  deps: CheckSodierDeps,
  npcValue: number,
  soldierType: string,
  type: number,
): Map<number, number> {
  const soldiersarray = soldierType.split(',').map((s) => phpIntval(s));
  const count = soldiersarray.length;
  const sv = deps.soldierValue();
  let totalRnd = 0;
  const valueMap = new Map<number, number>();

  if (count < 6) {
    for (const sid of soldiersarray) {
      const span = 100 - totalRnd;
      let rnd = span > 0 ? deps.rand() % span : 0;
      rnd = totalRnd + rnd > 100 ? 100 - totalRnd : rnd;
      if (rnd !== 0) {
        valueMap.set(sid, rnd);
        totalRnd += rnd;
      }
      if (totalRnd > 100) break;
    }
  } else {
    // arsort: values are the sids themselves (foreach $soldiersarray as $sid) — PHP arsort sorts
    // by VALUE descending, so the iteration order is the sid list sorted descending.
    const sorted = [...soldiersarray].sort((a, b) => b - a);
    let nowcount = 0;
    for (const sid of sorted) {
      let rnd = deps.mtRand(1, 5) === 1 && type !== 0 ? 0 : deps.mtRand(0, 100 - totalRnd);
      for (; rnd > 10; rnd = Math.floor(rnd / 2)) {
        /* halve down */
      }
      if (nowcount === count - 1) rnd = 100 - totalRnd;
      rnd = totalRnd + rnd > 100 ? 100 - totalRnd : rnd;
      if (rnd !== 0) {
        valueMap.set(sid, rnd);
        totalRnd += rnd;
      }
      if (totalRnd >= 100) break;
      nowcount++;
    }
  }

  const troops = new Map<number, number>();
  for (const [k, v] of valueMap) {
    if (k > 0 && v > 0) {
      const c = Math.floor((npcValue * v * 0.0078) / (sv[k] ?? Infinity));
      if (c >= 1) troops.set(k, c);
    }
  }
  if (troops.size === 0) {
    troops.set(0, 0); // mirrors PHP `$troops[] = 0` (a [0=>0] marker)
    return troops;
  }
  // ksort
  return new Map([...troops.entries()].sort((a, b) => a[0] - b[0]));
}

/** UtilsExtend.php::v2r($value,$type): troop → resource string. type 0 (field respawn) → 0. */
export function v2r(deps: CheckSodierDeps, value: number, type: number): string {
  if (value <= 0) return '0';
  value /= 10;
  let gold = 0;
  let food = 0;
  let wood = 0;
  let rock = 0;
  let iron = 0;
  let temp: number | undefined;
  switch (type) {
    case 0:
      break;
    case 1:
      temp = deps.mtRand(0, 4);
      break;
    case 2:
      temp = 3;
      break;
    case 3:
      temp = 2;
      break;
    case 4:
      temp = 1;
      break;
    case 5:
      temp = 4;
      break;
    case 6:
      temp = 1;
      break;
    case 7:
      temp = 1;
      break;
  }
  switch (temp) {
    case 0:
      gold = Math.floor(value / 10);
      break;
    case 1:
      food = Math.floor(value);
      break;
    case 2:
      wood = Math.floor(value);
      break;
    case 3:
      rock = Math.floor(value / 2);
      break;
    case 4:
      iron = Math.floor(value * 0.4);
      break;
  }
  gold = gold < 0 ? 0 : gold;
  food = food < 0 ? 0 : food;
  wood = wood < 0 ? 0 : wood;
  rock = rock < 0 ? 0 : rock;
  iron = iron < 0 ? 0 : iron;
  return `${gold},${food},${wood},${rock},${iron},`;
}

/**
 * UtilsExtend.php::add_troop_array($troop, $soldierArray): merge the fresh respawn into an existing
 * troop's soldiers, returning `num,sid,cnt,sid,cnt` (NO trailing comma; getArrayMerge order — the
 * oldTroop's keys first, then any new sids). Returns '0' when nothing positive remains.
 */
function addTroopArray(_deps: CheckSodierDeps, troop: Row, soldierArray: Map<number, number>): string {
  const target = troop2array(phpString(troop.soldiers));
  // getArrayMerge($soldierArray, $target): keys of $soldierArray first, then $target's extras; a
  // shared key SUMS. (array operator semantics differ, but the game's getArrayMerge adds.)
  const merged = new Map<number, number>();
  for (const [sid, cnt] of soldierArray) merged.set(sid, cnt);
  for (const [sid, cnt] of target) merged.set(sid, (merged.get(sid) ?? 0) + cnt);
  let soldiers = '';
  let comma = '';
  let num = 0;
  for (const [sid, cnt] of merged) {
    if (sid > 0 && cnt > 0) {
      soldiers += comma + `${sid},${cnt}`;
      comma = ',';
      num++;
    }
  }
  return soldiers ? `${num},${soldiers}` : '0';
}

/**
 * UtilsExtend.php::array2troop (the $def=0 form): `num,sid,cnt,sid,cnt,` WITH a trailing comma,
 * keys in iteration (ksorted, from createmapSoldier) order; empty → scalar `0`.
 */
export function array2troop(soldiers: Map<number, number>): string {
  let out = '';
  let i = 0;
  for (const [sid, cnt] of soldiers) {
    if (cnt > 0) {
      out += `${sid},${cnt},`;
      i++;
    }
  }
  return i ? `${i},${out}` : '0';
}

/** UtilsExtend.php::troop2array: `count,sid,n,...` → sid→count (positive only). */
function troop2array(soldiers: string): Map<number, number> {
  const out = new Map<number, number>();
  if (!soldiers || soldiers === '0') return out;
  const parts = soldiers.split(',');
  const num = phpIntval(parts.shift());
  for (let i = 0; i < num; i++) {
    const sid = phpIntval(parts.shift());
    const cnt = phpNum(parts.shift());
    if (cnt > 0) out.set(sid, cnt);
  }
  return out;
}
