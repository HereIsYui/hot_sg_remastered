import { describe, expect, it } from 'vitest';
import {
  type BattleRoundInput,
  type RoundTactic,
  buildFightSoldiers,
  getSoldierCounts,
  getabletarget,
  getrangbetween,
  getsoldierarray,
  playRound,
} from './battle-round';

/** cfg_soldier-ish stats: sid 1 melee foot (short range), sid 3 scouts (short range), sid 6 bow. */
const SOLDIER = new Map<
  number,
  { speed: number; range: number; hp: number; ap: number; dp: number; type: number }
>([
  [1, { speed: 100, range: 50, hp: 100, ap: 50, dp: 30, type: 1 }],
  [3, { speed: 200, range: 50, hp: 60, ap: 40, dp: 20, type: 3 }],
  [6, { speed: 80, range: 700, hp: 80, ap: 70, dp: 25, type: 6 }],
]);

const DEFENCE = new Map<number, { range: number; hp: number; ap: number; dp: number }>([
  [1, { range: 100, hp: 500, ap: 0, dp: 200 }],
  [3, { range: 800, hp: 300, ap: 90, dp: 100 }], // 箭塔: counterattacks
]);

/** Build a round input with sane defaults; `over` fields merged in. */
function input(over: Partial<BattleRoundInput>): BattleRoundInput {
  const tactics = new Map<string, RoundTactic>();
  // Everyone advances toward the enemy and prefers no specific target (random pick).
  for (const stype of [1, 3, 6]) {
    tactics.set(`1:${stype}`, { action: 1, target: 0 });
    tactics.set(`0:${stype}`, { action: 1, target: 0 });
  }
  return {
    type: 0,
    round: 1,
    fieldrange: 1000,
    wallhp: 0,
    attacksoldiers: '0',
    resistsoldiers: '0',
    attackpos: '0',
    resistpos: '0',
    resistdefence: '0,',
    tactics,
    soldierInfo: SOLDIER,
    defenceInfo: DEFENCE,
    attackhid: 0,
    resisthid: 0,
    attackCommand: { bravery: 0, wisdom: 0 },
    resistCommand: { bravery: 0, wisdom: 0 },
    attackHeroCommand: 0,
    resistHeroCommand: 0,
    attackSpeed: 0,
    resistSpeed: 0,
    attackTech: {},
    resistTech: {},
    ...over,
  };
}

const rand = () => 1; // deterministic: always pick the first reachable target

describe('battle-round string helpers', () => {
  it('getSoldierCounts sums a count,sid,n string', () => {
    expect(getSoldierCounts('2,1,100,3,50')).toBe(150);
    expect(getSoldierCounts('0')).toBe(0);
  });

  it('getsoldierarray zips troop + pos strings', () => {
    const out = getsoldierarray('2,1,100,3,50', '2,1,900,3,800');
    expect(out).toEqual([
      { sid: 1, count: 100, range: 900 },
      { sid: 3, count: 50, range: 800 },
    ]);
  });

  it('getrangbetween measures the attacker-to-defender frontier distance', () => {
    const fight = [
      {
        sid: 1,
        type: 1,
        count: 10,
        range: 300,
        speed: 0,
        gongjifanwei: 50,
        hp: 1,
        ap: 1,
        dp: 1,
        attack: 1,
      },
      {
        sid: 1,
        type: 1,
        count: 10,
        range: 100,
        speed: 0,
        gongjifanwei: 50,
        hp: 1,
        ap: 1,
        dp: 1,
        attack: 0,
      },
    ];
    // attacker at 300 vs furthest defender at 100 → 200
    expect(getrangbetween(fight, 1000, 0)).toBe(200);
    // defender at 100 vs nearest attacker at 300 → 300 - 100 = 200
    expect(getrangbetween(fight, 1000, 1)).toBe(200);
  });

  it('getabletarget lists enemies within reach', () => {
    const fight = [
      {
        sid: 1,
        type: 1,
        stype: 1,
        count: 10,
        range: 300,
        speed: 0,
        gongjifanwei: 300,
        hp: 1,
        ap: 1,
        dp: 1,
        attack: 1,
      },
      {
        sid: 1,
        type: 1,
        stype: 1,
        count: 10,
        range: 100,
        speed: 0,
        gongjifanwei: 50,
        hp: 1,
        ap: 1,
        dp: 1,
        attack: 0,
      },
    ];
    const able = getabletarget(fight, 0); // attacker reach 300-300=0; defender at 100 > 0 → reachable
    expect([...able.values()]).toContain(1);
  });
});

