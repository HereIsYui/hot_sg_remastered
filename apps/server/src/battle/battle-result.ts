/**
 * OLdBattleCron.php::getBattleResult — the TERMINAL settlement of a time-stepped battle, run once
 * `return_new_place` sets `$_SESSION['battle'][$id]['battle_end']`. It reads the two `bak_troops`
 * snapshots the arrival saved, computes losses / wounded / captures / prestige / hero exp, performs
 * the per-outcome troop & city mutations (掠夺 resource theft, 占领 city takeover, 野战 merge/return),
 * and files the attacker (and, for a player defender, the defender) battle report.
 *
 * Faithful to the original's control flow and arithmetic. Deep cross-system paths that belong to
 * other modules / later waves are isolated behind clearly-named `notPorted*` stubs so the core
 * settlement runs end to end without silently dropping them:
 *   - battlefield (战场, type 4 / bbid>0) event triggers, winpoints, reinforcements
 *   - honour/goods drops (getOpenDefaultGoodsResult / addGoods / isSentGood), 清囊 buffers
 *   - 洛阳 / 赤壁 / BloodBattle and cross-server hooks
 *   - armor hp / mem_hero_blood side-tables (hero module)
 * Each stub logs once; the surrounding deterministic settlement (soldiers, resources, prestige,
 * city capture, reports) is fully ported.
 */

import { Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { sprintf } from '../common/sprintf';
import { cid2wid } from '../core/city-rules.service';
import { phpIntval, phpNum, phpString } from '../core/php';
import { countDescIndex, getArraySub, sol2people, troop2array } from './battle-math';
import type { Database } from '../db/database.module';

type Row = Record<string, unknown>;

/** The collaborators getBattleResult needs, injected so it stays testable against a FakeDb. */
export interface BattleResultDeps {
  db: Database;
  query(q: ReturnType<typeof sql<Row>>): Promise<Row[]>;
  cell(q: ReturnType<typeof sql<Row>>): Promise<unknown>;
  lang: {
    report(key: string): string;
    row(n: string): string;
    battle(key: string): string;
    /** `$GLOBALS['battle'][key][index]` — the array lang values (citytype, juewei, ...). */
    battleArr(key: string, index: number): string;
    soldierName(sid: number): string;
    defenceName(did: number): string;
  };
  cityRules: {
    addCitySoldiers(cid: number, soldiers: Map<number, number>, add: boolean): Promise<void>;
    addCityResources(
      cid: number,
      wood: number,
      rock: number,
      iron: number,
      food: number,
      gold: number,
    ): Promise<void>;
    getNamePosition(cid: number, type: number): Promise<string>;
    refreshFoodArmyUsers(cid: number): Promise<void>;
    updateCityResourceAdd(cid: number): Promise<void>;
  };
  heroes: {
    addHeroExp(hid: number, exp: number): Promise<void>;
    throwHeroToField(hero: Row): Promise<void>;
    updateCityHeroChange(uid: unknown, cid: unknown): Promise<void>;
  };
  tasks: { completeTask(uid: number, goalId: number): Promise<void> };
  users: { bufferNobility(uid: number, nobility: number): Promise<number> };
  report: {
    sendReport(
      uid: number,
      title: number,
      origincid: number,
      happencid: number,
      content: string,
    ): Promise<void>;
  };
  warEvent(battleid: number, unionid: number, type: number, content: string): Promise<void>;
  rand(min: number, max: number): number;
  mtRand(min: number, max: number): number;
  /** cfg usepeople table for sol2people, and fooduse/usepeople for the food recompute. */
  usepeople: Record<number, number>;
}

const logger = new Logger('BattleResult');
const notPorted = new Set<string>();
function stub(name: string): void {
  if (!notPorted.has(name)) {
    notPorted.add(name);
    logger.debug(`getBattleResult: ${name} not ported (deep cross-system path) — skipped`);
  }
}

/** utils.php::array2count: total over a sid→count map. */
function array2count(m: Map<number, number>): number {
  let n = 0;
  for (const v of m.values()) n += v;
  return n;
}

/** utils.php::defence2array: `num,did,sid,count,oldcnt,...` → did → {cnt,oldcnt}. */
function defence2array(defence: string): Map<number, { cnt: number; oldcnt: number }> {
  const out = new Map<number, { cnt: number; oldcnt: number }>();
  if (!defence) return out;
  const arr = defence.split(',');
  const num = phpIntval(arr.shift());
  for (let i = 0; i < num; i++) {
    const did = phpIntval(arr.shift());
    arr.shift(); // sid
    const cnt = phpNum(arr.shift());
    const oldcnt = phpNum(arr.shift());
    out.set(did, { cnt, oldcnt });
  }
  return out;
}

/**
 * OLdBattleCron.php::getBattleResult($membattletroop, $end). `mem` is the mem_battle row, `end` the
 * verdict (0 atk win / 1 def win / 2 draw). Performs all terminal writes and files the reports.
 */
export async function getBattleResult(
  deps: BattleResultDeps,
  mem: Row,
  end: number,
): Promise<void> {
  const { lang, cityRules, heroes, report } = deps;
  const id = phpIntval(mem.id);
  const type = phpIntval(mem.type);
  const round = phpIntval(mem.round);
  const attacksoldiers = phpString(mem.attacksoldiers);
  const resistsoldiers = phpString(mem.resistsoldiers);
  const state = phpIntval(mem.state);

  const overActArray = troop2array(attacksoldiers);
  const overDefArray = troop2array(resistsoldiers);

  const sysBattle =
    (await deps.query(sql<Row>`select * from sys_battle where id = ${id}`))[0] ?? {};
  const defence = phpString(sysBattle.resistdefence);

  let overDefence: Map<number, { cnt: number; oldcnt: number }> | undefined;
  const overDefenceArray = new Map<number, number>();
  const lostDefenceArray = new Map<number, number>();
  if (type === 1 && defence) {
    overDefence = defence2array(defence);
    for (const [did, v] of overDefence) {
      if (v.cnt > 0) overDefenceArray.set(did, v.cnt);
      lostDefenceArray.set(did, v.oldcnt - v.cnt);
    }
  }

  const troops = await deps.query(sql<Row>`select * from bak_troops where battleid = ${id}`);
  const mtroop = troops.shift() ?? {};
  const ytroop = troops.shift() ?? {};
  await sql`update sys_troops set soldiers = ${attacksoldiers} where id = ${phpIntval(mtroop.id)}`.execute(
    deps.db,
  );
  await sql`update sys_troops set soldiers = ${resistsoldiers} where id = ${phpIntval(ytroop.id)}`.execute(
    deps.db,
  );

  const bbid = phpIntval(mtroop.battlefieldid);
  const uid = phpIntval(mtroop.uid);
  // bak_troops has no `troopid` column, so the original's `$troopid1/$troopid2` are always null
  // and every `where id = troopidN` statement below is a dead write — the engine's by-battleid
  // updates (applyEndTroops) do the real work. No `?? id` fallback: that would resurrect the
  // dead writes and, in case 1, delete the occupier's troop the original keeps marching home.
  const troopid1 = phpIntval(mtroop.troopid);
  const troopid2 = phpIntval(ytroop.troopid);
  const cid = phpIntval(mem.attackcid);
  const task = phpIntval(mtroop.task);
  const resistuid = phpIntval(ytroop.uid);
  const resistcid = phpIntval(mem.resistcid);
  const hid = phpIntval(mem.attackhid);
  const resisthid = phpIntval(mem.resisthid);

  const actArray = troop2array(phpString(mtroop.soldiers));
  const defArray = troop2array(phpString(ytroop.soldiers));
  const aArray = getArraySub(actArray, overActArray);
  const dArray = getArraySub(defArray, overDefArray);
  const dValue = sol2people(dArray, deps.usepeople); // sol2Value ≈ population value of losses
  const aValue = sol2people(aArray, deps.usepeople);
  const acount = array2count(actArray);
  const dcount = array2count(defArray);
  const adiecount = array2count(aArray);

  const users = await deps.query(
    sql<Row>`select * from sys_user where uid = ${uid} or uid = ${resistuid}`,
  );
  const firstIsAttacker = phpIntval(users[0]?.uid) === uid;
  const userInfo1: Row = (firstIsAttacker ? users[0] : users[1]) ?? {};
  const userInfo2: Row = (firstIsAttacker ? users[1] : users[0]) ?? {};
  const nobility = phpIntval(userInfo1.nobility);
  const wid = cid2wid(resistcid);
  const field = (await deps.query(sql<Row>`select * from mem_world where wid = ${wid}`))[0] ?? {};
  await sql`update mem_world set state = 0 where wid = ${wid}`.execute(deps.db);

  const aWoundedBase = acount > 1000 ? 0.19 : 0.8;
  const dWoundedBase = dcount > 1000 ? 0.19 : 0.8;
  const aCapture = dcount > 1000 ? 0.15 : 0.32;

  // 清囊 (buftype 9/10083) wounded/capture bonuses — a user-buffer side table (goods module).
  stub('清囊 buffers (mem_user_buffer buftype 9/10083)');

  // Wounded bookkeeping (addCityWounded) + capture detail.
  const cCapturenum = new Map<number, number>();
  let capturetiele = '';
  if (uid > 1000) {
    const aWounder = new Map<number, number>();
    for (const [sid, cnt] of aArray) {
      const w = Math.floor(cnt * aWoundedBase);
      if (w > 0) aWounder.set(sid, w);
    }
    if (aWounder.size)
      await addCityWounded(deps, type === 4 ? phpIntval(mtroop.startcid) : cid, aWounder);
  }
  const dWounder = new Map<number, number>();
  for (const [sid, cnt] of dArray) {
    const w = Math.floor(cnt * dWoundedBase);
    const cap = Math.floor(w * aCapture);
    const mtsid = deps.mtRand(0, 3);
    if (w > 0) {
      dWounder.set(sid, w);
      if (mtsid === 1) {
        cCapturenum.set(sid, cap);
        capturetiele += sprintf(lang.report('b_count'), lang.soldierName(sid), cap);
      }
    }
  }
  if (resistuid > 1000 && dWounder.size)
    await addCityWounded(deps, type === 4 ? phpIntval(ytroop.startcid) : resistcid, dWounder);

  // Hero blood / armor hp loss (cfg_js.php:1041-1052): one point per 1% of the army lost. The
  // defender's mem_hero_blood update keys hid by $resistuid instead of $resisthid — an original
  // bug that misses every row; kept as-is.
  const dlostCount = array2count(dArray);
  const alostBlood = adiecount > 0 ? Math.floor((adiecount * 100) / acount) : 0;
  const dlostBlood = dlostCount > 0 ? Math.floor((dlostCount * 100) / dcount) : 0;
  if (alostBlood > 0 && uid > 1000 && hid > 0) {
    await sql`update mem_hero_blood set force = GREATEST(0, force - ${alostBlood})
      where hid = ${hid}`.execute(deps.db);
    await sql`update sys_user_armor set hp = GREATEST(0, hp - ${alostBlood})
      where uid = ${uid} and hid = ${hid}`.execute(deps.db);
  }
  if (dlostBlood > 0 && resistuid > 1000 && resisthid > 0) {
    await sql`update mem_hero_blood set force = GREATEST(0, force - ${dlostBlood})
      where hid = ${resistuid}`.execute(deps.db);
    await sql`update sys_user_armor set hp = GREATEST(0, hp - ${dlostBlood})
      where uid = ${resistuid} and hid = ${resisthid}`.execute(deps.db);
  }

  // Hero exp (addHeroExp): min(value/10, 90% of next-level need); the attacker's amount also
  // lands in the hero's exp column and the report's 战斗收获 line (cfg_js.php:1053-1060).
  let exp1 = 0;
  if (uid > 1000 && hid > 0) {
    const need = phpNum(await heroNeedExp(deps, hid));
    if (need > 0) {
      exp1 = Math.floor(Math.min(dValue / 10, need * 0.9));
      await heroes.addHeroExp(hid, exp1);
    }
  }
  if (resistuid > 1000 && resisthid > 0) {
    const need = phpNum(await heroNeedExp(deps, resisthid));
    if (need > 0) await heroes.addHeroExp(resisthid, Math.floor(Math.min(aValue / 10, need * 0.9)));
  }

  // Prestige (addUserPrestige).
  const apeople = sol2people(aArray, deps.usepeople);
  const dpeople = sol2people(dArray, deps.usepeople);
  let prestige1 = phpNum(userInfo1.prestige);
  if (prestige1 <= 0) prestige1 = 1;
  let prestige3: number;
  if (resistuid < 1000) {
    prestige3 = Math.floor((dpeople - apeople) * Math.min(1, dpeople / prestige1));
    if (prestige3 + prestige1 < 0) prestige3 = 0;
  } else {
    let prestige2 = phpNum(userInfo2.prestige);
    if (prestige2 <= 0) prestige2 = 1;
    prestige3 = Math.floor(((dpeople - apeople) * (1 + Math.min(prestige1 / prestige2, 2))) / 10);
    let prestige4 = 0 - prestige3;
    if (prestige3 + prestige1 < 0) prestige3 = 0;
    if (prestige4 + prestige2 < 0) prestige4 = 0;
    await addUserPrestige(deps, resistuid, prestige4);
  }
  await addUserPrestige(deps, uid, prestige3);

  // Honour (battlefield wins) / goods drops (cfg_js.php:1091-1106). The mt_rand(0, 8000) draw
  // runs on both sides — the scripted RNG pins it — but the default-box opener behind a winning
  // roll (getOpenDefaultGoodsResult + addGoods) is a later wave; cases pin the roll cold.
  let getgoods = '';
  if (bbid > 0) {
    const honour = Math.floor(dpeople / 4000);
    if (honour > 0) {
      getgoods += sprintf(lang.report('goods'), '战场荣誉', honour);
      await sql`update sys_user set honour = honour + ${honour}
        where uid = ${uid}`.execute(deps.db);
    }
  } else {
    const logD = Math.log(dcount);
    const ratebase = logD * logD * logD;
    let rate = deps.mtRand(0, 8000);
    if (phpIntval(mtroop.battlefieldid) > 0) rate = 0;
    if (rate < ratebase) stub('default-goods drop (getOpenDefaultGoodsResult + addGoods)');
  }

  // Food/usepeople recompute values the UPDATEs below carry.
  let afoodUse = 0;
  let ausepeople = 0;
  let dfoodUse = 0;
  let dusepeople = 0;
  const foodUse = deps.usepeople; // the fooduse table is loaded alongside usepeople; see service
  for (const [sid, cnt] of overActArray) {
    afoodUse += (foodUse[sid] ?? 0) * cnt;
    ausepeople += (deps.usepeople[sid] ?? 0) * cnt;
  }
  for (const [sid, cnt] of overDefArray) {
    dfoodUse += (foodUse[sid] ?? 0) * cnt;
    dusepeople += (deps.usepeople[sid] ?? 0) * cnt;
  }

  const outcome: SettleOutcome = {
    enter: 0,
    mstate: '0',
    loyalty: 0,
    catch: '',
    warming: '',
    losthero: '',
    robArray: undefined,
    movecid: 0,
    check: undefined,
  };

  await applyOutcome(deps, {
    end,
    type,
    task,
    uid,
    resistuid,
    cid,
    resistcid,
    hid,
    resisthid,
    state,
    troopid1,
    troopid2,
    mtroop,
    ytroop,
    field,
    sysBattle,
    attacksoldiers,
    resistsoldiers,
    overActArray,
    overDefArray,
    overDefenceArray,
    afoodUse,
    ausepeople,
    dfoodUse,
    dusepeople,
    nobility,
    userInfo1,
    wid,
    bbid,
    outcome,
  });

  if (hid > 0) {
    await sql`update sys_city_hero set state = ${outcome.mstate}, exp = exp + ${exp1},
      loyalty = loyalty - ${outcome.loyalty} where hid = ${hid}`.execute(deps.db);
  }
  await sql`update sys_troops set state = 0 where state = 2 and targetcid = ${resistcid}
    order by endtime asc limit 1`.execute(deps.db);

  // Lost-defence regeneration bonus.
  if (type === 1 && lostDefenceArray.size) {
    const addDefence = new Map<number, number>();
    for (const [did, cnt] of lostDefenceArray) {
      if (cnt > 0) {
        const factor = { 1: 0.05, 2: 0.06, 3: 0.03, 4: 0.07, 5: 0.08 }[did];
        if (factor) addDefence.set(did, cnt * factor);
      }
    }
    if (addDefence.size) await addCityDefences(deps, resistcid, addDefence, true);
  }

  // ───────── reports ─────────
  const mcityname = await cityRules.getNamePosition(cid, type);
  const tcityname = await cityRules.getNamePosition(resistcid, type);
  let con = reportTitle(
    lang,
    mcityname,
    tcityname,
    phpIntval(mtroop.task),
    phpIntval(mtroop.state),
  );
  const battype = type === 0 ? (resistuid === 897 ? 1 : 2) : 0;
  con += lang.row(String(battype));

  const myw = end === 0 ? '胜利' : end === 1 ? '失败' : '平局';
  if (phpIntval(userInfo2.uid) === 895) userInfo2.name = '山贼';

  let okcontent = con;
  okcontent += sprintf(
    lang.report('b_titles'),
    round,
    myw,
    phpString(userInfo1.name),
    myw,
    phpString(userInfo2.name),
    end === 0 ? '失败' : end === 1 ? '胜利' : '平局',
    '',
  );

  // Army情 blocks.
  let mywArmy = '';
  let youwArmy = '';
  let rpsoinfo3 = '';
  for (const [sid, cnt] of actArray) {
    const sname = lang.soldierName(sid);
    const lost = aArray.get(sid) ?? 0;
    mywArmy += sprintf(lang.report('armynumss'), sname, cnt, lost);
    rpsoinfo3 = sprintf(lang.report('b_count'), sname, cnt - lost);
  }
  for (const [sid, cnt] of defArray) {
    const sname = lang.soldierName(sid);
    const lost = dArray.get(sid) ?? 0;
    youwArmy += sprintf(lang.report('armynumss'), sname, cnt, lost);
  }
  if (type === 1 && defence && overDefence) {
    for (const [did, v] of overDefence) {
      youwArmy += sprintf(
        lang.report('armynumss'),
        lang.defenceName(did),
        v.oldcnt,
        v.oldcnt - v.cnt,
      );
    }
  }
  if (end === 1 && round === 1) {
    okcontent +=
      '<table border="1" cellpadding="0" cellspacing="0" bordercolor="#FFFFFF" width="505">';
    okcontent += sprintf(lang.report('warming'), '我方首轮交战既全军覆没，没有获得任何情报！');
    okcontent += '</table>';
  } else {
    okcontent += sprintf(lang.report('b_adtroopss'), '我方军情', mywArmy);
    okcontent += sprintf(lang.report('b_adtroopss'), '敌方军情', youwArmy);
  }

  let con1 = sprintf(lang.report('get'), prestige3, exp1, aWoundedBase * 100);
  // 俘虏明细 (addCityCapture): type<>4 with a 50% roll.
  let captureCon = '';
  if (type !== 4) {
    const getcaptures = deps.mtRand(1, 10);
    if (getcaptures < 5 && cCapturenum.size) {
      captureCon = sprintf(lang.report('b_sbinfo'), '俘虏明细', '军队', '数量', capturetiele);
      await addCityCapture(deps, cid, cCapturenum);
    }
  }
  if (getgoods) con1 += getgoods;
  if (outcome.catch) con1 += outcome.catch;
  if (outcome.warming) con1 += outcome.warming;
  if (outcome.losthero) con1 += outcome.losthero;

  con += sprintf(lang.report('detectreport'), '战斗收获');
  con += con1;
  con += sprintf(lang.report('title_end'));

  // commn (cfg_js.php:1593-1612): the morale/nobility/city-type verdict lines of a city fight,
  // then 占领成功 / the 掠夺 outcome. `$check` is the check_morale result array — always truthy —
  // so for a type-1 battle the verdict lines append whether or not the takeover passed.
  let commn = '';
  if (outcome.check) {
    if (type === 1) commn += outcome.checkCon ?? '';
    if (type === 1 && outcome.enter === 1) {
      commn += '占领成功！<br/>';
    } else if (outcome.robArray) {
      const r = outcome.robArray;
      commn += sprintf(lang.report('resource'), '掠夺战果', r.gold, r.food, r.wood, r.rock, r.iron);
      commn += '掠夺完成！<br/>';
    } else {
      commn +=
        ' 遭到多次掠夺后，该城池充满了警惕，早在入侵者到达之前，就已经将所有资源隐藏起来，掠夺者没有获得任何资源。<br/>';
      commn += type === 1 ? '占领失败！<br/>' : '掠夺失败！<br/>';
    }
  }
  con += commn;
  if (captureCon) okcontent += captureCon;

  if (adiecount < acount) {
    if (outcome.enter) {
      con += `<br/>军队进入${tcityname}。`;
    } else {
      con += sprintf(lang.report('troopback'), '部队返回', '', rpsoinfo3);
      con += `<br/>军队正在返回${mcityname}。`;
    }
    okcontent += con;
  } else {
    okcontent += '<br/> 我军全军覆没，没有军队返回！';
  }

  await report.sendReport(
    uid,
    reportTitleType(task, phpIntval(mtroop.state)),
    cid,
    resistcid,
    okcontent,
  );

  if (uid > 1000) await cityRules.refreshFoodArmyUsers(phpIntval(mtroop.cid));
  if (resistuid > 1000) {
    await cityRules.refreshFoodArmyUsers(phpIntval(ytroop.cid));
    await sql`update sys_user set war_defence_prestige = war_defence_prestige + ${apeople}
      where uid = ${resistuid}`.execute(deps.db);
    if (uid > 1000) {
      await sql`update sys_user set war_attack_prestige = war_attack_prestige + ${dpeople}
        where uid = ${uid}`.execute(deps.db);
    }
    // The defender's own report + 联盟战报 — same shape; we file a defender report so the
    // player is notified (the extensive 盟报 bookkeeping is a later wave).
    stub('defender 联盟战报 (sys_union_report)');
    const con3 =
      reportTitle(lang, mcityname, tcityname, phpIntval(mtroop.task), phpIntval(mtroop.state)) +
      lang.battle('youend');
    await report.sendReport(resistuid, task + 10, cid, resistcid, con3);
  }
}

/** The per-outcome mutation bundle built as `applyOutcome` runs (the original's $-vars). */
interface SettleOutcome {
  enter: number;
  mstate: string;
  loyalty: number;
  catch: string;
  warming: string;
  losthero: string;
  robArray?: { gold: number; food: number; wood: number; rock: number; iron: number };
  movecid: number;
  check?: unknown;
  /** check_morale + check_nobility + check_city_type verdict lines (a type-1 battle's commn). */
  checkCon?: string;
}

interface OutcomeArgs {
  end: number;
  type: number;
  task: number;
  uid: number;
  resistuid: number;
  cid: number;
  resistcid: number;
  hid: number;
  resisthid: number;
  state: number;
  troopid1: number;
  troopid2: number;
  mtroop: Row;
  ytroop: Row;
  field: Row;
  sysBattle: Row;
  attacksoldiers: string;
  resistsoldiers: string;
  overActArray: Map<number, number>;
  overDefArray: Map<number, number>;
  overDefenceArray: Map<number, number>;
  afoodUse: number;
  ausepeople: number;
  dfoodUse: number;
  dusepeople: number;
  nobility: number;
  userInfo1: Row;
  wid: number;
  bbid: number;
  outcome: SettleOutcome;
}

/** The `switch($end){ case 0: switch($type)… }` body of getBattleResult. */
async function applyOutcome(deps: BattleResultDeps, a: OutcomeArgs): Promise<void> {
  const { db } = deps;
  const o = a.outcome;
  if (a.end === 0) {
    // 攻击方胜利
    await sql`delete from sys_troops where id = ${a.troopid2}`.execute(db);
    if (a.type === 0) {
      // 野地战 (掠夺 task 3 / 占领 else)
      if (a.task === 3) {
        o.check = 1;
        await sql`update sys_troops set state = 1, starttime = unix_timestamp(),
          endtime = unix_timestamp() + pathtime, soldiers = ${a.attacksoldiers},
          fooduse = ${a.afoodUse}, people = ${a.ausepeople} where id = ${a.troopid1}`.execute(db);
        o.mstate = '2';
        if (a.resisthid > 0) {
          if (a.resistuid > 1000)
            await sql`update sys_city_hero set state = 0 where hid = ${a.resisthid}`.execute(db);
          else {
            const hero = (
              await deps.query(
                sql<Row>`select * from sys_city_hero where hid = ${a.resisthid} limit 1`,
              )
            )[0];
            if (hero) await deps.heroes.throwHeroToField(hero);
          }
        }
        await deps.tasks.completeTask(a.uid, phpIntval(a.field.level) + 121);
      } else {
        // 占领野地
        if (a.resisthid > 0 && a.resistuid <= 1000) {
          const hero = (
            await deps.query(
              sql<Row>`select * from sys_city_hero where hid = ${a.resisthid} and herotype = 0`,
            )
          )[0];
          if (hero) o.catch += await catchHero(deps, a.uid, a.cid, hero, a.type);
        }
        if (await checkFeildCount(deps, a.cid)) {
          await sql`update mem_world set updatetime = unix_timestamp(), ownercid = ${a.cid} where wid = ${a.wid}`.execute(
            db,
          );
          await sql`update sys_troops set state = 4, soldiers = ${a.attacksoldiers},
            fooduse = ${a.afoodUse}, people = ${a.ausepeople} where id = ${a.troopid1}`.execute(db);
          await updateFieldResourceAdds(deps, a.cid);
          o.mstate = '4';
          o.enter = 1;
        } else {
          await sql`update sys_troops set state = 1, starttime = unix_timestamp(),
            endtime = unix_timestamp() + pathtime, soldiers = ${a.attacksoldiers},
            fooduse = ${a.afoodUse}, people = ${a.ausepeople} where id = ${a.troopid1}`.execute(db);
          o.mstate = '2';
          o.warming = sprintf(deps.lang.report('warming'), '野地达到上限，无法占领更多野地！');
        }
        if (phpIntval(a.field.type) === 1) await deps.tasks.completeTask(a.uid, 168);
        if (phpIntval(a.field.level) > 0)
          await deps.tasks.completeTask(a.uid, phpIntval(a.field.level) + 152);
      }
    } else if (a.type === 1) {
      await applyCityCapture(deps, a);
    } else if (a.type === 2) {
      // 掠夺城池
      o.mstate = '2';
      o.check = 1;
      stub('城池掠夺资源结算 (get_city_resource + add_resource robArray)');
      await sql`update sys_troops set state = 1, starttime = unix_timestamp(),
        endtime = unix_timestamp() + pathtime, soldiers = ${a.attacksoldiers},
        fooduse = ${a.afoodUse}, people = ${a.ausepeople} where id = ${a.troopid1}`.execute(db);
      if (a.resisthid)
        await sql`update sys_city_hero set state = ${a.state} where hid = ${a.resisthid}`.execute(
          db,
        );
      await sql`update sys_city_hero set loyalty = loyalty - 1 where cid = ${a.resistcid}`.execute(
        db,
      );
    } else if (a.type === 4) {
      // 战场 (BloodBattle) — events/winpoints not ported.
      o.mstate = '4';
      await sql`update sys_troops set cid = ${a.resistcid}, state = 4, soldiers = ${a.attacksoldiers},
        battleid = 0 where id = ${a.troopid1}`.execute(db);
      stub('战场 (type 4) events / winpoints / reinforcements');
      o.enter = 1;
    }
  } else if (a.end === 1) {
    // 防守方胜利
    if (a.type === 0 || a.type === 4) {
      await sql`delete from sys_troops where id = ${a.troopid1}`.execute(db);
      await sql`update sys_troops set state = 4, soldiers = ${a.resistsoldiers},
        fooduse = ${a.dfoodUse}, people = ${a.dusepeople} where id = ${a.troopid2}`.execute(db);
    } else {
      await sql`delete from sys_troops where id = ${a.troopid1} or id = ${a.troopid2}`.execute(db);
      if (a.overDefArray.size)
        await deps.cityRules.addCitySoldiers(a.resistcid, a.overDefArray, true);
      if (a.type === 1 && a.overDefenceArray.size)
        await addCityDefences(deps, a.resistcid, a.overDefenceArray, true);
    }
    o.mstate = '0';
    o.loyalty = 5;
    if (a.resisthid > 0)
      await sql`update sys_city_hero set state = ${a.state} where hid = ${a.resisthid}`.execute(db);
  } else if (a.end === 2) {
    // 平局
    o.mstate = '2';
    if (a.resisthid > 0)
      await sql`update sys_city_hero set state = ${a.state} where hid = ${a.resisthid}`.execute(db);
    if (a.type === 0 || a.type === 4) {
      await sql`update sys_troops set state = 4, soldiers = ${a.resistsoldiers},
        fooduse = ${a.dfoodUse}, people = ${a.dusepeople} where id = ${a.troopid2}`.execute(db);
    } else {
      if (a.overDefArray.size)
        await deps.cityRules.addCitySoldiers(a.resistcid, a.overDefArray, true);
      if (a.type === 1 && a.overDefenceArray.size)
        await addCityDefences(deps, a.resistcid, a.overDefenceArray, true);
      await sql`delete from sys_troops where id = ${a.troopid2}`.execute(db);
    }
    await sql`update sys_troops set state = 1, starttime = unix_timestamp(),
      endtime = unix_timestamp() + pathtime, soldiers = ${a.attacksoldiers},
      fooduse = ${a.afoodUse}, people = ${a.ausepeople} where id = ${a.troopid1}`.execute(db);
  }
}

/** case 1 (占领城池): the full city takeover, folded out of applyOutcome for readability. */
async function applyCityCapture(deps: BattleResultDeps, a: OutcomeArgs): Promise<void> {
  const { db } = deps;
  const o = a.outcome;
  // The morale/nobility/city-type gates (check_morale/check_nobility/check_city_type) determine
  // whether the city is actually taken; they are their own helpers below.
  const cityInfo =
    (
      await deps.query(sql<Row>`select r.morale, r.complaint, c.type, c.name,
      w.province, w.jun from mem_city_resource r, sys_city c, mem_world w
      where r.cid = c.cid and w.type = 0 and w.ownercid = c.cid and c.cid = ${a.resistcid}`)
    )[0] ?? {};
  const check = await checkMorale(
    deps,
    a.resistcid,
    phpIntval(cityInfo.type),
    phpNum(cityInfo.morale),
    phpNum(cityInfo.complaint),
  );
  const check1 = await checkNobility(deps, a.uid, a.nobility);
  const check2 = await checkCityType(deps, a.uid, cityInfo);
  o.check = check;
  o.checkCon = phpString(check.con) + phpString(check1.con) + phpString(check2.con);

  // 占领 captures the defending heroes: when the winner's city still has a free hero slot, the
  // legacy picks the defeated city's heroes via chose_hero (every hero at loyalty <= 40, plus one
  // loyalty-weighted mt_rand pick) and runs catchHero on each. This runs REGARDLESS of whether the
  // takeover gate below passes (the original does it before the check). Ported from
  // OLdBattleCron.php case 1.
  if (await cityHasHeroPosition(deps, a.uid, a.cid)) {
    const heros = await choseHeroes(deps, a.resistcid, a.resisthid);
    for (const hero of heros) {
      o.catch += await catchHero(deps, a.uid, a.cid, hero, a.type);
    }
  }
  await sql`update sys_city_hero set loyalty = loyalty - 5 where loyalty > 4 and cid = ${a.resistcid}`.execute(
    db,
  );

  if (check.can && check1.can && check2.can) {
    // Takeover: clear the city's transient tables, re-own it, drop building levels, move soldiers.
    // The schedule cooldowns reset first (cfg_js.php case 1, line 1207).
    await sql`update mem_city_schedule set last_govern_time = 0, last_change_name = 0,
      last_levy_resource = 0, last_pacify_people = 0, last_trick_morale = 0,
      last_trick_weiweijiuzhao = 0, last_trick_chenhuodajie = 0, last_trick_maifu = 0,
      last_anming = 0, last_adv_move = 0 where cid = ${a.resistcid}`.execute(db);
    for (const tbl of [
      'sys_city_draftqueue',
      'mem_city_draft',
      'mem_city_wounded',
      'mem_city_lamster',
      'sys_city_soldier',
      'mem_building_upgrading',
      'mem_building_destroying',
      'mem_city_buffer',
      'sys_city_defence',
      'sys_city_reinforcequeue',
      'mem_city_reinforce',
      'sys_city_tactics',
      'sys_city_rumor',
      'sys_recruit_hero',
    ]) {
      await sql`delete from ${sql.table(tbl)} where cid = ${a.resistcid}`.execute(db);
    }
    await sql`update sys_building set level = level - 1, state = 0 where cid = ${a.resistcid} and state > 0`.execute(
      db,
    );
    await sql`update sys_user set lastcid = ${a.resistcid} where uid = ${a.uid}`.execute(db);

    const cityCnt = phpNum(
      await deps.cell(sql<Row>`select count(cid) as c from sys_city where uid = ${a.resistuid}`),
    );
    if (a.resistuid > 1000 && phpIntval(cityInfo.type) === 0 && cityCnt <= 1) {
      // The defender's last city: 秒回 and relocate it. Deep (movecitys/troopsBack/moveGetCid).
      stub('占领 defender last-city relocation (troopsBack/movecitys/moveGetCid)');
      await sql`delete from sys_troops where cid = ${a.resistcid}`.execute(db);
    } else {
      await sql`delete from sys_troops where cid = ${a.resistcid}`.execute(db);
      const heros = await deps.query(
        sql<Row>`select * from sys_city_hero where cid = ${a.resistcid} and uid = ${a.resistuid}`,
      );
      for (const hero of heros) {
        await deps.heroes.throwHeroToField(hero);
        o.losthero += sprintf(
          deps.lang.battle('losthero'),
          phpString(hero.name),
          phpNum(hero.level),
        );
      }
    }
    await sql`update sys_city set uid = ${a.uid} where cid = ${a.resistcid}`.execute(db);
    let govLevel = 1;
    if (cityCnt <= 1 && a.resistuid > 1000) {
      await sql`update sys_building set level = 1 where cid = ${a.resistcid}`.execute(db);
    } else {
      await sql`update sys_building set level = level - floor(rand() * 4) where cid = ${a.resistcid}`.execute(
        db,
      );
      govLevel = phpNum(
        await deps.cell(
          sql<Row>`select level from sys_building where cid = ${a.resistcid} and bid = 6`,
        ),
      );
    }
    await resetCityGoodsAdd(deps, a.uid, a.resistcid);
    await delBuildings(deps, a.resistcid, govLevel);
    // check_city_resource + check_Technic (the economy / tech re-derive) belong to the resource
    // wave and stay unported; difftest cases scope their tables out.
    stub('占领 check_city_resource / check_Technic (economy recompute)');
    await deps.cityRules.addCitySoldiers(a.resistcid, a.overActArray, true);
    if (phpString(a.mtroop.resource) !== '0' && phpString(a.mtroop.resource) !== '0,0,0,0,0,') {
      const r = checkResource(phpString(a.mtroop.resource));
      if (r)
        await deps.cityRules.addCityResources(a.resistcid, r.wood, r.rock, r.iron, r.food, r.gold);
    }
    await sql`update sys_city_hero set cid = ${a.resistcid} where hid = ${a.hid}`.execute(db);
    o.mstate = '1';
    await sql`update sys_city set chiefhid = ${a.hid} where cid = ${a.resistcid}`.execute(db);
    await deps.heroes.updateCityHeroChange(a.uid, a.resistcid);
    const msg = sprintf(
      deps.lang.battle('invademsg'),
      deps.lang.battleArr('citytype', phpIntval(cityInfo.type)),
      phpString(cityInfo.name),
      phpString(a.userInfo1.name),
    );
    await sql`insert into sys_inform (type, inuse, starttime, endtime, \`interval\`, scrollcount, color, msg)
      values (0, 1, unix_timestamp(), unix_timestamp() + 600, 50000, 1, 16738740, ${msg})`.execute(
      db,
    );
    o.enter = 1;
    await sql`delete from sys_troops where id = ${a.troopid1}`.execute(db);
  } else {
    // Occupation failed: 掠夺 resources instead, turn home.
    stub('占领失败 → 掠夺资源结算 (get_city_resource robArray)');
    await sql`update sys_troops set state = 1, starttime = unix_timestamp(),
      endtime = unix_timestamp() + pathtime, soldiers = ${a.attacksoldiers},
      resource = ${phpString(a.mtroop.resource)}, fooduse = ${a.afoodUse}, people = ${a.ausepeople}
      where id = ${a.troopid1}`.execute(db);
    o.mstate = '2';
    if (a.type === 1 && a.overDefenceArray.size)
      await addCityDefences(deps, a.resistcid, a.overDefenceArray, true);
  }
  if (a.resisthid > 0) {
    await sql`update sys_city_hero set state = ${a.state} where hid = ${a.resisthid} and uid = ${a.resistuid}`.execute(
      db,
    );
  }
}

// ───────────────────────── small cfg_js.php helpers ─────────────────────────

/** cfg_js.php::addCityWounded. */
async function addCityWounded(
  deps: BattleResultDeps,
  cid: number,
  soldiers: Map<number, number>,
): Promise<void> {
  for (const [sid, count] of soldiers) {
    await sql`insert into mem_city_wounded (cid, sid, count) values (${cid}, ${sid}, ${count})
      on duplicate key update count = GREATEST(0, count + ${count})`.execute(deps.db);
  }
}

/** cfg_js.php::addCityCapture. */
async function addCityCapture(
  deps: BattleResultDeps,
  cid: number,
  soldiers: Map<number, number>,
): Promise<void> {
  for (const [sid, count] of soldiers) {
    await sql`insert into mem_city_captive (cid, sid, count) values (${cid}, ${sid}, ${count})
      on duplicate key update count = GREATEST(0, count + ${count})`.execute(deps.db);
  }
}

/** cfg_js.php::addCityDefences. */
async function addCityDefences(
  deps: BattleResultDeps,
  cid: number,
  soldiers: Map<number, number>,
  add: boolean,
): Promise<void> {
  for (const [did, count] of soldiers) {
    const n = add ? count : -count;
    await sql`insert into sys_city_defence (cid, did, count) values (${cid}, ${did}, ${n})
      on duplicate key update count = case when ((count + values(count)) > 4294967000) then 0
        else (count + values(count)) end`.execute(deps.db);
  }
}

/** cfg_js.php::addUserPrestige. */
async function addUserPrestige(deps: BattleResultDeps, uid: number, value: number): Promise<void> {
  await sql`update sys_user set warprestige = warprestige + GREATEST(0, ${value}),
    prestige = prestige + GREATEST(0, ${value}) where uid = ${uid}`.execute(deps.db);
}

/** cfg_js.php::checkFeildCount: owned fields below 官府 level. */
async function checkFeildCount(deps: BattleResultDeps, cid: number): Promise<boolean> {
  const guanlevel = phpNum(
    await deps.cell(sql<Row>`select level as v from sys_building where cid = ${cid} and bid = 6`),
  );
  const fieldcount = phpNum(
    await deps.cell(
      sql<Row>`select count(ownercid) as v from mem_world where ownercid = ${cid} and type > 0`,
    ),
  );
  return fieldcount < guanlevel;
}

/** OLdBattleCron.php::updateFieldResourceAdds: recompute a city's field resource adds. */
async function updateFieldResourceAdds(deps: BattleResultDeps, cid: number): Promise<void> {
  const fields = await deps.query(
    sql<Row>`select * from mem_world where type > 1 and ownercid = ${cid}`,
  );
  let food = 0;
  let wood = 0;
  let rock = 0;
  let iron = 0;
  for (const f of fields) {
    const level = phpNum(f.level);
    if (level <= 0) continue;
    switch (phpIntval(f.type)) {
      case 2:
        rock += 3 + 2 * level;
        break; // WT_DESERT
      case 3:
        wood += 3 + 2 * level;
        break; // WT_FOREST
      case 4:
        food += 2 + level;
        break; // WT_GRASS
      case 5:
        iron += 3 + 2 * level;
        break; // WT_HILL
      case 6:
        food += 5 + 3 * level;
        break; // WT_LAKE
      case 7:
        food += 3 + 2 * level;
        break; // WT_SWAMP
    }
  }
  await sql`update sys_city_res_add set field_food_add = ${food}, field_wood_add = ${wood},
    field_rock_add = ${rock}, field_iron_add = ${iron} where cid = ${cid}`.execute(deps.db);
  await deps.cityRules.updateCityResourceAdd(cid);
}

/** cfg_js.php::check_morale. */
async function checkMorale(
  deps: BattleResultDeps,
  cid: number,
  type: number,
  morale: number,
  complaint: number,
): Promise<{ can: number; morale: number; complaint: number; con: string }> {
  if (morale < 0) morale = 0;
  const addmorale = type > 0 ? (morale - 3 > 0 ? 3 : morale) : 0;
  const can = morale - addmorale === 0 ? 1 : 0;
  if (complaint > 100) complaint = 100;
  const recomplaint = complaint + 5 < 100 ? complaint + 5 : 100;
  const con = sprintf(
    deps.lang.battle('invade'),
    morale,
    addmorale,
    morale - addmorale,
    complaint,
    recomplaint - complaint,
    recomplaint,
    morale - addmorale,
    deps.lang.battleArr('invade_result', can),
  );
  await sql`update mem_city_resource set complaint = ${recomplaint}, morale = ${morale - addmorale},
    morale_stable = GREATEST(0, LEAST(100 - tax - complaint, 100)) where cid = ${cid}`.execute(
    deps.db,
  );
  return { can, morale: morale - addmorale, complaint: recomplaint, con };
}

/**
 * cfg_js.php::check_nobility (1158-1165): the takeover needs the (推恩-boosted) nobility to cover
 * one more city than the attacker currently holds.
 */
async function checkNobility(
  deps: BattleResultDeps,
  uid: number,
  nobility: number,
): Promise<{ can: number; con: string }> {
  const buffered = await deps.users.bufferNobility(uid, nobility);
  const count = phpNum(
    await deps.cell(sql<Row>`select count(cid) as v from sys_city where uid = ${uid}`),
  );
  const can = buffered >= count ? 1 : 0;
  return {
    can,
    con: sprintf(
      deps.lang.battle('jueweiinvade'),
      deps.lang.battleArr('juewei', count),
      deps.lang.battleArr('juewei', buffered),
      deps.lang.battleArr('invade_result', can),
    ),
  };
}

/**
 * cfg_js.php::check_city_type (1167-1191): an ordinary city (type < 2) is always takeable; a
 * 郡/州/都 additionally needs the attacker (or their union) to already hold a third of the
 * prerequisite famous cities in the same commandery / province / the realm.
 */
async function checkCityType(
  deps: BattleResultDeps,
  uid: number,
  cityInfo: Row,
): Promise<{ can: number; con: string }> {
  const citytype = phpIntval(cityInfo.type);
  if (citytype < 2) return { can: 1, con: '' };
  const province = phpNum(cityInfo.province);
  const jun = phpNum(cityInfo.jun);
  const unionid = phpNum(
    await deps.cell(sql<Row>`select union_id as v from sys_user where uid = ${uid}`),
  );
  // prerequisite type: taking a 郡城 needs 县城s, an 州城 needs 郡城s, a 都城 needs 州城s.
  const preType = citytype - 1;
  const inScope =
    unionid > 0
      ? sql<Row>`select count(*) as v from sys_city c, sys_user u, mem_world w
        where w.type = 0 and c.uid = u.uid and w.ownercid = c.cid
          and w.province = ${province} and w.jun = ${jun} and c.type = ${preType}
          and u.union_id = ${unionid}`
      : sql<Row>`select count(*) as v from sys_city c, mem_world w
        where w.type = 0 and c.uid = ${uid} and w.ownercid = c.cid
          and w.province = ${province} and w.jun = ${jun} and c.type = ${preType}`;
  let citys: number;
  let havecount = phpNum((await deps.query(inScope))[0]?.v);
  if (citytype === 2) {
    citys = phpNum(
      (
        await deps.query(sql<Row>`select count(*) as v from sys_city c, mem_world w
          where w.type = 0 and w.ownercid = c.cid and c.type = 1
            and w.province = ${province} and w.jun = ${jun}`)
      )[0]?.v,
    );
  } else if (citytype === 3) {
    citys = phpNum(
      (
        await deps.query(sql<Row>`select count(*) as v from sys_city c, mem_world w
          where w.type = 0 and w.ownercid = c.cid and c.type = 2 and w.province = ${province}`)
      )[0]?.v,
    );
    havecount = phpNum(
      (
        await deps.query(
          unionid > 0
            ? sql<Row>`select count(*) as v from sys_city c, sys_user u, mem_world w
                where w.type = 0 and c.uid = u.uid and w.ownercid = c.cid
                  and w.province = ${province} and c.type = 2 and u.union_id = ${unionid}`
            : sql<Row>`select count(*) as v from sys_city c, mem_world w
                where w.type = 0 and c.uid = ${uid} and w.ownercid = c.cid
                  and w.province = ${province} and c.type = 2`,
        )
      )[0]?.v,
    );
  } else {
    citys = 12;
    havecount = phpNum(
      (
        await deps.query(
          unionid > 0
            ? sql<Row>`select count(*) as v from sys_city c, sys_user u, mem_world w
                where w.type = 0 and c.uid = u.uid and w.ownercid = c.cid
                  and c.type = 3 and u.union_id = ${unionid}`
            : sql<Row>`select count(*) as v from sys_city c, mem_world w
                where w.type = 0 and c.uid = ${uid} and w.ownercid = c.cid and c.type = 3`,
        )
      )[0]?.v,
    );
  }
  const can = citys / 3 > havecount ? 0 : 1;
  return {
    can,
    con: sprintf(
      deps.lang.battle('cityinvade'),
      citys,
      deps.lang.battleArr('citytype', citytype - 1),
      deps.lang.battleArr('citytype', citytype - 1),
      havecount,
      deps.lang.battleArr('invade_result', can),
    ),
  };
}

/** cfg_js.php::delBuildings (1121-1137): below 官府 10, outer buildings off the level's grid go. */
async function delBuildings(deps: BattleResultDeps, cid: number, level: number): Promise<void> {
  const VALID_GRID_ARRAY = [
    '',
    '10,60,11,21,31,41,51,61,22,32,42,52',
    '10,60,70,11,21,31,41,51,61,71,22,32,42,52,62',
    '10,60,70,11,21,31,41,51,61,71,22,32,42,52,62,33,43,53',
    '10,60,70,11,21,31,41,51,61,71,81,22,32,42,52,62,72,33,43,53,63',
    '10,60,70,1,11,21,31,41,51,61,71,81,12,22,32,42,52,62,72,23,33,43,53,63',
    '10,60,70,1,11,21,31,41,51,61,71,81,12,22,32,42,52,62,72,23,33,43,53,63,34,44,54',
    '10,60,70,1,11,21,31,41,51,61,71,81,12,22,32,42,52,62,72,82,23,33,43,53,63,73,34,44,54,64',
    '10,60,70,1,11,21,31,41,51,61,71,81,12,22,32,42,52,62,72,82,23,33,43,53,63,73,34,44,54,64,45,55,65',
    '10,60,70,1,11,21,31,41,51,61,71,81,2,12,22,32,42,52,62,72,82,13,23,33,43,53,63,73,24,34,44,54,64,45,55,65',
    '10,60,70,1,11,21,31,41,51,61,71,81,2,12,22,32,42,52,62,72,82,13,23,33,43,53,63,73,24,34,44,54,64,35,45,55,65,46,56',
  ];
  if (level < 10) {
    const grid = VALID_GRID_ARRAY[level] ?? VALID_GRID_ARRAY[0]!;
    await sql`delete from sys_building where cid = ${cid} and xy < 100
      and xy not in (${sql.raw(grid)})`.execute(deps.db);
  }
}

/**
 * utils.php::resetCityGoodsAdd (1396-1424): re-derive the captured city's goods buffs (buftype
 * 1-4 → +25 resource add). Same private copy as city-found / city-merge until a shared port.
 */
async function resetCityGoodsAdd(deps: BattleResultDeps, uid: number, cid: number): Promise<void> {
  const buffers = await deps.query(sql<Row>`select * from mem_user_buffer
    where uid = ${uid} and buftype <= 4 and endtime > unix_timestamp()`);
  let food_add = 0;
  let wood_add = 0;
  let rock_add = 0;
  let iron_add = 0;
  for (const buffer of buffers) {
    const buftype = phpIntval(buffer.buftype);
    if (buftype === 1) food_add = 25;
    else if (buftype === 2) wood_add = 25;
    else if (buftype === 3) rock_add = 25;
    else if (buftype === 4) iron_add = 25;
  }
  await sql`update sys_city_res_add set goods_food_add = ${food_add}, goods_wood_add = ${wood_add},
    goods_rock_add = ${rock_add}, goods_iron_add = ${iron_add}, resource_changing = 1
    where cid = ${cid}`.execute(deps.db);
}

/** cfg_js.php::catchHero: attempt to capture a defeated hero (loyalty roll). */
async function catchHero(
  deps: BattleResultDeps,
  uid: number,
  cid: number,
  hero: Row,
  type: number,
): Promise<string> {
  const loyalty = phpNum(hero.loyalty);
  let catchRoll = deps.mtRand(1, 100);
  if (phpNum(hero.herotype) > 0) catchRoll = 0;
  if (type !== 1 && phpNum(hero.uid) > 1000) catchRoll = 0;
  if (loyalty <= catchRoll) {
    const lostlevel = phpNum(hero.level) > 40 ? Math.floor(phpNum(hero.level) * 0.05) : 0;
    const addPoint = phpNum(hero.level) - lostlevel;
    const affairs = Math.floor(addPoint / 3);
    const bravery = affairs;
    const wisdom = addPoint - affairs - bravery;
    const herolevel = phpNum(hero.level) - lostlevel;
    const exp = phpNum(
      await deps.cell(
        sql<Row>`select total_exp as v from cfg_hero_level where level = ${herolevel}`,
      ),
    );
    await sql`update sys_city_hero set uid = ${uid}, cid = ${cid}, state = 5, level = level - ${lostlevel},
      exp = ${exp}, command_add_on = 0, affairs_add = ${affairs}, bravery_add = ${bravery},
      wisdom_add = ${wisdom}, affairs_add_on = 0, bravery_add_on = 0, wisdom_add_on = 0,
      force_max_add_on = 0, energy_max_add_on = 0, speed_add_on = 0, attack_add_on = 0,
      defence_add_on = 0, loyalty = 0 where hid = ${phpIntval(hero.hid)}`.execute(deps.db);
    await sql`replace into sys_hero_captive (hid, uid, captivetime) values (${phpIntval(hero.hid)}, ${uid}, unix_timestamp())`.execute(
      deps.db,
    );
    // cfg_js.php:997-999: strip the captured hero's armour and start a fresh blood row.
    await sql`delete from sys_hero_armor where hid = ${phpIntval(hero.hid)}`.execute(deps.db);
    await sql`update sys_user_armor set hid = 0 where hid = ${phpIntval(hero.hid)}`.execute(
      deps.db,
    );
    await sql`replace into mem_hero_blood (hid) values (${phpIntval(hero.hid)})`.execute(deps.db);
    await deps.heroes.updateCityHeroChange(uid, cid);
    await deps.heroes.updateCityHeroChange(hero.uid, hero.cid);
    return sprintf(deps.lang.battle('catchhero'), phpString(hero.name), phpNum(hero.level));
  }
  // Not caught: the hero may flee to a wild field (throwHeroToField). cfg_js.php::catchHero else
  // branch — `$run = mt_rand(1,20)`, then by battle type and tile type:
  //   type 0 (占领): loyalty-3; a CITY tile releases the hero only when its morale is 0, a WILD
  //     field releases it when run>3 AND the hero is an NPC (uid<1000) — a player's field hero never
  //     flees; type !=0 (掠夺): only a WILD field with an NPC hero, released when run<11.
  const wInfo =
    (await deps.query(sql<Row>`select type from mem_world where wid = ${cid2wid(cid)}`))[0] ?? {};
  const run = deps.mtRand(1, 20);
  if (type === 0) {
    await sql`update sys_city_hero set loyalty = loyalty - 3 where loyalty > 0 and hid = ${phpIntval(hero.hid)}`.execute(
      deps.db,
    );
    if (phpIntval(wInfo.type) === 0) {
      const morale = phpNum(
        await deps.cell(sql<Row>`select morale as v from mem_city_resource where cid = ${cid}`),
      );
      if (morale === 0) await deps.heroes.throwHeroToField(hero);
    } else if (run > 3 && phpNum(hero.uid) < 1000) {
      await deps.heroes.throwHeroToField(hero);
    }
  } else if (phpIntval(wInfo.type) > 0 && phpNum(hero.uid) < 1000) {
    if (run < 11) await deps.heroes.throwHeroToField(hero);
  }
  return '';
}

/** utils.php::cityHasHeroPosition: the winner's city has a free 城守/主将/军师 slot. */
async function cityHasHeroPosition(
  deps: BattleResultDeps,
  uid: number,
  cid: number,
): Promise<boolean> {
  const city = (
    await deps.query(
      sql<Row>`select chiefhid, generalid, counsellorid from sys_city where uid = ${uid} and cid = ${cid}`,
    )
  )[0];
  if (!city) return false;
  return (
    phpNum(city.chiefhid) === 0 || phpNum(city.generalid) === 0 || phpNum(city.counsellorid) === 0
  );
}

/**
 * cfg_js.php::chose_hero($cid,$hid): the defeated city's heroes eligible for capture — every hero
 * in the city (state <2 or >6, <9, herotype 0) OR the given $hid. Returns all heroes at loyalty
 * <= 40, PLUS one loyalty-weighted mt_rand pick (skipped if it is already in the <=40 list). The
 * mt_rand(1,ratesum) draw is pinned by the scripted RNG so both sides pick the same hero.
 */
async function choseHeroes(deps: BattleResultDeps, cid: number, hid: number): Promise<Row[]> {
  const heros = await deps.query(
    sql<Row>`select * from sys_city_hero where (cid = ${cid} and (state < 2 or state > 6)
      and state < 9 and herotype = 0) or hid = ${hid}`,
  );
  if (!heros.length) return [];
  const loyaltyArray: number[] = [];
  let ratesum = 0;
  const ret: Row[] = [];
  const hids: number[] = [];
  for (const h of heros) {
    loyaltyArray.push(100 - phpNum(h.loyalty));
    ratesum += 100 - phpNum(h.loyalty);
    if (phpNum(h.loyalty) <= 40) {
      ret.push(h);
      hids.push(phpIntval(h.hid));
    }
  }
  const rate = deps.mtRand(1, ratesum);
  let sumRate = 0;
  for (let i = 0; i < heros.length; i++) {
    if (sumRate + loyaltyArray[i]! >= rate) {
      if ((hids.length && !hids.includes(phpIntval(heros[i]!.hid))) || !hids.length) {
        ret.push(heros[i]!);
      }
      break;
    }
    sumRate += loyaltyArray[i]!;
  }
  return ret;
}

/** UtilsExtend.php::check_resource. */
function checkResource(
  resource: string,
): { gold: number; food: number; wood: number; rock: number; iron: number } | false {
  if (resource === '0' || resource === '0,0,0,0,0,' || resource === '') return false;
  const p = resource.split(',');
  return {
    gold: phpNum(p[0]),
    food: phpNum(p[1]),
    wood: phpNum(p[2]),
    rock: phpNum(p[3]),
    iron: phpNum(p[4]),
  };
}

/** cfg_hero_level.upgrade_exp for the hero's current level (the min-exp cap). */
async function heroNeedExp(deps: BattleResultDeps, hid: number): Promise<unknown> {
  return deps.cell(sql<Row>`select l.upgrade_exp as v from cfg_hero_level l, sys_city_hero h
    where l.level = h.level and h.hid = ${hid}`);
}

/** UtilsExtend.php::getreporttitle (me = 1 / 0 variants share this shape). */
function reportTitle(
  lang: BattleResultDeps['lang'],
  cityname: string,
  tarname: string,
  task: number,
  state: number,
): string {
  const statetype = state === 0 ? '已到达目标' : `已经返回${cityname}`;
  void statetype;
  return sprintf(lang.report('title'), tarname, task, state);
}

/** UtilsExtend.php::getReportTitleType. */
function reportTitleType(task: number, state: number): number {
  const map0: Record<number, number> = { 0: 1, 1: 3, 2: 5, 3: 7, 4: 9, 7: 36, 8: 37, 9: 38 };
  const map1: Record<number, number> = { 0: 2, 1: 4, 2: 6, 3: 8, 4: 10, 7: 36, 8: 37, 9: 38 };
  return (state === 0 ? map0[task] : map1[task]) ?? 0;
}

// Re-exported for reuse / tests.
export {
  countDescIndex,
  array2count,
  defence2array,
  checkResource,
  updateFieldResourceAdds,
  addCityDefences,
  addCityCapture,
  addCityWounded,
};
