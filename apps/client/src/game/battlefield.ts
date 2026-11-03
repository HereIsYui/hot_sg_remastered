/**
 * BloodBattle.swf battlefield helpers (Battle package, the stage-9 本地 PVE 战场 client):
 * the pure parsing / layout / arithmetic the `battle` action dialogs share. The server side is
 * apps/server/src/battlefield/*.ts + apps/server/src/battle/battlefield-*.ts (BattleFunc.php).
 */

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v ?? 0), 10) || 0;
const row = (v: unknown): Row | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null;
const rows = (v: unknown): Row[] =>
  Array.isArray(v) ? ((v as unknown[]).filter(row) as Row[]) : [];

/** `Define.GAME_SPEED_RATE`. */
export const GAME_SPEED_RATE = 1;

/** `BattlePanel.BATTLE_SOLDIER_LIMIT` — the army-size cap per battlefield level (index = level). */
export const BATTLE_SOLDIER_LIMIT: number[] = [
  0, 1000, 2000, 4000, 8000, 10000, 20000, 40000, 60000, 80000, 100000, 120000, 140000,
];

/** `Define.SOLDIER_PEOPLE` (indexed 0..11 = sid 1..12): honour weight of one soldier. */
export const SOLDIER_PEOPLE: number[] = [1, 1, 1, 1, 1, 2, 3, 6, 4, 5, 10, 8];

/** `Define.SOLDIER_VALUE` (sid 1..12): the 援军令 count tier of one soldier. */
export const SOLDIER_VALUE: number[] = [
  22.5, 30.5, 69.5, 90, 135, 140, 285, 875, 297.5, 1000, 1375, 2900,
];

// ─────────────────────────── battlefield map layout ───────────────────────────

/** `BattlePanel.GRID_*` — the isometric diamond grid the 据点 sit on (30×30 cells). */
export const GRID_COUNT_X = 30;
export const GRID_COUNT_Y = 30;
export const GRID_OFFX = 27;
export const GRID_OFFY = 13;
export const GRID_TOP = -80;
export const GRID_LEFT = 370;

/** `BattlePanel.createGrid`: the x/y of cell `xy` inside the battleCanvas. */
export function battleGridPos(xy: number): { x: number; y: number } {
  const j = xy % GRID_COUNT_X;
  const i = Math.floor(xy / GRID_COUNT_X);
  return {
    x: GRID_LEFT + (j - i) * GRID_OFFX - GRID_OFFX,
    y: GRID_TOP + (j + i) * GRID_OFFY - 12,
  };
}

/** `BattlePanel.createGridData`: `buildingImage[image - 1]` of the embedded 据点 bitmaps. */
export const BUILDING_IMAGES: string[] = [
  'symbol:Battle.BattlePanel_battleCity',
  'symbol:Battle.BattlePanel_littleCity',
  'symbol:Battle.BattlePanel_farm',
  'symbol:Battle.BattlePanel_guan',
  'symbol:Battle.BattlePanel_mainCity',
  'symbol:Battle.BattlePanel_cangku',
  'symbol:Battle.BattlePanel_battleCity2',
  'symbol:Battle.BattlePanel_littleCity2',
  'symbol:Battle.BattlePanel_farm2',
  'symbol:Battle.BattlePanel_guan2',
  'symbol:Battle.BattlePanel_mainCity2',
  'symbol:Battle.BattlePanel_cangku2',
];

/** `BattlePanel.onCreate` flagImages: `flag` 0-5 of the map flags (setFlags' values). */
export const FLAG_IMAGES: string[] = [
  'symbol:Battle.BattlePanel_flag_yellow',
  'symbol:Battle.BattlePanel_flag_green',
  'symbol:Battle.BattlePanel_flag_blue',
  'symbol:Battle.BattlePanel_flag_rose',
  'symbol:Battle.BattlePanel_flag_red',
  'symbol:Battle.BattlePanel_flag_white',
];

/** `flagFontColor` of the flags (0 yellow, 1 green, 2 blue, 3 rose, 4 red, 5 white). */
export const FLAG_FONT_COLORS: number[] = [3289650, 1579032, 0, 15263976, 16777215, 0];

