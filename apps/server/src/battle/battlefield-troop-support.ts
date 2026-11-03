/**
 * BattleFunc.php battlefield-troop helpers shared by the troop-support commands (and reusable by
 * the sibling battlefield slices): the two "am I still in a battlefield" readers, the
 * mem_battle_event_mark cooldown, the sys_troop_things add/remove pair, the soldiers-string
 * codec, `enhanceArmy` (+ its `reGeneratePathTime`), `resetBattleFieldUid` and the two battle
 * event writers. Each function mirrors one PHP function line for line; PHP semantics come from
 * core/php.ts (loose compares, empty(), string-number juggling, insertion-ordered arrays).
 *
 * Out of scope (cross-server stubs, same verdict as stage 8): `sendRemoteRequest` /
 * `sendRemote9001Request` / `sendChibiRemoteRequest` (BattleNetFunc.php / ChibiNetFunc.php) —
 * BATTLE_NET_ENABLE / CHIBI_NET_ENABLE are false in the standalone package and both throw an
 * empty Exception when reached; callers in this slice reproduce exactly that.
 */

import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import type { Database } from '../db/database.module';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';

type Row = Record<string, unknown>;

/** The query helpers every helper below needs (a slice of the command service's deps). */
export interface BattlefieldDeps {
  db: Database;
  query(q: ReturnType<typeof sql<Row>>): Promise<Row[]>;
  one(q: ReturnType<typeof sql<Row>>): Promise<Row | false>;
  cell(q: ReturnType<typeof sql<Row>>): Promise<unknown>;
  /** `$GLOBALS[<group>][<key>]` as a string (LangService.t). */
  lang(key: string): string;
}

/**
 * BattleFunc.php:18 firstGetUserBattleInfo — the battlefield row (sys_user_battle_state joined
 * with sys_user_battle_field / cfg_battle_field / sys_user) for a user with `state=0`. Empty
 * throws `battle.user_not_in_battle` unless `$emptythrow` is falsy; a frozen field (field
 * `state=1`) throws `battle.battle_froze`. Note the selected `state` is the FIELD's (u.state is
 * not selected), exactly as in the original.
 */
export async function firstGetUserBattleInfo(
  deps: BattlefieldDeps,
  uid: number,
  emptythrow = 1,
): Promise<Row | false> {
  const userbattleinfo = await deps.one(sql<Row>`select su.honour, u.unionid, u.battlefieldid,
      b.bid, b.createuid, b.level, b.maxpeople, b.starttime, b.endtime, b.type, b.state, b.winner,
      u.in_cross_battle, c.name
    from sys_user_battle_state u
    left join sys_user_battle_field b on u.battlefieldid = b.id
    left join cfg_battle_field c on b.bid = c.id
    left join sys_user su on u.uid = su.uid
    where u.state = 0 and u.uid = ${uid}`);
  if (phpEmpty(userbattleinfo)) {
    if (!phpEmpty(emptythrow)) throw GameError.lang('battle.user_not_in_battle');
    return userbattleinfo;
  }
  if (phpIntval((userbattleinfo as Row).state) === 1) {
    throw GameError.lang('battle.battle_froze');
  }
  return userbattleinfo;
}

/**
 * BattleFunc.php:67 ifFrozeExit — the same gate with the field's type/progress/level columns.
 * Used by the battle actions (callArmy / fasterArmy / battleAttack / battleTroopDispatch).
 */
export async function ifFrozeExit(deps: BattlefieldDeps, uid: number): Promise<Row> {
  const userbattleinfo = await deps.one(sql<Row>`select s.unionid, s.battlefieldid, su.honour,
      f.type, f.state, f.bid, f.progress, f.level
    from sys_user_battle_state s
    left join sys_user_battle_field f on s.battlefieldid = f.id
    left join sys_user su on s.uid = su.uid
    where s.state = 0 and s.uid = ${uid}`);
  if (phpEmpty(userbattleinfo)) {
    throw GameError.lang('battle.user_not_in_battle');
  }
  if (phpIntval((userbattleinfo as Row).state) === 1) {
    throw GameError.lang('battle.battle_froze');
  }
  return userbattleinfo as Row;
}

