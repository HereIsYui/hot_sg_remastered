/**
 * The time-stepped city / field battle ROUND engine ported from `OLdBattleCron.php::return_new_place`
 * (plus its helpers `getspeeds`, `get_heroinfo`, `getSoldierCounts`, `getsoldierarray`,
 * `getrangbetween`, `getabletarget`). This is the per-tick (every ~25s) resolver that `updateBattle`
 * calls: it advances ONE round of a 掠夺 / 占领 / 攻击 battle and writes the new positions / counts
 * back to `mem_battle`, appends a `sys_battle_report` line, and — when a side is wiped out — flags
 * the battle finished for `getBattleResult`.
 *
 * It is written as a PURE function (`playRound`) over the already-loaded battle state plus an
 * injected `rand(min,max)` (PHP `rand`) so it is unit-testable with no DB: the only randomness is
 * `return_new_place`'s single `rand(1, count($target_keys))` pick when the preferred tactic target
 * is gone. Everything the round needs is read once per battle by the service and cached (the role
 * `$_SESSION['battle']` played in the original); this function never touches the database.
 *
 * NOT reimplemented here (they belong to the service that calls this, or to other waves):
 *   - loading the per-battle tech/speed/npc cache (OLdBattleCron reads sys_city_technic, sys_user,
 *     sys_city_hero once and caches in `$_SESSION`); the service passes it in as `BattleRoundInput`.
 *   - the terminal `getBattleResult` settlement (see battle-result.ts).
 */

import { phpIntval, phpNum } from '../core/php';

/** A combatant in the time-stepped round (a soldier row, a city-defence row, or the wall). */
export interface RoundSoldier {
  sid: number;
  did?: number;
  /** 1 soldier, 2 city-defence engine, 3 wall. */
  type: number;
  /** combat-type (cfg_soldier.type); drives tactics lookup. */
  stype?: number;
  count: number;
  /** battlefield position. */
  range: number;
  speed: number;
  /** attack range (攻击范围). */
  gongjifanwei: number;
  hp: number;
  ap: number;
  dp: number;
  /** 1 attacker, 0 defender. */
  attack: number;
  /** present only on the sorted merge; a `ratio` passthrough the original set. */
  ratio?: unknown;
}

/** A `mem_battle_tactics` row keyed by (attack, stype): the per-type move+target order. */
export interface RoundTactic {
  action: number;
  target: number;
}

/** Hero bravery/wisdom totals the attack/counter formulas fold in (get_heroinfo-adjacent reads). */
export interface HeroCombat {
  bravery: number;
  wisdom: number;
}

/** Everything one round needs, loaded once per battle by the service (the `$_SESSION` cache). */
export interface BattleRoundInput {
  type: number;
  round: number;
  fieldrange: number;
  wallhp: number;
  /** attacker/defender troop strings `count,sid,n,...`. */
  attacksoldiers: string;
  resistsoldiers: string;
  /** attacker/defender position strings `count,sid,pos,...`. */
  attackpos: string;
  resistpos: string;
  /** defender城防 `count,did,sid,count,...` (resistdefence). */
  resistdefence: string;
  /** per-(attack,stype) tactics. attack 1 = attacker, 0 = defender. */
  tactics: Map<string, RoundTactic>;
  /** cfg_soldier rows keyed by sid: {speed,range,hp,ap,dp,type}. */
  soldierInfo: Map<
    number,
    { speed: number; range: number; hp: number; ap: number; dp: number; type: number }
  >;
  /** cfg_defence rows keyed by did: {range,hp,ap,dp}. */
  defenceInfo: Map<number, { range: number; hp: number; ap: number; dp: number }>;
  attackhid: number;
  resisthid: number;
  attackCommand: HeroCombat;
  resistCommand: HeroCombat;
  /** heroinfo 统帅*1100 for attacker/defender (get_heroinfo). */
  attackHeroCommand: number;
  resistHeroCommand: number;
  /** speed_add_on of the attacker/defender hero (getspeeds). */
  attackSpeed: number;
  resistSpeed: number;
  /** sys_city_technic levels per side, keyed by tid. */
  attackTech: Record<number, number>;
  resistTech: Record<number, number>;
}

