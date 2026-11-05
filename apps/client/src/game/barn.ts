/**
 * Barn.BarnCommandDialog: the pure logic of the 粮仓/马厩 command dialog, with four tabs —
 * 驯服 (initHoles), 强化 (doStrong with is_zuoji = 1), 镶嵌 (doEmbed / doUnlade of 马装) and
 * 升级 (doUpgradeArmor).
 */

import { i18n } from '../i18n';
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

/** 伯乐符 / 师皇针 / 灵通甘草 / 高级灵通甘草 of the 强化 tab. */
export const GOODS_BOLE = 212;
export const GOODS_SHIHUANG = 213;
export const GOODS_LINGTONG = 214;
export const GOODS_HIGH_LINGTONG = 11171;

/**
 * `BarnCommandDialog.doStrong`: what strengthening a mount at its level means before sending —
 * a blocking alert, a confirm (from level 3 a failure may drop it), or nothing.
 */
export function horseStrongCheck(
  row: Row | null,
  stone: number,
  highStone: number,
): { block: string } | { confirm: string } | null {
  if (!row || int(row.sid) === 0) return { block: i18n('Barn_NoHorse') };
  const level = int(row.strong_level);
  if (level >= 15) return { block: i18n('Barn_Remind_3') };
  if (level <= 9 && stone <= 0) return { block: i18n('Barn_NoStrongGoods') };
  if (level >= 10 && highStone <= 0) return { block: i18n('Barn_NoHighStrongGoods') };
  if (level >= 6) return { confirm: i18n('Barn_Remind_2').replace('%d', String(level + 1)) };
  if (level >= 3) return { confirm: i18n('Barn_Remind_1').replace('%d', String(level + 1)) };
  return null;
}

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
 * `BarnCommandDialog.selectEmbedZuoji`: what clicking hole `pos` means — unlade an embedded
 * 马装, pick one for an open hole, or nothing on a sealed hole.
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