/** One `sys_battle_city` row as setFlags returned it. */
export interface BattleCity extends Row {
  cid: number;
  xy: number;
  flag: number;
  flagchar: string;
  name: string;
  image: number;
}

export function parseBattleCities(list: unknown): BattleCity[] {
  return rows(list).map((c) => ({
    ...c,
    cid: int(c.cid),
    xy: int(c.xy),
    flag: int(c.flag),
    flagchar: String(c.flagchar ?? ''),
    name: String(c.name ?? ''),
    image: int(c.image),
  }));
}

/** One `sys_troops` row joined with the owner hero (the map / field-state troop lists). */
export interface BattleTroop extends Row {
  id: number;
  cid: number;
  targetcid: number;
  state: number;
  hid: number;
  heroname: string;
  level: number;
  soldiers: string;
  ulimit: number;
}

export function parseBattleTroops(list: unknown): BattleTroop[] {
  return rows(list).map((t) => {
    const out: BattleTroop = {
      ...t,
      id: int(t.id),
      cid: int(t.cid),
      targetcid: int(t.targetcid),
      state: int(t.state),
      hid: int(t.hid),
      heroname: String(t.heroname ?? ''),
      level: int(t.level),
      soldiers: String(t.soldiers ?? ''),
      ulimit: int(t.ulimit),
    };
    return out;
  });
}

// ─────────────────────────── soldiers strings ───────────────────────────

/** `parseSoldier` (BattleActionDialog/BattleAttackDialog/BattleTroopItem): the `sid,count` pairs
 *  behind an optional leading pair-count field (`N,sid,cnt,...`); zero counts drop out. */
export function parseSoldierPairs(
  soldiers: string | null | undefined,
): { sid: number; count: number }[] {
  if (!soldiers) return [];
  const parts = soldiers.split(',').map((p) => int(p));
  const pairs: { sid: number; count: number }[] = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    if (parts[i + 1]! > 0) pairs.push({ sid: parts[i]!, count: parts[i + 1]! });
  }
  return pairs;
}

/** `getSoldierPeople` of BattleTroopItem: the head count the `soldiers` string carries. */
export function soldierPeopleOf(soldiers: string | null | undefined): number {
  return parseSoldierPairs(soldiers).reduce((sum, p) => sum + p.count, 0);
}

/** `startBattleTroop` (BattleCampaignDialog.startTroop): `N,sid,cnt,sid,cnt` from the taken rows. */
export function soldiersString(entries: { sid: number; takecount: number }[]): string {
  const taken = entries.filter((e) => e.takecount > 0);
  const parts: string[] = [String(taken.length)];
  for (const e of taken) parts.push(String(e.sid), String(e.takecount));
  return parts.join(',');
}

// ─────────────────────────── state snapshots ───────────────────────────

/** A `sys_user_battle_state` joined row (the in-field snapshot's first element). */
export interface BattleState extends Row {
  bid: number;
  battlefieldid: number;
  unionid: number;
  state: number;
  endtime: number;
  honour: number;
  level: number;
  sent_troop_count: number;
  name: string;
}

function parseBattleStateRow(r: Row): BattleState {
  return {
    ...r,
    bid: int(r.bid),
    battlefieldid: int(r.battlefieldid),
    unionid: int(r.unionid),
    state: int(r.state),
    endtime: int(r.endtime),
    honour: int(r.honour),
    level: int(r.level),
    sent_troop_count: int(r.sent_troop_count),
    name: String(r.name ?? ''),
  };
}

/** The hall list row (`cfg_battle_field` + hasBattleAct/canCreate). */
export interface HallBattle extends Row {
  id: number;
  type: number;
  state: number;
  hasBattleAct: boolean;
  canCreate: boolean;
}

export function parseHallBattles(list: unknown): HallBattle[] {
  return rows(list).map((b) => ({
    ...b,
    id: int(b.id),
    type: int(b.type),
    state: int(b.state),
    hasBattleAct: Boolean(b.hasBattleAct),
    canCreate: Boolean(b.canCreate),
  }));
}

/** `[version, flag, cfgbattles, 0, 0, todayWarCount, 5]` — the getBattleInfo hall reply. */
export interface HallReply {
  version: number;
  flag: number;
  battles: HallBattle[];
  todayWarCount: number;
}

