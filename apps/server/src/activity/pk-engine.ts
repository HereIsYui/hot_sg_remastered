import { Injectable } from '@nestjs/common';
import { phpEmpty, phpIntval, phpLooseEquals } from '../core/php';
import { RandomService } from '../core/random.service';

/** PKFunc.php:4 `define(RATE, 50)`. */
export const PK_RATE = 50;

/** One combatant row as the arena / campaign queries build it (hid, sex, energy, standIndex, command, affair, bravery, wisdom, speed). */
export type PkHero = Record<string, unknown>;
/** A queue slot; `false` mirrors sql_fetch_one's no-row return, which the loop shifts and discards. */
export type PkHeroEntry = PkHero | false;

/** PKFunc.php:60 battleComute's per-swing record. */
export interface PkBattleRet {
  flag: number;
  attack: number;
  resist: number;
  damage: number;
  blood: number;
  attackhid: unknown;
  resisthid: unknown;
  attacksex: unknown;
  resistsex: unknown;
  battleId: number;
  attackStandIndex: unknown;
  resistStandIndex: unknown;
}

/** PKFunc.php:151 startUserPK's result; PHP builds it with string keys, so it JSONs as an object. */
export interface PkResult {
  report: PkBattleRet[][];
  totalNum: number;
  endflag: number;
  winer: number;
}

/** PKFunc.php:9 initHeroState's derived state; blood mutates through the battle. */
interface PkState {
  hid: number;
  sex: number;
  blood: number;
  attackValue: number;
  defenceValue: number;
  baoji: number;
  poji: number;
  gedang: number;
  shanbi: number;
  standIndex: unknown;
}

/** `max(intval(x), 10)` capped at 3000 (PKFunc.php:16-31). */
function capped(value: number): number {
  return Math.min(Math.max(value, 10), 3000);
}

function copyHero(entry: PkHeroEntry): PkHeroEntry {
  return entry && typeof entry === 'object' ? { ...entry } : entry;
}

function fieldOf(hero: PkHeroEntry, key: string): unknown {
  return hero && typeof hero === 'object' ? hero[key] : null;
}

function withEnergy(hero: PkHeroEntry, energy: number): PkHeroEntry {
  // PHP auto-vivifies a false into an array on index assignment; a real row is mutated in place.
  const row: Record<string, unknown> =
    hero && typeof hero === 'object' ? (hero as Record<string, unknown>) : {};
  row.energy = energy;
  return row;
}

/**
 * PKFunc.php:151 startUserPK — the single-file PK engine the 过关斩将 campaign and the arena's
 * startArenaChallenge both run. Three-vs-three (any count) hero queues: the faster hero of each
 * pairing strikes first, survivors re-enter their queue's front with energy = blood/RATE until
 * one side is empty. `winer` 1 = the attacker cleared the defender queue. Inputs are copied so
 * the caller's rows stay untouched (PHP array value semantics).
 */
@Injectable()
export class PkEngine {
  constructor(private readonly random: RandomService) {}

  /** PKFunc.php:48 isTrigger — one mt_rand(1,20000) draw against the trigger stat. */
  private isTrigger(value: number): boolean {
    return value >= this.random.mtRand(1, 20000);
  }

  /** PKFunc.php:9 initHeroState. */
  private initHeroState(hero: PkHero): PkState {
    const energy = phpIntval(fieldOf(hero, 'energy'));
    const bravery = phpIntval(fieldOf(hero, 'bravery'));
    const wisdom = phpIntval(fieldOf(hero, 'wisdom'));
    const command = phpIntval(fieldOf(hero, 'command'));
    const affair = phpIntval(fieldOf(hero, 'affair'));
    return {
      hid: phpIntval(fieldOf(hero, 'hid')),
      sex: phpIntval(fieldOf(hero, 'sex')),
      blood: Math.max(energy * PK_RATE, 500),
      attackValue: Math.max(bravery * 10, 10),
      defenceValue: Math.max(wisdom * 10, 10),
      baoji: capped(bravery),
      poji: capped(command),
      gedang: capped(affair),
      shanbi: capped(wisdom),
      standIndex: fieldOf(hero, 'standIndex'),
    };
  }

  /** PKFunc.php:40 PKDamage. */
  private pkDamage(attackValue: number, defenceValue: number): number {
    return phpIntval(attackValue * (1 - defenceValue / (defenceValue + 2000)));
  }

