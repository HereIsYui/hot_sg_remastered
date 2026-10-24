import { describe, expect, it } from 'vitest';
import type { UserCity } from '../stores/user';
import { MAIN_CITY_LEVEL, MAIN_CITY_TYPE, mergeArgs, mergeLists, positionParts } from './cityMerge';

const city = (cid: number, type: number, level = 1): UserCity =>
  ({
    cid,
    type,
    level,
    name: `城${cid}`,
    position: `(${cid % 1000},${Math.floor(cid / 1000)})`,
  }) as UserCity;

describe('mergeLists', () => {
  it('main accepts ordinary and merged cities, sub only ordinary ones', () => {
    const { main, sub, lockedMain, blocked } = mergeLists([
      city(1, 0),
      city(2, MAIN_CITY_TYPE, 11),
      city(3, 2), // a 名城 can be neither side of a merge
      city(4, 0),
    ]);
    expect(main.map((c) => c.cid)).toEqual([1, 2, 4]);
    expect(sub.map((c) => c.cid)).toEqual([1, 4]);
    expect(lockedMain?.cid).toBe(2);
    expect(blocked).toBe(false);
  });

  it('locks onto the merged city and blocks at 官府 15', () => {
    const lists = mergeLists([city(9, MAIN_CITY_TYPE, 14), city(1, 0)]);
    expect(lists.lockedMain?.cid).toBe(9);
    expect(lists.blocked).toBe(false);
    const maxed = mergeLists([city(9, MAIN_CITY_TYPE, MAIN_CITY_LEVEL), city(1, 0)]);
    expect(maxed.blocked).toBe(true);
  });

  it('no merged city leaves the main combo unlocked', () => {
    const { lockedMain, blocked } = mergeLists([city(1, 0), city(2, 0)]);
    expect(lockedMain).toBeNull();
    expect(blocked).toBe(false);
  });
});

describe('positionParts', () => {
  it('splits the (x,y) position string', () => {
    expect(positionParts('(355,209)')).toEqual({ x: '355', y: '209' });
    expect(positionParts('(5,1)')).toEqual({ x: '5', y: '1' });
  });
});

describe('mergeArgs', () => {
  const main = [city(1, 0), city(2, MAIN_CITY_TYPE, 11)];
  const sub = [city(3, 0), city(4, 0)];

  it('refuses when either list is empty', () => {
    expect(mergeArgs([], 0, sub, 0)).toEqual({ error: 'empty' });
    expect(mergeArgs(main, 0, [], 0)).toEqual({ error: 'empty' });
  });

  it('refuses the same city on both sides', () => {
    expect(mergeArgs(main, 0, [city(1, 0)], 0)).toEqual({ error: 'same' });
  });

  it('builds the [mainCid, subCid] request', () => {
    expect(mergeArgs(main, 1, sub, 0)).toEqual({ args: [2, 3] });
    expect(mergeArgs(main, 0, sub, 1)).toEqual({ args: [1, 4] });
  });
});
