/**
 * BattleFunc.php internal battlefield helpers ported for the 战场 lifecycle slice and shared with
 * the later slices (S2 后半 quitBattle reuses playerExitBattle; the tick slice reuses
 * resetBattleFieldUid and sendBattleEvent):
 *
 * - `resetBattleFieldUid` BattleFunc.php:4152 — re-judge a strongpoint's owner from its troops;
 * - `setFlags` BattleFunc.php:3686 — per-strongpoint flag/flagchar for the client map;
 * - `playerAttendBattle` / `playerExitBattle` BattleFunc.php:4034-4068 — mem_war_buf + mem_war_event;
 * - `getBattleStartCityInfo` BattleFunc.php:4122 — the bid's 出征 city options;
 * - `deleteOldBattleTasks` / `addUserTasks` BattleFunc.php:1022-1045;
 * - `sendBattleEvent` BattleFunc.php:4425 — the mem_battle_event trigger queue write.
 *
 * All of them take a {@link BattlefieldDeps} instead of injected services (the battle-arrival.ts
 * pattern), so commands can run them inside their own `scope.transaction` and specs can drive them
 * over a FakeDb. PHP's file-lock `lockUser`/`unlockUser` around these writes is carried by the
 * gateway's per-user mutex (KeyedMutex), like every other ported module.
 */