/**
 * BattleFunc.php:4276 enoughIntervalFromLastMark — true when `interval` seconds have passed since
 * the mem_battle_event_mark row (battlefieldid, mark_id, option1); with `update` the mark is
 * written in place (insert when missing). questInCity's 60s 探索 cooldown and (commented-out)
 * callArmy's 300s 援军令 cooldown both go through it.
 */
export async function enoughIntervalFromLastMark(
  deps: BattlefieldDeps,
  battlefieldid: number,
  markid: number,
  option1: number,
  update = false,
  interval = 300,
): Promise<boolean> {
  const lastRunInfo = await deps.one(sql<Row>`select * from mem_battle_event_mark
    where battlefieldid = ${battlefieldid} and mark_id = ${markid} and option1 = ${option1}`);
  let lastRunTime = 0;
  if (!phpEmpty(lastRunInfo)) {
    lastRunTime = phpNum((lastRunInfo as Row).time);
  }
  const nowtime = phpNum(await deps.cell(sql<Row>`select unix_timestamp() as v`));
  if (nowtime - lastRunTime >= interval) {
    if (update) {
      if (phpEmpty(lastRunInfo)) {
        await sql`insert into mem_battle_event_mark (battlefieldid, mark_id, option1, \`time\`)
          values (${battlefieldid}, ${markid}, ${option1}, unix_timestamp())`.execute(deps.db);
      } else {
        await sql`update mem_battle_event_mark set \`time\` = unix_timestamp()
          where id = ${phpIntval((lastRunInfo as Row).id)}`.execute(deps.db);
      }
    }
    return true;
  }
  return false;
}

/** BattleFunc.php:4296 addTroopThings — the troop's carried 玉玺/罪证 items (on-duplicate add). */
export async function addTroopThings(
  deps: BattlefieldDeps,
  uid: number,
  troopid: number,
  tid: number,
  cnt: number,
): Promise<void> {
  await sql`insert into sys_troop_things (uid, troop_id, thing_id, \`count\`)
    values (${uid}, ${troopid}, ${tid}, ${cnt})
    on duplicate key update \`count\` = \`count\` + ${cnt}`.execute(deps.db);
}

/** BattleFunc.php:4299 removeTroopThings. */
export async function removeTroopThings(
  deps: BattlefieldDeps,
  troopid: number,
  tid: number,
): Promise<void> {
  await sql`delete from sys_troop_things where troop_id = ${troopid} and thing_id = ${tid}`.execute(
    deps.db,
  );
}

/**
 * BattleFunc.php:3544 getSoldierPeople — the SUM OF THE COUNTS of a `num,sid,n,...` string (the
 * name says "people" but no SOLDIER_PEOPLE lookup happens; callArmy's size limit uses it).
 */
export function getSoldierPeople(soldiers: unknown): number {
  const soldiersarray = phpString(soldiers).split(',');
  const count = phpIntval(soldiersarray.shift());
  let people = 0;
  for (let i = 0; i < count; i++) {
    soldiersarray.shift(); // sid
    people += phpNum(soldiersarray.shift());
  }
  return people;
}

/**
 * BattleFunc.php:3643 getSoldierMap — `num,sid,n,...` → sid→count in insertion order. An empty
 * string reads as "0," (an empty map). Values stay as parsed (numbers); keys are the sids.
 */
export function getSoldierMap(orisoldiers: unknown): Map<number, number> {
  let s = phpString(orisoldiers);
  if (phpLooseEquals(s, '')) s = '0,';
  const reinforcearray = s.split(',');
  const reinforcecount = phpIntval(reinforcearray.shift());
  const reinforcemap = new Map<number, number>();
  for (let i = 0; i < reinforcecount; i++) {
    const sid = phpIntval(reinforcearray.shift());
    const count = phpNum(reinforcearray.shift());
    reinforcemap.set(sid, count);
  }
  return reinforcemap;
}

