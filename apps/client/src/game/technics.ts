import { i18n } from '../i18n';
import type { ResourceTip, ResourceTipRow } from '../ui/tooltip';
import { duration, type CityAmounts } from './buildings';

type Row = Record<string, unknown>;

/** `Define.TECHNIC_MAX_LEVEL`. */
export const TECHNIC_MAX_LEVEL = 10;

/** `UpgradeCondition` of a technic level (TechnicFunc.php). */
export interface TechnicCondition {
  type: string;
  upgradeNeed: string;
  currentOwn: string;
  canUpgrade: boolean;
}

/** `TechnicState` (doGetTechnicInfo): a technic, its research state and the next level's cost. */
export interface TechnicState {
  tid: number;
  tname: string;
  /** The city researching it (0 when idle). */
  cid: number;
  description: string;
  levelDescription: string;
  nextLevelDescription: string;
  /** The player's level. */
  level: number;
  /** The level this city's 书院 lets it use. */
  sharelevel: number;
  /** 1 while researching. */
  state: number;
  state_endtime: number;
  can_upgrade: boolean;
  woodNeed: number;
  rockNeed: number;
  ironNeed: number;
  foodNeed: number;
  goldNeed: number;
  upgrade_time: number;
  conditions: TechnicCondition[];
}

export interface TechnicInfo {
  technics: TechnicState[];
  /** 书院 the player owns in all cities. */
  collegeCount: number;
}

const num = (v: unknown) => Number(v) || 0;
const int = (v: unknown) => parseInt(String(v), 10) || 0;
const bool = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
const str = (v: unknown) => (v == null || v === false ? '' : String(v));
const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

function parseTechnic(r: Row): TechnicState {
  return {
    tid: int(r.tid),
    tname: str(r.tname),
    cid: int(r.cid),
    description: str(r.description),
    levelDescription: str(r.levelDescription),
    nextLevelDescription: str(r.nextLevelDescription),
    level: int(r.level),
    sharelevel: int(r.sharelevel),
    state: int(r.state),
    state_endtime: int(r.state_endtime),
    can_upgrade: bool(r.can_upgrade),
    woodNeed: num(r.woodNeed),
    rockNeed: num(r.rockNeed),
    ironNeed: num(r.ironNeed),
    foodNeed: num(r.foodNeed),
    goldNeed: num(r.goldNeed),
    upgrade_time: int(r.upgrade_time),
    conditions: Array.isArray(r.conditions)
      ? r.conditions.filter(isRow).map((c) => ({
          type: str(c.type),
          upgradeNeed: str(c.upgradeNeed),
          currentOwn: str(c.currentOwn),
          canUpgrade: bool(c.canUpgrade),
        }))
      : [],
  };
}

/** The `[technics, collegeCount]` a 书院 reply carries after its two building levels. */
export function parseTechnicInfo(v: unknown): TechnicInfo | null {
  if (!Array.isArray(v) || !Array.isArray(v[0])) return null;
  return { technics: v[0].filter(isRow).map(parseTechnic), collegeCount: int(v[1]) };
}

/** `CollegeTechnicItem.createUpgradeTip`: null at the top level. */
export function technicTip(t: TechnicState, city: CityAmounts): ResourceTip | null {
  if (t.level >= TECHNIC_MAX_LEVEL) return null;
  const s = (n: number) => i18n(`College_CollegeTechnicItemSrc_${n}`);
  const rows: ResourceTipRow[] = t.conditions.map((c) => ({
    type: c.type,
    need: c.upgradeNeed,
    current: c.currentOwn,
    ok: c.canUpgrade,
  }));
  const costs: [number, number, number][] = [
    [t.foodNeed, city.food, 14],
    [t.woodNeed, city.wood, 15],
    [t.rockNeed, city.rock, 16],
    [t.ironNeed, city.iron, 17],
    [t.goldNeed, city.gold, 18],
  ];
  for (const [need, have, n] of costs) {
    if (need > 0)
      rows.push({ type: s(n), need: String(need), current: String(have), ok: have >= need });
  }
  return {
    title: `${s(8)}${t.tname}${s(9)}${t.level + 1})`,
    description: t.nextLevelDescription,
    headers: { type: s(10), need: s(11), current: s(12), time: s(13) },
    time: duration(t.upgrade_time),
    rows,
  };
}