import { sql, type RawBuilder } from 'kysely';
import type { Database } from '../db/database.module';
import { addslashes, phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';

export type Row = Record<string, unknown>;

/** The DB/clock face the battlefield helpers need (a slice of the commands class's deps). */
export interface BattlefieldDeps {
  /** `this.scope.db` — read lazily so writes join the caller's transaction. */
  readonly db: Database;
  rows(query: RawBuilder<Row>): Promise<Row[]>;
  one(query: RawBuilder<Row>): Promise<Row | false>;
  cell(query: RawBuilder<Row>): Promise<unknown>;
  /** LangService.t: `group.key` + sprintf args (the original's `$GLOBALS[..]` reads). */
  lang(key: string, ...args: unknown[]): string;
}

/**
 * BattleFunc.php::resetBattleFieldUid — re-judge which side owns strongpoint `cid` from the troops
 * standing/fighting there. Returns the info row the caller reads, or the number `0` when two
 * different unions are stationed together (the original `return 0`, which callers then index with
 * `["unionid"]` — a notice + null on the PHP side).
 */
export async function resetBattleFieldUid(deps: BattlefieldDeps, cid: number): Promise<Row | 0> {
  const result: Row = { oriuid: 0, oriunionid: 0, uid: 0, unionid: 0 };
  let hasuser = 0;
  let uid = -1;
  let unionid = -1;
  let sameUid = true;

  // 战斗中 (state 3) and 驻守 (state 4) troops all count as the strongpoint's garrison.
  const troops = await deps.rows(
    sql<Row>`select * from sys_troops where cid = ${cid} and ((state = 4 or state = 3) or targetcid = ${cid})`,
  );
  const oricidinfo = await deps.one(
    sql<Row>`select uid, unionid from sys_battle_city where cid = ${cid}`,
  );
  if (!oricidinfo) return result;
  result['oriuid'] = oricidinfo['uid'];
  result['oriunionid'] = oricidinfo['unionid'];

  if (troops.length === 0) {
    // 空白据点: nobody holds it (the original assigns the STRING '-1' here, not the number).
    result['uid'] = '-1';
    result['unionid'] = '-1';
    await sql`update sys_battle_city set uid = -1, unionid = -1, hasuser = 0 where cid = ${cid}`.execute(
      deps.db,
    );
    return result;
  }

  let isFirst = true;
  for (const troop of troops) {
    if (isFirst) {
      uid = phpIntval(troop['uid']);
      unionid = phpIntval(troop['battleunionid']);
      isFirst = false;
    } else {
      if (phpNum(troop['battleunionid']) !== unionid) {
        // 不属于同一阵营的驻扎 → 争夺中.
        await sql`update sys_battle_city set uid = 0, unionid = 0 where cid = ${cid}`.execute(
          deps.db,
        );
        return 0;
      }
      if (phpNum(troop['uid']) !== uid) {
        if (phpNum(troop['uid']) > 0 && uid > 0) {
          // 属于同一阵营但是 uid 不同,并且都不是 NPC 军队.
          sameUid = false;
        }
        uid = phpIntval(troop['uid']);
        unionid = phpIntval(troop['battleunionid']);
      }
    }
    if (phpNum(troop['uid']) > 0) hasuser = 1;
  }

  if (sameUid) {
    // 属于同一个用户 (uid 0 = a pure NPC garrison).
    await sql`update sys_battle_city set uid = ${uid}, ownerunionid = ${unionid}, unionid = ${unionid},
      hasuser = ${hasuser} where cid = ${cid}`.execute(deps.db);
    result['uid'] = uid;
    result['unionid'] = unionid;
  } else {
    // 同一阵营的不同用户 → uid 0, union keeps.
    await sql`update sys_battle_city set uid = 0, unionid = ${unionid}, hasuser = ${hasuser} where cid = ${cid}`.execute(
      deps.db,
    );
    result['uid'] = 0;
    result['unionid'] = unionid;
  }
  return result;
}

/**
 * BattleFunc.php::setFlags — decorate each strongpoint row with the client's flag/flagchar.
 * `$flagchar` is a function-scope PHP variable that carries over between iterations; the -1/0
 * branches overwrite the row's flagchar with "" instead, so the carry-over is never observable.
 */
export async function setFlags(
  deps: BattlefieldDeps,
  unionid: unknown,
  cityinfos: Row[],
): Promise<Row[]> {
  const resultcityinfo: Row[] = [];
  const flagcharmap = new Map<string, unknown>();
  for (const r of await deps.rows(sql<Row>`select unionid, flag from cfg_battle_union`)) {
    flagcharmap.set(String(phpIntval(r['unionid'])), r['flag']);
  }
  let flagchar: unknown;
  for (const cityinfo of cityinfos) {
    const row: Row = { ...cityinfo };
    const cityunionid = row['unionid'];
    if (phpNum(cityunionid) >= 1) {
      if (phpNum(cityunionid) > 1000) {
        // A player-union id is the leading user's uid (fetch_one_cell yields false without a row).
        flagchar = await deps.cell(
          sql<Row>`select flagchar from sys_user where uid = ${phpIntval(cityunionid)}`,
        );
      } else {
        // An unknown union reads PHP's undefined-index null (not fetch_one_cell's false).
        flagchar = flagcharmap.get(String(phpIntval(cityunionid))) ?? null;
      }
    }
    if (phpLooseEquals(cityunionid, -1)) {
      // 空据点，白旗.
      row['flag'] = 5;
      row['flagchar'] = '';
    } else if (phpLooseEquals(cityunionid, 0)) {
      // 争夺中,玫瑰色.
      row['flag'] = 3;
      row['flagchar'] = '';
    } else if (phpLooseEquals(cityunionid, unionid)) {
      // 同一阵营: npc 城 (no user troop) flag 2, 我方据点 flag 1.
      row['flagchar'] = flagchar;
      row['flag'] = phpEmpty(row['hasuser']) ? 2 : 1;
    } else {
      // 敌人阵营: npc 城 flag 0, 敌方玩家据点 flag 4.
      row['flagchar'] = flagchar;
      row['flag'] = phpEmpty(row['hasuser']) ? 0 : 4;
    }
    resultcityinfo.push(row);
  }
  return resultcityinfo;
}

/** `sql_insert` semantics: run the insert, then read `last_insert_id()` on the same connection. */
async function insertIdOf(deps: BattlefieldDeps, query: RawBuilder<Row>): Promise<unknown> {
  await query.execute(deps.db);
  return deps.cell(sql<Row>`select last_insert_id() as v`);
}

/**
 * BattleFunc.php::playerAttendBattle — announce a user joining the battlefield: one mem_war_buf
 * row (state 1) plus a mem_war_event (type 2) the 战况 channel replays. Returns 1 on success,
 * 0 when either insert reported last_insert_id()==0 (the original's dead-ish error path).
 */
export async function playerAttendBattle(
  deps: BattlefieldDeps,
  battleid: unknown,
  unionid: unknown,
  uid: unknown,
  nick: unknown,
  campName: unknown,
): Promise<number> {
  const content = phpLooseEquals(campName, '')
    ? deps.lang('battle.login_1', phpString(nick))
    : deps.lang('battle.login', phpString(campName), phpString(nick));
  // The original addslashes()es the content because it interpolated it into SQL; binding keeps the
  // escaped form in the DB exactly like the original stored it.
  const escaped = addslashes(content);
  const bufId = await insertIdOf(
    deps,
    sql<Row>`insert into mem_war_buf (battleid, unionid, uid, nick, state, updatetime)
      values (${phpNum(battleid)}, ${phpNum(unionid)}, ${phpNum(uid)}, ${phpString(nick)}, 1, unix_timestamp())`,
  );
  if (phpLooseEquals(bufId, 0)) return 0;
  const evtId = await insertIdOf(
    deps,
    sql<Row>`insert into mem_war_event (battleid, unionid, type, content, evttime)
      values (${phpNum(battleid)}, ${phpNum(unionid)}, 2, ${escaped}, unix_timestamp())`,
  );
  if (phpLooseEquals(evtId, 0)) return 0;
  return 1;
}

/** BattleFunc.php::playerExitBattle — the quitting twin of playerAttendBattle (state 0, logout text). */
export async function playerExitBattle(
  deps: BattlefieldDeps,
  battleid: unknown,
  unionid: unknown,
  uid: unknown,
  nick: unknown,
  campName: unknown,
): Promise<number> {
  const content = deps.lang('battle.logout', phpString(campName), phpString(nick));
  const escaped = addslashes(content);
  const bufId = await insertIdOf(
    deps,
    sql<Row>`insert into mem_war_buf (battleid, unionid, uid, nick, state, updatetime)
      values (${phpNum(battleid)}, ${phpNum(unionid)}, ${phpNum(uid)}, ${phpString(nick)}, 0, unix_timestamp())`,
  );
  if (phpLooseEquals(bufId, 0)) return 0;
  const evtId = await insertIdOf(
    deps,
    sql<Row>`insert into mem_war_event (battleid, unionid, type, content, evttime)
      values (${phpNum(battleid)}, ${phpNum(unionid)}, 2, ${escaped}, unix_timestamp())`,
  );
  if (phpLooseEquals(evtId, 0)) return 0;
  return 1;
}

/**
 * BattleFunc.php::getBattleStartCityInfo — the 出征 target cities of `bid`/`unionid`, cheapest
 * honour first. Bids without options (or bid/unionid 0 — the original's `$bid == ""` PHP 5 loose
 * check) yield an empty list; a `return;` yields PHP null, which the callers keep as a null slot.
 *
 * The bid-6001 branch (逐鹿中原, cross-server, unreachable on the standalone) assigns a random
 * start city once; its `order by rand()` stays literal like the other ports, and its empty-city
 * path reproduces the original's PearDB syntax-error death (`$ret[0]["xy"]` → null →
 * `set startcid=` → MySQL error) with the same generic response text.
 */
export async function getBattleStartCityInfo(
  deps: BattlefieldDeps,
  bid: unknown,
  unionid: unknown,
): Promise<Row[] | null> {
  if (phpLooseEquals(bid, '') || phpLooseEquals(unionid, '')) return null;
  if (phpLooseEquals(bid, 6001)) {
    // unionid is the user's uid here.
    const uid = phpIntval(unionid);
    const startcid = await deps.cell(
      sql<Row>`select startcid from sys_user_battle_state where state = 0 and uid = ${uid}`,
    );
    if (phpLooseEquals(startcid, 0)) {
      // 洛阳/长安/江陵/昌邑/晋阳 are never assigned.
      const ret = await deps.rows(
        sql<Row>`select xy, \`name\` from cfg_battle_city where bid = 6001
          and xy not in (407, 374, 97, 410, 285) order by rand() limit 1`,
      );
      if (ret.length === 0) {
        // Original: `$ret[0]["xy"]` is null → `set startcid=` → SQL error → PearDB die.
        throw new Error('getBattleStartCityInfo: bid 6001 has no cfg_battle_city row');
      }
      await sql`update sys_user_battle_state set startcid = ${phpIntval(ret[0]!['xy'])}
        where state = 0 and uid = ${uid}`.execute(deps.db);
      return ret;
    }
    return deps.rows(
      sql<Row>`select xy, \`name\` from cfg_battle_city where bid = 6001 and xy = ${phpNum(startcid)}`,
    );
  }
  return deps.rows(
    sql<Row>`select * from cfg_battle_start_city where bid = ${phpIntval(bid)}
      and unionid = ${phpIntval(unionid)} order by needhonour asc`,
  );
}

/**
 * BattleFunc.php::deleteOldBattleTasks — drop the user's old 战场 tasks (cfg_task_goal sort
 * 100/110/120) before a new battlefield's tasks are added. The tid list comes from GROUP_CONCAT;
 * it is spliced raw (config-derived, exactly like the original's string building), and an empty
 * result (NULL == "" in PHP 5) skips both deletes.
 */
export async function deleteOldBattleTasks(deps: BattlefieldDeps, uid: number): Promise<void> {
  const tasks = await deps.cell(
    sql<Row>`SELECT GROUP_CONCAT(DISTINCT tid) FROM cfg_task_goal WHERE sort in (100, 110, 120)`,
  );
  if (phpLooseEquals(tasks, '')) return;
  const tidList = phpString(tasks);
  await sql`DELETE FROM sys_user_task where uid = ${uid} and tid in (${sql.raw(tidList)})`.execute(
    deps.db,
  );
  const taskgoals = await deps.cell(
    sql<Row>` select group_concat(id) from cfg_task_goal where tid in (${sql.raw(tidList)})`,
  );
  await sql`DELETE FROM sys_user_goal where uid = ${uid} and gid in (${sql.raw(
    phpString(taskgoals),
  )})`.execute(deps.db);
}

/**
 * BattleFunc.php::addUserTasks — (re)insert a list of tasks as state 0. The original interpolated
 * `'$task'` into the tid slot, so an empty element became tid 0 through MySQL's coercion; binding
 * intval(task) reproduces that row exactly on both engines.
 */
export async function addUserTasks(
  deps: BattlefieldDeps,
  uid: number,
  tasks: unknown[],
): Promise<void> {
  for (const task of tasks) {
    await sql`insert into sys_user_task (uid, tid, state)
      values (${uid}, ${phpIntval(task)}, 0) on duplicate key update state = 0`.execute(deps.db);
  }
}

/**
 * BattleFunc.php::sendBattleEvent — enqueue one cfg_battle_event trigger into mem_battle_event for
 * the tick/cron side to resolve (initial event 9, quest events 11, ...).
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
