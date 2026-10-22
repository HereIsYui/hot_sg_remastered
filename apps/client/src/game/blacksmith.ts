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

/** The 强化/镶嵌/合成/技能书 tabs are ported; the rest show a not-yet-open notice. */
export const PORTED_TABS = new Set<number>([
  BLACKSMITH_TABS.Strong,
  BLACKSMITH_TABS.Embed,
  BLACKSMITH_TABS.PearlUpgrade,
  BLACKSMITH_TABS.SkillBook,
]);

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