/** What one round produced: the strings the service writes back and the end verdict. */
export interface BattleRoundResult {
  /** `count,sid,pos,...`. */
  attackpos: string;
  resistpos: string;
  /** `count,sid,n,...`. */
  attacksoldiers: string;
  resistsoldiers: string;
  /** `count,did,pos,count,...`. */
  resistdefence: string;
  wallhp: number;
  /** one `sys_battle_report.report` row. */
  report: string;
  /** 0 attacker win, 1 defender win, 2 draw, 3 unknown (both empty); undefined = not over. */
  battleEnd?: number;
}

/** OLdBattleCron.php::getSoldierCounts: total soldiers in a `count,sid,n,...` string. */
export function getSoldierCounts(soldierstring: string): number {
  const arr = soldierstring.split(',');
  const num = phpIntval(arr.shift());
  let total = 0;
  for (let i = 0; i < num; i++) {
    arr.shift();
    total += phpNum(arr.shift());
  }
  return total;
}

/**
 * OLdBattleCron.php::getsoldierarray: zip a troop string `count,sid,n,...` with a position string
 * `count,sid,pos,...` into `[{sid,count,range}]`. The original read `$pos[$m+2]` — the position
 * value at the SAME offset the count sits at in the soldier string.
 */
export function getsoldierarray(
  soldiers: string,
  soldierspos: string,
): { sid: number; count: number; range: number }[] {
  const s = soldiers.split(',');
  const pos = soldierspos.split(',');
  const num = phpIntval(s[0]);
  const out: { sid: number; count: number; range: number }[] = [];
  for (let i = 0; i < num; i++) {
    const m = i * 2;
    out.push({
      sid: phpIntval(s[m + 1]),
      count: phpNum(s[m + 2]),
      range: phpNum(pos[m + 2]),
    });
  }
  return out;
}

/**
 * OLdBattleCron.php::getrangbetween: the distance between the two armies' frontiers, relative to
 * unit `xx`. For an attacker it is its own pos minus the furthest-forward defender; for a defender
 * it is the nearest attacker minus its own pos.
 */
export function getrangbetween(
  fightsoldier: (RoundSoldier | null)[],
  fightrange: number,
  xx: number,
): number {
  let attack = fightrange;
  let resist = 0;
  for (const v of fightsoldier) {
    if (!v) continue;
    if (v.attack === 1 && v.count > 0 && v.range < attack) attack = v.range;
    if (v.attack === 0 && v.count > 0 && v.range > resist) resist = v.range;
  }
  const self = fightsoldier[xx]!;
  return self.attack === 1 ? self.range - resist : attack - self.range;
}

/**
 * OLdBattleCron.php::getabletarget: the indices of units unit `xx` can currently reach, keyed by
 * their array index → sid (the original returned `$rt[$key]=$sid`). Long-range attacker types
 * (6/10/12 = 抛射) may only hit 箭塔 among city defences.
 */
export function getabletarget(
  fightsoldier: (RoundSoldier | null)[],
  xx: number,
): Map<number, number> {
  const self = fightsoldier[xx]!;
  const attack = self.attack;
  const stype = self.stype ?? 0;
  const able = attack === 1 ? self.range - self.gongjifanwei : self.range + self.gongjifanwei;
  const rt = new Map<number, number>();
  fightsoldier.forEach((v, key) => {
    if (!v) return;
    if (attack === 1) {
      if (stype === 6 || stype === 10 || stype === 12) {
        if (v.attack === 0 && v.range > able) {
          if (v.type === 2 && v.did !== 3) return; // 非箭塔跳过
          rt.set(key, v.sid);
        }
      } else if (v.attack === 0 && v.range > able && v.type !== 2) {
        rt.set(key, v.sid);
      }
    } else if (v.attack === 1 && v.range < able) {
      rt.set(key, v.sid);
    }
  });
  return rt;
}

/** OLdBattleCron.php::getspeeds: a hero's speed_add_on (0 for no hero). */
export function getspeeds(speedAddOn: number, hid: number): number {
  return hid === 0 ? 0 : speedAddOn;
}

/** OLdBattleCron.php::get_heroinfo: `(level+command_base+command_add_on)*1100`, 0 for no hero. */
export function getHeroCommand(
  level: number,
  commandBase: number,
  commandAddOn: number,
  hid: number,
): number {
  return hid === 0 ? 0 : (level + commandBase + commandAddOn) * 1100;
}

