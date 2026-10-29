import { LUOYANG_CID } from './troop';

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v ?? 0), 10) || 0;
const row = (v: unknown): Row | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null;
const rows = (v: unknown): Row[] =>
  Array.isArray(v) ? ((v as unknown[]).filter(row) as Row[]) : [];

/**
 * LuoyangFunc.php — the 洛阳战场 (battle) and 洛阳归属 (belong) client helpers. Actions:
 * `LuoYangBattle` (战场) and `LuoYangInitBattle` (归属总览), plus `union/luoyangAllocate`.
 */

/** The 11 city slots of LuoYangBattlePanel (CityNameLabel city_0..city_10 x/y). */
export const CITY_SLOTS: { x: number; y: number }[] = [
  { x: 549, y: 341 },
  { x: 655, y: 182 },
  { x: 216, y: 406 },
  { x: 458, y: 301 },
  { x: 563, y: 233 },
  { x: 293, y: 385 },
  { x: 478, y: 182 },
  { x: 261, y: 301 },
  { x: 303, y: 204 },
  { x: 94, y: 255 },
  { x: 178, y: 149 },
];

/** `isSpecialCid`: the five cities a troop may not skip past (LuoYangBattlePanel.as:468). */
const SPECIAL_CIDS = [1, 2, 4, 5, 7];
export const isSpecialCid = (cid: number) => SPECIAL_CIDS.includes(cid);

/** A cfg_luoyang_city_add row joined with its group_concat(targetcid) nextcid. */
export interface LuoyangCity extends Row {
  cid: number;
  image: number;
  nextcid: string;
  /** The slot index the row renders into (`displayBuildInfo` uses the `image` column). */
  slot: number;
  nextList: number[];
}

export function parseLuoyangCities(list: unknown): LuoyangCity[] {
  return rows(list).map((c, index) => {
    const city: Row = { ...c };
    city.cid = int(c.cid);
    const image = int(c.image);
    const nextcid = String(c.nextcid ?? '');
    city.image = image;
    city.nextcid = nextcid;
    city.slot = image < CITY_SLOTS.length ? image : index;
    city.nextList = nextcid
      .split(',')
      .map((v: string) => int(v))
      .filter((v: number) => v > 0);
    return city as LuoyangCity;
  });
}

/** getLYBattleData reply `[cityInfo, leavingTime, isOpenSecond, userTroops]`. */
export interface LyBattleData {
  cities: LuoyangCity[];
  leavingTime: number;
  isOpenSecond: number;
  userTroops: LyUserTroop[];
}

export function parseLYBattleData(data: unknown): LyBattleData {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  return {
    cities: parseLuoyangCities(d.shift()),
    leavingTime: int(d.shift()),
    isOpenSecond: int(d.shift()),
    userTroops: rows(d.shift()).map(parseUserTroop),
  };
}

/** One sys_luoyang_troops row joined with its hero (`getUserTroopsData`). */
export interface LyUserTroop extends Row {
  hid: number;
  cid: number;
  heroname: string;
  level: number;
  state: number;
  leavingTime: number;
  heroImage: string;
}

/** `setImageSrc`: the hero portrait; the lord hero shows the player's face. */
export function troopHeroImage(t: Row, userSex: number, userFace: number): string {
  if (int(t.herotype) === 1000) {
    return `images/player/player_${userSex === 0 ? 'girl' : 'boy'}_${userFace + 1}.jpg`;
  }
  return `images/herox/hero_${Number(t.sex) === 0 ? 'girl' : 'boy'}_${int(t.face)}.jpg`;
}

export function parseUserTroop(t: Row): LyUserTroop {
  const troop: Row = { ...t };
  troop.hid = int(t.hid);
  troop.cid = int(t.cid);
  troop.level = int(t.level);
  troop.state = int(t.state);
  troop.leavingTime = Math.max(0, int(t.leavingTime));
  return troop as LyUserTroop;
}

/** `getCanPassNextCidStr`: the cids a troop on `cid` may march to next. */
export function canPassNextCid(cities: LuoyangCity[], cid: number): number[] {
  return cities.find((c) => c.cid === cid)?.nextList ?? [];
}

