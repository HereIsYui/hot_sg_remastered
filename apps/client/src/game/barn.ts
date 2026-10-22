/**
 * Barn.BarnCommandDialog: the pure logic of the 粮仓/马厩 command dialog. The original has four
 * tabs — 激活(active) / 强化(strong) / 镶嵌(embed) / 升级(upgrade). Only the 镶嵌 tab's unembed
 * path (`loadZuojiArmor` + `doUnlade`) and the goods list (`loadBarnGoods`) have ported server
 * commands; the strengthen / activate / upgrade / embed-insert actions are not ported and show a
 * not-yet-open notice.
 */

import { parseEmbedHoles, parseEmbedPearls } from './blacksmith';

type Row = Record<string, unknown>;
const int = (v: unknown) => parseInt(String(v), 10) || 0;

/** `BarnCommandDialog` tab button indices (`showTab`). */
export const BARN_TABS = {
  Active: 2,
  Strong: 0,
  Embed: 1,
  Upgrade: 3,
} as const;

/** The tabs whose server commands are ported. Only 镶嵌 can act (unlade); the rest are notices. */
export const BARN_PORTED_TABS = new Set<number>([BARN_TABS.Embed]);

/** The 坐骑装备 type the embed picker filters by (loadZuojiArmor's first arg). */
export const ZUOJI_ARMOR_TYPE = 1;

/** The five embed-hole button positions (`embedArmorPearlN` x/y), hole order 0..4. */
export const EMBED_HOLE_POS: readonly { x: number; y: number }[] = [
  { x: 32, y: 154 },
  { x: 63, y: 59 },
  { x: 176, y: 22 },
  { x: 288, y: 59 },
  { x: 319, y: 154 },
];

/** One parsed zuoji armor the embed picker lists / embeds into. */
export interface ZuojiArmor {
  sid: number;
  gid: number;
  image: string;
  holes: number[];
  pearls: number[];
  row: Row;
}

/** `BarnCommandDialog.setArmor` / `set5EmbedPearls`: parse an armor row's holes and pearls. */
export function parseZuojiArmor(row: Row): ZuojiArmor {
  const image = int(row.image) > 0 ? String(row.image) : String(row.id ?? row.armorid ?? '');
  return {
    sid: int(row.sid),
    gid: int(row.gid ?? row.armorid),
    image: `images/armor/${image}.png`,
    holes: parseEmbedHoles(row.embed_holes),
    pearls: parseEmbedPearls(row.embed_pearls),
    row,
  };
}

/** `BarnCommandDialog.parseEmbedPearls`: the pearl gids of each hole, 0 when empty. */
export function barnHolePearls(armor: ZuojiArmor | null): number[] {
  return armor ? armor.pearls : [0, 0, 0, 0, 0];
}

/**
 * `BarnCommandDialog.selectEmbedZuoji`: what clicking hole `pos` means — unlade an embedded pearl
 * (the only ported action), embed into an open hole (not ported), or nothing on a sealed hole.
 */
export function holeAction(
  armor: ZuojiArmor | null,
  pos: number,
): { kind: 'unlade'; gid: number } | { kind: 'embed' } | { kind: 'none' } {
  if (!armor) return { kind: 'none' };
  const pearl = armor.pearls[pos] ?? 0;
  if (pearl !== 0) return { kind: 'unlade', gid: pearl };
  // An open hole (code 0) would embed; a sealed/locked hole does nothing here.
  if ((armor.holes[pos] ?? 3) === 0) return { kind: 'embed' };
  return { kind: 'none' };
}
