/**
 * Pure combat math ported verbatim from `cfg_js.php` (the helper functions `action`, `checkPos`,
 * `getTarget`, `checkBattleEnd*`, `SoBitSo`, `getBattleRange`, `changePos`, `count_desc`,
 * `sol2people`) and the troop-string helpers from `UtilsExtend.php`.
 *
 * Everything here is deterministic given its inputs — the ONLY randomness in the 演习 (upManeuver)
 * path is a single `mt_rand(0, i-1)` inside `getTarget`, which is injected as a callback so a
 * difftest can script the exact call sequence (see `battle-engine.ts`). Keeping the math pure and
 * free of DB/`RandomService` dependencies is what makes the engine unit-testable.
 */

import { phpIntval, phpNum } from '../core/php';

/** cfg_js.php::action: a soldier's movement direction for its tactic, flipped for defenders. */
export function action(act: number, state: number): number {
  let ret = 0;
  switch (act) {
    case 1:
      ret = 1;
      break;
    case 2:
      ret = 0;
      break;
    case 3:
      ret = -1;
      break;
  }
  if (state === 1) ret *= -1;
  return ret;
}

/**
 * cfg_js.php::checkPos: clamp a soldier's intended end position to the battlefield, bounded by the
 * current min (attacker frontier) / max (defender frontier) and `[0, fieldrange]`.
 */
export function checkPos(
  state: number,
  _pos: number,
  endpos: number,
  min: number,
  max: number,
  fieldrange: number,
): number {
  let ret = endpos;
  switch (state) {
    case 0: {
      // 防守
      ret = endpos > min ? min : endpos < 0 ? 0 : endpos;
      ret = ret < 0 ? 0 : ret > fieldrange ? fieldrange : ret;
      break;
    }
    case 1: {
      // 进攻
      ret = endpos < max ? max : endpos > fieldrange ? fieldrange : endpos;
      ret = ret < 0 ? 0 : ret > fieldrange ? fieldrange : ret;
      break;
    }
  }
  return ret;
}

/** A combatant entry in the `soldierInfo` map keyed by `sid` (sid*100 for attacker units). */
export interface Combatant {
  cnt: number;
  pos: number;
  type: number;
  shoot: number;
  act: number;
  def: number;
  blood: number;
  speed: number;
  ap: number;
  dp: number;
  hp: number;
  uid: number;
  state: number;
  oldcnt?: number;
}

export type SoldierInfo = Map<number, Combatant>;

/**
 * cfg_js.php::getTarget: pick the sid an attacker fires at. First a unit of the preferred `target`
 * type on the other side within range; else a uniformly-random reachable enemy ground unit
 * (sid < 10000) via `mt_rand(0, i-1)`; else the wall (180000) if the attacker is attacking.
 *
 * `rand` is the injected `mt_rand(0, max)` so the call lands in the scripted difftest sequence.
 * Returns the chosen sid, or 0 when nothing is reachable.
 */
export function getTarget(
  infos: SoldierInfo,
  attack: Combatant,
  target: number,
  rand: (min: number, max: number) => number,
): number {
  for (const [sid, info] of infos) {
    if (
      info.type === target &&
      info.state !== attack.state &&
      attack.shoot >= Math.abs(attack.pos - info.pos)
    ) {
      return sid;
    }
  }
  // No preferred-type target: gather every reachable enemy ground unit, pick one at random.
  let i = 0;
  const targetsid: number[] = [];
  for (const [sid, info] of infos) {
    if (
      info.state !== attack.state &&
      sid < 10000 &&
      attack.shoot >= Math.abs(attack.pos - info.pos)
    ) {
      targetsid[i] = Math.floor(sid);
      i++;
    }
  }
  let ret = 0;
  if (targetsid.length > 0) {
    ret = targetsid[rand(0, i - 1)] ?? 0;
  }
  if (!ret && infos.has(180000) && attack.state === 1) ret = 180000;
  return ret;
}

/** cfg_js.php::checkBattleEnd: a side wiped out -> that side's end code (0 atk win, 1 def win). */
export function checkBattleEnd(state: number): number {
  switch (state) {
    case 0:
      return 0;
    case 1:
      return 1;
    case 2:
      return 2;
    default:
      return 0;
  }
}

