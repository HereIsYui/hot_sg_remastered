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

import { sql } from 'kysely';
import type { Database } from '../db/database.module';
import { sprintf } from '../common/sprintf';
import { phpIntval, phpNum, phpString } from '../core/php';
import { array2troop, changePos, getBattleRange, troop2array } from './battle-math';
import { checkSodier, type CheckSodierDeps } from './check-sodier';

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
    updateFieldResourceAdds(cid: number): Promise<void>;
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
  /** `$GLOBALS['soldier']['soldiervalue']` (index 0 unused) — for checkSodier's createmapSoldier. */
  soldierValue(): number[];
  /** utils.php::addCitySoldiers — checkSodier tops up an NPC city's garrison through it. */
  addCitySoldiers(cid: number, soldiers: Map<number, number>, add: boolean): Promise<void>;
  rand(min: number, max: number): number;
  mtRand(min: number, max: number): number;
  /** PHP `rand()` with no args: the raw draw (createmapSoldier's `<6` regime uses it). */
  randRaw(): number;
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

  // cfg_js.php line 404: `if($type<4&&$field['uid']<1000) $hascreat=checkSodier($field);` — an NPC
  // field/city tops up (or seeds) its garrison on arrival BEFORE the defender troop is resolved, so
  // the battle meets the respawned force. The return value ($hascreat) is not branched on below.
  if (type < 4 && phpNum(field.uid) < 1000) {
    await checkSodier(checkSodierDepsOf(deps), field);
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
        await deps.cityRules.updateFieldResourceAdds(cid);
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
      // getreporttitle($cityname,$targetcityname,$task,$state,0): the field-owner's report opens
      // with title1 ('一支军队向%s进行了%s。<br/>'), then the empty-field line + youend.
      let con2 = sprintf(deps.lang.report('title1'), a.targetcityname, REPORT_TYPE[task] ?? '');
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
    // The original's second bak_troops insert hardcodes starttime='0', pathtime='0', noback='0'
    // for the defender snapshot (only the soldiers / resource / ids are copied from targetrow).
    {
      ...(targetrow || {}),
      id: targetInfo.id,
      hid: targetInfo.hid,
      soldiers: targetInfo.soldiers,
      starttime: 0,
      pathtime: 0,
      noback: 0,
    },
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
  // BUG-FAITHFUL: the original is `UPDATE mem_world SET state='1' WHERE wid='field[wid]'` — a PHP
  // string literal with a missing `$`, so it matches the literal wid 'field[wid]' (no row) and
  // mem_world.state is never actually set to 1 when a battle starts. Reproduce the no-op (do not
  // interpolate field.wid), so the tile's state matches the legacy side on both the battle-start
  // and battle-end snapshots. (updateBattle's own `state=0` reset on completion is then harmless.)
  void field.wid;
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

// ───────────────────────── UtilsExtend.php combat-bonus port ─────────────────────────
// $GLOBALS['report']['type'] — the task-name shown in report titles (lang.php).
const REPORT_TYPE: Record<number, string> = {
  0: '运输',
  1: '派遣',
  2: '侦查',
  3: '掠夺',
  4: '占领',
  5: '防守',
  6: '护家',
  7: '战场出征',
  8: '战场派遣',
  9: '战场攻击',
};
// $GLOBALS['battle']['pos'] = ['', '100', '50', '0'] — the battlefield position for a tactic
// action 1/2/3 (前进/原地/后退). Index 0 is unused.
const BATTLE_POS: Record<number, string> = { 1: '100', 2: '50', 3: '0' };

// $GLOBALS['sid']['type']: a soldier's COMBAT type for the stat line's `type` column. Differs from
// cfg_soldier.type for the regional/NPC sids (13→2, 14→4, …). cfg_soldier.type drives the tactic
// lookup; this table fills the stat string's second field (lang.php).
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

/** The hero/tech/buff combat multipliers getAdd computes (UtilsExtend.php::getAdd). */
interface CombatAdd {
  command: number;
  act: number;
  def: number;
  speed: number;
  speed1: number;
  speed2: number;
  blood: number;
  plund: number;
}

/**
 * UtilsExtend.php::getAdd — the hero (base + add + add_on), 宝物 buff, and city-technic combat
 * multipliers for one side. `$tec_shoot_add` and `$heroadd['range']` are undefined in the original
 * (so `shoot`/`speed`-via-range terms fall to 0); getAdd's `shoot` is unused by the stat build
 * anyway (defcityadd/battleAdd use getshootadd separately), so it is not returned here.
 */
async function getAdd(deps: BattleArrivalDeps, cid: number, hid: number): Promise<CombatAdd> {
  // Hero base stats (NPC heroes have hid 0 → all zero). $batteler (cfg_battle_hero) is a 战场 path
  // we keep stubbed, so this always reads sys_city_hero.
  let commandBase = 0;
  let commandAddOn = 0;
  let braveryBase = 0;
  let braveryAdd = 0;
  let attackAddOn = 0;
  let wisdomBase = 0;
  let wisdomAdd = 0;
  let wisdomAddOn = 0;
  let defenceAddOn = 0;
  let speedAddOn = 0;
  let affairsBase = 0;
  let affairsAdd = 0;
  let affairsAddOn = 0;
  let level = 0;
  if (hid !== 0) {
    const h = (await deps.one(sql<Row>`select * from sys_city_hero where hid = ${hid}`)) || {};
    commandBase = phpNum(h.command_base);
    commandAddOn = phpNum(h.command_add_on);
    braveryBase = phpNum(h.bravery_base);
    braveryAdd = phpNum(h.bravery_add);
    attackAddOn = phpNum(h.attack_add_on);
    wisdomBase = phpNum(h.wisdom_base);
    wisdomAdd = phpNum(h.wisdom_add);
    wisdomAddOn = phpNum(h.wisdom_add_on);
    defenceAddOn = phpNum(h.defence_add_on);
    speedAddOn = phpNum(h.speed_add_on);
    affairsBase = phpNum(h.affairs_base);
    affairsAdd = phpNum(h.affairs_add);
    affairsAddOn = phpNum(h.affairs_add_on);
    level = phpNum(h.level);
  }

  // 宝物 buffs on the hero (mem_hero_buffer, by buftype).
  let goodsCommand = 0;
  let goodsBlood = 0;
  let goodsAtt = 0;
  let goodsDef = 0;
  const bufs = await deps.query(
    sql<Row>`select buftype from mem_hero_buffer where endtime > unix_timestamp() and hid = ${hid}`,
  );
  for (const b of bufs) {
    switch (phpIntval(b.buftype)) {
      case 1:
        goodsCommand = 0.5;
        break;
      case 2:
        goodsBlood = 0.25;
        break;
      case 3:
        goodsAtt = 0.25;
        break;
      case 4:
        goodsDef = 0.25;
        break;
    }
  }

  const tec = async (tid: number): Promise<number> =>
    phpNum(
      await deps.cell(
        sql<Row>`select level as v from sys_city_technic where cid = ${cid} and tid = ${tid}`,
      ),
    );
  const tecCommand = await tec(6);
  const tecAttc = await tec(9);
  const tecDef = await tec(10);
  const tecSpeed = await tec(12);
  const tecJiayu = await tec(13);
  const tecBlood = await tec(16);
  const tecPlund = await tec(20);

  const command = (commandBase + level) * (1 + goodsCommand + 0.1 * tecCommand) + commandAddOn;
  const act =
    // $heroadd['bravery_add_on'] / ['wisdom_add_on'] are undefined columns in the original → 0.
    (braveryBase + braveryAdd) * (1 + goodsAtt + 0.05 * tecAttc) + 0 + attackAddOn / 10;
  const def =
    (wisdomBase + wisdomAdd) * (1 + goodsDef + 0.05 * tecDef) + wisdomAddOn + defenceAddOn / 10;
  const speed = speedAddOn;
  const speed1 = 0.1 * tecSpeed;
  const speed2 = tecJiayu * 0.05;
  const blood = (affairsAdd + affairsAddOn + affairsBase) / 300 + goodsBlood + 0.05 * tecBlood;
  const plund = 1 + 0.03 * tecPlund;
  return { command, act, def, speed, speed1, speed2, blood, plund };
}

/** UtilsExtend.php::getshootadd: `1 + 0.05 * 侦察/抛射 tech (tid 14)`. */
async function getshootadd(deps: BattleArrivalDeps, cid: number): Promise<number> {
  const lvl = phpNum(
    await deps.cell(
      sql<Row>`select level as v from sys_city_technic where cid = ${cid} and tid = 14`,
    ),
  );
  return 1 + 0.05 * lvl;
}

/** A resolved per-sid tactic from take_atactics / take_dtactics. */
interface Tactic {
  action: number;
  target: number;
  action2: number;
  target2: number;
  cnt: number;
  type: number;
}

// The default tactic strings the original falls back to when no sys_troop_tactics /
// sys_city_tactics row exists (the difftest save ships none). `stype,action,target[,action2,target2]`.
const T_PLUNDER =
  '1,1,1;2,1,2;3,1,3;4,1,4;5,1,5;6,1,6;7,1,7;8,1,8;9,1,9;10,1,10;11,1,11;12,1,12;45,2,45;46,2,46;47,2,47;48,2,48;49,2,49;50,2,50';
const T_INVADE =
  '1,1,1,1,1;2,1,2,1,2;3,1,3,1,3;4,1,4,1,4;5,1,5,1,5;6,1,6,1,6;7,1,7,1,7;8,1,8,1,8;9,1,9,1,9;10,1,10,1,10;11,1,11,1,11;12,1,12,1,12;45,2,45,2,45;46,2,46,2,46;47,2,47,2,47;48,2,48,2,48;49,2,49,2,49;50,2,50,2,50';
const T_FIELD = '1,2,1;2,1,2;3,1,3;4,1,4;5,1,5;6,1,6;7,1,7;8,1,8;9,2,9;10,1,10;11,1,11;12,1,12';
// take_dtactics城防 defaults (NPC / tactics-less defender).
const DT_DEPLUNDER_JOIN = '2,4,5,6,7,8,10,12';
const DT_DEPLUNDER =
  '1,2,1;2,1,2;3,2,3;4,1,4;5,1,5;6,1,6;7,1,7;8,1,8;9,2,9;10,1,10;11,1,11;12,1,12';
const DT_DEINVADE =
  '1,1,1,1,1;2,1,2,1,2;3,1,3,1,3;4,1,4,1,4;5,1,5,1,5;6,1,6,1,6;7,1,7,1,7;8,1,8,1,8;9,1,9,1,9;10,1,10,1,10;11,1,11,1,11;12,1,12,1,12;45,2,45,2,45;46,2,46,2,46;47,2,47,2,47;48,2,48,2,48;49,2,49,2,49;50,2,50,2,50;15,2,6;16,2,4;17,2,11';
const DT_DEINVADE_JOIN = '2,4,5,6,7,8,10,12';

/** Parse a `stype,action,target[,action2,target2];…` tactic string into a type→tactic map. */
function parseTacticTable(tactic: string): Map<number, Omit<Tactic, 'cnt' | 'type'>> {
  const out = new Map<number, Omit<Tactic, 'cnt' | 'type'>>();
  for (const part of tactic.split(';')) {
    const t = part.split(',');
    const stype = phpIntval(t[0]);
    out.set(stype, {
      action: phpIntval(t[1]),
      target: phpIntval(t[2]),
      action2: t[3] !== undefined && t[3] !== '' ? phpIntval(t[3]) : 0,
      target2: t[4] !== undefined && t[4] !== '' ? phpIntval(t[4]) : 0,
    });
  }
  return out;
}

/** cfg_soldier.type for one sid (the tactic-lookup key). */
async function cfgSoldierType(deps: BattleArrivalDeps, sid: number): Promise<number> {
  const info = await deps.soldierInfo();
  return info.get(sid)?.type ?? 0;
}

/**
 * UtilsExtend.php::take_atactics (uid < 1000 → tactics-less default). Resolve each soldier's
 * action/target from the default tactic for its cfg_soldier.type.
 */
async function takeAtactics(
  deps: BattleArrivalDeps,
  soldierArray: Map<number, number>,
  type: number,
): Promise<Map<number, Tactic>> {
  const tactic = type === 0 ? T_FIELD : type === 1 ? T_INVADE : T_PLUNDER;
  const table = parseTacticTable(tactic);
  const out = new Map<number, Tactic>();
  for (const [sid, cnt] of soldierArray) {
    const sidType = await cfgSoldierType(deps, sid);
    const t = table.get(sid); // take_atactics keys the default by SID (1..12/45..50 == their type)
    if (!t) {
      out.set(sid, {
        action: 1,
        target: sidType,
        action2: 1,
        target2: sidType,
        cnt,
        type: sidType,
      });
    } else {
      out.set(sid, {
        action: t.action,
        target: t.target,
        action2: t.action2 || t.action,
        target2: t.target2 || t.target,
        cnt,
        type: sidType,
      });
    }
  }
  return out;
}

/** cfg_js.php::battleAdd — the attacker (or stationed defender troop) side. Faithful stat build. */
async function battleAdd(
  deps: BattleArrivalDeps,
  troop: Row | false,
  type: number,
  battleid: number,
  task = 0,
): Promise<SideInfo> {
  if (!troop) return emptySide();
  const troopid = phpIntval(troop.id);
  const uid = phpIntval(troop.uid);
  const hid = phpIntval(troop.hid);
  const cid = type < 4 ? phpIntval(troop.cid) : phpIntval(troop.startcid);

  // Wall shoot/def add only when a 攻城 troop that already arrived (task>5).
  let shootadd = 0;
  let defadd = 1;
  if (type === 1 && phpIntval(troop.task) > 5) {
    const wallLevel = phpNum(
      await deps.cell(
        sql<Row>`select level as v from sys_building where cid = ${cid} and bid = 20`,
      ),
    );
    shootadd = 1 + wallLevel * 0.05;
    defadd = wallLevel * 0.1;
  }
  // 陷阵(5)/八卦(6) user buffs. NOTE: battleAdd's def formula uses goods_att (not goods_def) — a
  // legacy quirk reproduced faithfully — so only goods_att is accumulated here.
  let goodsAtt = 0;
  const bufs = await deps.query(
    sql<Row>`select buftype from mem_user_buffer
      where (buftype = 5 or buftype = 6) and endtime > unix_timestamp() and uid = ${uid}`,
  );
  for (const b of bufs) {
    if (phpIntval(b.buftype) === 5) goodsAtt += 0.1;
  }

  const soldierArray = troop2array(phpString(troop.soldiers));
  // $state: attacker=1 defender troop=0 (used in the tactics row attack column).
  let state = phpIntval(troop.state) === 0 ? 1 : 0;
  if (phpIntval(troop.state) === 3) state = phpIntval(troop.task) < 5 ? 1 : 0;

  const tactics = await takeAtactics(deps, soldierArray, type);
  const info = await deps.soldierInfo();
  const add = await getAdd(deps, cid, hid);
  add.def *= defadd;

  let count = 0;
  for (const t of tactics.values()) count += t.cnt;
  const ret: SideInfo = emptySide();
  ret.hid = hid;
  ret.hstate = '4';
  if (count > 0) {
    let command = (add.command * 100) / count;
    if (command > 1) command = 1;
    let shootAdd = await getshootadd(deps, cid);
    shootAdd += shootadd;
    let soldierStr = '';
    let posStr = '';
    let statStr = '';
    const tacticRows: {
      attack: number;
      stype: number;
      action: number;
      target: number;
      action2: number;
      target2: number;
    }[] = [];
    let i = 0;
    let value = 0;
    for (const [sid, t] of tactics) {
      if (task && !(task && sid === 3)) continue; // task (patrol) keeps only sid 3
      const sidtype = SID_TYPE[sid] ?? t.type;
      const s = info.get(sid);
      if (!s) continue;
      // 速度恢复 /2 before the formula.
      const baseSpeed = s.speed / 2;
      soldierStr += `${sid},${t.cnt},`;
      posStr += `${sid},${BATTLE_POS[t.action] ?? '0'},`;
      const shoot = s.range >= 600 ? s.range * shootAdd : s.range;
      const att = s.ap * command * (add.act / 100 + goodsAtt);
      const def = s.dp * command * (add.def / 100 + goodsAtt);
      const blood = s.hp * command * add.blood;
      let speed: number;
      if (baseSpeed >= 500)
        speed = baseSpeed + baseSpeed * add.speed2 + add.speed * 2 * command - 1;
      else speed = baseSpeed + baseSpeed * add.speed1 + add.speed * 2 * command - 1;
      statStr += `${sid},${sidtype},${shoot},${att},${def},${blood},${speed},${s.ap},${s.dp},${s.hp},${uid};`;
      tacticRows.push({
        attack: state,
        stype: t.type,
        action: t.action,
        target: t.target,
        action2: t.action2,
        target2: t.target2,
      });
      i++;
      value += t.cnt * ((att + def + blood) * 2 + s.ap + s.dp + s.hp);
    }
    statStr = statStr.replace(/;$/, '');
    soldierStr = soldierStr.replace(/,$/, '');
    posStr = posStr.replace(/,$/, '');
    if (!task) await writeTactics(deps, battleid, tacticRows);
    ret.pos = `${i},${posStr}`;
    ret.info = statStr;
    ret.soldiers = `${i},${soldierStr}`;
    ret.id = troopid;
    ret.value = value;
  }
  return ret;
}

/** cfg_js.php::defcityadd — the defending CITY's garrison + defences. Faithful stat build. */
async function defcityadd(
  deps: BattleArrivalDeps,
  uid: number,
  cid: number,
  type: number,
  battleid: number,
  task = 0,
): Promise<SideInfo> {
  // check_city_ground_hero: a stationed owner-hero in state 1 or 7.
  const hero = (await deps.one(
    sql<Row>`select hid, state from sys_city_hero where cid = ${cid} and state in (1,7)
        and uid = (select uid from sys_city where cid = ${cid}) order by state desc limit 1`,
  )) || { hid: 0, state: 0 };
  const hid = phpIntval(hero.hid);

  // Wall level (type 1 → 攻城): shoot/def add.
  let wallLevel = 0;
  if (type === 1) {
    wallLevel = phpNum(
      await deps.cell(
        sql<Row>`select level as v from sys_building where cid = ${cid} and bid = 20`,
      ),
    );
  }
  const defadd = 1 + wallLevel * 0.1;

  const add = await getAdd(deps, cid, hid);
  add.def *= defadd;
  // 陷阵/八卦 user buffs.
  let goodsAtt = 0;
  let goodsDef = 0;
  const bufs = await deps.query(
    sql<Row>`select buftype from mem_user_buffer
      where (buftype = 5 or buftype = 6) and endtime > unix_timestamp() and uid = ${uid}`,
  );
  for (const b of bufs) {
    if (phpIntval(b.buftype) === 5) goodsAtt += 0.1;
    if (phpIntval(b.buftype) === 6) goodsDef += 0.1;
  }

  // take_dtactics (NPC / tactics-less). Garrison soldiers, plus city defences for type 1.
  const sidTempPlunder = DT_DEPLUNDER_JOIN;
  const sidTempInvade = DT_DEINVADE_JOIN;
  let garrison: Row[];
  if (uid < 1000) {
    // NPC: all garrison soldiers.
    garrison = await deps.query(
      sql<Row>`select s.sid, s.count, c.type from sys_city_soldier s, cfg_soldier c
        where s.sid = c.sid and s.count > 0 and s.cid = ${cid}`,
    );
  } else {
    const join = type === 2 ? sidTempPlunder : sidTempInvade;
    garrison = await deps.query(
      sql<Row>`select s.sid, s.count, c.type from sys_city_soldier s, cfg_soldier c
        where s.sid = c.sid and s.count > 0 and s.cid = ${cid}
        and s.sid in (${sql.raw(join)})`,
    );
  }
  let defences: Row[] = [];
  if (type === 1) {
    defences = await deps.query(
      sql<Row>`select s.did * 10000 as sid, s.count, c.* from sys_city_defence s, cfg_defence c
        where s.did = c.did and s.count > 0 and s.cid = ${cid}`,
    );
  }

  const table = parseTacticTable(type === 2 ? DT_DEPLUNDER : DT_DEINVADE);
  const info = await deps.soldierInfo();
  const ret: SideInfo = emptySide();
  ret.hid = hid;
  ret.hstate = phpString(hero.state) || '4';

  // Resolve per-row tactics (take_dtactics body).
  interface DRow {
    sid: number;
    cnt: number;
    type: number;
    action: number;
    target: number;
    action2: number;
    target2: number;
    range: number;
    ap: number;
    dp: number;
    hp: number;
    speed: number;
  }
  const rows: DRow[] = [];
  for (const g of [...garrison, ...defences]) {
    const sid = phpIntval(g.sid);
    let sidType = phpNum(g.type);
    if (sid < 100) sidType = await cfgSoldierType(deps, sid);
    const t = table.get(sidType);
    const cnt = phpNum(g.count);
    const soldierStats =
      sid >= 10000
        ? { range: phpNum(g.range), ap: phpNum(g.ap), dp: phpNum(g.dp), hp: phpNum(g.hp), speed: 0 }
        : (() => {
            const s = info.get(sid)!;
            return { range: s.range, ap: s.ap, dp: s.dp, hp: s.hp, speed: s.speed };
          })();
    rows.push({
      sid,
      cnt,
      type: sidType,
      action: t ? t.action : 1,
      target: t ? t.target : sidType,
      action2: t ? t.action2 || t.action : 1,
      target2: t ? t.target2 || t.target : sidType,
      ...soldierStats,
    });
  }

  let count = 0;
  for (const r of rows) count += r.cnt;
  if (count > 0) {
    let command = (add.command * 100) / count;
    if (command > 1) command = 1;
    let shootAdd = await getshootadd(deps, cid);
    shootAdd += type === 1 ? wallLevel * 0.05 : 0;
    let posStr = '';
    let statStr = '';
    let i = 0;
    let value = 0;
    const dsoldier = new Map<number, number>();
    const defenceArray = new Map<number, number>();
    const tacticRows: {
      attack: number;
      stype: number;
      action: number;
      target: number;
      action2: number;
      target2: number;
    }[] = [];
    for (const r of rows) {
      const sidtype = r.type;
      if (sidtype < 13 || (sidtype > 44 && sidtype < 51)) {
        dsoldier.set(r.sid, r.cnt);
        posStr += `${r.sid},${r.action > 1 ? '0' : (BATTLE_POS[r.action] ?? '0')},`;
        i++;
      } else {
        defenceArray.set(Math.floor(r.sid / 10000), r.cnt);
        if (sidtype !== 15) shootAdd = 1;
      }
      // 13/14 speed recovery /2 (only these two for the defender).
      const baseSpeed = sidtype === 13 || sidtype === 14 ? r.speed / 2 : r.speed;
      const shoot = r.range >= 600 ? r.range * shootAdd : r.range;
      const act = r.ap * command * (add.act / 100 + goodsAtt);
      const def = r.dp * command * (add.def / 100 + goodsDef);
      const blood = r.hp * command * add.blood;
      let speed: number;
      if (baseSpeed >= 500)
        speed = Math.floor(baseSpeed + baseSpeed * add.speed2 + add.speed * 2 * command - 1);
      else speed = Math.floor(baseSpeed + baseSpeed * add.speed1 + add.speed * 2 * command - 1);
      statStr += `${r.sid},${sidtype},${shoot},${act},${def},${blood},${speed},${r.ap},${r.dp},${r.hp},${uid};`;
      tacticRows.push({
        attack: 0,
        stype: r.type,
        action: r.action,
        target: r.target,
        action2: r.action2,
        target2: r.target2,
      });
      value += r.cnt * ((act + def + blood) * 2 + r.ap + r.dp + r.hp);
    }
    statStr = statStr.replace(/;$/, '');
    posStr = posStr.replace(/,$/, '');
    if (!task) await writeTactics(deps, battleid, tacticRows);
    ret.pos = `${i},${posStr}`;
    ret.info = statStr;
    ret.value = value;
    ret.soldiers = dsoldier.size ? array2troop(dsoldier) : '0';
    if (type === 1) {
      if (defenceArray.size) {
        ret.defence = defenceTroop(defenceArray);
        await addCityDefences(deps, cid, defenceArray);
      }
      ret.wall = wallLevel;
    }
    if (!task && dsoldier.size) await deps.cityRules.addCitySoldiers(cid, dsoldier, false);
    if (!task) {
      ret.id = Number(
        (
          await sql`insert into sys_troops (uid, cid, hid, targetcid, task, state, soldiers)
            values (${uid}, ${cid}, ${hid}, ${cid}, 6, 3, ${ret.soldiers})`.execute(deps.db)
        ).insertId ?? 0,
      );
    }
  } else {
    ret.pos = '0';
    ret.info = '';
    ret.soldiers = '0';
    if (type === 1) ret.wall = wallLevel;
    if (!task) {
      ret.id = Number(
        (
          await sql`insert into sys_troops (uid, cid, hid, targetcid, task, state, soldiers)
            values (${uid}, ${cid}, ${hid}, ${cid}, 6, 3, '0')`.execute(deps.db)
        ).insertId ?? 0,
      );
    }
  }
  return ret;
}

/** replace into mem_battle_tactics for one side's resolved tactic rows. */
async function writeTactics(
  deps: BattleArrivalDeps,
  battleid: number,
  rows: {
    attack: number;
    stype: number;
    action: number;
    target: number;
    action2: number;
    target2: number;
  }[],
): Promise<void> {
  for (const r of rows) {
    await sql`replace into mem_battle_tactics (battleid, attack, stype, action, target, action2, target2)
      values (${battleid}, ${r.attack}, ${r.stype}, ${r.action}, ${r.target}, ${r.action2}, ${r.target2})`.execute(
      deps.db,
    );
  }
}

/** array2troop($defenceArray, 1): `count,did,cnt,cnt,…` (the def=1 form doubles the count). */
function defenceTroop(defenceArray: Map<number, number>): string {
  const keys = [...defenceArray.keys()].sort((a, b) => a - b);
  let s = '';
  let i = 0;
  for (const did of keys) {
    const cnt = defenceArray.get(did)!;
    if (cnt > 0) {
      s += `${did},${cnt},${cnt},`;
      i++;
    }
  }
  return i ? `${i},${s}` : '0';
}

/** cfg_js.php::addCityDefences (subtract: the garrison defences join the battle). */
async function addCityDefences(
  deps: BattleArrivalDeps,
  cid: number,
  defenceArray: Map<number, number>,
): Promise<void> {
  for (const [did, cnt] of defenceArray) {
    await sql`insert into sys_city_defence (cid, did, count) values (${cid}, ${did}, ${cnt})
      on duplicate key update count = case when ((count - values(count)) > 4294967000) then 0
      else (count - values(count)) end`.execute(deps.db);
  }
}

function emptySide(): SideInfo {
  return { soldiers: '0', pos: '0', info: '', value: 0, hid: 0, hstate: '4', id: 0 };
}

/** Adapt the arrival's deps to the `CheckSodierDeps` shape checkSodier expects. */
function checkSodierDepsOf(deps: BattleArrivalDeps): CheckSodierDeps {
  return {
    db: deps.db,
    query: deps.query,
    one: deps.one,
    cell: deps.cell,
    soldierValue: deps.soldierValue,
    addCitySoldiers: deps.addCitySoldiers,
    rand: () => deps.randRaw(),
    mtRand: deps.mtRand,
  };
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
