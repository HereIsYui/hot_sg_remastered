import { i18n } from '../i18n';

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;

/** `BSCommandDialog` tabs, by their button index. */
export const BLACKSMITH_TABS = {
  Xilian: 0,
  Strong: 1,
  Embed: 2,
  PearlUpgrade: 3,
  SkillBook: 4,
  Fusion: 5,
  UpgradeArmor: 6,
} as const;

/** 坐骑 part id; the smithy handles only gear. */
export const PART_HORSE = 12;

/** `xilianChoose`: the three 洗练 stones by index, and how many one use spends. */
export const XILIAN_GOODS: readonly {
  gid: number;
  label: string;
  count: (type: number) => number;
}[] = [
  { gid: 12079, label: 'xilian_goods_zhurong', count: () => 1 },
  { gid: 12080, label: 'xilian_goods_qingxi', count: () => 1 },
  { gid: 12081, label: 'xilian_goods_xilian', count: (type) => xilianStoneCount(type) },
];

/** `useXilian`: 洗练符 per re-roll by colour (0 when the colour cannot be re-rolled). */
export function xilianStoneCount(type: number): number {
  if (type >= 1 && type <= 3) return 1;
  return ({ 4: 2, 5: 3, 6: 4 } as Record<number, number>)[type] ?? 0;
}

/**
 * `useZhurong` / `useQingxi` / `useXilian` guards: the alert that blocks using stone `index`
 * with `count` owned on a piece whose 极品 attribute is `best`, or null. The original never
 * checks the 洗练符 count (its test is inverted); the server's buy popup covers it.
 */
export function xilianBlockReason(index: number, count: number, best: string): string | null {
  const has = best !== '';
  if (index === 0) {
    if (count <= 0) return i18n('xilian_lack_zhurong');
    if (has) return i18n('xilian_exist');
  } else if (index === 1) {
    if (count <= 0) return i18n('xilian_lack_qingxi');
    if (!has) return i18n('xilian_not_exist');
  } else if (!has) {
    return i18n('xilian_not_exist');
  }
  return null;
}

/** 熔炼保护符, shown in the 熔炼 tab from loadEquitmentInfor. */
export const GOODS_FUSION_PROTECT = 10778;

/**
 * `ArmorItem.menuHandler`: why a listed piece cannot go into a 熔炼 slot — the slot is taken, or
 * it differs in piece / combine level from those already chosen — as an i18n key, or null.
 */
export function fusionSlotError(chosen: Row[], slotFilled: boolean, row: Row): string | null {
  if (slotFilled) return 'BlackSmith_FusionArmorHasExist';
  const first = chosen[0];
  if (
    first &&
    (int(first.armorid) !== int(row.armorid) || int(first.combine_level) !== int(row.combine_level))
  ) {
    return 'BlackSmith_FusionArmorNotUnify_1';
  }
  return null;
}

/** `doFusion`: the three slots must be filled with the same piece; an i18n key, or null. */
export function fusionSubmitError(slots: readonly (Row | null)[]): string | null {
  if (slots.some((s) => !s)) return 'BlackSmith_FusionArmorNotFull';
  if (new Set(slots.map((s) => int(s!.armorid))).size > 1) return 'BlackSmith_FusionArmorNotUnify';
  return null;
}

/** 升级保护符. */
export const GOODS_UPGRADE_PROTECT = 12157;

/** `setUpgradeArmorMater`: the [set material, 龙骨玉] an upgradable set needs, else null. */
export function upgradeMaterials(tieid: number): [number, number] | null {
  const own = ({ 11002: 12159, 12003: 12160, 10008: 12161 } as Record<number, number>)[tieid];
  return own ? [own, 12158] : null;
}

/** `parsePropGood`: the `gid,count,gid,count,...` left-over string of doUpgradeArmor. */
export function parseGoodsCounts(s: unknown): Map<number, number> {
  const out = new Map<number, number>();
  const parts = (s == null ? '' : String(s)).split(',');
  for (let i = 0; i + 1 < parts.length; i += 2) out.set(int(parts[i]), int(parts[i + 1]));
  return out;
}

