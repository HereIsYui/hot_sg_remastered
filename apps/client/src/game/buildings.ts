import { timeLeftText } from '../core/clock';
import { i18n } from '../i18n';
import type { ResourceTip, ResourceTipRow } from '../ui/tooltip';
import { BUILDING_GOVERNMENT } from './cityGrid';

type Row = Record<string, unknown>;

/** `Define.GAME_SPEED_RATE`. */
const GAME_SPEED_RATE = 1;

/** Buildings that reach level 15 once the king is level 4. */
const KING_LEVEL_BUILDINGS = [8, 15, 20];

/** `UpgradeCondition` (BuildingFunc.php): a building, technic or item a level depends on. */
export interface UpgradeCondition {
  type: string;
  upgradeNeed: string;
  currentOwn: string;
  canUpgrade: boolean;
  /** 0 building, 1 technic, 2 item. */
  pre_type: number;
  pre_id: number;
  pre_level: number;
}

/** `BuildingInfo` (doGetSimpleBuildingInfo): one level of a building and what it costs. */
export interface BuildingInfo {
  bid: number;
  name: string;
  description: string;
  levelDescription: string;
  level: number;
  woodNeed: number;
  rockNeed: number;
  ironNeed: number;
  foodNeed: number;
  goldNeed: number;
  peopleNeed: number;
  upgradeTime: number;
  canUpgrade: boolean;
  conditions: UpgradeCondition[];
}

/** The city amounts the tips compare against (`City.people_all`, `City.food`, ...). */
export interface CityAmounts {
  people_all: number;
  food: number;
  wood: number;
  rock: number;
  iron: number;
  gold: number;
}

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const bool = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
const str = (v: unknown) => (v == null ? '' : String(v));

function parseCondition(r: Row): UpgradeCondition {
  return {
    type: str(r.type),
    upgradeNeed: str(r.upgradeNeed),
    currentOwn: str(r.currentOwn),
    canUpgrade: bool(r.canUpgrade),
    pre_type: int(r.pre_type),
    pre_id: int(r.pre_id),
    pre_level: int(r.pre_level),
  };
}

export function parseBuildingInfo(v: unknown): BuildingInfo | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Row;
  return {
    bid: int(r.bid),
    name: str(r.name),
    description: str(r.description),
    levelDescription: str(r.levelDescription),
    level: int(r.level),
    woodNeed: int(r.woodNeed),
    rockNeed: int(r.rockNeed),
    ironNeed: int(r.ironNeed),
    foodNeed: int(r.foodNeed),
    goldNeed: int(r.goldNeed),
    peopleNeed: int(r.peopleNeed),
    upgradeTime: int(r.upgradeTime),
    canUpgrade: bool(r.canUpgrade),
    conditions: Array.isArray(r.conditions)
      ? (r.conditions as unknown[])
          .filter((c): c is Row => !!c && typeof c === 'object')
          .map(parseCondition)
      : [],
  };
}

/** `UpgradeBuildingItem.getMaxLevel`. */
export function maxBuildingLevel(bid: number, cityType: number, kingLevel: number): number {
  if (bid < 5) return [12, 12, 15, 18, 20, 15][cityType] ?? 12;
  if (KING_LEVEL_BUILDINGS.includes(bid) && kingLevel >= 4) return 15;
  return cityType === 5 ? 15 : 10;
}

/** `ResourceRelatedToolTip.setUpgradeTime`: the duration goes through an int. */
export function duration(seconds: number): string {
  return timeLeftText(Math.trunc(Math.trunc(seconds) / GAME_SPEED_RATE), i18n);
}

