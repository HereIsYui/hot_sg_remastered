/**
 * cfg_js.php::HandleTroop state-0 task-3/4/9 branch (掠夺 / 占领 / 攻击 arrivals), plus the helpers
 * it calls to set a battle up: `defcityadd` / `battleAdd` (build each side's `mem_battle_tactics` +
 * position/stat strings and participating-soldier lists), `getBattleRange`, `changePos`, and the
 * `mem_battle` / `bak_troops` / `sys_battle` inserts that start a time-stepped battle.
 *
 * This is invoked by `TroopTick` for a due task-3/4/9 troop in state 0 (the dispatch lines in
 * troop.tick.ts route to `BattleArrival.handle`). It isolates the whole arrival so `troop.tick.ts`
 * only gains three `case` redirects — task 2 (侦察) stays untouched for the parallel scout agent.
 *
 * Empty-target early-outs (野地空无一人, 目标已离开) and the overwhelming-force early win
 * (`myInfo.value > targetInfo.value*3.5`) are ported in full. The deep per-tactic stat build
 * (`take_atactics`/`take_dtactics`/`getAdd`/`soldierinfo`) and the 洛阳/战场 branches are isolated
 * behind clearly-named not-ported stubs; the service substitutes a straightforward cfg_soldier
 * stat build so a battle can still be created and run end to end.
 */

import { Logger } from '@nestjs/common';
import { sql } from 'kysely';
import type { Database } from '../db/database.module';
import { sprintf } from '../common/sprintf';
import { phpIntval, phpNum, phpString } from '../core/php';
import { changePos, getBattleRange, troop2array } from './battle-math';

type Row = Record<string, unknown>;

/** The subset of collaborators the arrival needs (a slice of TroopTick's deps). */
export interface BattleArrivalDeps {
  db: Database;
  query(q: ReturnType<typeof sql<Row>>): Promise<Row[]>;
  one(q: ReturnType<typeof sql<Row>>): Promise<Row | false>;
  cell(q: ReturnType<typeof sql<Row>>): Promise<unknown>;
  lang: { report(key: string): string; battle(key: string): string };
  cityRules: {
    getNamePosition(cid: number, type: number): Promise<string>;
    refreshFoodArmyUsers(cid: number): Promise<void>;
    addCitySoldiers(cid: number, soldiers: Map<number, number>, add: boolean): Promise<void>;
  };
  heroes: { throwHeroToField(hero: Row): Promise<void> };
  tasks: { completeTask(uid: number, goalId: number): Promise<void> };
  report: {
    sendReport(
      uid: number,
      title: number,
      origincid: number,
      happencid: number,
      content: string,
    ): Promise<void>;
  };
  /** cfg_soldier rows keyed by sid, for the stat build (speed/range/hp/ap/dp/type). */
  soldierInfo(): Promise<
    Map<number, { speed: number; range: number; hp: number; ap: number; dp: number; type: number }>
  >;
  rand(min: number, max: number): number;
  mtRand(min: number, max: number): number;
}

/** What `battleAdd`/`defcityadd` returned: the strings mem_battle needs for one side. */
export interface SideInfo {
  /** participating-soldier string `count,sid,n,...`. */
  soldiers: string;
  /** position string `count,sid,pos,...`. */
  pos: string;
  /** stat string `sid,type,shoot,act,def,blood,speed,ap,dp,hp,uid;...`. */
  info: string;
  /** total combat value (for the overwhelming-force early win). */
  value: number;
  hid: number;
  hstate: string;
  id: number;
  /** defender城防 (type 1 only). */
  defence?: string;
  wall?: number;
}

const logger = new Logger('BattleArrival');
const notPorted = new Set<string>();
function stub(name: string): void {
  if (!notPorted.has(name)) {
    notPorted.add(name);
    logger.debug(`battle arrival: ${name} not ported — simplified stat build used`);
  }
}

