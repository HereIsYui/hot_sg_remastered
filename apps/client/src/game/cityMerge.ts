import type { UserCity } from '../stores/user';

/**
 * World/CityMergeDialog.as pure logic: the main / sub city lists `onShow` builds (AS3 967-1014),
 * the `(x,y)` position parsing of `updateMainList` / `updateSubList` (AS3 914-960) and the submit
 * guards of `onMergeCity` (AS3 643-658).
 */

/** `Define.MAIN_CITY_TYPE` (Define.as:153): a merged city (sys_city.type = 5). */
export const MAIN_CITY_TYPE = 5;
/** `Define.MAIN_CITY_LEVEL` (Define.as:157): the 官府 level merges stop at. */
export const MAIN_CITY_LEVEL = 15;

/** The city's 官府 level (the `level` subquery of the `getUserCities` reply). */
export function cityLevel(city: UserCity): number {
  return Number(city.level ?? 0) || 0;
}

/**
 * `onShow` (AS3 967-1014): the main combo accepts ordinary cities and merged (type 5) ones, the
 * sub combo only ordinary cities. A type-5 city is the locked main pick (`AS3 994-1004`), and
 * when its 官府 is already 15 the dialog refuses to open at all (`CityMergeDialog_tile_10`,
 * AS3 1007-1011).
 */
export function mergeLists(cities: UserCity[]): {
  main: UserCity[];
  sub: UserCity[];
  /** The type-5 city locking the main combo, if the player has one. */
  lockedMain: UserCity | null;
  /** True when the locked main city's 官府 has reached 15 — no further merge possible. */
  blocked: boolean;
} {
  const main = cities.filter((c) => c.type === 0 || c.type === MAIN_CITY_TYPE);
  const sub = cities.filter((c) => c.type === 0);
  const lockedMain = main.find((c) => c.type === MAIN_CITY_TYPE) ?? null;
  return {
    main,
    sub,
    lockedMain,
    blocked: lockedMain !== null && cityLevel(lockedMain) >= MAIN_CITY_LEVEL,
  };
}

/** `updateMainList` / `updateSubList` (AS3 914-960): the `"(x,y)"` position split into X / Y. */
export function positionParts(position: string): { x: string; y: string } {
  const [x = '', y = ''] = position.slice(1, -1).split(',');
  return { x, y };
}

/**
 * `onMergeCity` (AS3 643-658): the guard — no city on either side (`City_Merge_Dialog_3`) or the
 * same city picked twice (`City_Merge_Dialog_1`) — or the `[mainCid, subCid]` request args. The
 * command itself goes out as `('CityMerge', 'mergeCity', args)`.
 */
export function mergeArgs(
  main: UserCity[],
  mainIndex: number,
  sub: UserCity[],
  subIndex: number,
): { error: 'empty' | 'same' } | { args: [number, number] } {
  if (main.length <= 0 || sub.length <= 0) return { error: 'empty' };
  const mainCid = Number(main[mainIndex]?.cid);
  const subCid = Number(sub[subIndex]?.cid);
  if (mainCid === subCid) return { error: 'same' };
  return { args: [mainCid, subCid] };
}
