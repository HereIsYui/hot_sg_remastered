import { i18n } from '../i18n';
import type { ResourceTip, ResourceTipRow } from '../ui/tooltip';
import { duration, type CityAmounts } from './buildings';
import type { TechnicCondition } from './technics';

type Row = Record<string, unknown>;

/** `ArmySoldierState` (doGetSoldierInfo / changeSoldierInfo): a soldier type of the 兵营. */
export interface ArmySoldierState {
  sid: number;
  sname: string;
  /** Soldiers of this type in the city. */
  count: number;
  description: string;
  hp: number;
  ap: number;
  dp: number;
  range: number;
  speed: number;
  carry: number;
  can_draft: boolean;
  food_use: number;
  woodNeed: number;
  rockNeed: number;
  ironNeed: number;
  foodNeed: number;
  goldNeed: number;
  peopleNeed: number;
  /** Seconds per soldier. */
  draft_time: number;
  conditions: TechnicCondition[];
}

/** `ArmyDraftState` (doGetDraftQueue): an entry of the 兵营's queue. */
export interface ArmyDraftState {
  qid: number;
  sid: number;
  sname: string;
  count: number;
  /** 1 while training, 0 while waiting. */
  state: number;
  /** Seconds left when the reply was built (the whole duration while waiting). */
  time_left: number;
  /** 1 once sped up by 韩信三篇下部. */
  accmark: number;
}

/** What a 兵营 reply carries after its two building levels. */
export interface ArmyInfo {
  soldiers: ArmySoldierState[];
  queue: ArmyDraftState[];
  /** sys_soldier_convert: the day's allowance and what was converted of it. */
  convert: { value: number; convert: number };
}

const num = (v: unknown) => Number(v) || 0;
const int = (v: unknown) => parseInt(String(v), 10) || 0;
const bool = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
const str = (v: unknown) => (v == null || v === false ? '' : String(v));
const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