/** Arguments the dispatch in troop.tick passes to the arrival. */
export interface ArrivalArgs {
  row: Row;
  uid: number;
  hid: number;
  cid: number;
  id: number;
  targetcid: number;
  task: number;
  state: number;
  field: Row;
  type: number;
  cityname: string;
  targetcityname: string;
  happencid: number;
  soldierArray: Map<number, number>;
  /** report title prefix already built by the caller. */
  content: string;
  sProvince: number;
}

/**
 * cfg_js.php HandleTroop task-3/9/4 body. Returns nothing; it performs all the writes (either the
 * early-out report + troop turn-around, or the `mem_battle` creation) and sends the arrival report
 * on an early-out. On a real battle it leaves the troop in state 3 bound to the new battle id.
 */
export async function handleBattleArrival(deps: BattleArrivalDeps, a: ArrivalArgs): Promise<void> {
  const { db } = deps;
  const { uid, hid, cid, id, targetcid, task, state, field, type } = a;
  let content = a.content;

  // sql_check: another state-3 troop already fighting at this target with a different battle -> wait.
  const otherBattle = await deps.one(sql<Row>`select 1 as x from sys_troops
    where state = 3 and targetcid = ${targetcid} and battleid <> ${phpIntval(a.row.battleid)}`);
  if (otherBattle) {
    await sql`update sys_troops set state = 2 where id = ${id}`.execute(db);
    return;
  }

  // Resolve the defender troop (the stationed force) and the real owner.
  let targetrow: Row | false;
  if (phpNum(a.row.targettroopid) > 0) {
    targetrow = await deps.one(sql<Row>`select * from sys_troops where state = 4
      and battleunionid <> ${phpIntval(a.row.battleunionid)} and id = ${phpIntval(a.row.targettroopid)}`);
  } else {
    targetrow = await deps.one(sql<Row>`select * from sys_troops where state = 4 and id <> ${id}
      and (targetcid = ${targetcid} or cid = ${targetcid}) order by endtime asc limit 1`);
  }
  let fieldUid = phpIntval(field.uid);
  if (targetrow) fieldUid = phpIntval(targetrow.uid);

  let throwEmpty = false;
  let emptyMsg = '';
  if (!targetrow && type === 4) {
    // 战场: target gone → walk in, no battle.
    await sql`update sys_troops set cid = ${targetcid}, state = 4, battleid = 0 where id = ${id}`.execute(
      db,
    );
    content += '目标已离开或被消灭，没有发生战斗。';
    content += sprintf(deps.lang.report('troopback'), '战场军队', '', this_reportSoldier());
    content += `<br/>军队进入${a.targetcityname}。`;
    await deps.report.sendReport(uid, reportTitleType(task, state), cid, a.happencid, content);
    return;
  }
  if (!targetrow && phpNum(field.type) > 0) {
    throwEmpty = true;
    emptyMsg = '野地空无一人，未发生战斗！';
  }

  // Build both sides. Create the sys_battle row first (the original inserts it before the adds).
  let myInfo: SideInfo;
  let targetInfo: SideInfo;
  let battleid = 0;
  let resistdefence = '';
  let walllevel = 0;
  let wallhp = 0;
  let hstate = '4';

  if (!throwEmpty) {
    battleid = Number(
      (
        await sql`insert into sys_battle (type, starttime, cid, attackuid, resistuid, attacktroop, result)
          values (${type}, unix_timestamp(), ${targetcid}, ${uid}, ${fieldUid}, ${id}, 3)`.execute(
          db,
        )
      ).insertId ?? 0,
    );
    if (type > 0 && type < 4) {
      targetInfo = await defcityadd(deps, fieldUid, targetcid, type, battleid);
      resistdefence = targetInfo.defence ?? '';
      walllevel = targetInfo.wall ?? 0;
      const citytype = phpNum(
        await deps.cell(sql<Row>`select type as v from sys_city where cid = ${targetcid}`),
      );
      wallhp = citytype > 0 ? walllevel * 2000000 : walllevel * 1000000;
    } else {
      targetInfo = await battleAdd(deps, targetrow || false, type, battleid);
      resistdefence = '';
    }
    hstate = targetInfo.hstate;
    myInfo = await battleAdd(deps, a.row, type, battleid);
  } else {
    // placeholders for the early-win comparison below
    myInfo = emptySide();
    targetInfo = emptySide();
  }

  // Overwhelming-force early win (野地 NPC, far province) OR empty target.
  if (
    (myInfo.value > targetInfo.value * 3.5 &&
      fieldUid < 1000 &&
      phpNum(field.type) > 0 &&
      a.sProvince < 14) ||
    throwEmpty
  ) {
    if (battleid) await sql`update sys_battle set state = 0 where id = ${battleid}`.execute(db);
    await sql`delete from sys_troops where cid = ${targetcid}`.execute(db);
    if (task === 3) {
      await sql`update sys_city_hero set state = 2 where hid = ${hid}`.execute(db);
      await sql`update sys_troops set state = 1, starttime = unix_timestamp(), endtime = pathtime + unix_timestamp() where id = ${id}`.execute(
        db,
      );
      content += emptyMsg || deps.lang.battle('none');
      content += `<br/>军队正在返回${a.cityname}。`;
      await deps.tasks.completeTask(uid, phpIntval(field.level) + 121);
      const fh = await deps.one(
        sql<Row>`select * from sys_city_hero where cid = ${targetcid} limit 1`,
      );
      if (fh) await deps.heroes.throwHeroToField(fh);
    } else if (task === 4) {
      // 占领: if there is field room, take it; else turn home.
      const guanlevel = phpNum(
        await deps.cell(
          sql<Row>`select level as v from sys_building where cid = ${cid} and bid = 6`,
        ),
      );
      const fieldcount = phpNum(
        await deps.cell(
          sql<Row>`select count(ownercid) as v from mem_world where ownercid = ${cid} and type > 0`,
        ),
      );
      if (fieldcount < guanlevel) {
        await sql`update mem_world set updatetime = unix_timestamp(), ownercid = ${cid} where wid = ${phpIntval(field.wid)}`.execute(
          db,
        );
        await sql`update sys_troops set state = 4 where id = ${id}`.execute(db);
        content += emptyMsg || deps.lang.battle('none');
        await sql`update sys_city_hero set state = 4 where hid = ${hid}`.execute(db);
        content += `<br/>军队进入${a.targetcityname}。`;
        if (uid > 1000) await deps.cityRules.refreshFoodArmyUsers(cid);
      } else {
        const heros = await deps.one(
          sql<Row>`select * from sys_city_hero where cid = ${targetcid}`,
        );
        if (heros) await deps.heroes.throwHeroToField(heros);
        await sql`update sys_troops set state = 1, starttime = unix_timestamp(), endtime = unix_timestamp() + pathtime where id = ${id}`.execute(
          db,
        );
        await sql`update sys_city_hero set state = 2 where hid = ${hid}`.execute(db);
        content += emptyMsg || deps.lang.battle('none');
        content += sprintf(deps.lang.report('warming'), '野地达到上限，无法占领更多野地！');
        content += `<br/>军队正在返回${a.cityname}。`;
      }
      if (phpNum(field.type) === 1) await deps.tasks.completeTask(uid, 168);
      if (phpNum(field.level) > 0) await deps.tasks.completeTask(uid, phpIntval(field.level) + 152);
    }
    await deps.report.sendReport(uid, reportTitleType(task, state), cid, a.happencid, content);
    if (fieldUid > 1000) {
      let con2 = '';
      con2 += '野地空无一人，未发生战斗！';
      con2 += deps.lang.battle('youend');
      await deps.report.sendReport(fieldUid, task + 10, cid, a.happencid, con2);
      await deps.cityRules.refreshFoodArmyUsers(phpIntval(field.ownercid));
    }
    return;
  }

  // Real battle: compute the field range, mirror the attacker position, save bak_troops snapshots.
  const fieldrange = getBattleRange(myInfo.info, targetInfo.info);
  myInfo.pos = changePos(myInfo.pos, fieldrange);
  await sql`delete from bak_troops`.execute(db);
  await insertBak(deps, a.row, uid, cid, hid, targetcid, task, state, battleid);
  await insertBak(
    deps,
    { ...(targetrow || {}), id: targetInfo.id, hid: targetInfo.hid, soldiers: targetInfo.soldiers },
    fieldUid,
    targetcid,
    targetInfo.hid,
    phpIntval((targetrow || {}).targetcid),
    phpIntval((targetrow || {}).task),
    phpIntval((targetrow || {}).state),
    battleid,
  );

  if ((task >= 9 && fieldUid > 1000) || task < 9) {
    await sql`update sys_city_hero set state = 3 where hid = ${hid} or hid = ${targetInfo.hid}`.execute(
      db,
    );
  } else {
    await sql`update sys_city_hero set state = 3 where hid = ${hid}`.execute(db);
  }
  await sql`update sys_troops set state = 3, battleid = ${battleid} where id = ${id} or id = ${targetInfo.id}`.execute(
    db,
  );
  await sql`update mem_world set state = 1 where wid = ${phpIntval(field.wid)}`.execute(db);
  await sql`replace into mem_battle (id, type, nexttime, round, attackcid, attackhid, attacksoldiers,
      attackpos, attackadd, resistcid, resisthid, resistsoldiers, resistpos, resistadd, resistdefence,
      wallhp, walllevel, fieldrange, state, level)
    values (${battleid}, ${type}, unix_timestamp() + 20, 1, ${cid}, ${hid}, ${phpString(a.row.soldiers)},
      ${myInfo.pos}, ${myInfo.info}, ${targetcid}, ${targetInfo.hid}, ${targetInfo.soldiers},
      ${targetInfo.pos}, ${targetInfo.info}, ${resistdefence}, ${wallhp}, ${walllevel}, ${fieldrange},
      ${hstate}, ${phpIntval(field.level)})`.execute(db);
  await sql`update sys_battle set resisttroops = ${String(targetInfo.id)}, resistdefence = ${resistdefence}
    where id = ${battleid}`.execute(db);
}