/**
 * BattleFunc.php:3660 getSoldierString — the inverse: `num,sid,n,...` over the entries with
 * count > 0, or "" when none (callBackArmy branches on that empty string). The original computed
 * `count($soldiersmap)` into an unused variable — all zero-count entries are dropped here.
 */
export function getSoldierString(soldiersmap: Map<number, number>): string {
  let newsoldierscount = 0;
  let newsoldiers = '';
  for (const [sid, count] of soldiersmap) {
    if (count > 0) {
      newsoldiers += `,${sid},${count}`;
      newsoldierscount++;
    }
  }
  if (newsoldierscount > 0) newsoldiers = `${newsoldierscount}${newsoldiers}`;
  return newsoldiers;
}

/**
 * BattleFunc.php:2723 reGeneratePathTime — recompute the march time (s) after the army changed:
 * `162000 / slowest speed`, with the 步行/骑术 tech (tid 12/13), the hero's speed_add_on and the
 * equipment speed attribute (attid 2000+sid*100+11). Quirks kept: `$speedAdd` is declared inside
 * the loop in PHP and therefore LEAKS across cfg_soldier rows (the last sid 1..12 row's value
 * persists for sids 45..50); an unknown/empty hero row leaves speedAddRate3 at 1.
 */
export async function reGeneratePathTime(
  deps: BattlefieldDeps,
  cid: number,
  hid: unknown,
  soldiers: unknown,
): Promise<number> {
  // 步兵速度加成 (tid 12) / 骑兵速度加成 (tid 13); the original interpolates the raw $cid — an
  // undefined one matches no row, as cid 0 does here.
  const nCid = phpNum(cid);
  const speedAddRate1 =
    1 +
    phpIntval(
      await deps.cell(
        sql<Row>`select level as v from sys_city_technic where cid = ${nCid} and tid = 12`,
      ),
    ) *
      0.1;
  const speedAddRate2 =
    1 +
    phpIntval(
      await deps.cell(
        sql<Row>`select level as v from sys_city_technic where cid = ${nCid} and tid = 13`,
      ),
    ) *
      0.05;
  // 将领速度加成: `if ($hid != 0)` — loose, so null/"0" skip the fetch; a missing row reads
  // speed_add_on as null → rate 1.
  let speedAddRate3 = 1;
  if (!phpLooseEquals(hid, 0)) {
    const heroInfo = await deps.one(
      sql<Row>`select * from sys_city_hero where hid = ${phpNum(hid)}`,
    );
    speedAddRate3 = 1 + phpNum(heroInfo ? heroInfo.speed_add_on : null) * 0.01;
  }

  const soldierArray = phpString(soldiers).split(',');
  const takeSoldiers = new Map<number, number>();
  const numSoldiers = phpIntval(soldierArray.shift());
  for (let i = 0; i < numSoldiers; i++) {
    const sid = phpIntval(soldierArray.shift());
    let cnt = phpNum(soldierArray.shift());
    if (cnt < 0) cnt = 0;
    takeSoldiers.set(sid, cnt);
  }

  const pathLength = 162000;
  let minSpeed = 999999999;
  // PHP's $speedAdd is function-scoped: declared here so the value from the last sid 1..12 row
  // leaks into later iterations, and stays 0 when $hid <= 0 (the `if ($hid > 0)` guard).
  let speedAdd = 0;
  const soldierConfig = await deps.query(
    sql<Row>`select * from cfg_soldier where fromcity = 1 order by sid`,
  );
  for (const soldier of soldierConfig) {
    const sid = phpIntval(soldier.sid);
    if (phpNum(hid) > 0) {
      speedAdd = 0;
      if (sid >= 1 && sid <= 12) {
        const attid = 2000 + (sid - 1) * 100 + 11;
        const attr = await deps.one(
          sql<Row>`select * from sys_hero_attribute where hid = ${phpNum(hid)} and attid = ${attid}`,
        );
        if (!phpEmpty(attr)) speedAdd = phpNum((attr as Row).value);
      }
    }
    if (!phpEmpty(takeSoldiers.get(sid))) {
      const speed = phpNum(soldier.speed);
      if (sid < 7 && sid !== 3) {
        minSpeed = Math.min(speed * speedAddRate1 * speedAddRate3 + speedAdd, minSpeed);
      } else {
        minSpeed = Math.min(speed * speedAddRate2 * speedAddRate3 + speedAdd, minSpeed);
      }
    }
  }

  const pathNeedTime = pathLength / minSpeed;
  return phpIntval(Math.floor(pathNeedTime));
}

