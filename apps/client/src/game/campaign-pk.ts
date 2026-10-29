import { LUOYANG_CID } from './troop';

export type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v ?? 0), 10) || 0;
const row = (v: unknown): Row | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null;
const rows = (v: unknown): Row[] =>
  Array.isArray(v) ? ((v as unknown[]).filter(row) as Row[]) : [];

/**
 * PKFunc.php / GuoGuanZhanJiang — the 过关斩将 (征战) ladder client. The engine itself runs on
 * the server (`getOneBattleRet`); here only the dialog data is parsed.
 */

/** The 10 chapters (`battleItemArr`, GuoGuanZhanJiangDialog.as:829): label/image/floors. */
export interface BattleChapter {
  label: string;
  image: string;
  data: number;
  floorCount: number;
}

/** The chapter list; labels resolve through the caller's i18n (GuoGuanZhanJiangDialog.as:830). */
export function battleChapters(labelOf: (id: number) => string): BattleChapter[] {
  return Array.from({ length: 10 }, (_, i) => ({
    label: labelOf(i + 1),
    image: `images/battle_serial_${i + 1}.png`,
    data: i + 1,
    floorCount: 10,
  }));
}

/** One ladder NPC row of loadCampaignInitData (`doCalculateHeroAttr`, AS3:2050). */
export interface LadderHero extends Row {
  battleid: number;
  levelid: number;
  flag: number;
  area: number;
  lowerType: 0 | 1;
  showState: -1 | 0 | 1;
  heroImage: string;
  attack: number;
  defence: number;
  force: number;
  speed: number;
  blood: number;
}

/** `doCalculateHeroAttr`: the display stats of an NPC hero row. */
export function calcHeroAttr(hero: Row): LadderHero {
  const h: Row = { ...hero };
  const sex = int(h.sex);
  h.heroImage = `images/hero/hero_${sex === 0 ? 'girl_' : 'boy_'}${int(h.face)}.jpg`;
  h.attack = (int(h.bravery_base) + int(h.bravery_add)) * 10;
  h.defence = (int(h.wisdom_base) + int(h.wisdom_add)) * 10;
  h.force = int(h.energy) + int(h.energy_add);
  h.speed = int(h.speed_base) + int(h.speed_add);
  h.blood = (int(h.energy) + int(h.energy_add)) * 50;
  return h as LadderHero;
}

/** `saveHerosByBattleType`: the per-chapter hero buckets the entry tip reads. */
export function heroesByChapter(heroes: LadderHero[]): Map<number, LadderHero[]> {
  const map = new Map<number, LadderHero[]>();
  for (const hero of heroes) {
    const list = map.get(hero.battleid) ?? [];
    list.push(hero);
    map.set(hero.battleid, list);
  }
  return map;
}

/** showState for a ladder row against the reached floor (getInitData, AS3:1318-1325). */
export function showState(
  battleid: number,
  levelid: number,
  maxBattleId: number,
  maxFloor: number,
): -1 | 0 | 1 {
  if (battleid < maxBattleId || (battleid === maxBattleId && levelid < maxFloor)) return 1;
  if (battleid === maxBattleId && levelid === maxFloor) return 0;
  return -1;
}

/** loadCampaignInitData reply → the dialog state (`getInitData`, AS3:1281). */
export interface CampaignInit {
  /** `[normal, special]` of sys_pk_user; false keeps the fresh 1/1 the server inserts. */
  normal: number;
  special: number;
  common: LadderHero[];
  specialHeroes: LadderHero[];
  rewards: { battleid: number; flag: number; goods: Row | null }[];
  junling: number;
  wuzhuqian: number;
  descs: { id: number; description: string }[];
}

/** `holdUserMaxData`: the reached chapter + the next floor of one difficulty. The packed
 * sys_pk_user value is `battleid * 100 + level`; a floor count beyond the chapter's area-1 rows
 * rolls onto the next chapter (AS3:1543). */
export function maxBattleOf(
  passId: number,
  heroes: LadderHero[],
): { battleId: number; floor: number } {
  if (passId === 1) return { battleId: 1, floor: 1 };
  let battleId = Math.floor(passId / 100);
  let floor = Math.floor(passId % 100) + 1;
  const area1 = heroes.filter((h) => h.battleid === battleId && h.area === 1).length;
  if (floor > area1) {
    battleId += 1;
    floor = 1;
  }
  return { battleId, floor };
}