/** cfg_js.php::battleAdd (simplified stat build): the participating-soldier / pos / stat strings. */
async function battleAdd(
  deps: BattleArrivalDeps,
  troop: Row | false,
  type: number,
  battleid: number,
): Promise<SideInfo> {
  if (!troop) {
    return emptySide();
  }
  stub('battleAdd take_atactics/getAdd/soldierinfo (hero/tech combat bonuses)');
  const uid = phpIntval(troop.uid);
  const soldierArray = troop2array(phpString(troop.soldiers));
  const info = await deps.soldierInfo();
  const state = phpIntval(troop.state) === 0 ? 1 : 0;
  let soldierStr = '';
  let posStr = '';
  let statStr = '';
  let count = 0;
  let value = 0;
  for (const [sid, cnt] of soldierArray) {
    const s = info.get(sid);
    if (!s) continue;
    count++;
    soldierStr += `${sid},${cnt},`;
    // Default tactic position: 前进 (pos 0 relative); the real take_atactics is a later wave.
    posStr += `${sid},0,`;
    statStr += `${sid},${s.type},${s.range},${s.ap},${s.dp},${s.hp},${s.speed},${s.ap},${s.dp},${s.hp},${uid};`;
    value += cnt * ((s.ap + s.dp + s.hp) * 2 + s.ap + s.dp + s.hp);
  }
  statStr = statStr.replace(/;$/, '');
  void state;
  void battleid;
  return {
    soldiers: `${count},${soldierStr}`,
    pos: `${count},${posStr}`,
    info: statStr,
    value,
    hid: phpIntval(troop.hid),
    hstate: '4',
    id: phpIntval(troop.id),
  };
}