/** `doTestLegalCid`: whether `target` is reachable from the selected troop's city. */
export function isLegalTarget(cities: LuoyangCity[], fromCid: number, target: number): boolean {
  return canPassNextCid(cities, fromCid).includes(target);
}

/** luoyangTroopStart `[hid, City.cid, User.unionid, soldiersStr, useFlag]`. */
export function luoyangTroopStartArgs(
  hid: number,
  cid: number,
  unionid: number,
  soldiersStr: string,
  useFlag: boolean,
): (number | string | boolean)[] {
  return [hid, cid, unionid, soldiersStr, useFlag];
}

/** luoyangCityTroops reply `[troopInfos]` (BattleFiledViewDialog.onLoadTroopData). */
export function parseCityTroops(data: unknown): Row[] {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  return rows(d.shift());
}

/** luoyangChangeCity reply `[troop, message]` (AS3:518). */
export function parseChangeCity(data: unknown): { troop: Row | null; message: string } {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  return { troop: row(d.shift()), message: String(d.shift() ?? '') };
}

// ---- 洛阳归属 ----

/** getLYBelongInfo reply `[info, battle, isCanSend]`. */
export interface BelongInfo {
  info: Row | null;
  battle: Row;
  isCanSend: boolean;
  /** The owner line `userName + doParseYear(yearCount) + 年` when the sign row exists. */
  yearName: string;
  unionName: string;
  userName: string;
}

/** `Utils.doParseYear` (game.ts luoyangYear): the LuoYang_Battle_1_{n+1} era names. */
export function luoyangYear(count: number, i18n: (k: string) => string): string {
  return i18n(count >= 1 && count <= 20 ? `LuoYang_Battle_1_${count + 1}` : 'LuoYang_Battle_1_1');
}

export function parseBelongInfo(data: unknown, i18n: (k: string) => string): BelongInfo {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const info = row(d.shift());
  const battle = row(d.shift()) ?? {};
  const isCanSend = Boolean(d.shift());
  const empty = i18n('Report_Announcement_12_1');
  const parsed: BelongInfo = {
    info,
    battle,
    isCanSend,
    yearName: empty,
    unionName: empty,
    userName: empty,
  };
  if (info && int(info.uid) > 1000 && info.yearCount != null) {
    const name = String(info.userName ?? '');
    parsed.yearName = name + luoyangYear(int(info.yearCount), i18n) + i18n('_Utils_1');
    parsed.unionName = String(info.unionName ?? empty);
    parsed.userName = name;
  }
  return parsed;
}

/** getLuoyangEvent rows: the 分配/易主 record list. */
export function parseLuoyangEvents(list: unknown): Row[] {
  return rows(list);
}

/** getUnionRankPoint / getUserRankPoint reply — the score board rows. */
export function parseRankPoints(data: unknown): Row[] {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  return rows(d.shift());
}

/** getUserInfoPoint reply `[userScore, battleInfo]` (ViewPointPanel.getPointData). */
export function parseUserInfoPoint(data: unknown): { score: string; rows: Row[] } {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  return { score: String(d.shift() ?? '0'), rows: rows(d.shift()) };
}

/** luoyangAllocate (union action) reply `[message]`. */
export function parseAllocate(data: unknown): string {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  return String(d.shift() ?? '');
}

/** The 战场说明 intro of the belong panel (LuoYangBelongPanel.onLoadBelongInfo, AS3:725). */
export function battleIntro(battle: Row, i18n: (k: string) => string): string {
  const space = '　　';
  return (
    i18n('LuoYang_Belong_tip_1') +
    '\n' +
    space +
    i18n('LuoYang_Belong_tip_2') +
    '\n' +
    i18n('LuoYang_Belong_tip_3') +
    '\n' +
    space +
    i18n('LuoYang_Belong_tip_4') +
    '\n' +
    i18n('LuoYang_Belong_tip_5') +
    '\n' +
    space +
    String(battle.winCondition ?? '') +
    '\n' +
    i18n('LuoYang_Belong_tip_6') +
    '\n' +
    space +
    String(battle.loseCondition ?? '')
  );
}

/** 洛阳城 target cid the troop dialogs dispatch on. */
export const LUOYANG_TROOP_CID = LUOYANG_CID;
