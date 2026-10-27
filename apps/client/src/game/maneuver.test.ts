import { describe, expect, it } from 'vitest';
import {
  formatManeuverResult,
  normalizeManeuverCount,
  parseManeuverLosses,
  serializeManeuverSoldiers,
} from './maneuver';

describe('maneuver helpers', () => {
  it('clamps counts to the original 0..200000 range', () => {
    expect(normalizeManeuverCount('garbage')).toBe(0);
    expect(normalizeManeuverCount(-1)).toBe(0);
    expect(normalizeManeuverCount('200001')).toBe(200000);
    expect(normalizeManeuverCount('120')).toBe(120);
  });

  it('serializes both sides with the original trailing comma', () => {
    expect(
      serializeManeuverSoldiers([
        { sid: 3, name: '斥候', count: 100, diecount: 0 },
        { sid: 1, name: '民夫', count: 10, diecount: 0 },
      ]),
    ).toBe('2,3,100,1,10,');
  });

  it('parses count,sid,n loss strings and empty results', () => {
    expect([...parseManeuverLosses('2,3,5,1,20')]).toEqual([
      [3, 5],
      [1, 20],
    ]);
    expect(parseManeuverLosses('0').size).toBe(0);
  });

  it('formats the round count and all three outcomes', () => {
    expect(formatManeuverResult({ result: 3, round: 40 })).toBe('战斗持续40回合，双方战平。');
    expect(formatManeuverResult({ result: 0, round: 1 })).toBe('战斗持续1回合，进攻方胜。');
    expect(formatManeuverResult({ result: 1, round: 2 })).toBe('战斗持续2回合，防守方胜。');
  });
});
