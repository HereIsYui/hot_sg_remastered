import { describe, expect, it } from 'vitest';
import { officeHeroRows, parseRestHeroes } from './office';

describe('office helpers', () => {
  it('computes buffer-adjusted attributes and sorts states like the original panel', () => {
    const rows = officeHeroRows(
      [
        { hid: 1, state: 0, hero_health: 0, level: 10, command_base: 20 },
        {
          hid: 2,
          state: 7,
          hero_health: 0,
          level: 20,
          command_base: 30,
          buf1: 200,
          affairs_base: 40,
          affairs_add: 10,
          affairs_add_on: 5,
          buf2: 200,
        },
      ],
      100,
    );
    expect(rows[0]!.hid).toBe(2);
    expect(rows[0]!.command).toBe(75);
    expect(rows[0]!.affairs).toBe(67);
    expect(rows[1]!.command).toBe(30);
  });

  it('parses resting heroes and falls back to hurt heroes', () => {
    expect(parseRestHeroes([100, [{ hid: 1 }], [{ hid: 2 }]]).heroes[0]!.hid).toBe(1);
    expect(parseRestHeroes([100, [], [{ hid: 2 }]]).heroes[0]!.hid).toBe(2);
    expect(parseRestHeroes(null).heroes).toEqual([]);
  });
});