export function parseSoldier(r: Row): ArmySoldierState {
  return {
    sid: int(r.sid),
    sname: str(r.sname),
    count: int(r.count),
    description: str(r.description),
    hp: num(r.hp),
    ap: num(r.ap),
    dp: num(r.dp),
    range: num(r.range),
    speed: num(r.speed),
    carry: num(r.carry),
    can_draft: bool(r.can_draft),
    food_use: num(r.food_use),
    woodNeed: num(r.woodNeed),
    rockNeed: num(r.rockNeed),
    ironNeed: num(r.ironNeed),
    foodNeed: num(r.foodNeed),
    goldNeed: num(r.goldNeed),
    peopleNeed: num(r.peopleNeed),
    draft_time: num(r.draft_time),
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

function parseDraft(r: Row): ArmyDraftState {
  return {
    qid: int(r.qid),
    sid: int(r.sid),
    sname: str(r.sname),
    count: int(r.count),
    state: int(r.state),
    time_left: int(r.time_left),
    accmark: int(r.accmark),
  };
}

/** `[soldiers, queue, [convert, ratios]]`, the reply elements after the two building levels. */
export function parseArmyInfo(extra: unknown[]): ArmyInfo | null {
  const [soldiers, queue, convert] = extra;
  if (!Array.isArray(soldiers) || !Array.isArray(queue)) return null;
  const allowance = Array.isArray(convert) ? convert[0] : null;
  return {
    soldiers: soldiers.filter(isRow).map(parseSoldier),
    queue: queue.filter(isRow).map(parseDraft),
    convert: isRow(allowance)
      ? { value: int(allowance.value), convert: int(allowance.convert) }
      : { value: 0, convert: 0 },
  };
}

/** City amounts the draft dialog also needs. */
export interface DraftCity extends CityAmounts {
  people_free: number;
}

/**
 * `ArmyDraftDialog.getMaxDraftCount`: limited by population, food, wood, rock, iron and free
 * people; the original leaves gold out.
 */
export function maxDraftCount(s: ArmySoldierState, city: DraftCity): number {
  let max = city.people_all;
  const costs: [number, number][] = [
    [s.foodNeed, city.food],
    [s.woodNeed, city.wood],
    [s.rockNeed, city.rock],
    [s.ironNeed, city.iron],
  ];
  for (const [need, have] of costs) {
    if (need > 0) max = Math.min(max, Math.floor(have / need));
  }
  return Math.trunc(Math.max(0, Math.min(max, Math.floor(city.people_free / s.peopleNeed))));
}

/** `ArmySoldierItem.createDraftTip`. */
export function draftTip(s: ArmySoldierState, city: CityAmounts): ResourceTip {
  const src = (n: number) => i18n(`Army_ArmySoldierItemSrc_${n}`);
  const rows: ResourceTipRow[] = s.conditions.map((c) => ({
    type: c.type,
    need: c.upgradeNeed,
    current: c.currentOwn,
    ok: c.canUpgrade,
  }));
  const costs: [number, number, number][] = [
    [s.foodNeed, city.food, 2],
    [s.woodNeed, city.wood, 3],
    [s.rockNeed, city.rock, 4],
    [s.ironNeed, city.iron, 5],
    [s.goldNeed, city.gold, 6],
  ];
  for (const [need, have, n] of costs) {
    if (need > 0) {
      rows.push({ type: src(n), need: String(need), current: String(have), ok: have >= need });
    }
  }
  return {
    title: src(1) + s.sname,
    description: s.description,
    time: duration(s.draft_time),
    rows,
  };
}

/**
 * `ArmySoldierItem.createDissolveTip`: a third of each cost back. The original only checks the
 * food cost before the food, wood, rock and iron lines.
 */
export function dissolveTip(s: ArmySoldierState, city: CityAmounts): ResourceTip {
  const src = (n: number) => i18n(`Army_ArmySoldierItemSrc_${n}`);
  const rows: ResourceTipRow[] = [];
  const refunds: [number, number, number, number][] = [
    [s.foodNeed, s.foodNeed, city.food, 13],
    [s.foodNeed, s.woodNeed, city.wood, 14],
    [s.foodNeed, s.rockNeed, city.rock, 15],
    [s.foodNeed, s.ironNeed, city.iron, 16],
    [s.goldNeed, s.goldNeed, city.gold, 17],
  ];
  for (const [check, need, have, n] of refunds) {
    if (check > 0) {
      rows.push({
        type: src(n),
        need: String(Math.trunc(need / 3)),
        current: String(have),
        ok: true,
      });
    }
  }
  return {
    title: src(7) + s.sname,
    description: src(8),
    headers: { type: src(9), need: src(10), current: src(11), time: src(12) },
    time: null,
    rows,
  };
}

/** `ArmySoldierItem.createSoldierTip`: the name, description and stats. */
export function soldierTip(s: ArmySoldierState): string {
  const src = (n: number) => i18n(`Army_ArmySoldierItemSrc_${n}`);
  const stats = [s.hp, s.ap, s.dp, s.range, s.speed, s.carry, s.food_use, s.peopleNeed];
  return `${s.sname}\n${s.description}\n${stats.map((v, i) => src(18 + i) + v).join('')}`;
}

/** One line of the draft / dissolve dialogs' resource grids. */
export interface ResourceLine {
  condition: string;
  countNeed: number;
  countCurrent: number;
}

/**
 * `resetCondition` of the draft and dissolve dialogs: gold, food, wood, rock and iron, labelled
 * `key(1..5)`, with `amount` of each unit cost.
 */
export function resourceLines(
  s: ArmySoldierState,
  city: CityAmounts,
  key: (n: number) => string,
  amount: (need: number) => number,
): ResourceLine[] {
  const lines: [number, number, number][] = [
    [s.goldNeed, city.gold, 1],
    [s.foodNeed, city.food, 2],
    [s.woodNeed, city.wood, 3],
    [s.rockNeed, city.rock, 4],
    [s.ironNeed, city.iron, 5],
  ];
  return lines
    .filter(([need]) => need > 0)
    .map(([need, have, n]) => ({
      condition: key(n),
      countNeed: amount(need),
      countCurrent: Math.round(have),
    }));
}