export function parseHallReply(data: unknown): HallReply {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const version = int(d.shift());
  const flag = int(d.shift());
  const battles = parseHallBattles(d.shift());
  d.shift();
  d.shift();
  const todayWarCount = int(d.shift());
  return { version, flag, battles, todayWarCount };
}

/** getUserBattleState when `hasBattle` is 0 (hall) or 2 (cross-server waiting): hall + tail. */
export interface UserBattleStateHall extends HallReply {
  netLevel: number;
  waitingBid: number;
}

export function parseUserBattleStateHall(data: unknown): UserBattleStateHall {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const version = int(d.shift());
  const flag = int(d.shift());
  const battles = parseHallBattles(d.shift());
  d.shift();
  d.shift();
  const todayWarCount = int(d.shift());
  d.shift(); // the trailing literal 5 of the hall tail
  return {
    version,
    flag,
    battles,
    todayWarCount,
    netLevel: int(d.shift()),
    waitingBid: int(d.shift()),
  };
}

/** The in-field snapshot of getUserBattleState / refreshUserBattleState (hasBattle = 1). */
export interface FieldSnapshot {
  battle: BattleState;
  cities: BattleCity[];
  troops: BattleTroop[];
  startCityInfo: Row[];
  winpoints: Row[] | null;
}

export function parseFieldSnapshot(d: unknown[], hasWinpoint: boolean): FieldSnapshot {
  const battle = parseBattleStateRow(row(d.shift()) ?? ({} as Row));
  const cities = parseBattleCities(d.shift());
  const troops = parseBattleTroops(d.shift());
  const startCityInfo = rows(d.shift());
  const winpoints = hasWinpoint ? rows(d.shift()) : null;
  return { battle, cities, troops, startCityInfo, winpoints };
}

/** `getUserBattleState` reply → hall (0/2) or field (1); 2001/7001 append the winpoint list. */
export type UserBattleState =
  | { kind: 'hall'; hasBattle: 0 | 2; state: UserBattleStateHall }
  | { kind: 'field'; state: FieldSnapshot; netLevel: number };

export function parseUserBattleState(data: unknown): UserBattleState {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  d.shift(); // version
  const hasBattle = int(d.shift());
  if (hasBattle === 1) {
    d.shift(); // in_cross_battle == 0 for the local fields
    const bid = int(row(d[0])?.bid);
    const snapshot = parseFieldSnapshot(d, bid === 2001 || bid === 7001);
    return { kind: 'field', state: snapshot, netLevel: int(d[0]) };
  }
  // the hall tail still carries version/flag
  return {
    kind: 'hall',
    hasBattle: hasBattle === 2 ? 2 : 0,
    state: parseUserBattleStateHall(Array.isArray(data) ? (data as unknown[]) : []),
  };
}

/** `refreshUserBattleState` reply → the field snapshot (hasBattle = 1) or out of battle (0). */
export type RefreshUserBattleState = { kind: 'out' } | { kind: 'field'; state: FieldSnapshot };

export function parseRefreshUserBattleState(data: unknown): RefreshUserBattleState {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const hasBattle = int(d.shift());
  if (hasBattle !== 1) return { kind: 'out' };
  return { kind: 'field', state: parseFieldSnapshot(d, false) };
}

/** `createBattle` / `joinToBattle` / `joinToPVPBattle` reply → the entered field. */
export function parseEnterBattle(data: unknown): FieldSnapshot {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const bid = int(row(d[0])?.bid);
  return parseFieldSnapshot(d, bid === 2001 || bid === 7001);
}

/** `getBattleFieldState` reply (battle-move.commands.ts): the clicked 据点's state. */
export interface BattleFieldState {
  cityname: string;
  cid: number;
  troops: Row[];
  cities: BattleCity[];
  myTroops: BattleTroop[];
  canAddArmy: boolean;
  canQuest: boolean;
  enableQuest: boolean;
}

