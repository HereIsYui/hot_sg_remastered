import { describe, expect, it } from 'vitest';
import { isValidRates, parseStoreInfo, storeRows, totalStore, type StoreInfo } from './store';

const reply = [
  '1000', // foodbase
  '2000', // woodbase
  '3000', // rockbase
  '4000', // ironbase
  '1.2', // techLevel (仓储 level 2)
  '3', // buildingCount
  '100000', // storeSum
  { food_store: '40', wood_store: '20', rock_store: '10', iron_store: '0' },
  '5000', // copper
];

describe('parseStoreInfo', () => {
  it('shifts the doGetStoreInfo reply into fields', () => {
    const info = parseStoreInfo(reply);
    expect(info.resBase).toEqual([1000, 2000, 3000, 4000]);
    expect(info.techLevel).toBe(1.2);
    expect(info.buildingCount).toBe(3);
    expect(info.storeSum).toBe(100000);
    expect(info.rates).toEqual([40, 20, 10, 0]);
    expect(info.copper).toBe(5000);
  });

  it('defaults a missing res-add object to zero ratios', () => {
    const info = parseStoreInfo([0, 0, 0, 0, 1, 0, 0]);
    expect(info.rates).toEqual([0, 0, 0, 0]);
    expect(info.copper).toBe(0);
  });
});

describe('totalStore', () => {
  it('floors storeSum × techLevel', () => {
    expect(totalStore(parseStoreInfo(reply))).toBe(120000);
  });
});

describe('storeRows', () => {
  const info: StoreInfo = parseStoreInfo(reply);

  it('splits capacity, stored and overflow per the ratios (StorePanel.changeRate)', () => {
    const { rows, emptyStore } = storeRows(info, [40, 20, 10, 0], [60000, 10000, 0, 0]);
    // food: capacity = round(100000·0.01·40·1.2) = 48000; holds 48000, overflow 12000.
    expect(rows[0]!.capacity).toBe(48000);
    expect(rows[0]!.instore).toBe(48000);
    expect(rows[0]!.outstore).toBe(12000);
    // food resmax = round((1000 + 100000·0.01·40)·1.2 + 10000) = round(41000·1.2) + 10000 = 59200.
    expect(rows[0]!.resmax).toBe(59200);
    // wood: capacity = round(100000·0.01·20·1.2) = 24000; holds 10000, nothing overflows.
    expect(rows[1]!.capacity).toBe(24000);
    expect(rows[1]!.instore).toBe(10000);
    expect(rows[1]!.outstore).toBe(0);
    // iron: 0 ratio -> no extra capacity.
    expect(rows[3]!.capacity).toBe(0);
    // emptyStore = 120000 - 48000 - 10000 - 0 - 0.
    expect(emptyStore).toBe(62000);
  });
});

describe('isValidRates', () => {
  it('rejects negatives and a sum over 100', () => {
    expect(isValidRates([40, 20, 10, 0])).toBe(true);
    expect(isValidRates([40, 40, 40, 0])).toBe(false);
    expect(isValidRates([-1, 0, 0, 0])).toBe(false);
    expect(isValidRates([25, 25, 25, 25])).toBe(true);
  });
});
