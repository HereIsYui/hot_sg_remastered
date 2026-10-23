import { describe, expect, it } from 'vitest';
import { parseGroundSoldiers } from './ground';

describe('parseGroundSoldiers', () => {
  it('parses the [rows, goldNeed] reply', () => {
    const list = parseGroundSoldiers([
      [
        { sid: 5, name: '刀兵', count: 120 },
        { sid: 7, name: '弓兵', count: 30 },
      ],
      450,
    ]);
    expect(list.goldNeed).toBe(450);
    expect(list.soldiers).toEqual([
      { sid: 5, name: '刀兵', count: 120 },
      { sid: 7, name: '弓兵', count: 30 },
    ]);
  });

  it('coerces string fields and tolerates an empty / malformed reply', () => {
    expect(parseGroundSoldiers([[{ sid: '5', name: '刀兵', count: '12' }], '99'])).toEqual({
      soldiers: [{ sid: 5, name: '刀兵', count: 12 }],
      goldNeed: 99,
    });
    expect(parseGroundSoldiers([])).toEqual({ soldiers: [], goldNeed: 0 });
    expect(parseGroundSoldiers(null)).toEqual({ soldiers: [], goldNeed: 0 });
    expect(parseGroundSoldiers('garbage')).toEqual({ soldiers: [], goldNeed: 0 });
  });
});