export function parseBattleFieldState(data: unknown): BattleFieldState {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const cityname = String(d.shift() ?? '');
  const cid = int(d.shift());
  const troops = rows(d.shift());
  const cities = parseBattleCities(d.shift());
  const myTroops = parseBattleTroops(d.shift());
  const canAddArmy = Boolean(d.shift());
  const canQuest = Boolean(d.shift());
  const enableQuest = Boolean(d.shift());
  return { cityname, cid, troops, cities, myTroops, canAddArmy, canQuest, enableQuest };
}

// ─────────────────────────── BattleFiledViewDialog.resetData ───────────────────────────

/** The per-row 操作 gates BattleFiledViewDialog.resetData derives from the raw troop rows. */
export interface FiledViewRow extends Row {
  canAttack: boolean;
  canChat: boolean;
  canPatrol: boolean;
  canView: boolean;
  enableChat: boolean;
}

/**
 * `BattleFiledViewDialog.resetData`: enemy rows may be attacked (unless `no_attack`) or, when
 * `can_chat`, talked to; 巡逻 needs the selected troop to stand elsewhere; 详情 is the own
 * camp's rows and everything on the troop's own 据点.
 */
export function buildFiledViewRows(
  info: Row[],
  unionid: number,
  cid: number,
  currentTroopCid: number,
): { rows: FiledViewRow[]; canSend: boolean } {
  const out: FiledViewRow[] = [];
  let canSend = true;
  for (const src of info) {
    const item: FiledViewRow = {
      ...src,
      canAttack: false,
      canChat: String(src.can_chat) === '1',
      canPatrol: false,
      canView: false,
      enableChat: String(src.enable_chat) === '1',
    };
    const sameUnion = unionid === int(src.battleunionid);
    if (!sameUnion) {
      if (!item.canChat) item.canAttack = true;
      item.canPatrol = cid !== currentTroopCid;
      if (item.canAttack && String(src.no_attack) === '1') {
        item.canAttack = false;
      } else {
        canSend = false;
      }
    }
    if (cid === currentTroopCid) item.canView = true;
    else item.canView = sameUnion;
    if (item.canAttack) item.canChat = false;
    out.push(item);
  }
  return { rows: out, canSend };
}

// ─────────────────────────── 出征配兵 (BattleCampaignDialog) ───────────────────────────

/**
 * `BattleCampaignDialog.getMaxSoldierLimit`: the 校场-level cap against the battlefield-level
 * `BATTLE_SOLDIER_LIMIT`; the 军旗 adds 25% to both, the 名城 type adds 25/50/75/100%.
 */
export function maxCampaignSoldierLimit(
  groundLevel: number,
  useFlag: boolean,
  cityType: number,
  battle: { bid: number; level: number },
): number {
  let maxCount = groundLevel * GAME_SPEED_RATE * 10000;
  let limitadd = 0;
  if (useFlag) limitadd += 25;
  if (cityType === 1) limitadd += 25;
  else if (cityType === 2) limitadd += 50;
  else if (cityType === 3) limitadd += 75;
  else if (cityType === 4) limitadd += 100;
  if (limitadd > 0) maxCount = Math.floor((maxCount * (100 + limitadd)) / 100);
  let maxCount1 = BATTLE_SOLDIER_LIMIT[battle.level] ?? 0;
  if (battle.bid === 5001) maxCount1 -= 2;
  if (useFlag) maxCount1 = Math.floor(maxCount1 * 1.25);
  return Math.trunc(Math.min(maxCount, maxCount1));
}

/** `takeMaxSoldier` / `takeAllSoldier` / `changeCount`: sid 9 (辎重车) cannot march in 千里走单骑. */
export function campaignSoldierBlocked(bid: number, sid: number): boolean {
  return bid === 5001 && sid === 9;
}

/** `BattleCampaignDialog.getFoodUse`: the soldiers' hourly food against the battle's full hours. */
export function campaignFoodUse(
  entries: { food_use: number; takecount: number }[],
  leftTime: number,
): number {
  let ret = 0;
  for (const e of entries) ret += Number(e.food_use ?? 0) * Number(e.takecount ?? 0);
  const foodRate = Math.max(1, Math.ceil(leftTime / 3600));
  return ret * foodRate;
}