/** The conditions from the server, then people and the five resources that are needed. */
function costRows(info: BuildingInfo, city: CityAmounts, key: (n: number) => string, gold: number) {
  const rows: ResourceTipRow[] = info.conditions.map((c) => ({
    type: c.type,
    need: c.upgradeNeed,
    current: c.currentOwn,
    ok: c.canUpgrade,
  }));
  const costs: [number, number, number][] = [
    [info.peopleNeed, city.people_all, 0],
    [info.foodNeed, city.food, 1],
    [info.woodNeed, city.wood, 2],
    [info.rockNeed, city.rock, 3],
    [info.ironNeed, city.iron, 4],
    [info.goldNeed, gold, 5],
  ];
  for (const [need, have, n] of costs) {
    if (need > 0)
      rows.push({ type: key(n), need: String(need), current: String(have), ok: have >= need });
  }
  return rows;
}

/** `CreateBuildingItem.showCreateBuildingTip`. */
export function createBuildingTip(info: BuildingInfo, city: CityAmounts): ResourceTip | null {
  if (info.bid === 0) return null;
  return {
    title: `${i18n('Building_CreateBuildingItemSrc_1')}${info.name}${i18n('Building_CreateBuildingItemSrc_2')}`,
    description: info.levelDescription,
    time: duration(info.upgradeTime),
    rows: costRows(
      info,
      city,
      (n) => i18n(`Building_CreateBuildingItemSrc_${n + 3}`),
      Math.round(city.gold),
    ),
  };
}

/** `UpgradeBuildingItem.createUpgradeTip`: a plain text when no further level is possible. */
export function upgradeBuildingTip(
  current: BuildingInfo | null,
  next: BuildingInfo | null,
  maxLevel: number,
  city: CityAmounts,
): ResourceTip | string | null {
  if (!current) return null;
  if (current.level >= maxLevel) return i18n('Building_UpgradeBuildingItem_2_1');
  if (current.bid === BUILDING_GOVERNMENT && current.level >= 10) {
    return i18n('Building_UpgradeBuildingItem_6_1');
  }
  if (!next) return null;
  return {
    title: `${i18n('Building_UpgradeBuildingItemSrc_22')}${next.name}${i18n('Building_UpgradeBuildingItemSrc_23')}${next.level})`,
    description: next.levelDescription,
    time: duration(next.upgradeTime),
    rows: costRows(next, city, (n) => i18n(`Building_UpgradeBuildingItemSrc_${n + 24}`), city.gold),
  };
}

/** `UpgradeBuildingItem.createDestroyTip`: a third of the current level's cost comes back. */
export function destroyBuildingTip(
  current: BuildingInfo | null,
  city: CityAmounts,
): ResourceTip | null {
  if (!current) return null;
  const t = (n: number) => i18n(`Building_UpgradeBuildingItemSrc_${n}`);
  const rows: ResourceTipRow[] = [];
  for (const c of current.conditions) {
    if (c.pre_type === 2 && c.pre_id !== 40) {
      const need = c.upgradeNeed.replace(String(c.pre_level), String(Math.floor(c.pre_level / 3)));
      rows.push({ type: t(43), need, current: c.currentOwn, ok: true });
    }
  }
  const third = (n: number) => String(Math.trunc(n / 3));
  // The original guards wood, rock and iron with the food cost as well.
  if (current.foodNeed > 0) {
    rows.push({ type: t(38), need: third(current.foodNeed), current: String(city.food), ok: true });
    rows.push({ type: t(39), need: third(current.woodNeed), current: String(city.wood), ok: true });
    rows.push({ type: t(40), need: third(current.rockNeed), current: String(city.rock), ok: true });
    rows.push({ type: t(41), need: third(current.ironNeed), current: String(city.iron), ok: true });
  }
  if (current.goldNeed > 0) {
    rows.push({ type: t(42), need: third(current.goldNeed), current: String(city.gold), ok: true });
  }
  return {
    title: current.level <= 1 ? t(30) : `${t(31)}${current.name}${t(32)}${current.level - 1})`,
    description: t(33),
    headers: { type: t(34), need: t(35), current: t(36), time: t(37) },
    time: duration(current.upgradeTime / 2),
    rows,
  };
}
