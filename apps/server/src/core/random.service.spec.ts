import { describe, expect, it } from 'vitest';
import {
  parseRngSpec,
  PHP_RAND_MAX,
  RandomService,
  scaleDraw,
  ScriptedRandom,
  seedSource,
  sequenceSource,
} from './random.service';

describe('scaleDraw', () => {
  it('maps a draw into [min, max] with the legacy prepend formula', () => {
    // 622 = 600 + (22 % 1201); matches rng-prepend.php's $min + ($v % ($max-$min+1)).
    expect(scaleDraw(600, 1800, 22)).toBe(622);
    expect(scaleDraw(1, 100, 33)).toBe(34);
    expect(scaleDraw(45, 50, 33)).toBe(48); // 45 + (33 % 6)
  });

  it('collapses an empty or inverted range to min', () => {
    expect(scaleDraw(5, 5, 999)).toBe(5);
    expect(scaleDraw(10, 3, 999)).toBe(10);
  });
});

describe('sequenceSource', () => {
  it('draws in order and cycles when exhausted', () => {
    const src = sequenceSource([11, 22, 33]);
    expect([src.draw(), src.draw(), src.draw(), src.draw(), src.draw()]).toEqual([
      11, 22, 33, 11, 22,
    ]);
  });
});

describe('seedSource', () => {
  it('reproduces the legacy prepend LCG stream value-for-value', () => {
    // Captured from the PHP 5.6 container running the identical recurrence; the raw streams must
    // agree, not only the scaled values, so a seeded battle case lines up draw-for-draw.
    const src = seedSource(12345);
    const got = Array.from({ length: 8 }, () => src.draw());
    expect(got).toEqual([
      1406932606, 654583775, 1449466924, 229283573, 1109335178, 1051550459, 1293799192, 794471793,
    ]);
  });

  it('is deterministic for a given seed', () => {
    const a = seedSource(7);
    const b = seedSource(7);
    expect([a.draw(), a.draw(), a.draw()]).toEqual([b.draw(), b.draw(), b.draw()]);
  });
});

describe('parseRngSpec', () => {
  it('parses a comma sequence', () => {
    const src = parseRngSpec('5,6,7')!;
    expect([src.draw(), src.draw(), src.draw()]).toEqual([5, 6, 7]);
  });

  it('parses a seed spec', () => {
    const src = parseRngSpec('seed:12345')!;
    expect(src.draw()).toBe(1406932606);
  });

  it('returns undefined for an empty or junk spec', () => {
    expect(parseRngSpec('')).toBeUndefined();
    expect(parseRngSpec(',,')).toBeUndefined();
    expect(parseRngSpec('seed:')).toBeUndefined();
  });
});

describe('ScriptedRandom', () => {
  it('exposes the source only inside run(), and isolates nested runs', () => {
    const scripted = new ScriptedRandom();
    expect(scripted.active).toBeUndefined();
    scripted.run(sequenceSource([1]), () => {
      expect(scripted.active).toBeDefined();
      scripted.run(sequenceSource([2]), () => {
        expect(scripted.active!.draw()).toBe(2);
      });
    });
    expect(scripted.active).toBeUndefined();
  });
});

describe('RandomService', () => {
  it('draws from the scripted source when one is armed', () => {
    const scripted = new ScriptedRandom();
    const random = new RandomService(scripted);
    scripted.run(sequenceSource([11, 22, 33]), () => {
      expect(random.rand()).toBe(11); // no-arg: raw draw
      expect(random.randRange(600, 1800)).toBe(622); // 600 + (22 % 1201)
      expect(random.mtRand(45, 50)).toBe(48); // 45 + (33 % 6)
    });
  });

  it('falls back to real randomness within range when no source is armed', () => {
    const random = new RandomService(new ScriptedRandom());
    for (let i = 0; i < 200; i++) {
      const v = random.randRange(600, 1800);
      expect(v).toBeGreaterThanOrEqual(600);
      expect(v).toBeLessThanOrEqual(1800);
      const m = random.mtRand(45, 50);
      expect(m).toBeGreaterThanOrEqual(45);
      expect(m).toBeLessThanOrEqual(50);
      const r = random.rand();
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(PHP_RAND_MAX);
    }
  });

  it('cycles a short sequence across many draws', () => {
    const scripted = new ScriptedRandom();
    const random = new RandomService(scripted);
    scripted.run(sequenceSource([0, 1]), () => {
      // mtRand(0,9): 0 -> 0, 1 -> 1, cycling.
      expect([random.mtRand(0, 9), random.mtRand(0, 9), random.mtRand(0, 9)]).toEqual([0, 1, 0]);
    });
  });
});
