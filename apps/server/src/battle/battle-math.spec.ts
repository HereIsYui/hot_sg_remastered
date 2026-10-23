import { describe, expect, it } from 'vitest';
import {
  SoBitSo,
  action,
  array2troop,
  changePos,
  checkBattleEnd,
  checkPos,
  countDescIndex,
  getArraySub,
  getBattleRange,
  getTarget,
  sol2people,
  troop2array,
  type Combatant,
  type SoldierInfo,
} from './battle-math';

function unit(partial: Partial<Combatant>): Combatant {
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
    ...partial,
  };
}

describe('action', () => {
  it('maps 1/2/3 to +1/0/-1 for attackers', () => {
    expect(action(1, 0)).toBe(1);
    expect(action(2, 0)).toBe(0);
    expect(action(3, 0)).toBe(-1);
  });
  it('flips the sign for defenders (state 1)', () => {
    expect(action(1, 1)).toBe(-1);
    expect(action(3, 1)).toBe(1);
  });
});

describe('checkPos', () => {
  it('clamps a defender toward min and into [0, fieldrange]', () => {
    expect(checkPos(0, 500, 700, 400, 900, 1000)).toBe(400); // endpos>min -> min
    expect(checkPos(0, 500, -50, 400, 900, 1000)).toBe(0); // below 0 -> 0
  });
  it('clamps an attacker toward max and into [0, fieldrange]', () => {
    expect(checkPos(1, 500, 300, 100, 600, 1000)).toBe(600); // endpos<max -> max
    expect(checkPos(1, 500, 1200, 100, 600, 1000)).toBe(1000); // above fieldrange -> fieldrange
  });
});

describe('SoBitSo', () => {
  it('returns the exact rock-paper-scissors multipliers', () => {
    expect(SoBitSo(4, 7)).toBe(3.6);
    expect(SoBitSo(6, 5)).toBe(0.49);
    expect(SoBitSo(13, 5)).toBe(0.49);
    expect(SoBitSo(5, 4)).toBe(2.2);
    expect(SoBitSo(7, 6)).toBe(2.4);
    expect(SoBitSo(11, 18)).toBe(15);
    expect(SoBitSo(12, 15)).toBe(2.9);
    expect(SoBitSo(10, 12)).toBe(0.5);
    expect(SoBitSo(8, 18)).toBe(2);
    expect(SoBitSo(1, 2)).toBe(1);
  });
});

describe('checkBattleEnd', () => {
  it('returns the state code (0 atk win, 1 def win, 2 draw)', () => {
    expect(checkBattleEnd(0)).toBe(0);
    expect(checkBattleEnd(1)).toBe(1);
    expect(checkBattleEnd(2)).toBe(2);
  });
});

describe('getBattleRange', () => {
  it('is the longest shoot range on either side + 299', () => {
    // field 2 = shoot: attacker 100, defender 600 -> 600 + 299.
    const atk = '3,1,100,10,10,10,0,10,10,10,0';
    const def = '5,2,600,20,20,20,0,20,20,20,0';
    expect(getBattleRange(atk, def)).toBe(899);
  });
});

describe('changePos', () => {
  it('mirrors each position across the battlefield', () => {
    // 2 units: sid 3 at 100, sid 1 at 900, fieldrange 1000.
    expect(changePos('2,3,100,1,900', 1000)).toBe('2,3,900,1,100');
  });
});

describe('countDescIndex', () => {
  it('buckets army size into the 9 fuzzy ranges', () => {
    expect(countDescIndex(5)).toBe(0);
    expect(countDescIndex(10)).toBe(1);
    expect(countDescIndex(99)).toBe(2);
    expect(countDescIndex(249)).toBe(3);
    expect(countDescIndex(999)).toBe(4);
    expect(countDescIndex(2499)).toBe(5);
    expect(countDescIndex(4999)).toBe(6);
    expect(countDescIndex(9999)).toBe(7);
    expect(countDescIndex(10000)).toBe(8);
  });
});

describe('sol2people', () => {
  const usepeople = { 1: 1, 3: 2, 7: 5 };
  it('sums floor(cnt*usepeople) over a troop string', () => {
    // 2 kinds: sid1 x10 (10), sid7 x3 (15) -> 25.
    expect(sol2people('2,1,10,7,3', usepeople)).toBe(25);
  });
  it('accepts a map too', () => {
    expect(sol2people(new Map([[3, 4]]), usepeople)).toBe(8);
  });
});

describe('troop2array / array2troop round trip', () => {
  it('parses and re-serializes with sids ascending', () => {
    const m = troop2array('3,7,5,1,10,3,4');
    expect(m).toEqual(
      new Map([
        [7, 5],
        [1, 10],
        [3, 4],
      ]),
    );
    expect(array2troop(m)).toBe('3,1,10,3,4,7,5'); // ksort -> 1,3,7
  });
  it('drops non-positive counts', () => {
    expect(troop2array('2,1,0,3,5')).toEqual(new Map([[3, 5]]));
  });
});

describe('getArraySub', () => {
  it('subtracts survivors from the original, flooring at 0 and dropping zeros', () => {
    const set = new Map([
      [1, 10],
      [3, 5],
    ]);
    const survived = new Map([[1, 4]]); // sid3 all died
    expect(getArraySub(set, survived)).toEqual(
      new Map([
        [1, 6],
        [3, 5],
      ]),
    );
  });
});

describe('getTarget', () => {
  const attacker = unit({ state: 1, pos: 500, shoot: 1000, type: 1 });
  it('prefers a reachable enemy of the target type', () => {
    const infos: SoldierInfo = new Map([
      [200, unit({ state: 0, pos: 400, type: 2 })], // enemy, type 2
      [300, unit({ state: 0, pos: 450, type: 5 })], // enemy, target type
    ]);
    expect(getTarget(infos, attacker, 5, () => 99)).toBe(300);
  });
  it('falls back to a random reachable enemy ground unit', () => {
    const infos: SoldierInfo = new Map([
      [200, unit({ state: 0, pos: 400, type: 2 })],
      [300, unit({ state: 0, pos: 450, type: 4 })],
    ]);
    // target type 9 is absent; rand picks index 1 of [200,300].
    expect(getTarget(infos, attacker, 9, () => 1)).toBe(300);
    expect(getTarget(infos, attacker, 9, () => 0)).toBe(200);
  });
  it('targets the wall (180000) when attacking and nothing else is reachable', () => {
    const infos: SoldierInfo = new Map([[180000, unit({ state: 0, pos: 2000, type: 18 })]]);
    expect(getTarget(infos, attacker, 9, () => 0)).toBe(180000);
  });
});