/**
 * Build the speed-sorted `fightsoldier` array for a round: apply the 满统/超统 speed formulas and
 * attack-range tech bonus to each soldier, append the wall + city-defence rows when a wall stands,
 * then bubble-sort fastest-first (the original's descending-speed bubble sort). This is the first
 * half of `return_new_place`, extracted so `playRound` reads cleanly.
 */
export function buildFightSoldiers(input: BattleRoundInput): RoundSoldier[] {
  const soldierInfo = input.soldierInfo;
  const atkArr = getsoldierarray(input.attacksoldiers, input.attackpos);
  const resArr = getsoldierarray(input.resistsoldiers, input.resistpos);
  const attackCount = getSoldierCounts(input.attacksoldiers);
  const resistCount = getSoldierCounts(input.resistsoldiers);

  const applySpeed = (
    arr: { sid: number; count: number; range: number }[],
    tech: Record<number, number>,
    speedAdd: number,
    heroCommand: number,
    count: number,
    commandTech: number,
    over: boolean,
  ): RoundSoldier[] => {
    const commandSoldier =
      heroCommand === 0 ? 0 : (heroCommand / 1100) * 1000 * (1 + commandTech / 10);
    const out: RoundSoldier[] = [];
    for (const v of arr) {
      const sid = v.sid;
      const info = soldierInfo.get(sid);
      if (!info) continue;
      const xingjun = tech[12] ?? 0;
      const jiayu = tech[13] ?? 0;
      const paoshe = tech[14] ?? 0;
      let speed: number;
      // Mirrors the per-sid speed branches of return_new_place for the attacker side; the
      // defender uses the same formula families (only the tech source differs), so one routine
      // serves both. `over` = count exceeds 满统 (超统) → the proportional马速 term applies.
      const propMa = count > 0 ? (speedAdd / 100) * (commandSoldier / count) : 0;
      if (sid < 7) {
        speed = over
          ? info.speed * (1 + xingjun / 10) + info.speed * propMa
          : info.speed * (1 + xingjun / 10 + speedAdd / 100);
      } else if (sid > 6 && sid < 13) {
        speed = over
          ? info.speed * (1 + jiayu / 10) + info.speed * propMa
          : info.speed * (1 + jiayu / 10 + speedAdd / 100);
      } else if (sid > 44 && sid < 51) {
        speed = over
          ? info.speed * (1 + jiayu / 10) + info.speed * propMa
          : info.speed * (1 + jiayu / 10 + speedAdd / 100);
      } else {
        speed = info.speed; // sid 13..44: no bonus (both branches)
      }
      const rangeIsPaoshe = sid !== 6 && sid !== 10 && sid !== 12 && sid !== 49;
      const gongjifanwei = rangeIsPaoshe ? info.range : info.range * (1 + paoshe / 20);
      out.push({
        sid,
        type: 1,
        stype: info.type,
        count: v.count,
        range: v.range,
        speed,
        gongjifanwei,
        hp: info.hp,
        ap: info.ap,
        dp: info.dp,
        attack: 0,
      });
    }
    return out;
  };

  const attacker = applySpeed(
    atkArr,
    input.attackTech,
    input.attackSpeed,
    input.attackHeroCommand,
    attackCount,
    input.attackTech[6] ?? 0,
    attackCount > (input.attackHeroCommand / 1100) * 1000 * (1 + (input.attackTech[6] ?? 0) / 10),
  ).map((s) => ({ ...s, attack: 1 }));
  const defender = applySpeed(
    resArr,
    input.resistTech,
    input.resistSpeed,
    input.resistHeroCommand,
    resistCount,
    input.resistTech[6] ?? 0,
    resistCount > (input.resistHeroCommand / 1100) * 1000 * (1 + (input.resistTech[6] ?? 0) / 10),
  ).map((s) => ({ ...s, attack: 0 }));

  // Wall + city defences (defender only), appended when the wall still stands.
  if (input.wallhp !== 0) {
    defender.push({
      sid: 18,
      type: 3,
      count: input.wallhp,
      range: 100,
      speed: 0,
      gongjifanwei: 0,
      hp: input.wallhp,
      ap: 0,
      dp: 0,
      attack: 0,
    });
    const def = input.resistdefence.split(',');
    const defCount = phpIntval(def.shift());
    for (let i = 0; i < defCount; i++) {
      const did = phpIntval(def.shift());
      const sid = phpIntval(def.shift());
      let cnt = phpNum(def.shift());
      if (cnt < 0) cnt = 0;
      const info = input.defenceInfo.get(did) ?? { range: 0, hp: 0, ap: 0, dp: 0 };
      defender.push({
        sid,
        did,
        type: 2,
        count: cnt,
        range: 100,
        speed: 0,
        gongjifanwei: info.range,
        hp: info.hp,
        ap: info.ap,
        dp: info.dp,
        attack: 0,
      });
    }
  }

  const all = [...attacker, ...defender];
  // Descending-speed bubble sort, exactly as the original (stable on ties: `>` only swaps).
  for (let i = 0; i < all.length; i++) {
    for (let j = all.length - 1; j > i; j--) {
      if (all[j]!.speed > all[j - 1]!.speed) {
        const x = all[j]!;
        all[j] = all[j - 1]!;
        all[j - 1] = x;
      }
    }
  }
  return all;
}

