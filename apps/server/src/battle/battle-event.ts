/**
 * The cfg_battle_event trigger runner at its two call sites — 1,014 rows of 战场 events that add
 * tasks, rebuild NPC garrisons (增兵), remove generals (消失将领) and judge the battlefield winner:
 *
 *   - Arrival site (cfg_js.php:535-593, HandleTroop task 8 调遣到达): events keyed by
 *     `triggerid = targetcid%1000 and bid = troop.bid and unionid = troop.battleunionid`; the
 *     triggertype-2 gate is "enemy troops still exist on the battlefield"; and the `$v['msg']`
 *     branch is an EMPTY body in the original (cfg_js.php:565-566) — no mem_war_event write here.
 *   - Result site (OLdBattleCron.php:1343-1407, getBattleResult type 4 终局): events keyed by
 *     `triggerid = resistcid%1000 OR triggerid = resisthid`; the triggertype-2 gate is negated AND
 *     scoped to the fought-over city (enemy GONE → do it); `$v['msg']` writes mem_war_event; the
 *     消失将领 delete filters `uid<1000` (the arrival site does not).
 *
 * The targettype-3 (胜负判定) branch differs per site too — see runBattlefieldArrivalEvents /
 * runBattlefieldResultEvents. The 增兵 rebuild is verbatim identical at both sites and shared.
 */

import { sql } from 'kysely';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import type { Database } from '../db/database.module';
import { battleid2cid, checkBattleResult, createSoldier } from './battle-field-uid';

type Row = Record<string, unknown>;

/** What the trigger runners need beyond resetBattleFieldUid's reads/writes. */
export interface BattleEventDeps {
  db: Database;
  query(q: ReturnType<typeof sql<Row>>): Promise<Row[]>;
  cell(q: ReturnType<typeof sql<Row>>): Promise<unknown>;
  tasks: { completeTask(uid: number, goalId: number): Promise<void> };
  /** Raw PHP `rand()` draw (utils.php::createSoldier) — scripted for the difftest. */
  randRaw(): number;
}

/** The deps the RESULT site adds (mem_war_event writes). */
export interface BattleResultEventDeps extends BattleEventDeps {
  warEvent(battleid: number, unionid: number, type: number, content: string): Promise<void>;
}

/**
 * cfg_js.php:574-591 == OLdBattleCron.php:1387-1403 — the 增兵 (targetid1 > 1000) group: every hid
 * in cfg_battle_troop for this bid gets its garrison DELETED and rebuilt from `createSoldier` at
 * `battleid2cid(battlefieldid, xy)`.
 */
async function applyAddHid(
  deps: BattleEventDeps,
  battlefieldid: number,
  bid: number,
  addhid: number[],
  battlelevel: number,
): Promise<void> {
  if (addhid.length === 0) return;
  const newadd = await deps.query(sql<Row>`select * from cfg_battle_troop
    where bid = ${bid} and hid in (${sql.join(addhid)})`);
  if (newadd.length === 0) return;
  await sql`delete from sys_troops where battlefieldid = ${battlefieldid}
    and hid in (${sql.join(addhid)})`.execute(deps.db);
  await sql`insert into sys_troops (cid, uid, hid, soldiers, state, \`drop\`, rate,
      battlefieldid, battleunionid, bid) values ${sql.join(
        newadd.map(
          (v) => sql`(${battleid2cid(battlefieldid, phpNum(v.xy))}, 0, ${phpNum(v.hid)},
            ${createSoldier(phpNum(v.npcvalue), phpString(v.soldiers), battlelevel, deps.randRaw)},
            4, ${phpString(v.drop)}, ${phpNum(v.rate)}, ${battlefieldid}, ${phpNum(v.unionid)},
            ${phpNum(v.bid)})`,
        ),
      )}`.execute(deps.db);
}

/**
 * cfg_js.php:535-593 — the task-8 arrival site. `events` is the triggerid=targetcid%1000 row list
 * the caller fetched (together with $battlelevel, both unconditional queries in the original).
 *
 * FAITHFUL (broken-column) DIVERGENCE: the targettype-3 branch continues (cfg_js.php:550) with
 * `insert into sys_user_goal ... select ... from sys_user_battle_state where ... battleunionid=...`
 * — sys_user_battle_state has `unionid`, no `battleunionid`. On the legacy server that statement
 * errors and database.php::error() DIES, ending the cron run right there. Throwing here would roll
 * the per-row transaction back (the troop would re-settle every tick, which the original never
 * does), so the documented port is: the winner update runs, the broken insert is skipped (the same
 * net DB state — no sys_user_goal rows), and processing continues past where the legacy died.
 */
