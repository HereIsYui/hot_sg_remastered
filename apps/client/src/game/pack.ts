/**
 * Store.BigPackDialog: the pure logic of the 仓库 打包 sub-dialog. Each of the five resources
 * (gold/food/wood/rock/iron) can be packed into one of two tradable goods — a large pack of
 * 1,000,000 units and a small pack of 100,000 units — paying 铜钱 per pack. From the chosen pack
 * size and pack count this computes the resource and 铜钱 each row needs, and validates the order
 * the way `BigPackDialog.submit` does before sending payToPack.
 */

import { i18n } from '../i18n';

/** One pack size of a resource (`packtypes[*]` in the original). */
export interface PackSize {
  /** The combo label, e.g. 大金砖 / 小金砖. */
  label: string;
  /** Units of the resource one pack consumes. */
  count: number;
  /** 铜钱 one pack costs. */
  price: number;
}

/** A resource row of the dialog, `resname` matching the server's payToPack type prefix. */
export interface PackRow {
  /** gold/food/wood/rock/iron — the server appends the 1-based size index to form the type. */
  resname: 'gold' | 'food' | 'wood' | 'rock' | 'iron';
  /** Grid header: 物品 column (黄金/粮食/木材/石料/铁矿). */
  restype: string;
  /** The two pack sizes (index 0 large, 1 small). */
  sizes: [PackSize, PackSize];
}

/**
 * `BigPackDialog.packtypes` + `buildPackdata`: the five rows in grid order, labels and prices
 * exactly as the original (`Store_PackDialogSrc_1..10`, `Stat_StatDialog_22..26_1`).
 */
export function packRows(): PackRow[] {
  return [
    {
      resname: 'gold',
      restype: i18n('Stat_StatDialog_22_1'),
      sizes: [
        { label: i18n('Store_PackDialogSrc_1'), count: 1000000, price: 40 },
        { label: i18n('Store_PackDialogSrc_2'), count: 100000, price: 5 },
      ],
    },
    {
      resname: 'food',
      restype: i18n('Stat_StatDialog_23_1'),
      sizes: [
        { label: i18n('Store_PackDialogSrc_3'), count: 1000000, price: 16 },
        { label: i18n('Store_PackDialogSrc_4'), count: 100000, price: 2 },
      ],
    },
    {
      resname: 'wood',
      restype: i18n('Stat_StatDialog_24_1'),
      sizes: [
        { label: i18n('Store_PackDialogSrc_5'), count: 1000000, price: 16 },
        { label: i18n('Store_PackDialogSrc_6'), count: 100000, price: 2 },
      ],
    },
    {
      resname: 'rock',
      restype: i18n('Stat_StatDialog_25_1'),
      sizes: [
        { label: i18n('Store_PackDialogSrc_7'), count: 1000000, price: 16 },
        { label: i18n('Store_PackDialogSrc_8'), count: 100000, price: 2 },
      ],
    },
    {
      resname: 'iron',
      restype: i18n('Stat_StatDialog_26_1'),
      sizes: [
        { label: i18n('Store_PackDialogSrc_9'), count: 1000000, price: 16 },
        { label: i18n('Store_PackDialogSrc_10'), count: 100000, price: 2 },
      ],
    },
  ];
}

/** The resource amount each row shows, in grid order (gold/food/wood/rock/iron). */
export function packResources(gold: number, reals: [number, number, number, number]): number[] {
  return [gold, ...reals].map((v) => Math.floor(v));
}

/** `updateRes`: resource and 铜钱 a row needs at a chosen size and count. */
export function packNeed(
  row: PackRow,
  sizeIndex: number,
  packCount: number,
): { resNeed: number; copperNeed: number } {
  const size = row.sizes[sizeIndex] ?? row.sizes[0];
  return { resNeed: size.count * packCount, copperNeed: size.price * packCount };
}

/** One submitted entry: `[type, packCount, resNeed, copperNeed]`, type = `resname + (size+1)`. */
export type PackEntry = [string, number, number, number];

/** The current per-row selection the dialog tracks. */
export interface PackSelection {
  packCount: number;
  sizeIndex: number;
}

export type PackValidation = { ok: true; entries: PackEntry[] } | { ok: false; message: string };

/**
 * `BigPackDialog.submit`: build the payToPack payload and validate it the way the original does —
 * every row's resource need must be affordable, the total 铜钱 must be covered, and at least one
 * pack must be ordered. `resCounts`/`copper` are the resource amounts and 铜钱 the dialog holds.
 */
export function validatePack(
  rows: PackRow[],
  selections: PackSelection[],
  resCounts: number[],
  copper: number,
): PackValidation {
  const entries: PackEntry[] = [];
  let totalCopper = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const sel = selections[i] ?? { packCount: 0, sizeIndex: 0 };
    const { resNeed, copperNeed } = packNeed(row, sel.sizeIndex, sel.packCount);
    if (resNeed > (resCounts[i] ?? 0)) {
      return { ok: false, message: i18n('Big_pack_dialog_tile_1') };
    }
    entries.push([`${row.resname}${sel.sizeIndex + 1}`, sel.packCount, resNeed, copperNeed]);
    totalCopper += copperNeed;
  }
  if (copper < totalCopper) return { ok: false, message: i18n('Big_pack_dialog_tile_2') };
  if (totalCopper === 0) return { ok: false, message: i18n('Big_pack_dialog_tile_3') };
  return { ok: true, entries };
}