/** PKFunc.php:452 loadCampaignInitData: `[levelInfo, common, special, rewards, goods, descs]`. */
export function parseCampaignInit(data: unknown): CampaignInit {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const level = row(d.shift()) ?? {};
  const common = rows(d.shift()).map(calcHeroAttr);
  const special = rows(d.shift()).map(calcHeroAttr);
  const rewards = rows(d.shift()).map((r) => ({
    battleid: int(r.battleid),
    flag: int(r.flag),
    goods: row(r.goods),
  }));
  const goods = row(d.shift()) ?? {};
  const descs = rows(d.shift()).map((r) => ({
    id: int(r.id),
    description: String(r.description ?? ''),
  }));
  // `parseInt(levelInfo.normal) || 1`: the very first call reads the row the server just inserted.
  const normal = int(level.normal) || 1;
  const specialPass = int(level.special) || 1;
  const commonMax = maxBattleOf(normal, common);
  const specialMax = maxBattleOf(specialPass, special);
  for (const h of common) {
    h.showState = showState(h.battleid, h.levelid, commonMax.battleId, commonMax.floor);
  }
  for (const h of special) {
    h.showState = showState(h.battleid, h.levelid, specialMax.battleId, specialMax.floor);
  }
  return {
    normal,
    special: specialPass,
    common,
    specialHeroes: special,
    rewards,
    junling: goods.junling == null ? 0 : int(goods.junling),
    wuzhuqian: int(goods.wuzhuqian),
    descs,
  };
}

/** `maxLevelOf` — a chapter's max floor from its rows (PHP max(levelid)). */
export function maxLevelOf(heroes: LadderHero[], battleid: number, flag: number): number {
  let max = 0;
  for (const h of heroes) {
    if (h.battleid === battleid && h.flag === flag && h.levelid > max) max = h.levelid;
  }
  return max;
}

/** `battleId100` — sys_pk_user's `battleid * 100 + level` packing. */
export const packPassId = (battleId: number, level: number) => battleId * 100 + level;

/** regetCampaignMaxData reply `[userBattleInfo, junlin, wuzhuqian]` (updateUserMaxCampaign). */
export function parseCampaignMax(data: unknown): {
  normal: number;
  special: number;
  junling: number;
  wuzhuqian: number;
} {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const level = row(d.shift()) ?? {};
  return {
    normal: int(level.normal) || 1,
    special: int(level.special) || 1,
    junling: int(d.shift()),
    wuzhuqian: int(d.shift()),
  };
}

/** `updateUserMaxCampaign`: re-marks the passed/current floors after a fight (in place). */
export function applyShowState(init: CampaignInit): CampaignInit {
  const commonMax = maxBattleOf(init.normal, init.common);
  const specialMax = maxBattleOf(init.special, init.specialHeroes);
  for (const h of init.common) {
    h.showState = showState(h.battleid, h.levelid, commonMax.battleId, commonMax.floor);
  }
  for (const h of init.specialHeroes) {
    h.showState = showState(h.battleid, h.levelid, specialMax.battleId, specialMax.floor);
  }
  return init;
}

/** buyJunlingFunc reply `[type, count, money]` (onGetData, AS3:2090). */
export function parseBuyJunling(data: unknown): {
  type: number;
  count: number;
  money: number | null;
} {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const type = int(d.shift());
  const count = int(d.shift());
  const money = type === 0 ? int(d.shift()) : null;
  return { type, count, money };
}

/** The drop item of a chapter + difficulty (mAllBattleRewardArr lookup, AS3:2169). */
export function dropGoodOf(
  rewards: CampaignInit['rewards'],
  battleid: number,
  flag: number,
): Row | null {
  return rewards.find((r) => r.battleid === battleid && r.flag === flag)?.goods ?? null;
}

/** `getBattleDesc`: a chapter's introduction text. */
export function battleDesc(descs: CampaignInit['descs'], battleid: number): string {
  return descs.find((d) => d.id === battleid)?.description ?? '';
}

/** The entry condition tooltip of a chapter (showRestrictCondition, AS3:1180). */
export function enterCondition(
  label: string,
  floorCount: number,
  heroLevel: number,
  userLevel: number,
  i18n: (key: string) => string,
): string {
  return (
    i18n('Hero_Battle_Dialog_battle_tip_battle_1') +
    label +
    i18n('Hero_Battle_Dialog_battle_type_3') +
    String(floorCount) +
    i18n('Hero_Battle_Dialog_battle_type_4') +
    '\n\n' +
    i18n('Hero_Battle_Dialog_battle_type_1') +
    '\n' +
    i18n('Hero_Battle_Dialog_battle_tip_instr_1') +
    String(heroLevel) +
    i18n('Hero_Battle_Dialog_battle_tip_battle_level') +
    '\n' +
    i18n('Hero_Battle_Dialog_battle_type_2') +
    '\n' +
    i18n('Hero_Battle_Dialog_battle_tip_instr_2') +
    String(userLevel) +
    i18n('Hero_Battle_Dialog_battle_tip_battle_level')
  );
}