/**
 * cfg_js.php::SoBitSo: the rock-paper-scissors damage multiplier of attacker soldier-type `as`
 * against defender soldier-type `bs`. The constants are copied exactly from the original.
 */
export function SoBitSo(as: number, bs: number): number {
  if (as === 4 && bs === 7) return 3.6;
  if ((as === 6 || as === 13) && bs === 5) return 0.49;
  if (as === 5 && bs === 4) return 2.2;
  if (as === 7 && bs === 6) return 2.4;
  if (as === 11 && bs === 18) return 15;
  if (as === 12 && bs === 15) return 2.9;
  if ((as === 10 || as === 12) && bs < 13) return 0.5;
  if ([4, 7, 8].includes(as) && bs === 18) return 2;
  return 1;
}

/** cfg_js.php::getBattleRange: battlefield length = the longest shoot range on either side + 299. */
export function getBattleRange(minfo: string, yinfo: string): number {
  const msinfo = [...minfo.split(';'), ...yinfo.split(';')];
  let range = 0;
  for (const v of msinfo) {
    const msid = v.split(',');
    const shoot = phpNum(msid[2]);
    range = shoot > range ? shoot : range;
  }
  return range + 299;
}

/**
 * cfg_js.php::changePos: mirror a `count,sid,pos,...` position string across the battlefield so the
 * attacker's frontier becomes the defender-relative one. The PHP wrote `$_SESSION['bid']` as a
 * side effect of the full battle; the 演习 path does not use that cache, so this only transforms.
 */
export function changePos(pos: string, fieldrange: number): string {
  const posarray = pos.split(',');
  const posnum = phpIntval(posarray.shift());
  const parts: (string | number)[] = [];
  for (let i = 0; i < posnum; i++) {
    const sid = phpIntval(posarray.shift());
    const postemp = fieldrange - phpNum(posarray.shift());
    parts.push(sid, postemp);
  }
  return [posnum, ...parts].join(',');
}

/** cfg_js.php::count_desc: fuzzy army-size bucket index (0..8) used by low-level 侦察 reports. */
export function countDescIndex(count: number): number {
  if (count < 10) return 0;
  if (count < 25) return 1;
  if (count < 100) return 2;
  if (count < 250) return 3;
  if (count < 1000) return 4;
  if (count < 2500) return 5;
  if (count < 5000) return 6;
  if (count < 10000) return 7;
  return 8;
}

/**
 * cfg_js.php::sol2people: the population a troop string (or sid->count map) occupies, using the
 * per-soldier `usepeople` table. `floor(sum(floor(cnt*usepeople[sid])))`.
 */
export function sol2people(
  soldiers: string | Map<number, number>,
  usepeople: Record<number, number>,
): number {
  let exp = 0;
  if (typeof soldiers === 'string') {
    const arr = soldiers.split(',');
    const num = phpIntval(arr.shift());
    for (let i = 0; i < num; i++) {
      const sid = phpIntval(arr.shift());
      const cnt = phpNum(arr.shift());
      exp += Math.floor(cnt * (usepeople[sid] ?? 0));
    }
  } else {
    for (const [sid, cnt] of soldiers) exp += Math.floor(cnt * (usepeople[sid] ?? 0));
  }
  return Math.floor(exp);
}

// ───────────────────────── UtilsExtend.php troop-string helpers ─────────────────────────

/** UtilsExtend.php::troop2array: `count,sid,n,...` -> map of sid->count (positive counts only). */
export function troop2array(soldiers: string): Map<number, number> {
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

/** UtilsExtend.php::array2troop: map -> `count,sid,n,...` with keys ascending (ksort). */
export function array2troop(soldiers: Map<number, number>): string {
  const keys = [...soldiers.keys()].sort((x, y) => x - y);
  const parts: (string | number)[] = [keys.length];
  for (const sid of keys) parts.push(sid, soldiers.get(sid)!);
  return parts.join(',');
}

/** UtilsExtend.php::getArraySub: element-wise `a - b` over sid keys, floored at 0, drops zeros. */
export function getArraySub(a: Map<number, number>, b: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [sid, cnt] of a) {
    const left = cnt - (b.get(sid) ?? 0);
    if (left > 0) out.set(sid, left);
  }
  return out;
}