/**
 * BattleFunc.php:3565 enhanceArmy — add `count` soldiers of `sid` to the troop's soldiers string,
 * dropping zero-count entries, capping at 12 soldier types (`$count.$GLOBALS['depluder']
 * ['too_many_sid']` — the count leads the message), regenerating pathtime, and recording the
 * reinforcement into sys_battle_reinforce (cleaning its consumed rows first).
 */
export async function enhanceArmy(
  deps: BattlefieldDeps,
  troopid: number,
  orisoldiers: unknown,
  sid: number,
  count: number,
  cid: number,
  hid: unknown,
  bid = 0,
): Promise<string | false> {
  void bid; // only the commented-out 5001 branch ever used it
  const orisoldiersarray = phpString(orisoldiers).split(',');
  let orisoldiertypecount = phpIntval(orisoldiersarray.shift());
  let contain = false;
  let newsoldiers = '';
  let deletecount = 0;
  for (let i = 0; i < orisoldiertypecount; i++) {
    const orisid = phpIntval(orisoldiersarray.shift());
    let oricount = phpNum(orisoldiersarray.shift());
    if (orisid === sid) {
      oricount += count;
      contain = true;
    }
    if (oricount <= 0) {
      deletecount += 1;
    } else {
      newsoldiers += `,${orisid},${oricount}`;
    }
  }
  orisoldiertypecount -= deletecount;
  if (!contain) {
    orisoldiertypecount++;
    newsoldiers += `,${sid},${count}`;
  }
  if (orisoldiertypecount > 12) {
    throw GameError.raw(`${orisoldiertypecount}${deps.lang('depluder.too_many_sid')}`);
  }

  newsoldiers = `${orisoldiertypecount}${newsoldiers}`;
  // 重算行军速度
  const newPathTime = await reGeneratePathTime(deps, cid, hid, newsoldiers);
  const result = await sql`update sys_troops set soldiers = ${newsoldiers},
    pathtime = ${newPathTime} where id = ${troopid}`.execute(deps.db);
  if (result) {
    await sql`delete from sys_battle_reinforce where troopid = ${troopid} and \`count\` <= 0`.execute(
      deps.db,
    );
    await sql`insert into sys_battle_reinforce (troopid, sid, count) values (${troopid}, ${sid}, ${count})
      on duplicate key update count = count + ${count}`.execute(deps.db);
    return newsoldiers;
  }
  return false;
}

/**
 * BattleFunc.php:4152 resetBattleFieldUid — re-decide a 据点's owner (sys_battle_city uid/unionid)
 * from the troops standing in it (state 3/4 or targeting it): one union + one user → that user;
 * one union + several users → uid 0; mixed unions → uid/unionid 0; empty → -1/-1 with hasuser 0.
 * The mixed-union early return returns int 0 in the original (callers ignore the return).
 * NOTE for the battlefield-tick slice: cfg_js.php's HandleTroop battle branch needs the same
 * helper — import this one instead of reimplementing it.
 */
