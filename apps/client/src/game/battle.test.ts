import { describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  battleFinished,
  battleResultLine,
  maxRound,
  parseBattleData,
  parseBattleReport,
} from './battle';

setStrings({
  Troop_BattleDialogSrc_40: '胜利',
  Troop_BattleDialogSrc_41: '失败',
  Troop_BattleDialogSrc_42: '平局',
});

/** A getBattleReport reply `[sysbattle, membattle, rounds, atkTac, resTac]`. */
const report = (state = 0) => [
  { state, result: 0 },
  { id: 5, wallhp: 100, type: 1 },
  [
    { round: 1, report: '<p>a</p>' },
    { round: 2, report: '<p>b</p>' },
  ],
  [{ stype: 1, action: 2, target: 3, action2: 2, target2: 3 }],
  [{ stype: 1, action: 0, target: 0, action2: 0, target2: 0 }],
];

describe('parseBattleReport', () => {
  it('decodes battle state, rounds and both tactics sides', () => {
    const r = parseBattleReport(report());
    expect(r.sysbattle?.state).toBe(0);
    expect(r.membattle?.wallhp).toBe(100);
    expect(r.rounds).toHaveLength(2);
    expect(r.attackTactics[0]).toMatchObject({ stype: 1, action: 2, target: 3 });
    expect(r.resistTactics).toHaveLength(1);
  });

  it('tolerates a malformed reply', () => {
    const r = parseBattleReport(null);
    expect(r.sysbattle).toBeNull();
    expect(r.rounds).toEqual([]);
  });
});

describe('parseBattleData', () => {
  it('decodes a city battle (type 1) with attacker user/city/hero', () => {
    const data = [
      1, // battleType
      1001, // attackuid flag
      { uid: 1001, name: 'A' }, // attack user
      1002, // resistuid flag
      { uid: 1002, name: 'B' }, // resist user
      11, // attackcid flag
      { cid: 11, name: 'atkCity' }, // attack city
      22, // resistcid
      { cid: 22, name: 'resCity' }, // resist city
      101, // attackhid
      { hid: 101, name: 'H' }, // attack hero
      0, // resisthid
      report(),
    ];
    const bd = parseBattleData(data);
    expect(bd.battleType).toBe(1);
    expect(bd.attackUser?.name).toBe('A');
    expect(bd.resistUser?.name).toBe('B');
    expect(bd.attackCity?.name).toBe('atkCity');
    expect(bd.resistCid).toBe(22);
    expect(bd.attackHid).toBe(101);
    expect(bd.resistHero).toBeNull();
    expect(bd.report.rounds).toHaveLength(2);
  });

  it('a field battle (type 4) consumes a resist-user row even when resistuid is 0', () => {
    const data = [
      4, // battleType = 战场战
      0, // attackuid 0 -> no attack user
      0, // resistuid 0 ...
      { unionid: 5, name: 'unionNPC' }, // ... but type 4 still reads a resist user row
      0, // attackcid
      0, // resistcid
      0, // attackhid
      0, // resisthid
      report(),
    ];
    const bd = parseBattleData(data);
    expect(bd.battleType).toBe(4);
    expect(bd.attackUser).toBeNull();
    expect(bd.resistUser?.name).toBe('unionNPC');
  });
});

describe('battleResultLine', () => {
  it('shows win/lose/draw from the viewer side only when finished', () => {
    expect(battleResultLine({ state: 0, result: 0 }, true)).toBe('');
    expect(battleResultLine({ state: 1, result: '0' }, true)).toBe('胜利');
    expect(battleResultLine({ state: 1, result: '0' }, false)).toBe('失败');
    expect(battleResultLine({ state: 1, result: '2' }, true)).toBe('平局');
  });
});

describe('battleFinished / maxRound', () => {
  it('battleFinished reads sys_battle.state == 1', () => {
    expect(battleFinished({ state: 1 })).toBe(true);
    expect(battleFinished({ state: 0 })).toBe(false);
    expect(battleFinished(null)).toBe(false);
  });

  it('maxRound finds the highest round number', () => {
    expect(maxRound([{ round: 1 }, { round: 5 }, { round: 3 }])).toBe(5);
    expect(maxRound([])).toBe(0);
  });
});
