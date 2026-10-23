/**
 * The 演习 / 侦察-patrol combat simulator ported from `cfg_js.php::battleInfo` + `cfg_js.php::
 * upManeuver`. This is the single self-contained battle loop in the legacy code that settles
 * instantly (it is NOT the time-stepped city/field battle of `OLdBattleCron.php`): the 校场 演习
 * command and the task-2 侦察 "has a patrol? fight it" branch both run this exact loop.
 *
 * It is written as a PURE function over a parsed `mem_maneuver` row plus an injected
 * `mt_rand(min,max)` callback, so a difftest can script the RNG sequence and a unit test can assert
 * the die counts and winner with no database. The only randomness is `getTarget`'s target pick.
 *
 * NOT ported here (the time-stepped multi-round engine): `OLdBattleCron.php::updateBattle` /
 * `return_new_place` / `getBattleResult`, which drive 掠夺/占领/攻击 city & field battles through
 * `mem_battle` over many 3s ticks. Those remain behind `BattleTick.handleBattle`'s scaffold.
 */

import { phpIntval, phpNum } from '../core/php';
import {
  type Combatant,
  type SoldierInfo,
  SoBitSo,
  action,
  array2troop,
  checkBattleEnd,
  checkPos,
  getArraySub,
  getTarget,
  troop2array,
} from './battle-math';

/** A parsed `mem_maneuver` row — the input to the 演习 loop. */
export interface ManeuverRow {
  /** `count,sid,n,...` attacker troop string. */
  attacksoldiers: string;
  /** `count,sid,n,...` defender troop string (empty / "0" when the field is empty). */
  resistsoldiers: string;
  /** `sid,type,shoot,act,def,blood,speed,ap,dp,hp,uid;...` precomputed attacker stats. */
  attackadd: string;
  /** `sid,type,shoot,act,def,blood,speed,ap,dp,hp,uid;...` precomputed defender stats. */
  resistadd: string;
  /** Wall hitpoints (0 for the 演习 / field patrol path). */
  wallhp?: number;
}

/** The patrol (`$patrol=1`) result upManeuver returns to the 侦察 arrival branch. */
export interface ManeuverResult {
  /** 0 attacker win, 1 defender win, 2 draw (round cap or both survive). */
  end: number;
  /** Attacker sid-3 (patrol scouts) killed. */
  attackdie: number;
  /** Defender sid-3 killed. */
  resistdie: number;
  /** Rounds fought, capped at 40. */
  round: number;
  /**
   * The whole-army loss maps (sid -> killed), for the non-patrol 演习 serialization which stores
   * `attackdie` / `resistdie` as full `count,sid,n,...` strings rather than just the scout figure.
   * Empty on an early-out (no engagement).
   */
  attackLost: Map<number, number>;
  resistLost: Map<number, number>;
  /**
   * The RAW `$end` / `$round` the non-patrol `upManeuver` persist line stored, before the patrol
   * branch's `$end > 2 → 2` collapse and `round` cap. Legacy wrote `result=$end` (3 on a round-40
   * draw) and `round=$round-1`. `settleManeuver` uses these so the stored `mem_maneuver` row
   * byte-matches; `end` / `round` above keep the patrol (侦察) shape. Undefined on an early-out,
   * where legacy wrote nothing at all (see `settleManeuver`).
   */
  rawEnd?: number;
  rawRound?: number;
  /** True when the real-battle branch ran (the loop executed); false on an early-out. */
  fought: boolean;
}

/**
 * cfg_js.php::battleInfo for the 演习 path (`type=0`, no wall / city defences): parse `attackadd` /
 * `resistadd` into the `soldierInfo` map keyed by sid (attacker sids are multiplied by 100 and
 * carry `state=1`, defender sids keep their value with `state=0`). Positions are the defaults the
 * original set when no explicit `attackpos` / `resistpos` is present: attacker at `fieldrange-100`,
 * defender at `100`. The 演习 loop always uses `fieldrange=1000`.
 */