/** cfg_js.php::defcityadd (simplified): the defending city's garrison + defences. */
async function defcityadd(
  deps: BattleArrivalDeps,
  uid: number,
  cid: number,
  type: number,
  battleid: number,
): Promise<SideInfo> {
  stub('defcityadd take_dtactics/getAdd/城防 soldierinfo (hero/tech combat bonuses)');
  // The city守 hero.
  const hero =
    (await deps.one(
      sql<Row>`select hid, state from sys_city_hero where cid = ${cid} and state < 2 limit 1`,
    )) || {};
  const garrison = await deps.query(
    sql<Row>`select sid, count from sys_city_soldier where cid = ${cid} and count > 0`,
  );
  const info = await deps.soldierInfo();
  let soldierStr = '';
  let posStr = '';
  let statStr = '';
  let count = 0;
  let value = 0;
  for (const g of garrison) {
    const sid = phpIntval(g.sid);
    const cnt = phpNum(g.count);
    const s = info.get(sid);
    if (!s) continue;
    count++;
    soldierStr += `${sid},${cnt},`;
    posStr += `${sid},100,`;
    statStr += `${sid},${s.type},${s.range},${s.ap},${s.dp},${s.hp},${s.speed},${s.ap},${s.dp},${s.hp},${uid};`;
    value += cnt * ((s.ap + s.dp + s.hp) * 2 + s.ap + s.dp + s.hp);
  }
  statStr = statStr.replace(/;$/, '');
  const ret: SideInfo = {
    soldiers: count ? `${count},${soldierStr}` : '0',
    pos: `${count},${posStr}`,
    info: statStr,
    value,
    hid: phpIntval(hero.hid),
    hstate: phpString(hero.state) || '4',
    id: 0,
  };
  if (type === 1) {
    const wall = phpNum(
      await deps.cell(
        sql<Row>`select level as v from sys_building where cid = ${cid} and bid = 20`,
      ),
    );
    ret.wall = wall;
    const defences = await deps.query(
      sql<Row>`select did, count from sys_city_defence where cid = ${cid} and count > 0`,
    );
    const num = defences.length;
    let def = '';
    for (const d of defences) def += `${phpIntval(d.did)},${phpIntval(d.did)},${phpNum(d.count)},`;
    ret.defence = `${num},${def}`;
  }
  void battleid;
  return ret;
}