export async function runBattlefieldArrivalEvents(
  deps: BattleEventDeps,
  row: Row,
  uid: number,
  events: Row[],
  battlelevel: number,
): Promise<void> {
  const battlefieldid = phpIntval(row.battlefieldid);
  const battleunionid = phpNum(row.battleunionid);
  const bid = phpNum(row.bid);
  const addhid: number[] = [];
  const loshid: number[] = [];
  for (const v of events) {
    let cando: boolean | number = 1;
    if (phpIntval(v.triggertype) === 2) {
      // 敌方军队还在战场上 → 触发（与终局侧的"敌军已清空才触发"相反）。
      cando = !!(await deps.cell(sql<Row>`select 1 as x from sys_troops
        where battlefieldid = ${battlefieldid} and battleunionid <> ${battleunionid} limit 1`));
    }
    if (cando) {
      if (phpNum(v.targetid1) > 50000) {
        // 任务
        const goalid = await deps.cell(
          sql<Row>`select id from cfg_task_goal where tid = ${phpNum(v.targetid1)}`,
        );
        if (!phpEmpty(goalid)) {
          const gid = phpIntval(goalid);
          if (phpIntval(v.targettype) === 3) {
            if (await checkBattleResult(deps, bid, phpNum(v.bid))) {
              await sql`update sys_user_battle_field set finishtime = unix_timestamp(),
                winner = ${battleunionid} where id = ${battlefieldid}`.execute(deps.db);
              // (see the function comment: cfg_js.php:550's broken sys_user_goal insert ends here)
            }
          } else if (phpIntval(v.targettype) === 1) {
            // 增加任务
            await sql`delete from sys_user_goal where uid = ${uid} and gid = ${gid}`.execute(
              deps.db,
            );
            await sql`insert into sys_user_task (uid, tid, state) select uid, ${phpNum(v.targetid1)},
              0 from sys_user_battle_state where battlefieldid = ${battlefieldid}
              and unionid = ${battleunionid} on duplicate key update state = 0`.execute(deps.db);
          } else {
            await deps.tasks.completeTask(uid, gid);
          }
        }
      } else if (phpNum(v.targetid1) > 1000) {
        // 增兵
        addhid.push(phpNum(v.targetid1));
      }
      // if ($v['msg']) { } — cfg_js.php:565-566: EMPTY body, no mem_war_event write on this site.
      if (phpNum(v.targetid2) > 1000) {
        // 消失将领
        loshid.push(phpNum(v.targetid2));
      }
    }
  }
  await applyAddHid(deps, battlefieldid, bid, addhid, battlelevel);
  if (loshid.length > 0) {
    await sql`delete from sys_troops where battlefieldid = ${battlefieldid}
      and hid in (${sql.join(loshid)})`.execute(deps.db);
  }
}

export interface BattleResultEventArgs {
  bbid: number;
  mtroop: Row;
  resistcid: number;
  resisthid: number;
  uid: number;
}

/**
 * OLdBattleCron.php:1343-1407 — the getBattleResult type-4 终局 site. `events` is the
 * `(triggerid=resistcid%1000 or triggerid=resisthid) and bid=mtroop.bid and
 * unionid=mtroop.battleunionid` row list the caller fetched along with $battlelevel.
 */
export async function runBattlefieldResultEvents(
  deps: BattleResultEventDeps,
  a: BattleResultEventArgs,
  events: Row[],
  battlelevel: number,
): Promise<void> {
  const bbid = a.bbid;
  const battleunionid = phpNum(a.mtroop.battleunionid);
  const bid = phpNum(a.mtroop.bid);
  const addhid: number[] = [];
  const loshid: number[] = [];
  for (const v of events) {
    let cando: boolean | number = 1;
    if (phpIntval(v.triggertype) === 2) {
      // 该据点的敌方军队已清空 → 触发。
      const enemy = await deps.cell(sql<Row>`select 1 as x from sys_troops
        where cid = ${a.resistcid} and battlefieldid = ${bbid}
        and battleunionid <> ${battleunionid} limit 1`);
      cando = !enemy;
    }
    if (cando) {
      if (phpNum(v.targetid1) > 50000) {
        const goalid = await deps.cell(
          sql<Row>`select id from cfg_task_goal where tid = ${phpNum(v.targetid1)}`,
        );
        if (!phpEmpty(goalid)) {
          const gid = phpIntval(goalid);
          if (phpIntval(v.targettype) === 3) {
            // 胜负判定 gate (OLdBattleCron.php:1359) — then the goal grant runs OUTSIDE it
            // (:1362), unlike the arrival site where the insert is inside the gate.
            if (await checkBattleResult(deps, phpNum(v.bid), bbid)) {
              await sql`update sys_user_battle_field set finishtime = unix_timestamp(),
                winner = ${battleunionid} where id = ${bbid}`.execute(deps.db);
            }
            await sql`insert into sys_user_goal (uid, gid) select uid, ${gid}
              from sys_user_battle_state where battlefieldid = ${bbid}
              and unionid = ${battleunionid} on duplicate key update gid = values(gid)`.execute(
              deps.db,
            );
          } else if (phpIntval(v.targettype) === 1) {
            await sql`insert into sys_user_task (uid, tid, state) select uid, ${phpNum(v.targetid1)},
              0 from sys_user_battle_state where battlefieldid = ${bbid}
              and unionid = ${battleunionid} on duplicate key update state = 0`.execute(deps.db);
          } else {
            await deps.tasks.completeTask(a.uid, gid);
          }
        }
      } else if (phpNum(v.targetid1) > 1000) {
        addhid.push(phpNum(v.targetid1));
      }
      if (!phpEmpty(v.msg)) {
        // OLdBattleCron.php:1378 interpolates $unionid, which is UNDEFINED until :1408 — the
        // empty-string cast lands as 0 in the int column.
        await deps.warEvent(bbid, 0, 2, phpString(v.msg));
      }
      if (phpNum(v.targetid2) > 1000) {
        loshid.push(phpNum(v.targetid2));
      }
    }
  }
  await applyAddHid(deps, bbid, bid, addhid, battlelevel);
  if (loshid.length > 0) {
    // The result site alone filters NPC troops out of the 消失将领 delete (:1405).
    await sql`delete from sys_troops where battlefieldid = ${bbid} and uid < 1000
      and hid in (${sql.join(loshid)})`.execute(deps.db);
  }
}