export function battleInfo(row: ManeuverRow): SoldierInfo {
  const ret: SoldierInfo = new Map();
  const fieldrange = 1000;

  const acnt = row.attacksoldiers ? row.attacksoldiers.split(',') : ['0'];
  const cnt = new Map<number, number>();

  // Attacker counts/positions (sid*100).
  const anum = phpIntval(acnt.shift());
  for (let i = 0; i < anum; i++) {
    const sid = phpIntval(acnt.shift()) * 100;
    const c = phpNum(acnt.shift());
    cnt.set(sid, c);
    if (c > 0) ret.set(sid, { ...blank(), cnt: c, pos: fieldrange - 100 });
  }

  // Defender counts/positions.
  if (row.resistsoldiers && row.resistsoldiers !== '0') {
    const rcnt = row.resistsoldiers.split(',');
    const rnum = phpIntval(rcnt.shift());
    for (let i = 0; i < rnum; i++) {
      const sid = phpIntval(rcnt.shift());
      const c = phpNum(rcnt.shift());
      cnt.set(sid, c);
      if (c > 0) ret.set(sid, { ...blank(), cnt: c, pos: 100 });
    }
  }

  // Attacker stat blocks (`attackadd`).
  if (row.attackadd) {
    for (const v of row.attackadd.split(';')) {
      const info = v.split(',');
      const sid = phpIntval(info.shift()) * 100;
      if ((cnt.get(sid) ?? 0) > 0) applyAdd(ret.get(sid)!, info, 1);
    }
  }
  // Defender stat blocks (`resistadd`).
  if (row.resistadd) {
    for (const v of row.resistadd.split(';')) {
      const info = v.split(',');
      const sid = phpIntval(info.shift());
      if ((cnt.get(sid) ?? 0) > 0) applyAdd(ret.get(sid)!, info, 0);
    }
  }
  return ret;
}

function blank(): Combatant {
  return {
    cnt: 0,
    pos: 0,
    type: 0,
    shoot: 0,
    act: 0,
    def: 0,
    blood: 0,
    speed: 0,
    ap: 0,
    dp: 0,
    hp: 0,
    uid: 0,
    state: 0,
  };
}

/** Fill a combatant's stats from an `attackadd`/`resistadd` segment: type,shoot,act,def,blood,... */
function applyAdd(c: Combatant, info: string[], state: number): void {
  c.type = phpNum(info.shift());
  c.shoot = phpNum(info.shift());
  c.act = phpNum(info.shift());
  c.def = phpNum(info.shift());
  c.blood = phpNum(info.shift());
  c.speed = phpNum(info.shift());
  c.ap = phpNum(info.shift());
  c.dp = phpNum(info.shift());
  c.hp = phpNum(info.shift());
  c.uid = phpNum(info.shift());
  c.state = state;
}

/**
 * cfg_js.php::upManeuver in its `$patrol=1` form: run the instant 演习 battle to completion and
 * return the result. Mirrors the original's early-outs, the speed-sorted turn order (`uasort cmp`,
 * descending speed; PHP's sort is not stable but the engine only reads the ordering, and ties keep
 * insertion order as PHP's does), the per-unit move → attack → counterattack, and the round cap of
 * 40 (end 2 = draw).
 *
 * `rand` is the injected `mt_rand(min,max)` used solely by `getTarget`.
 */