describe('return_new_place (playRound)', () => {
  it('attacker wins a field battle when the defender is wiped out', () => {
    const r = playRound(
      input({
        attacksoldiers: '1,1,5000',
        resistsoldiers: '1,3,1',
        attackpos: '1,1,60',
        resistpos: '1,3,60',
        round: 1,
      }),
      buildFightSoldiers(
        input({
          attacksoldiers: '1,1,5000',
          resistsoldiers: '1,3,1',
          attackpos: '1,1,60',
          resistpos: '1,3,60',
        }),
      ),
      rand,
    );
    // The lone defender scout dies; attacker survivors remain → attacker win (0).
    expect(r.battleEnd).toBe(0);
    expect(r.attacksoldiers.startsWith('1,')).toBe(true);
    expect(r.report.length).toBeGreaterThan(0);
  });

  it('defender wins when the attacker is wiped out', () => {
    const r = playRound(
      input({
        attacksoldiers: '1,3,1',
        resistsoldiers: '1,1,5000',
        attackpos: '1,3,60',
        resistpos: '1,1,60',
      }),
      buildFightSoldiers(
        input({
          attacksoldiers: '1,3,1',
          resistsoldiers: '1,1,5000',
          attackpos: '1,3,60',
          resistpos: '1,1,60',
        }),
      ),
      rand,
    );
    expect(r.battleEnd).toBe(1);
  });

  it('round > 40 forces a draw (end 2)', () => {
    const r = playRound(
      input({
        attacksoldiers: '1,1,10',
        resistsoldiers: '1,1,10',
        attackpos: '1,1,900',
        resistpos: '1,1,100',
        round: 41,
      }),
      buildFightSoldiers(
        input({
          attacksoldiers: '1,1,10',
          resistsoldiers: '1,1,10',
          attackpos: '1,1,900',
          resistpos: '1,1,100',
          round: 41,
        }),
      ),
      rand,
    );
    expect(r.battleEnd).toBe(2);
  });

  it('a standing wall survives while the triggered city defence kills the lone assaulter', () => {
    // type 1 city, wall up: one attacker reaches, chips the wall, and the触发型 city defence
    // (did 1, ap 0) kills it via rand(0,count). Attacker and field soldiers both gone, wall
    // standing → end 3 (未知), exactly as return_new_place resolves it.
    const base = input({
      type: 1,
      wallhp: 1_000_000,
      attacksoldiers: '1,1,1',
      resistsoldiers: '0',
      attackpos: '1,1,200',
      resistpos: '0',
      resistdefence: '1,1,1,10', // one did-1 defence, count 10
    });
    const r = playRound(base, buildFightSoldiers(base), rand);
    expect(r.wallhp).toBeGreaterThan(0); // wall not breached
    expect(r.battleEnd).toBe(3); // both sides' field units gone, wall intact
  });
});

describe('buildFightSoldiers', () => {
  it('appends the wall (type 3) and city defences (type 2) for a standing wall', () => {
    const fight = buildFightSoldiers(
      input({
        type: 1,
        wallhp: 2000,
        resistsoldiers: '0',
        resistdefence: '1,3,16,5',
        attacksoldiers: '1,1,10',
        attackpos: '1,1,500',
      }),
    );
    expect(fight.some((s) => s.type === 3)).toBe(true); // the wall
    expect(fight.some((s) => s.type === 2 && s.did === 3)).toBe(true); // 箭塔 defence
  });

  it('sorts fastest-first', () => {
    const fight = buildFightSoldiers(
      input({ attacksoldiers: '2,1,10,3,10', resistsoldiers: '0', attackpos: '2,1,900,3,900' }),
    );
    for (let i = 1; i < fight.length; i++) {
      expect(fight[i - 1]!.speed).toBeGreaterThanOrEqual(fight[i]!.speed);
    }
  });
});