/**
 * `BSCommandDialog.parseEmbedHoles`: an `embed_holes` string into five hole codes.
 * 0 open, 1 初级打孔器, 2 高级打孔器, 3 no hole, 4 特级金刚钻.
 */
export function parseEmbedHoles(holes: unknown): number[] {
  const s = holes == null ? '' : String(holes);
  if (s === '') return [3, 3, 3, 3, 3];
  return s.split(',').map((h) => int(h));
}

/** `BSCommandDialog.parseEmbedPearls`: five pearl gids, 0 for an empty hole. */
export function parseEmbedPearls(pearls: unknown): number[] {
  const out = [0, 0, 0, 0, 0];
  const s = pearls == null ? '' : String(pearls);
  if (s === '') return out;
  const parts = s.split(',');
  for (let i = 0; i < 5 && i < parts.length; i++) out[i] = int(parts[i]);
  return out;
}

/**
 * `BSCommandDialog.getNeedCount`: the 化石粉 needed to clear a pearl out of its hole, by its gid.
 */
export function dismantleNeedCount(gid: number): number {
  if (gid >= 300 && gid <= 379) {
    return [1, 2, 3, 4, 6, 8, 10, 14, 20, 60][(gid % 10) + 1 - 1] ?? 1;
  }
  if (gid >= 17500 && gid <= 17539) {
    return [120, 240, 500, 1000, 2000][(gid % 5) + 11 - 11] ?? 1;
  }
  if (gid >= 10830 && gid <= 10839) {
    return [15, 30, 60, 120, 240, 500, 1000, 2000, 4000, 8000][(gid % 10) + 1 - 1] ?? 1;
  }
  return 1;
}

/**
 * `BSCommandDialog.doStrong` guards: the client refuses a strengthen before it sends. Returns the
 * i18n key of the blocking reason, or null when the strengthen may proceed.
 */
export function strongBlockReason(
  armor: Row | null,
  strongPearl: number,
  highStrongPearl: number,
): string | null {
  if (!armor || int(armor.sid) === 0) return 'BlackSmith_NoArmor';
  const level = int(armor.strong_level);
  if (level >= 15) return 'BlackSmith_Remind_3';
  if (level <= 9 && strongPearl <= 0) return 'BlackSmith_NoStrongPearl';
  if (level >= 10 && highStrongPearl <= 0) return 'BlackSmith_NoHighStrongPearl';
  if (
    int(armor.part) !== PART_HORSE &&
    int(armor.type) === 4 &&
    level >= 10 &&
    int(armor.combine_level) <= 2
  ) {
    return 'BlackSmith_BlueStrongLimit';
  }
  return null;
}

/** `BSCommandDialog.couldSynthStuff`: a pearl can be synthesized when its predecessor is owned. */
export function couldSynthStuff(gid: number, lowerCount: number): boolean {
  if (gid % 10 > 0) return lowerCount > 0;
  return true;
}

/** `BSCommandDialog.parseStuffRecipe`: a `gid,count,gid,count,...` recipe into a map. */
export function parseStuffRecipe(recipe: unknown): Map<number, number> {
  const dict = new Map<number, number>();
  const parts = (recipe == null ? '' : String(recipe)).split(',');
  for (let i = 0; i + 1 < parts.length; i += 2) dict.set(int(parts[i]), int(parts[i + 1]));
  return dict;
}

/** `BSCommandDialog.parseBestQuality`: the 极品 tooltip `name属性+值%`, or '' when none. */
export function parseBestQuality(bestQuality: unknown): string {
  const s = bestQuality == null ? '' : String(bestQuality);
  if (s === '') return '';
  const p = s.split(',');
  // name + property name + "+" + value + "%"
  return `${p[3] ?? ''}${p[4] ?? ''}+${p[2] ?? ''}%`;
}

/** `BSCommandDialog.onCommand("doStrong")`: the alert for a strengthen result code. */
export function strongResultText(failure: number, extra: string): string {
  if (failure === 0) {
    const succ = i18n('BlackSmith_StrongSucc');
    return extra ? succ + extra : succ;
  }
  return i18n(`BlackSmith_StrongFailure${failure}`);
}

/** Three same-level books of a skill may merge into level+1 when below 10. */
export function canMergeBook(level: number, count: number): boolean {
  return level < 10 && count >= 3;
}
