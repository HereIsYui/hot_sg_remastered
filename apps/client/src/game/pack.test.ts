import { describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import { packNeed, packResources, packRows, validatePack, type PackSelection } from './pack';

// The validation messages are looked up by key; give them stable values for the assertions.
setStrings({
  Big_pack_dialog_tile_1: 'not-enough-res',
  Big_pack_dialog_tile_2: 'not-enough-copper',
  Big_pack_dialog_tile_3: 'nothing-to-pack',
});

const rows = packRows();

describe('packRows', () => {
  it('lists the five resources in grid order with two sizes each', () => {
    expect(rows.map((r) => r.resname)).toEqual(['gold', 'food', 'wood', 'rock', 'iron']);
    // gold packs cost the most (40 / 5); the other four match (16 / 2).
    expect(rows[0]!.sizes.map((s) => [s.count, s.price])).toEqual([
      [1000000, 40],
      [100000, 5],
    ]);
    expect(rows[1]!.sizes.map((s) => [s.count, s.price])).toEqual([
      [1000000, 16],
      [100000, 2],
    ]);
  });
});

describe('packResources', () => {
  it('floors gold then the four reals in order', () => {
    expect(packResources(1234.9, [100.4, 200.6, 300.1, 400.9])).toEqual([1234, 100, 200, 300, 400]);
  });
});

describe('packNeed', () => {
  it('multiplies the chosen size by the pack count', () => {
    expect(packNeed(rows[1]!, 0, 3)).toEqual({ resNeed: 3000000, copperNeed: 48 });
    expect(packNeed(rows[1]!, 1, 2)).toEqual({ resNeed: 200000, copperNeed: 4 });
  });
  it('falls back to the large size for a bad index', () => {
    expect(packNeed(rows[0]!, 9, 1)).toEqual({ resNeed: 1000000, copperNeed: 40 });
  });
});

describe('validatePack', () => {
  const none: PackSelection[] = rows.map(() => ({ packCount: 0, sizeIndex: 0 }));

  it('builds the payToPack payload with resname + 1-based size index', () => {
    const sel = [...none];
    sel[1] = { packCount: 1, sizeIndex: 1 }; // one small food pack: 100000 food, 2 铜钱
    sel[3] = { packCount: 2, sizeIndex: 0 }; // two large rock packs: 2000000 rock, 32 铜钱
    const result = validatePack(rows, sel, [0, 100000, 0, 2000000, 0], 1000);
    expect(result).toEqual({
      ok: true,
      entries: [
        ['gold1', 0, 0, 0],
        ['food2', 1, 100000, 2],
        ['wood1', 0, 0, 0],
        ['rock1', 2, 2000000, 32],
        ['iron1', 0, 0, 0],
      ],
    });
  });

  it('rejects a row needing more resource than it has', () => {
    const sel = [...none];
    sel[1] = { packCount: 1, sizeIndex: 0 }; // needs 1,000,000 food
    const result = validatePack(rows, sel, [0, 100, 0, 0, 0], 100000);
    expect(result).toEqual({ ok: false, message: 'not-enough-res' });
  });

  it('rejects an order that costs more 铜钱 than the player holds', () => {
    const sel = [...none];
    sel[0] = { packCount: 1, sizeIndex: 0 }; // 40 铜钱
    const result = validatePack(rows, sel, [1000000, 0, 0, 0, 0], 39);
    expect(result).toEqual({ ok: false, message: 'not-enough-copper' });
  });

  it('rejects an empty order', () => {
    const result = validatePack(rows, none, [9e9, 9e9, 9e9, 9e9, 9e9], 9e9);
    expect(result).toEqual({ ok: false, message: 'nothing-to-pack' });
  });
});
