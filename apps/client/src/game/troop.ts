import { i18n } from '../i18n';
import { cidToXY, makeCid } from './world';

/**
 * Pure parsing and the 出征 (campaign) / 军队 (troop) arithmetic of `Ground/CampaignDialog.as`,
 * `Troop/TroopDialog.as`, `Troop/TroopArmyPanel.as`, `Troop/TroopDetailDialog.as` and the matching
 * PHP (`GroundFunc.StartTroop/getTroopScheme/setTroopScheme`, `TroopFunc.*`,
 * `ExternService.getTroopMaxTime`). Everything here is side-effect free so it can be unit-tested
 * against PHP-shaped fixtures; the Vue dialogs keep only the layout and the command plumbing.
 */

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const num = (v: unknown) => Number(v) || 0;
const str = (v: unknown) => (v == null || v === false ? '' : String(v));
const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

/** `Define.GRID_DISTANCE`, `Define.GAME_SPEED_RATE`. */
export const GRID_DISTANCE = 100;
export const GAME_SPEED_RATE = 1;
/** 洛阳 fixed coordinate (`mTargetX == 265 && mTargetY == 215` -> cid 215265). */
export const LUOYANG_CID = 215265;

// ---- names (`TroopDialog.TASK_NAME_ARRAY`, `STATE_NAME_ARRAY`, `TARGET_WORLD_TYPE`) ----

/**
 * `Utils.MakeTimeLeftString`: the `HH:MM:SS` a countdown shows; negative or zero reads `00:00:00`.
 * Matches the original's hour / minute / second split with zero padding.
 */