export async function resetBattleFieldUid(
  deps: BattlefieldDeps,
  cid: number,
): Promise<Row | number> {
  const result: Row = { oriuid: 0, oriunionid: 0, uid: 0, unionid: 0 };
  let hasuser = 0;
  let uid: unknown = -1;
  let unionid: unknown = -1;
  let sameUid = true;

  const troops = await deps.query(sql<Row>`select * from sys_troops
    where cid = ${cid} and ((state = 4 or state = 3) or targetcid = ${cid})`);
  const oricidinfo = await deps.one(
    sql<Row>`select uid, unionid from sys_battle_city where cid = ${cid}`,
  );
  if (phpEmpty(oricidinfo)) return result;
  result.oriuid = (oricidinfo as Row).uid;
  result.oriunionid = (oricidinfo as Row).unionid;

  if (phpEmpty(troops)) {
    // 空白据点 — the original writes the string "-1" into the result array.
    result.uid = '-1';
    result.unionid = '-1';
    await sql`update sys_battle_city set uid = -1, unionid = -1, hasuser = 0
      where cid = ${cid}`.execute(deps.db);
    return result;
  }

  let isFirst = true;
  for (const troop of troops) {
    if (isFirst) {
      uid = troop.uid;
      unionid = troop.battleunionid;
      isFirst = false;
    } else {
      if (!phpLooseEquals(troop.battleunionid, unionid)) {
        // 不属于同一阵营的驻扎
        await sql`update sys_battle_city set uid = 0, unionid = 0 where cid = ${cid}`.execute(
          deps.db,
        );
        return 0;
      }
      if (!phpLooseEquals(troop.uid, uid)) {
        if (phpNum(troop.uid) > 0 && phpNum(uid) > 0) {
          // 属于同一阵营但是uid不同,并且都不是NPC军队
          sameUid = false;
        }
        uid = troop.uid;
        unionid = troop.battleunionid;
      }
    }
    if (phpNum(troop.uid) > 0) {
      // 是否有NPC部队
      hasuser = 1;
    }
  }

  const nUid = phpIntval(uid);
  const nUnionid = phpIntval(unionid);
  if (sameUid) {
    // 属于同一个用户
    await sql`update sys_battle_city set uid = ${nUid}, ownerunionid = ${nUnionid},
      unionid = ${nUnionid}, hasuser = ${hasuser} where cid = ${cid}`.execute(deps.db);
    result.uid = nUid;
    result.unionid = nUnionid;
  } else {
    // 同一阵营的不同用户
    await sql`update sys_battle_city set uid = 0, unionid = ${nUnionid}, hasuser = ${hasuser}
      where cid = ${cid}`.execute(deps.db);
    result.uid = 0;
    result.unionid = nUnionid;
  }
  return result;
}

/**
 * BattleFunc.php:4425 sendBattleEvent — the mem_battle_event trigger row the tick/quest flow
 * consumes (questInCity's 探索 event, createBattle's join event, chatWithHero's talk events).
 */
export async function sendBattleEvent(
  deps: BattlefieldDeps,
  troopid: number,
  uid: number,
  bid: number,
  battlefieldid: number,
  unionid: number,
  triggerid: number,
  eventtype: number,
): Promise<void> {
  await sql`insert into mem_battle_event (troop_id, uid, bid, battlefieldid, unionid, trigger_id, event_type)
    values (${troopid}, ${uid}, ${bid}, ${battlefieldid}, ${unionid}, ${triggerid}, ${eventtype})`.execute(
    deps.db,
  );
}

/**
 * BattleFunc.php:4421 sendBattleMsg — a battlefield channel message: mem_war_event (the proc-52
 * push source) plus the log_battle_news record.
 */
export async function sendBattleMsg(
  deps: BattlefieldDeps,
  battlefieldid: number,
  unionid: number,
  msg: string,
): Promise<void> {
  await sql`insert into mem_war_event (battleid, unionid, type, content, evttime)
    values (${battlefieldid}, ${unionid}, 1, ${msg}, unix_timestamp())`.execute(deps.db);
  await sql`insert into log_battle_news (battleid, unionid, content, log_time)
    values (${battlefieldid}, ${unionid}, ${msg}, unix_timestamp())`.execute(deps.db);
}