/** `startTroop`: the command args `[cid, hid, soldiers, useFlag, xy]`. */
export function startBattleTroopArgs(
  cid: number,
  hid: number,
  entries: { sid: number; takecount: number }[],
  useFlag: boolean,
  xy: number,
): (number | string | boolean)[] {
  return [cid, hid, soldiersString(entries), useFlag, xy];
}

// ─────────────────────────── 调遣援军 (CallArmyDialog) ───────────────────────────

/** `CallArmyDialog.resetData`: the caps / honour cost / 援军令 tiers of one call. */
export function callArmyPreview(
  selectedIndex: number,
  count: number,
  honour: number,
  reinforceAvailable: number,
): { maxCall: number; needHonour: number; yuanjun: number } {
  const people = SOLDIER_PEOPLE[selectedIndex] ?? 0;
  const count1 = people === 0 ? 0 : (honour * 100) / people;
  const count2 = Math.max(0, Math.trunc(reinforceAvailable));
  const maxCall = Math.floor(Math.min(count1, count2));
  const safeCount = Math.min(Math.max(0, Math.trunc(count)), maxCall);
  const callPeople = people * safeCount;
  const needHonour = Math.ceil(callPeople / 100);
  const value = callPeople === 0 ? 0 : (SOLDIER_VALUE[selectedIndex] ?? 0) * safeCount;
  let yuanjun: number;
  if (value === 0) yuanjun = 0;
  else if (value <= 100000) yuanjun = 1;
  else if (value <= 1000000) yuanjun = 2;
  else if (value <= 10000000) yuanjun = 3;
  else if (value <= 100000000) yuanjun = 4;
  else yuanjun = 5;
  return { maxCall, needHonour, yuanjun };
}

/** `BattleTroopItem.getReinforceAvailable`: the battlefield-level cap minus the army's heads. */
export function reinforceAvailable(battle: { level: number }, soldiers: string): number {
  return (BATTLE_SOLDIER_LIMIT[battle.level] ?? 0) - soldierPeopleOf(soldiers);
}

/** `callArmy` reply: success `[1, troopid, soldiers, honour, msg]` / failure `[0, msg]`. */
export function parseCallArmyReply(data: unknown): {
  ok: boolean;
  troopid: number;
  soldiers: string;
  honour: number;
  message: string;
} {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const ok = int(d.shift()) === 1;
  if (!ok)
    return { ok: false, troopid: 0, soldiers: '', honour: 0, message: String(d.shift() ?? '') };
  const troopid = int(d.shift());
  const soldiers = String(d.shift() ?? '');
  const honour = int(d.shift());
  const message = String(d.shift() ?? '');
  return { ok, troopid, soldiers, honour, message };
}

// ─────────────────────────── 加入场 (JoinBattle / SelectUnion) ───────────────────────────

/** `getPVPBattleInfo` reply: the per-level instance list and the camp rows when the bid has them. */
export function parsePVPBattleInfo(data: unknown): { battles: Row[]; unions: Row[] } {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const battles = rows(d.shift());
  const unions = d.length > 0 ? rows(d.shift()) : [];
  return { battles, unions };
}

/** `Battle_JoinBattleDialogSrc_2..5` state text of one instance row. */
export function joinBattleStateText(state: number, i18n: (k: string) => string): string {
  if (state === 0) return i18n('Battle_JoinBattleDialogSrc_2');
  if (state === 1) return i18n('Battle_JoinBattleDialogSrc_3');
  if (state === 2) return i18n('Battle_JoinBattleDialogSrc_4');
  if (state === 3) return i18n('Battle_JoinBattleDialogSrc_5');
  return '';
}

// ─────────────────────────── 退出战场 ───────────────────────────

/** `getQuitResult` reply `[result]` with the client-side confirm text (`Battle_BattlePanelSrc_6..10`). */
export function quitResultText(result: number, level: number, i18n: (k: string) => string): string {
  if (result === -1) {
    const penalty = level * level * 20;
    return `${i18n('Battle_BattlePanelSrc_6')}${penalty}${i18n('Battle_BattlePanelSrc_7')}`;
  }
  if (result === 2) return i18n('Battle_BattlePanelSrc_8');
  if (result === 1) return i18n('Battle_BattlePanelSrc_9');
  return i18n('Battle_BattlePanelSrc_10');
}