// ---- hero picker (getAllHeroByUid) ----

/** A picker hero row (`sys_city_hero` + `mem_hero_blood` full row). */
export interface PickerHero extends Row {
  hid: number;
  name: string;
  heroBravery: number;
  heroImage: string;
  attack: number;
  defence: number;
  speed: number;
  isKing: boolean;
}

/** `StartChallengePanel.doCalculateHeroAttr` (AS3:3723) for an own hero row. */
export function pickerHero(hero: Row): PickerHero {
  const h: Row = { ...hero };
  const sex = int(h.sex);
  h.isKing = int(h.herotype) === 1000;
  h.heroImage = `images/hero/hero_${sex === 0 ? 'girl_' : 'boy_'}${int(h.face)}.jpg`;
  h.heroBravery = int(
    h.heroBravery ?? int(h.bravery_base) + int(h.bravery_add) + int(h.bravery_add_on),
  );
  h.attack = (int(h.bravery_base) + int(h.bravery_add) + int(h.bravery_add_on)) * 10;
  h.defence = (int(h.wisdom_base) + int(h.wisdom_add) + int(h.wisdom_add_on)) * 10;
  h.speed = int(h.speed_base) + int(h.speed_add) + int(h.speed_add_on);
  // the fight engine reads mem_hero_blood.force as the hero's energy (PKFunc.php:349)
  h.blood = int(h.force) * 50;
  return h as PickerHero;
}

/** getAllHeroByUid reply → the page rows plus the king hero appended on page 1. */
export function parseAllHeroByUid(data: unknown): {
  list: PickerHero[];
  page: number;
  king: PickerHero | null;
} {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const list = rows(d.shift()).map(pickerHero);
  const page = int(d.shift());
  const king = row(d.shift());
  return { list, page, king: king ? pickerHero(king) : null };
}

// ---- battle playback (getOneBattleRet) ----

/** One blow of the PK report (battleComute of PKFunc.php:60). */
export interface PkBlow {
  attackhid: number;
  resisthid: number;
  attacksex: number;
  resistsex: number;
  damage: number;
  blood: number;
  flag: number;
  attack: number;
  resist: number;
  battleId: number;
}

/** startUserPK result: rounds of blows; a `report` key is absent when the fight never started. */
export interface PkBattle {
  report: PkBlow[][];
  totalNum: number;
  winer: number;
  reward: unknown;
}

/** getOneBattleRet reply `[battle]` (HeroBattlePanel.getBattleData, AS3:1643). */
export function parsePkBattle(data: unknown): PkBattle | null {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const b = row(d.shift());
  if (!b) return null;
  // report is an array of arrays: a round without rows (PHP `empty($attackHero)` break) is
  // dropped server-side, the rest stay arrays.
  const report = Array.isArray(b.report) ? (b.report as unknown[]) : [];
  return {
    report: report.map((round) => (Array.isArray(round) ? (round as unknown as PkBlow[]) : [])),
    totalNum: int(b.totalNum),
    winer: int(b.winer),
    reward: b.reward ?? '',
  };
}

/** The reward rows of a won fight (`sendUserReward` rows or the '' of a loss). */
export function battleRewards(reward: unknown): Row[] {
  return rows(reward);
}

// ---- rank rewards (loadPKRewardRank / getPkFirstReward) ----

/** One first-pass rank row (ZhanJiangRewardDialog.onGetRewardData, AS3:1604). */
export interface PkRankRow {
  rankid: number;
  uid: number;
  userName: string;
  formatTime: string;
  rewardType: number;
  rewardGood: Row | null;
  rewardCount: string;
}

export function parsePkRewardRank(data: unknown): PkRankRow[] {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  return rows(d.shift()).map((r) => ({
    rankid: int(r.rankid),
    uid: int(r.uid),
    userName: String(r.userName ?? ''),
    formatTime: String(r.formatTime ?? ''),
    rewardType: int(r.rewardType),
    rewardGood: row(r.rewardGood),
    rewardCount: String(r.rewardCount ?? ''),
  }));
}

/** getPkFirstReward reply — parseAndAddReward rows, shown through the treasure popup. */
export function parsePkFirstReward(data: unknown): Row[] {
  return rows(data);
}

/** 洛阳出兵 target: the campaign dialog routes 洛阳 to luoyangTroopStart. */
export const isLuoyangTarget = (cid: number) => cid === LUOYANG_CID;