  /** PKFunc.php:60 battleComute — one swing; the four rolls draw in baoji/poji/shanbi/gedang order. */
  private battleComute(attacker: PkState, resister: PkState, num: number): PkBattleRet {
    let attckAttack = phpIntval(attacker.attackValue);
    let resistBlood = phpIntval(resister.blood);
    const resistDefence = phpIntval(resister.defenceValue);
    const isBoji = this.isTrigger(attacker.baoji);
    const isPoji = this.isTrigger(attacker.poji);
    const isShanbi = this.isTrigger(resister.shanbi);
    let isGedang = this.isTrigger(resister.gedang);
    let boji = isBoji;
    if (isShanbi) isGedang = false; // 两者不能同时出现
    if (isPoji) boji = false; // 两者不能同时出现
    let flag: number;
    let attack: number;
    let resist: number;
    if (isShanbi) {
      attckAttack = 0;
      if (isPoji) {
        flag = 1;
        attack = 2;
        resist = 2;
      } else if (boji) {
        flag = 1;
        attack = 1;
        resist = 2;
      } else {
        flag = 1;
        attack = 0;
        resist = 2;
      }
    } else if (isGedang) {
      if (isPoji) {
        flag = 1;
        attack = 2;
        resist = 1;
      } else if (boji) {
        attckAttack *= 0.75;
        flag = 1;
        attack = 1;
        resist = 1;
      } else {
        attckAttack *= 0.5;
        flag = 1;
        attack = 0;
        resist = 1;
      }
    } else {
      if (isPoji) {
        attckAttack *= 2;
        flag = 1;
        attack = 2;
        resist = 0;
      } else if (boji) {
        attckAttack *= 1.5;
        flag = 1;
        attack = 1;
        resist = 0;
      } else {
        flag = 0;
        attack = 0;
        resist = 0;
      }
    }
    let damage = this.pkDamage(attckAttack, resistDefence);
    damage = Math.max(1, damage);
    if (resistBlood > damage) resistBlood -= damage;
    else resistBlood = 0;
    resister.blood = resistBlood;
    return {
      flag,
      attack,
      resist,
      damage,
      blood: resistBlood,
      attackhid: attacker.hid,
      resisthid: resister.hid,
      attacksex: attacker.sex,
      resistsex: resister.sex,
      battleId: num,
      attackStandIndex: attacker.standIndex,
      resistStandIndex: resister.standIndex,
    };
  }

  /** PKFunc.php:151 startUserPK. Empty input returns PHP's `array()` — an empty JSON array. */
  startUserPK(attackUser: PkHeroEntry[], resistUser: PkHeroEntry[]): PkResult | never[] {
    if (attackUser.length === 0 || resistUser.length === 0) return [];
    // PHP arrays are values: copy the queue and each shifted row so mutations stay local.
    const attacks = attackUser.map(copyHero);
    const resists = resistUser.map(copyHero);
    const ret: PkResult = { report: [], totalNum: 0, endflag: 1, winer: 0 };
    let totalBattle = 0;
    while (attacks.length > 0 && resists.length > 0) {
      const attackHero = attacks.shift()!;
      const resistHero = resists.shift()!;
      const battleRet: PkBattleRet[] = [];
      if (phpEmpty(attackHero) || phpEmpty(resistHero)) break;
      let attacker: PkState;
      let resister: PkState;
      if (phpIntval(fieldOf(attackHero, 'speed')) >= phpIntval(fieldOf(resistHero, 'speed'))) {
        attacker = this.initHeroState(attackHero as PkHero);
        resister = this.initHeroState(resistHero as PkHero);
      } else {
        attacker = this.initHeroState(resistHero as PkHero);
        resister = this.initHeroState(attackHero as PkHero);
      }
      while (attacker.blood > 0 && resister.blood > 0) {
        totalBattle++;
        battleRet.push(this.battleComute(attacker, resister, totalBattle));
        if (resister.blood === 0) {
          this.revive(attackHero, resistHero, attacker, attacks, resists);
          break;
        }
        totalBattle++;
        battleRet.push(this.battleComute(resister, attacker, totalBattle));
        if (attacker.blood === 0) {
          this.revive(attackHero, resistHero, resister, attacks, resists);
          break;
        }
      }
      ret.report.push(battleRet);
    }
    ret.totalNum = totalBattle;
    ret.endflag = 1;
    ret.winer = resists.length === 0 ? 1 : 0;
    return ret;
  }

  /**
   * PKFunc.php:175-196 — the survivor re-enters its own queue's front with energy = blood/RATE.
   * The `hid` match decides which side's queue; a `false` row's missing hid reads as null, and
   * `null == 0` holds in PHP, so the assignment auto-vivifies the false into an array there.
   */
  private revive(
    attackHero: PkHeroEntry,
    resistHero: PkHeroEntry,
    survivor: PkState,
    attacks: PkHeroEntry[],
    resists: PkHeroEntry[],
  ): void {
    const energy = phpIntval(survivor.blood / PK_RATE);
    if (phpLooseEquals(fieldOf(attackHero, 'hid'), survivor.hid)) {
      attacks.unshift(withEnergy(attackHero, energy));
    } else if (phpLooseEquals(fieldOf(resistHero, 'hid'), survivor.hid)) {
      resists.unshift(withEnergy(resistHero, energy));
    }
  }
}
