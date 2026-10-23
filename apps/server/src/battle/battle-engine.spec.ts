import { describe, expect, it } from 'vitest';
import { battleInfo, upManeuver, type ManeuverRow } from './battle-engine';

/**
 * A scripted `mt_rand(min,max)` that yields queued values in order (the only randomness the 演习
 * loop consumes is `getTarget`'s target pick), so every outcome is deterministic. A difftest scopes
 * the exact same sequence against the live PHP.
 */
function scriptedRand(...values: number[]): (min: number, max: number) => number {
  let i = 0;
  return () => values[i++] ?? 0;
}

/** Build a stat segment `sid,type,shoot,act,def,blood,speed,ap,dp,hp,uid`. */
function add(
  sid: number,
  o: Partial<{
    type: number;
    shoot: number;
    act: number;
    def: number;
    blood: number;
    speed: number;
    ap: number;
    dp: number;
    hp: number;
  }>,
): string {
  const t = o.type ?? sid;
  return [
    sid,
    t,
    o.shoot ?? 0,
    o.act ?? 0,
    o.def ?? 0,
    o.blood ?? 1,
    o.speed ?? 0,
    o.ap ?? 0,
    o.dp ?? 0,
    o.hp ?? 1,
    0,
  ].join(',');
}

describe('battleInfo', () => {
  it('keys attacker units by sid*100 (state 1) and defenders by sid (state 0)', () => {
    const row: ManeuverRow = {
      attacksoldiers: '1,3,10',
      resistsoldiers: '1,3,5',
      attackadd: add(3, { type: 3, shoot: 500, ap: 100, dp: 10, hp: 20, blood: 20, speed: 300 }),
      resistadd: add(3, { type: 3, shoot: 500, ap: 100, dp: 10, hp: 20, blood: 20, speed: 300 }),
    };
    const info = battleInfo(row);
    expect(info.get(300)).toMatchObject({ cnt: 10, pos: 900, state: 1, type: 3 });
    expect(info.get(3)).toMatchObject({ cnt: 5, pos: 100, state: 0, type: 3 });
  });
});

describe('upManeuver early-outs', () => {
  it('attacker win (end 0) when the field is empty', () => {
    const row: ManeuverRow = {
      attacksoldiers: '1,3,10',
      resistsoldiers: '0',
      attackadd: '',
      resistadd: '',
    };
    const r = upManeuver(row, scriptedRand());
    expect(r.end).toBe(0);
    expect(r.round).toBe(1);
    expect(r.attackdie).toBe(0);
  });

  it('defender win (end 1) when the attacker brought nothing', () => {
    const row: ManeuverRow = {
      attacksoldiers: '0',
      resistsoldiers: '1,3,5',
      attackadd: '',
      resistadd: '',
    };
    expect(upManeuver(row, scriptedRand()).end).toBe(1);
  });
});

describe('upManeuver combat', () => {
  it('a dominant attacker wipes the defender and takes no scout losses', () => {
    // Attacker: 100 scouts (sid3), huge attack, reaches the defender in one move.
    // Defender: 5 scouts, no offence (ap/dp/act/def 0) so they cannot hurt back.
    const row: ManeuverRow = {
      attacksoldiers: '1,3,100',
      resistsoldiers: '1,3,5',
      attackadd: add(3, {
        type: 3,
        shoot: 1000,
        act: 0,
        def: 0,
        blood: 10,
        speed: 1000,
        ap: 500,
        dp: 50,
        hp: 50,
      }),
      resistadd: add(3, {
        type: 3,
        shoot: 0,
        act: 0,
        def: 0,
        blood: 10,
        speed: 0,
        ap: 0,
        dp: 0,
        hp: 10,
      }),
    };
    // getTarget: preferred type 3 present on the other side, so no rand is consumed.
    const r = upManeuver(row, scriptedRand());
    expect(r.end).toBe(0); // attacker win
    expect(r.resistdie).toBe(5); // defender scouts all dead
    expect(r.attackdie).toBe(0); // attacker took no losses
  });

  it('draws (end 2) when 40 rounds pass without a wipe', () => {
    // Both sides out of range of each other (shoot 0) so nobody can ever die.
    const row: ManeuverRow = {
      attacksoldiers: '1,3,10',
      resistsoldiers: '1,3,10',
      attackadd: add(3, { type: 3, shoot: 0, speed: 0, blood: 10, hp: 10 }),
      resistadd: add(3, { type: 3, shoot: 0, speed: 0, blood: 10, hp: 10 }),
    };
    const r = upManeuver(row, scriptedRand());
    expect(r.end).toBe(2);
    expect(r.round).toBe(40);
  });

  it('serialises whole-army losses in attackLost / resistLost', () => {
    const row: ManeuverRow = {
      attacksoldiers: '1,3,100',
      resistsoldiers: '1,3,5',
      attackadd: add(3, { type: 3, shoot: 1000, blood: 10, speed: 1000, ap: 500, dp: 50, hp: 50 }),
      resistadd: add(3, { type: 3, shoot: 0, blood: 10, speed: 0, ap: 0, dp: 0, hp: 10 }),
    };
    const r = upManeuver(row, scriptedRand());
    expect(r.resistLost.get(3)).toBe(5);
    expect(r.attackLost.get(3) ?? 0).toBe(0);
  });
});