/**
 * OLdBattleCron.php::return_new_place body: advance one round. `fightsoldier` is the sorted array
 * from {@link buildFightSoldiers}; `rand` is PHP `rand`. Returns the strings to persist plus the
 * end verdict. The attack / counterattack arithmetic is copied term-for-term from the original.
 */
export function playRound(
  input: BattleRoundInput,
  fight: RoundSoldier[],
  rand: (min: number, max: number) => number,
): BattleRoundResult {
  const fightsoldier: (RoundSoldier | null)[] = fight.map((s) => ({ ...s }));
  const fieldrange = input.fieldrange;
  let wallhp = input.wallhp;
  const atkBravery = input.attackCommand.bravery;
  const atkWisdom = input.attackCommand.wisdom;
  const defBravery = input.resistCommand.bravery;
  const defWisdom = input.resistCommand.wisdom;
  let report = '';
  let battleEnd: number | undefined;

  for (let key = 0; key < fightsoldier.length; key++) {
    const value = fightsoldier[key];
    if (!value || value.type === 3) continue;

    const sid = value.type === 1 ? value.sid : value.did!;
    const stype = value.stype ?? 0;
    let speed = value.speed;
    const pos = value.range;
    const range = getrangbetween(fightsoldier, fieldrange, key);
    const isCity = value.type === 1 ? 1 : 2;
    let istarget = 0;
    let shanghai = 0 + 999;
    let siwang = 0;
    let targetSid = 0;
    let targetType = 0;
    let targetStart = 0;
    let targetEnd = 0;
    let ableFanji = 0;
    let fanjiShanghai = 0;
    let targetStartD = 0;
    let fanjiSiwang = 0;
    let fanjiEnd = 0;
    let isAttack: number;
    const tacticKey = `${value.attack === 1 ? 1 : 0}:${stype}`;
    // PHP: sql_fetch_one() returns false when no mem_battle_tactics row exists, and
    // `false['action']` concatenates as '' in the report (not 0). Logic still treats it as 0.
    const tacticRow = input.tactics.get(tacticKey);
    const tactics: RoundTactic = tacticRow ?? { action: 0, target: 0 };
    const tacticActionField = tacticRow ? String(tactics.action) : '';

    if (value.attack === 1) {
      isAttack = 1;
      if (tactics.action === 1) {
        // 前进
        const newrange = pos - speed;
        if (speed < range) value.range = newrange;
        else {
          speed = range;
          value.range = pos - range;
        }
      }
      if (tactics.action === 3) {
        // 后退
        const newrange = pos + speed;
        if (newrange > fieldrange) {
          speed = fieldrange - pos;
          value.range = fieldrange;
        } else value.range = newrange;
      }
    } else {
      isAttack = 2;
      if (tactics.action === 1) {
        const newrange = pos + speed;
        if (newrange < pos + range) value.range = newrange;
        else {
          speed = range;
          value.range = pos + range;
        }
      }
      if (tactics.action === 3) {
        const newrange = pos - speed;
        if (newrange > 0) value.range = newrange;
        else {
          speed = pos;
          value.range = 0;
        }
      }
    }

    const abletarget = getabletarget(fightsoldier, key);
    if (abletarget.size > 0) {
      // array_search($target,$abletarget): first index whose sid equals the tactic target.
      let targetKey: number | undefined;
      for (const [k, v] of abletarget) {
        if (v === tactics.target) {
          targetKey = k;
          break;
        }
      }
      if (targetKey === undefined) {
        const keys = [...abletarget.keys()];
        const fuck = rand(1, keys.length);
        targetKey = keys[fuck - 1];
      }
      const tgt = fightsoldier[targetKey!]!;
      const targetPos = tgt.range;
      const targetCount = tgt.count;
      const targetHp = tgt.hp;
      const targetDp = tgt.dp;
      istarget = 1;
      targetSid = tgt.sid;
      targetType = tgt.type;
      targetStart = targetCount;

      if (value.type === 2 && value.did !== 3) {
        // 城防 触发型攻击
        fanjiSiwang = rand(0, value.count);
        value.count = value.count - fanjiSiwang;
        if (value.count <= 0) fightsoldier[key] = null;
        if (value.ap === 0) {
          siwang = fanjiSiwang;
        } else {
          shanghai = (fanjiSiwang * value.ap * value.ap) / (value.ap + targetDp);
          siwang = Math.floor(shanghai / targetHp);
        }
        targetEnd = targetCount - siwang;
      } else {
        // 正常攻击或箭塔攻击
        const jlyw = atkBravery;
        const jlzl = atkWisdom;
        const fsfjlyw = defBravery;
        const fsfjlzl = defWisdom;
        if (value.attack === 1) {
          shanghai =
            (((value.count * value.ap * value.ap) / (value.ap + targetDp)) * (1 + jlyw / 100)) /
            (1 + fsfjlzl / 100);
        } else {
          shanghai =
            (((2 * value.count * value.ap * value.ap) / (value.ap + targetDp)) *
              (1 + fsfjlyw / 100)) /
            (1 + jlzl / 100);
        }
        if (targetType === 3) {
          // 打城墙
          shanghai = Math.floor(shanghai * 3);
          siwang = shanghai;
          targetEnd = targetCount - siwang;
          if (targetEnd <= 0) {
            wallhp = 0;
            for (let k1 = 0; k1 < fightsoldier.length; k1++) {
              if (fightsoldier[k1] && fightsoldier[k1]!.type === 2) fightsoldier[k1] = null;
            }
          } else {
            wallhp = targetEnd;
          }
        } else {
          shanghai = Math.floor(shanghai);
          siwang = Math.floor(shanghai / targetHp);
          targetEnd = targetCount - siwang;
          fightsoldier[targetKey!]!.count = targetEnd;
        }
      }

      // 反击
      if (targetEnd > 0) {
        const tk = fightsoldier[targetKey!];
        if (tk && (tk.type === 1 || (tk.type === 2 && tk.did === 3))) {
          tk.count = targetEnd;
          const fanjiRange = tk.gongjifanwei;
          const fanjiAttack = tk.attack;
          const self = fightsoldier[key];
          const jlyw = atkBravery;
          const jlzl = atkWisdom;
          const fsfjlyw = defBravery;
          const fsfjlzl = defWisdom;
          const counter = (): void => {
            if (!self) return;
            ableFanji = 1;
            fanjiShanghai = (tk.count * tk.ap * tk.ap) / (tk.ap + value.dp);
            if (value.attack !== 1) {
              fanjiShanghai =
                2 * Math.floor((fanjiShanghai * (1 + jlyw / 100)) / (1 + fsfjlzl / 100));
            } else {
              fanjiShanghai = (Math.floor(fanjiShanghai) / (1 + jlzl / 100)) * (1 + fsfjlyw / 100);
            }
            targetStartD = self.count;
            const hp = value.hp <= 0 ? 1 : value.hp;
            fanjiSiwang = Math.floor(fanjiShanghai / hp);
            if (value.count - fanjiSiwang > 0) {
              fanjiEnd = self.count - fanjiSiwang;
              self.count = fanjiEnd;
              value.count = fanjiEnd;
              if (value.count <= 0 || self.count <= 0) {
                self.count = 0;
                value.count = 0;
                fanjiEnd = 0;
              }
            } else {
              fanjiSiwang = value.count;
              fanjiEnd = 0;
              fightsoldier[key] = null;
            }
          };
          if (fanjiAttack === 1) {
            // 攻击方被反击
            if (value.did === 3 && value.type === 2) {
              const fs = tk.stype ?? 0;
              if (fs === 6 || fs === 10 || fs === 12) {
                if (targetPos - fanjiRange < value.range) {
                  // the箭塔-vs-箭塔 special counter path
                  ableFanji = 1;
                  fanjiShanghai = (tk.count * tk.ap * tk.ap) / (tk.ap + value.dp);
                  if (value.attack !== 1)
                    fanjiShanghai =
                      Math.floor(fanjiShanghai * (1 + jlyw / 100)) / (1 + fsfjlzl / 100);
                  else
                    fanjiShanghai =
                      (Math.floor(fanjiShanghai) / (1 + jlzl / 100)) * (1 + fsfjlyw / 100);
                  targetStartD = value.count;
                  fanjiSiwang = Math.floor(fanjiShanghai / value.hp);
                  if (value.count - fanjiSiwang > 0) {
                    fanjiEnd = value.count - fanjiSiwang;
                    value.count = fanjiEnd;
                    if (value.count <= 0) {
                      value.count = 0;
                      fanjiEnd = 0;
                    }
                  } else {
                    fanjiSiwang = value.count;
                    fanjiEnd = 0;
                    fightsoldier[key] = null;
                  }
                }
              }
            } else if (targetPos - fanjiRange < value.range) {
              counter();
            }
          } else {
            // 防御方被反击
            if (targetPos + fanjiRange > value.range) counter();
          }
        } else {
          // 被触发型城防干掉的
          if (fightsoldier[targetKey!]) fightsoldier[targetKey!]!.count = fanjiEnd;
        }
      } else {
        siwang = targetStart;
        targetEnd = 0;
        fightsoldier[targetKey!] = null;
      }
    }

    // 战报行
    report +=
      `${isAttack}.000000,${isCity}.000000,${sid}.000000,${tacticActionField}.000000,${speed}.000000,` +
      `${istarget}.000000,${shanghai}.000000,${targetType}.000000,${targetSid}.000000,${targetStart}.000000,` +
      `${siwang}.000000,${targetEnd}.000000,${ableFanji}.000000,${fanjiShanghai}.000000,${targetStartD}.000000,` +
      `${fanjiSiwang}.000000,${fanjiEnd}.000000;`;
  }

  // Re-index and rebuild the persisted strings.
  const alive = fightsoldier.filter((v): v is RoundSoldier => v !== null);
  let attackmem = 0;
  let resistmem = 0;
  let defencemem = 0;
  let attackstr = '';
  let resiststr = '';
  let attackstrpos = '';
  let resiststrpos = '';
  let defencestrpos = '';
  for (const v of alive) {
    if (v.attack === 1 && v.count > 0) {
      attackmem++;
      attackstr += `${v.sid},${v.count},`;
      attackstrpos += `${v.sid},${v.range},`;
    }
    if (v.attack === 0) {
      if (v.count > 0 && v.type === 1) {
        resistmem++;
        resiststr += `${v.sid},${v.count},`;
        resiststrpos += `${v.sid},${v.range},`;
      }
      if (v.count > 0 && v.type === 2) {
        defencemem++;
        defencestrpos += `${v.did},${v.range},${v.count},`;
      }
    }
  }

  if (resistmem === 0 && wallhp === 0) battleEnd = 0; // 攻击方成功
  if (attackmem === 0) battleEnd = 1; // 防守方胜利
  if (attackmem === 0 && resistmem === 0) battleEnd = 3; // 未知
  if (input.round > 40) battleEnd = 2; // 平局

  return {
    attackpos: `${attackmem},${attackstrpos}`,
    resistpos: `${resistmem},${resiststrpos}`,
    attacksoldiers: `${attackmem},${attackstr}`,
    resistsoldiers: `${resistmem},${resiststr}`,
    resistdefence: `${defencemem},${defencestrpos}`,
    wallhp,
    report,
    battleEnd,
  };
}
