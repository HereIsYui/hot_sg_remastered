/**
 * Store.StorePanel: the 仓库 resource-split dialog's pure logic. The server reply (doGetStoreInfo)
 * carries the four resource bases, the 仓储 technic multiplier, the 粮仓 count and total extra
 * capacity, the saved split ratios and the player's 铜钱; from a chosen split this computes each
 * resource's cap, what is stored, and what overflows.
 */

type Row = Record<string, unknown>;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** `StorePanel.onData`: the parsed 仓库 reply. */
export interface StoreInfo {
  /** food/wood/rock/iron base caps (already ×100×speed). */
  resBase: [number, number, number, number];
  /** 仓储 technic multiplier (1 with none, else 1 + 0.1·level). */
  techLevel: number;
  /** Number of 粮仓 in the city. */
  buildingCount: number;
  /** Total extra capacity the 粮仓 add before the technic multiplier. */
  storeSum: number;
  /** Saved split ratios, food/wood/rock/iron, each 0-100. */
  rates: [number, number, number, number];
  /** Current 铜钱 count. */
  copper: number;
}

/** `StorePanel.onData`: shift the reply into a StoreInfo. */
export function parseStoreInfo(reply: unknown): StoreInfo {
  const data = Array.isArray(reply) ? [...(reply as unknown[])] : [];
  const resBase: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) resBase[i] = Math.trunc(num(data.shift()));
  const techLevel = num(data.shift());
  const buildingCount = Math.trunc(num(data.shift()));
  const storeSum = Math.trunc(num(data.shift()));
  const add = (data.shift() ?? {}) as Row;
  const copper = num(data.shift());
  return {
    resBase,
    techLevel,
    buildingCount,
    storeSum,
    rates: [num(add.food_store), num(add.wood_store), num(add.rock_store), num(add.iron_store)],
    copper,
  };
}

/** One resource row as `StorePanel.changeRate` fills the grid. */
export interface StoreResourceRow {
  /** 0-3: food/wood/rock/iron. */
  index: number;
  /** Current amount held (City.*_real, rounded). */
  rescount: number;
  /** Max this resource can hold at the current split. */
  resmax: number;
  /** Extra capacity this split grants (before the base). */
  capacity: number;
  /** How much of `rescount` fits the extra capacity. */
  instore: number;
  /** How much of `rescount` overflows it. */
  outstore: number;
}

/** `StorePanel.mTotalStore`: the total extra capacity after the technic multiplier. */
export function totalStore(info: StoreInfo): number {
  return Math.floor(info.storeSum * info.techLevel);
}

/**
 * `StorePanel.changeRate`: with the chosen split ratios and the city's current resource amounts,
 * compute each row and the still-free total capacity.
 */
export function storeRows(
  info: StoreInfo,
  rates: [number, number, number, number],
  amounts: [number, number, number, number],
): { rows: StoreResourceRow[]; emptyStore: number } {
  const total = totalStore(info);
  let emptyStore = total;
  const rows: StoreResourceRow[] = [];
  for (let i = 0; i < 4; i++) {
    const rate = rates[i]!;
    const rescount = Math.round(amounts[i]!);
    const resmax = Math.round(
      (info.resBase[i]! + info.storeSum * 0.01 * rate) * info.techLevel + 10000,
    );
    const capacity = Math.round(info.storeSum * 0.01 * rate * info.techLevel);
    const instore = Math.round(Math.min(rescount, capacity));
    const outstore = Math.round(Math.max(rescount - instore, 0));
    emptyStore -= instore;
    rows.push({ index: i, rescount, resmax, capacity, instore, outstore });
  }
  return { rows, emptyStore: Math.floor(emptyStore) };
}

/** `StorePanel.modifyRate`: whether the chosen split is valid (non-negative, sum ≤ 100). */
export function isValidRates(rates: [number, number, number, number]): boolean {
  if (rates.some((r) => r < 0)) return false;
  return rates[0] + rates[1] + rates[2] + rates[3] <= 100;
}
