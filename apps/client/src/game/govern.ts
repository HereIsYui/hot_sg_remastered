import { i18n } from '../i18n';

/**
 * World/GovernPanel.as + WorldActionDialog.as `onGovern` (AS3 2489-2536) pure logic: the 政令
 * name / preview tables, the `getGovernInfo` reply parsing and the client-side gates checked
 * before the panel opens. The 防沉迷 reminder of `onSubmit` (AdultSrc) is not ported, and neither
 * is the `_fromFlag == 2` 洛阳 branch (`governLuoyangOthers`, a later phase).
 */

/**
 * `GovernPanel` constructor (AS3 350, `mActionSelect`): the five 政令 choices; the combo index is
 * the `type` sent to `governOthers` (0 征税 .. 4 裁军).
 */
export function governActions(): string[] {
  return [1, 2, 3, 4, 5].map((n) => i18n(`World_GovernPanelSrc_${n}`));
}

/** `mTypeName` (AS3 351): 县城 / 郡城 / 州城 / 都城 for the player's city type 1..4. */
export function governTypeName(cityType: number): string {
  return cityType >= 1 && cityType <= 4 ? i18n(`World_GovernPanelSrc_${cityType + 5}`) : '';
}

/** `mLeastofficeposName` (AS3 352): 县长 / 太守 / 州牧 / 丞相, the office a type needs. */
export function leastGovernOffice(cityType: number): string {
  return cityType >= 1 && cityType <= 4 ? i18n(`World_GovernPanelSrc_${cityType + 9}`) : '';
}

/** `mMsg` (AS3 353): the per-政令 description line shown above the counts in the preview. */
export function governMessage(actionIndex: number): string {
  return actionIndex >= 0 && actionIndex <= 4
    ? i18n(`World_GovernPanelSrc_${actionIndex + 14}`)
    : '';
}

/** The `getGovernInfo` reply (`WorldPanel.as:9340` calls `setGovernInfo` with it). */
export interface GovernInfo {
  officename: string;
  maxCount: number;
  todayCount: number;
}

const int = (v: unknown): number => parseInt(String(v), 10) || 0;

/** `[officeName, maxCount, usedToday]` (`world.commands.ts getGovernInfo`). */
export function parseGovernInfo(data: unknown): GovernInfo {
  const d = Array.isArray(data) ? (data as unknown[]) : [];
  return {
    officename: d[0] == null ? '' : String(d[0]),
    maxCount: int(d[1]),
    todayCount: int(d[2]),
  };
}

/**
 * `setGovernInfo` (AS3 392-411): null when the panel may open; the Alert text otherwise — the
 * office is too low (maxCount 0), or today's 政令 count is already spent.
 */
export function governBlockAlert(cityType: number, info: GovernInfo): string | null {
  if (info.maxCount === 0) {
    return (
      i18n('World_GovernPanelSrc_24') +
      leastGovernOffice(cityType) +
      i18n('World_GovernPanelSrc_25')
    );
  }
  if (info.todayCount >= info.maxCount) {
    return (
      info.officename +
      i18n('World_GovernPanelSrc_26') +
      governTypeName(cityType) +
      i18n('World_GovernPanelSrc_27') +
      info.maxCount +
      i18n('World_GovernPanelSrc_28') +
      info.maxCount +
      i18n('World_GovernPanelSrc_29')
    );
  }
  return null;
}

/** `onChange` (AS3 693-708, `_fromFlag == 1`): the preview text under the 政令 combo. */
export function governPreview(cityType: number, actionIndex: number, info: GovernInfo): string {
  return (
    governMessage(actionIndex) +
    '\n' +
    info.officename +
    i18n('World_GovernPanelSrc_19') +
    governTypeName(cityType) +
    i18n('World_GovernPanelSrc_20') +
    info.maxCount +
    i18n('World_GovernPanelSrc_21') +
    i18n('World_GovernPanelSrc_22') +
    (info.todayCount + 1) +
    i18n('World_GovernPanelSrc_23')
  );
}

/** `onSubmit` (AS3 565-571): `[type, tcid, tuid, cid, cityname]` for `governOthers`. */
export function governOthersArgs(
  actionIndex: number,
  targetCid: number,
  targetUid: number,
  cid: number,
  cityname: string,
): [number, number, number, number, string] {
  return [actionIndex, targetCid, targetUid, cid, cityname];
}

/** `City` fields the gates read (`WorldActionDialog.onGovern` AS3 2495-2531). */
export interface GovernCity {
  cid: number;
  /** `sys_city.type`: 5 is the DB value of an ordinary player city; the server folds it to 0. */
  type: number;
  /** `City.govermentLevel`: the 官府 (bid 6) building level, 0 without one. */
  govermentLevel: number;
  junId: number;
  provinceId: number;
}

/** The clicked cell (`mGrid`) fields the gates read. */
export interface GovernTarget {
  cid: number;
  junid: number;
  provinceid: number;
}

/** AS3 2509-2510: the 县 code packed from a city id. */
export function countyCode(cid: number): number {
  return Math.floor(cid / 10000) * 100 + Math.floor(Math.floor(cid % 1000) / 10);
}

/**
 * `WorldActionDialog.onGovern` (AS3 2489-2536): the client-side gates before `getGovernInfo` is
 * sent; returns the Alert key, or null when the command may go out. Two deliberate deviations
 * from the letter of the AS3, both to match what the server enforces anyway:
 *
 * - a type-5 city (every ordinary player city) is rejected here like type 0 — the AS3 check
 *   `City.type == 0` misses it, and its later `mLeastofficeposName[4].toString()` would throw;
 * - the 县 comparison uses the direct county-code equality of `governOthers` — the AS3 compares
 *   `Global.xianNameMap` entries, a 2173-cid table where only the first 36 counties are named, so
 *   two unnamed counties pass the client gate only to be rejected by the server.
 */
export function governGate(city: GovernCity, target: GovernTarget): string | null {
  if (city.type === 0 || city.type === 5) return 'World_WorldActionDialogSrc_22';
  if (city.govermentLevel < 10) return 'World_WorldActionDialogSrc_23';
  if (city.type === 1 && countyCode(city.cid) !== countyCode(target.cid)) {
    return 'World_WorldActionDialogSrc_24';
  }
  if (city.type === 2 && target.junid !== city.junId) return 'World_WorldActionDialogSrc_25';
  if (city.type === 3 && target.provinceid !== city.provinceId) {
    return 'World_WorldActionDialogSrc_26';
  }
  return null;
}
