import { i18n } from '../i18n';
import type { ResourceTip } from '../ui/tooltip';
import { duration, type CityAmounts } from './buildings';
import { costRows, parseConditions, refundRows } from './soldiers';
import type { TechnicCondition } from './technics';

type Row = Record<string, unknown>;

/** `WallDefenceState` (doGetDefenceInfo): a defence type of the 城墙. */
export interface WallDefenceState {
  did: number;
  dname: string;
  /** Defences of this type in the city. */
  count: number;
  description: string;
  hp: number;
  ap: number;
  dp: number;
  range: number;
  speed: number;
  carry: number;
  can_reinforce: boolean;
  woodNeed: number;
  rockNeed: number;
  ironNeed: number;
  foodNeed: number;
  goldNeed: number;
  /** Wall space per defence. */
  areaNeed: number;
  /** Seconds per defence. */
  reinforce_time: number;
  conditions: TechnicCondition[];
}

/** `WallReinforceState` (doGetReinforceQueue): an entry of the 城墙's queue. */
export interface WallReinforceState {
  qid: number;
  did: number;
  dname: string;
  count: number;
  /** 1 while building, 0 while waiting. */
  state: number;
  /** Seconds left when the reply was built (the whole duration while waiting). */
  time_left: number;
  /** 1 once sped up by 备城门. */
  accmark: number;
}

/** What a 城墙 reply carries after its two building levels. */
export interface WallInfo {
  defences: WallDefenceState[];
  queue: WallReinforceState[];
  /** The wall's capacity and what built and queued defences take of it. */
  area: number;
  areaUsed: number;
}

const num = (v: unknown) => Number(v) || 0;
const int = (v: unknown) => parseInt(String(v), 10) || 0;
const bool = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
const str = (v: unknown) => (v == null || v === false ? '' : String(v));
const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

function parseDefence(r: Row): WallDefenceState {
  return {
    did: int(r.did),
    dname: str(r.dname),
    count: int(r.count),
    description: str(r.description),
    hp: num(r.hp),
    ap: num(r.ap),
    dp: num(r.dp),
    range: num(r.range),
    speed: num(r.speed),
    carry: num(r.carry),
    can_reinforce: bool(r.can_reinforce),
    woodNeed: num(r.woodNeed),
    rockNeed: num(r.rockNeed),
    ironNeed: num(r.ironNeed),
    foodNeed: num(r.foodNeed),
    goldNeed: num(r.goldNeed),
    areaNeed: num(r.areaNeed),
    reinforce_time: num(r.reinforce_time),
    conditions: parseConditions(r.conditions),
  };
}

function parseReinforce(r: Row): WallReinforceState {
  return {
    qid: int(r.qid),
    did: int(r.did),
    dname: str(r.dname),
    count: int(r.count),
    state: int(r.state),
    time_left: int(r.time_left),
    accmark: int(r.accmark),
  };
}

/** `[defences, queue, area, used]`, the reply elements after the two building levels. */
export function parseWallInfo(extra: unknown[]): WallInfo | null {
  const [defences, queue, area, used] = extra;
  if (!Array.isArray(defences) || !Array.isArray(queue)) return null;
  return {
    defences: defences.filter(isRow).map(parseDefence),
    queue: queue.filter(isRow).map(parseReinforce),
    area: int(area),
    areaUsed: int(used),
  };
}

/** `WallReinforceDialog.getMaxReinforceCount`: limited by population and the five resources. */
export function maxReinforceCount(d: WallDefenceState, city: CityAmounts): number {
  let max = city.people_all;
  const costs: [number, number][] = [
    [d.goldNeed, city.gold],
    [d.foodNeed, city.food],
    [d.woodNeed, city.wood],
    [d.rockNeed, city.rock],
    [d.ironNeed, city.iron],
  ];
  for (const [need, have] of costs) {
    if (need > 0) max = Math.min(max, Math.floor(have / need));
  }
  return Math.trunc(max);
}

const src = (n: number) => i18n(`Wall_WallDefenceItemSrc_${n}`);

/** `WallDefenceItem.createReinforceTip`. */
export function reinforceTip(d: WallDefenceState, city: CityAmounts): ResourceTip {
  return {
    title: src(1) + d.dname,
    description: d.description,
    time: duration(d.reinforce_time),
    rows: costRows(d, city, src),
  };
}

/** `WallDefenceItem.createDissolveTip`. */
export function dissolveDefenceTip(d: WallDefenceState, city: CityAmounts): ResourceTip {
  return {
    title: src(7) + d.dname,
    description: src(8),
    headers: { type: src(9), need: src(10), current: src(11), time: src(12) },
    time: null,
    rows: refundRows(d, city, src),
  };
}

/** `WallDefenceItem.createDefenceTip`: the name, description and stats. */
export function defenceTip(d: WallDefenceState): string {
  const stats = [d.hp, d.ap, d.dp, d.range, d.areaNeed];
  return `${d.dname}\n${d.description}\n${stats.map((v, i) => src(18 + i) + v).join('')}`;
}