export function upManeuver(
  row: ManeuverRow,
  rand: (min: number, max: number) => number,
): ManeuverResult {
  let round = 1;
  let end: number;

  if (round > 40) end = 2;
  else if (phpNum(row.attacksoldiers) === 0) end = 1;
  else if (phpNum(row.resistsoldiers) === 0 && phpNum(row.wallhp ?? 0) === 0) end = 0;
  else {
    end = 3;
    const soldierInfo = battleInfo(row);

    // uasort by descending speed, keeping insertion order on ties (PHP cmp returns 0 on a tie).
    const sorted = [...soldierInfo.entries()].sort((a, b) => {
      if (a[1].speed === b[1].speed) return 0;
      return a[1].speed > b[1].speed ? -1 : 1;
    });
    const order = new Map<number, Combatant>(sorted);

    // posArray[state] = sid -> pos, used to compute the moving frontier each action.
    const posArray: Record<number, Map<number, number>> = { 0: new Map(), 1: new Map() };
    for (const [sid, info] of order) posArray[info.state]!.set(sid, info.pos);

    while (end === 3 && round <= 40) {
      for (const sid of [...order.keys()]) {
        const self = order.get(sid);
        if (self && self.cnt > 0 && end === 3) {
          const minpos = Math.min(...posArray[1]!.values());
          const maxpos = Math.max(...posArray[0]!.values());
          const state = self.state;
          const speed = self.speed;
          const shoot = self.shoot;
          const cnt = self.cnt;
          const type = self.type;
          const ap = self.ap;
          const hp = self.hp;
          const dp = self.dp;
          const act = self.act;
          const def = self.def;
          const blood = self.blood;
          const pos = self.pos;

          if (type < 13 || type === 15) {
            const a = action(1, state);
            let endpos = pos + speed * a;
            endpos = checkPos(state, pos, endpos, minpos, maxpos, 1000);
            self.pos = endpos;
            posArray[state]!.set(sid, endpos);

            const targetSid = getTarget(order, self, type, rand);
            const tInfo = targetSid ? order.get(targetSid) : undefined;
            // NOTE (difftest): legacy `getTarget` returns a bare sid, yet upManeuver then reads
            // `$tInfo['pos']` / `['cnt']` / `['blood']` as if it were the combatant. In PHP that
            // indexes an int (NULL with a warning), which would divide by zero — so the LIVE game
            // must be resolving the sid back to its `$soldierInfo[$sid]` entry. We do that here
            // (`order.get(targetSid)`), the only interpretation that yields a working battle. If a
            // difftest shows the legacy server genuinely degenerates, pin that behaviour instead.

            // Attack: only if a target was found and it is within range.
            const range = tInfo ? Math.abs(endpos - tInfo.pos) : Infinity;
            if (tInfo && range <= shoot) {
              let sinact =
                (ap * ap) / (tInfo.ap + tInfo.dp) +
                (act * act) /
                  (tInfo.ap + tInfo.act + tInfo.def + tInfo.dp + tInfo.hp + tInfo.blood);
              sinact *= SoBitSo(type, tInfo.type);
              if (shoot > 600) {
                if (range === 0) sinact /= 2;
                else if (range <= shoot / 2) sinact *= 2;
              }
              let allact = sinact * cnt;
              if (allact > tInfo.blood * tInfo.cnt) allact = (tInfo.blood + tInfo.hp) * tInfo.cnt;
              const lost = Math.round(allact / (tInfo.blood + tInfo.hp));
              tInfo.cnt -= lost;
              if (tInfo.cnt <= 0) {
                const deadState = state === 1 ? 0 : 1;
                order.delete(targetSid);
                posArray[deadState]!.delete(targetSid);
                if (posArray[deadState]!.size === 0) end = checkBattleEnd(deadState);
              }

              // Counterattack (the target hits back, if still alive, in range, not the wall).
              if (range <= tInfo.shoot && tInfo.cnt > 0 && self.cnt > 0 && tInfo.type !== 18) {
                let backsinact =
                  (tInfo.ap * tInfo.ap) / (ap + dp) +
                  (tInfo.act * tInfo.act) / (ap + act + def + dp + hp + blood);
                backsinact *= SoBitSo(tInfo.type, type);
                if (tInfo.shoot > 600) {
                  if (range === 0) backsinact /= 4;
                  else if (range <= tInfo.shoot / 2) backsinact /= 2;
                }
                let backallact = backsinact * tInfo.cnt;
                if (backallact > (blood + hp) * cnt) backallact = (blood + hp) * cnt;
                const backlost = Math.round(backallact / (blood + hp));
                self.cnt -= backlost;
                if (self.cnt <= 0) {
                  order.delete(sid);
                  posArray[state]!.delete(sid);
                  if (posArray[state]!.size === 0) end = checkBattleEnd(state);
                }
              }
            }
          }
          if (end !== 3) break;
        }
        if (end !== 3) break;
      }
      if (end !== 3) break;
      round++;
    }

    return finish(row, order, round, end);
  }

  // Early-out (no engagement): the patrol branch still returns a result.
  return {
    end: end > 2 ? 2 : end,
    attackdie: 0,
    resistdie: 0,
    round: round > 40 ? 40 : round,
    attackLost: new Map(),
    resistLost: new Map(),
    fought: false,
  };
}

/** Compute the surviving-vs-lost difference and build the result (patrol + full-army forms). */
function finish(
  row: ManeuverRow,
  order: Map<number, Combatant>,
  round: number,
  end: number,
): ManeuverResult {
  const aOver = new Map<number, number>();
  const dOver = new Map<number, number>();
  for (const [sid, v] of order) {
    if (v.cnt > 0 && sid) {
      if (sid > 99) aOver.set(Math.floor(sid / 100), v.cnt);
      else dOver.set(sid, v.cnt);
    }
  }
  const actArray = troop2array(row.attacksoldiers);
  const defArray = troop2array(row.resistsoldiers);
  const aArray = aOver.size ? getArraySub(actArray, aOver) : actArray;
  const dArray = dOver.size ? getArraySub(defArray, dOver) : defArray;
  // `attackdie`/`resistdie` the original serialized = the whole-army loss: who set out minus who
  // survived. `array2troop` round-trips it into the stored `count,sid,n,...` form.
  troop2array(array2troop(aArray));

  const patrolEnd = end > 2 ? 2 : end;
  return {
    end: patrolEnd,
    attackdie: (aArray.get(3) ?? 0) > 0 ? aArray.get(3)! : 0,
    resistdie: (dArray.get(3) ?? 0) > 0 ? dArray.get(3)! : 0,
    round: round > 40 ? 40 : round,
    attackLost: aArray,
    resistLost: dArray,
    // The non-patrol persist stored the RAW `$end` (3 on a round-40 draw) and `$round - 1`.
    rawEnd: end,
    rawRound: round - 1,
    fought: true,
  };
}