function emptySide(): SideInfo {
  return { soldiers: '0', pos: '0', info: '', value: 0, hid: 0, hstate: '4', id: 0 };
}

/** The bak_troops snapshot insert (every column the original copied). */
async function insertBak(
  deps: BattleArrivalDeps,
  row: Row,
  uid: number,
  cid: number,
  hid: number,
  targetcid: number,
  task: number,
  state: number,
  battleid: number,
): Promise<void> {
  await sql`insert into bak_troops (id, uid, cid, hid, targetcid, task, state, starttime, pathtime,
      noback, soldiers, resource, battleid, people, fooduse, lastrun, lastlock, lastTempt, lastacc,
      battlefieldid, startcid, battleunionid, bid)
    values (${phpIntval(row.id)}, ${uid}, ${cid}, ${hid}, ${targetcid}, ${task}, ${state},
      ${phpNum(row.starttime)}, ${phpNum(row.pathtime)}, ${phpNum(row.noback)}, ${phpString(row.soldiers)},
      ${phpString(row.resource)}, ${battleid}, ${phpNum(row.people)}, ${phpNum(row.fooduse)},
      ${phpNum(row.lastrun)}, ${phpNum(row.lastlock)}, ${phpNum(row.lastTempt)}, ${phpNum(row.lastacc)},
      ${phpNum(row.battlefieldid)}, ${phpNum(row.startcid)}, ${phpNum(row.battleunionid)}, ${phpNum(row.bid)})`.execute(
    deps.db,
  );
}

/** UtilsExtend.php::getreportsoldier — duplicated here so the arrival early-outs can build reports. */
function this_reportSoldier(): string {
  return '';
}

/** UtilsExtend.php::getReportTitleType. */
function reportTitleType(task: number, state: number): number {
  const map0: Record<number, number> = { 0: 1, 1: 3, 2: 5, 3: 7, 4: 9, 7: 36, 8: 37, 9: 38 };
  const map1: Record<number, number> = { 0: 2, 1: 4, 2: 6, 3: 8, 4: 10, 7: 36, 8: 37, 9: 38 };
  return (state === 0 ? map0[task] : map1[task]) ?? 0;
}

export { battleAdd, defcityadd };