export function makeTimeLeftString(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** `TroopDialog.TASK_NAME_ARRAY[task]` (0..9). Falls back to the 出征 task labels. */
export function taskName(task: number): string {
  const key = `Troop_TroopDialogSrc_${9 + task}`;
  const fallback = TASK_FALLBACK[task] ?? '';
  return i18n(key) || fallback;
}

/** `TroopDialog.STATE_NAME_ARRAY[state]` (0..5). */
export function troopStateName(state: number): string {
  const key = `Troop_TroopDialogSrc_${19 + state}`;
  const fallback = STATE_FALLBACK[state] ?? '';
  return i18n(key) || fallback;
}

/** `TroopDialog.TARGET_WORLD_TYPE[wtype]` (0..7): the terrain label of a troop's target. */
export function targetWorldTypeName(wtype: number): string {
  const key = `Troop_TroopDialogSrc_${1 + wtype}`;
  const fallback = TARGET_WORLD_FALLBACK[wtype] ?? '';
  return i18n(key) || fallback;
}

/** `CampaignDialog` task combo labels (`Ground_CampaignDialog_14..18`): 侦察/掠夺/占领/运输/派遣. */
export function campaignTaskName(index: number): string {
  return i18n(`Ground_CampaignDialog_${14 + index}`) || CAMPAIGN_TASK_FALLBACK[index] || '';
}

const TASK_FALLBACK = ['驻扎', '支援', '侦察', '掠夺', '占领', '运输', '', '派遣', '', ''];
const STATE_FALLBACK = ['前进', '返回', '驻扎', '战斗', '集结', '集结'];
const TARGET_WORLD_FALLBACK = ['城池', '平原', '树林', '石山', '湖泊', '沙漠', '火山', '沼泽'];
/** 出征 task options, in CampaignDialog order (combo index 0..4). */
export const CAMPAIGN_TASK_FALLBACK = ['侦察', '掠夺', '占领', '运输', '派遣'];
/** The server `task` id for each CampaignDialog combo index (侦察=2, 掠夺=3, 占领=4, 运输=5, 派遣=7). */
export const CAMPAIGN_TASK_SERVER_ID = [2, 3, 4, 5, 7];

// ---- getTroopScheme: the saved 出征方案 ----

export interface TroopScheme {
  type: number;
  /** `"n,sid,count,sid,count,..."`, as `setTroopScheme` stored it. */
  soldiers: string;
}

/** `CampaignDialog.onLoadTroopSchme`: `[schemeRow]`; empty when no scheme is saved for the slot. */
export function parseTroopScheme(data: unknown): TroopScheme | null {
  const arr = Array.isArray(data) ? (data as unknown[]) : [];
  const r = arr[0];
  if (!isRow(r)) return null;
  return { type: int(r.type), soldiers: str(r.soldiers) };
}

// ---- getArmyTroops / getEnemyTroops / getUnionTroops: a sys_troops row ----

/** One `sys_troops` row as the Troop panels model it (`TroopArmyPanel.onLoadData`). */
export interface TroopRow {
  id: number;
  uid: number;
  userid: number;
  cid: number;
  hid: number;
  targetcid: number;
  task: number;
  state: number;
  wtype: number;
  battleid: number;
  battlefieldid: number;
  endtime: number;
  starttime: number;
  pathtime: number;
  inBattleNet: number;
  inChibiNet: number;
  /** `sys_city.name` of the origin (`fromcity`). */
  fromcityName: string;
  /** Target name: a city name, or the 名城/野地 label. */
  targetcityName: string;
  username: string;
  /** Owner name shown in the enemy / union panels (`enemyuser` / `username`). */
  origincityName: string;
}

export function parseTroopRow(raw: unknown): TroopRow {
  const r = isRow(raw) ? raw : {};
  return {
    id: int(r.id),
    uid: int(r.uid),
    userid: int(r.userid ?? r.uid),
    cid: int(r.cid),
    hid: int(r.hid),
    targetcid: int(r.targetcid),
    task: int(r.task),
    state: int(r.state),
    wtype: int(r.wtype),
    battleid: int(r.battleid),
    battlefieldid: int(r.battlefieldid),
    endtime: int(r.endtime),
    starttime: int(r.starttime),
    pathtime: int(r.pathtime),
    inBattleNet: int(r.inBattleNet),
    inChibiNet: int(r.inChibiNet),
    fromcityName: str(r.fromcity),
    targetcityName: str(r.targetcity),
    username: str(r.username),
    origincityName: str(r.origincity ?? r.enemyuser ?? r.username),
  };
}

export function parseTroopRows(data: unknown): TroopRow[] {
  return (Array.isArray(data) ? (data as unknown[]) : []).map(parseTroopRow);
}

/**
 * `TroopDialog.onCommand("getStayTroops")`: `[allowAutoDiscard, troops]`, where `troops` is a list
 * of駐扎 rows (`sys_troops` with `state=4`, or `state=5` while gathering).
 */
export interface StayTroops {
  allowAutoDiscard: boolean;
  troops: TroopRow[];
}

export function parseStayTroops(data: unknown): StayTroops {
  const arr = Array.isArray(data) ? (data as unknown[]) : [];
  return {
    allowAutoDiscard: int(arr[0]) === 1,
    troops: parseTroopRows(arr[1]),
  };
}

/**
 * The display row a troop table shows for one `sys_troops` entry (`TroopArmyPanel.onLoadData`):
 * task / state names, the `[x,y]` labels and the countdown relative to `now` (server time).
 */
export interface TroopDisplay {
  id: number;
  task: number;
  state: number;
  taskName: string;
  stateName: string;
  fromLabel: string;
  targetLabel: string;
  arriveLabel: string;
  timeLeft: string;
  /** The row's underlying troop. */
  troop: TroopRow;
}

/**
 * `TroopArmyPanel.onLoadData`: the from/target `[x,y]` labels (named cities use the server name),
 * the arrival clock and the live countdown. A fighting troop (state 3) shows the 战斗 label and no
 * countdown; 派遣 (task 7-9) and 沙场 (battlefieldid 10001) hide the coordinates as `[ -- ]`.
 */
export function troopDisplay(troop: TroopRow, now: number): TroopDisplay {
  const special = troop.task >= 7 && troop.task <= 9;
  const sachang = troop.battlefieldid === 10001;
  let fromLabel = troop.fromcityName || makeCid(troop.cid);
  let targetLabel =
    troop.targetcityName ||
    (troop.wtype > 0 ? targetWorldTypeName(troop.wtype) : makeCid(troop.targetcid));
  if (special || sachang) {
    targetLabel = '[ -- ]';
    if (sachang || troop.cid > 1_000_000) fromLabel = '[ -- ]';
  }
  const fighting = troop.state === 3;
  return {
    id: troop.id,
    task: troop.task,
    state: troop.state,
    taskName: taskName(troop.task),
    stateName: troopStateName(troop.state),
    fromLabel,
    targetLabel,
    arriveLabel: fighting
      ? i18n('Troop_TroopArmyPanelSrc_3') || '战斗中'
      : makeEndTimeString(troop.endtime, now),
    timeLeft: fighting ? '--' : makeTimeLeftString(troop.endtime - now),
    troop,
  };
}

/** `Utils.MakeEndTimeString`: `HH:MM:SS` wall-clock of an absolute server timestamp. */
export function makeEndTimeString(endtime: number, now: number, nowClock = Date.now()): string {
  // Map the server `endtime` to a local wall clock through the shared server-time offset: the
  // dialogs feed `now = serverTime()` and we render the local HH:MM:SS of (endtime).
  const ms = nowClock + (endtime - now) * 1000;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ---- getTroopDetail: the 军队详情 dialog ----

export interface TroopDetailSoldier {
  soldier: string;
  count: string;
}
export interface TroopDetailResource {
  resource: string;
  count: string;
}
export interface TroopDetailTechnic {
  name: string;
  level: number;
}

export interface TroopDetail {
  owner: string;
  union: string;
  heroName: string;
  heroLevel: string;
  viewLevel: number;
  soldiers: TroopDetailSoldier[];
  resource: TroopDetailResource[];
  technic: TroopDetailTechnic[];
}

/** `TroopDetailDialogSrc_1..5`: 黄金/粮食/木材/石料/铁矿 (the resource-string column order). */
const RESOURCE_FALLBACK = ['黄金', '粮食', '木材', '石料', '铁矿'];
const resourceName = (i: number) =>
  i18n(`Troop_TroopDetailDialogSrc_${i + 1}`) || RESOURCE_FALLBACK[i] || '';

/**
 * `TroopDetailDialog.onCommand`: `[detailRow]` with `{troopowner, troopunion, hero:{name,level},
 * troop:{soldiers, resource}, technic, viewLevel}`. `soldierNames` / `technicNames` map the ids,
 * `showEnemy` hides exact counts behind a fog level (viewLevel) the same way the AS3 does.
 */
export function parseTroopDetail(
  data: unknown,
  soldierNames: Record<number, string>,
  technicNames: Record<number, string>,
  options: { showEnemy?: boolean; countDesc?: { count: number; desc: string }[] } = {},
): TroopDetail {
  const arr = Array.isArray(data) ? (data as unknown[]) : [];
  const r = isRow(arr[0]) ? arr[0] : {};
  const hero = isRow(r.hero) ? r.hero : null;
  const troop = isRow(r.troop) ? r.troop : {};
  const viewLevel = int(r.viewLevel);
  return {
    owner: r.troopowner != null ? str(r.troopowner) : '',
    union: r.troopunion != null ? str(r.troopunion) : '',
    heroName: hero ? str(hero.name) : '',
    heroLevel: hero ? str(hero.level) : '',
    viewLevel,
    soldiers: parseDetailSoldiers(str(troop.soldiers), soldierNames, viewLevel, options),
    resource: parseDetailResource(str(troop.resource)),
    technic: parseDetailTechnic(r.technic, technicNames),
  };
}

/**
 * `TroopDetailDialog.parseSoldier`: `"n,sid,count,sid,count,..."`. For an enemy troop the counts
 * are fogged by the watcher's 烽火台 view level: >=8 exact, >=7 bucketed via `countDesc`, >=6 just
 * "有" and the type name, below 6 everything is "--".
 */
function parseDetailSoldiers(
  soldiers: string,
  soldierNames: Record<number, string>,
  viewLevel: number,
  options: { showEnemy?: boolean; countDesc?: { count: number; desc: string }[] },
): TroopDetailSoldier[] {
  if (!soldiers) return [];
  const parts = soldiers.split(',');
  const out: TroopDetailSoldier[] = [];
  const unknown = i18n('Troop_TroopDetailDialogSrc_13') || '--';
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const sid = int(parts[i]);
    const count = int(parts[i + 1]);
    if (count <= 0) continue;
    if (!options.showEnemy) {
      out.push({ soldier: soldierNames[sid] ?? '', count: String(count) });
      continue;
    }
    let countStr = '';
    if (viewLevel >= 8) countStr = String(count);
    else if (viewLevel >= 7) {
      countStr = unknown;
      for (const d of options.countDesc ?? []) {
        if (count >= d.count) {
          countStr = d.desc;
          break;
        }
      }
    } else if (viewLevel >= 6) countStr = unknown;
    const soldier = viewLevel >= 6 ? (soldierNames[sid] ?? '') : unknown;
    out.push({ soldier, count: countStr });
  }
  return out;
}

/** `TroopDetailDialog.parseResource`: `"gold,food,wood,rock,iron"`, skipping zero amounts. */
function parseDetailResource(resource: string): TroopDetailResource[] {
  if (!resource) return [];
  const out: TroopDetailResource[] = [];
  const parts = resource.split(',');
  for (let i = 0; i < parts.length; i++) {
    const v = parseFloat(parts[i] ?? '');
    if (v > 0) out.push({ resource: resourceName(i), count: String(v) });
  }
  return out;
}

/** `TroopDetailDialog.parseTechnic`: `[{tid, level}]` mapped to names. */
function parseDetailTechnic(
  data: unknown,
  technicNames: Record<number, string>,
): TroopDetailTechnic[] {
  return (Array.isArray(data) ? (data as unknown[]) : []).filter(isRow).map((t) => ({
    name: technicNames[int(t.tid)] ?? '',
    level: int(t.level),
  }));
}

// ---- CampaignDialog: soldier picker + the StartTroop arithmetic ----

/** A soldier type available to carry on a campaign (city army count + cfg_soldier stats). */
export interface CampaignSoldier {
  sid: number;
  name: string;
  /** Soldiers of this type in the city. */
  count: number;
  speed: number;
  carry: number;
  food_use: number;
  /** How many are being taken. */
  takecount: number;
}

/**
 * Builds the CampaignDialog soldier rows: joins the city's per-sid counts with the `cfg_soldier`
 * stats (`global.soldiers`). Only types the city actually has (count > 0) and that exist in the
 * config are offered, in sid order, matching `CampaignDialog.loadData` (`City.soldierList`).
 */
export function campaignSoldiers(
  soldierCounts: Record<number, number>,
  soldierConfig: Row[],
): CampaignSoldier[] {
  const out: CampaignSoldier[] = [];
  for (const cfg of soldierConfig) {
    const sid = int(cfg.sid);
    const count = int(soldierCounts[sid]);
    if (count <= 0) continue;
    out.push({
      sid,
      name: str(cfg.name),
      count,
      speed: num(cfg.speed),
      carry: num(cfg.carry),
      food_use: num(cfg.food_use),
      takecount: 0,
    });
  }
  return out;
}

/** The five carryable resources, in CampaignDialog order: 黄金/粮食/木材/石料/铁矿. */
export interface CampaignResource {
  name: string;
  count: number;
  takecount: number;
}

/** `CampaignDialog.getFoodUse`: food spent by the carried soldiers over the round trip. */
export function campaignFoodUse(soldiers: CampaignSoldier[], pathNeedTime: number): number {
  let use = 0;
  for (const s of soldiers) use += s.food_use * s.takecount;
  return Math.ceil((use * 2 * pathNeedTime) / 3600);
}

/**
 * `CampaignDialog.getTotalCarry`: the carrying capacity of the taken soldiers. `辎重` tech (tid 11)
 * raises every soldier's carry by 10% per level; hero bonuses are folded in by the caller as a
 * flat `heroCarryBonus` per soldier (the AS3 reads the hero's per-soldier `20xx12` fields).
 */
export function campaignTotalCarry(
  soldiers: CampaignSoldier[],
  technicLevel11: number,
  heroCarryFlat = 0,
): number {
  const factor = 1 + Math.max(0, technicLevel11) * 0.1;
  let total = 0;
  for (const s of soldiers) total += (s.carry * factor + heroCarryFlat) * s.takecount;
  return Math.floor(total);
}

/**
 * `CampaignDialog.resetResult`: the marching time (seconds) to the target. Distance is Euclidean in
 * cells, scaled by `GRID_DISTANCE`, divided by the slowest taken soldier's effective speed.
 * `speedMul` folds the 行军 techs (12/13/26) and the hero's `speed_add_on`; the caller passes the
 * already-combined per-sid multiplier via `soldierSpeed`. `addSeconds` is the delay (hour/minute
 * inputs); `maxTime` caps non-驻扎 tasks when the server returned one; `beaconHalf` halves the time
 * for a 烽火台-covered close target. Mirrors the min-speed loop of the original.
 */
export function campaignPathTime(args: {
  fromX: number;
  fromY: number;
  targetX: number;
  targetY: number;
  soldiers: CampaignSoldier[];
  /** Effective speed per taken soldier (speed * tech * hero); the min is used. */
  soldierSpeed: (s: CampaignSoldier) => number;
  taskIndex: number;
  speedAddRate: number;
  addSeconds: number;
  maxTime: number;
  beaconHalf: boolean;
}): number {
  const dx = args.targetX - args.fromX;
  const dy = args.targetY - args.fromY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  let minSpeed = 999_999_999;
  for (const s of args.soldiers) {
    if (s.takecount > 0) minSpeed = Math.min(minSpeed, args.soldierSpeed(s));
  }
  if (minSpeed <= 0 || minSpeed === 999_999_999) return 0;
  // The 大道馆 speed bonus applies to 侦察 / 掠夺 (combo 0,1) off the 洛阳 fixed coordinate.
  const notLuoyang = !(args.targetX === 265 && args.targetY === 215);
  if (notLuoyang && (args.taskIndex === 0 || args.taskIndex === 1)) minSpeed *= args.speedAddRate;
  let time = Math.ceil((distance * GRID_DISTANCE) / minSpeed);
  if (args.taskIndex > 0 && args.maxTime > 0) time = Math.min(time, args.maxTime);
  time += args.addSeconds;
  if (args.beaconHalf) time = Math.ceil(time * 0.5);
  return time;
}

/**
 * `CampaignDialog.startTroop`: the `soldiers` command field, `"n,sid,count,sid,count,..."` for
 * every type with `takecount > 0`. Returns null when nothing is taken (the original alerts).
 */
export function buildTroopSoldiersString(soldiers: CampaignSoldier[]): string | null {
  let n = 0;
  let body = '';
  for (const s of soldiers) {
    if (s.takecount > 0) {
      n++;
      body += `${s.sid},${s.takecount},`;
    }
  }
  if (n === 0) return null;
  return `${n},${body}`;
}

/** `CampaignDialog.startTroop`: the `resource` field, `"gold,food,wood,rock,iron,"`. */
export function buildTroopResourceString(resources: CampaignResource[]): string {
  return resources.map((r) => `${r.takecount},`).join('');
}

// ---- getTroopMaxTime (ExternService): client just reads a number ----

/** The `getTroopMaxTime` reply is a single number of seconds (0 = no cap). */
export function parseTroopMaxTime(data: unknown): number {
  return int(Array.isArray(data) ? (data as unknown[])[0] : data);
}

/** A CampaignDialog target coordinate from a cid, and whether it is the 洛阳 fixed target. */
export function targetFromCid(cid: number): { x: number; y: number; isLuoyang: boolean } {
  const { x, y } = cidToXY(cid);
  return { x, y, isLuoyang: cid === LUOYANG_CID };
}
