import type { CommandArg } from '@hot/shared';
import { i18n } from '../i18n';
import { timeLeftText } from '../core/clock';

/**
 * Trick/TrickDialog + Buffer/TrickBufferDialog: pure helpers for the 计谋 dialog family. The
 * commands live in the `trick` action (getTrickList / useTrick / getTrickBuffer).
 */

export type TrickRow = Record<string, unknown>;

/** TrickDialog.TOTAL per-row size and the 7-per-row grid of trickPanel (TrickDialog.as:615-616). */
export const TRICK_GRID_COLUMNS = 7;

/** The 锦囊 item the tricks consume (`not_enough_goods13#N` buys it through the popup). */
export const GOODS_JINNANG = 13;

/**
 * `TrickDialog.onInit` (AS3 380-406): the 使用目标 line and the command target of one trick type.
 * `troopTargetCid` is 215265 (洛阳) only for a useLuoyangTrick dispatch.
 */
export interface TrickTarget {
  trickType: number;
  label: string;
  /** `mTargetCid` (type 0/1) or `mTargetTroopid` (type 2/3). */
  target: number;
  /** `mTroopHid` — the marching troop's hero for tricktype 2. */
  troopHid: number;
  /** `mTroopTargetCid` — the city the troop marches to (the 洛阳 check). */
  troopTargetCid: number;
}

/** `TrickDialog.onInit`: the target line per tricktype. */
export function trickTarget(
  trickType: number,
  params: unknown[],
  city: { cid: number; name: string; position: string },
): TrickTarget {
  if (trickType === 0) {
    return {
      trickType,
      label: city.name + city.position,
      target: city.cid,
      troopHid: 0,
      troopTargetCid: 0,
    };
  }
  if (trickType === 1) {
    const cid = parseInt(String(params[0]), 10) || 0;
    return {
      trickType,
      label: `${String(params[1] ?? '')}(${cid % 1000},${Math.floor(cid / 1000)})`,
      target: cid,
      troopHid: 0,
      troopTargetCid: 0,
    };
  }
  if (trickType === 2) {
    // i18n(Trick_TrickDialogSrc_1)+城市+i18n(_2)+任务+i18n(_3): 前往X进行Y任务的军队
    return {
      trickType,
      label:
        i18n('Trick_TrickDialogSrc_1') +
        String(params[2] ?? '') +
        i18n('Trick_TrickDialogSrc_2') +
        String(params[3] ?? '') +
        i18n('Trick_TrickDialogSrc_3'),
      target: parseInt(String(params[0]), 10) || 0,
      troopHid: parseInt(String(params[1]), 10) || 0,
      troopTargetCid: parseInt(String(params[4]), 10) || 0,
    };
  }
  // type 3: 前往X的军队
  return {
    trickType,
    label:
      i18n('Trick_TrickDialogSrc_4') + String(params[1] ?? '') + i18n('Trick_TrickDialogSrc_5'),
    target: parseInt(String(params[0]), 10) || 0,
    troopHid: 0,
    troopTargetCid: 0,
  };
}

/** A trick grid cell after `onGetTrickList` decorated the cfg_trick row. */
export interface TrickItemRow {
  id: number;
  name: string;
  description: string;
  manual: string;
  usetype: number;
  cost: number;
  /** `usetype != mTrickType`: dimmed, clicking shows the manual instead of using the trick. */
  invalid: boolean;
}

/**
 * `TrickDialog.onGetTrickList` (AS3 602-643): the reply is `[cfg_trick rows, 锦囊 count]`; the
 * description gains the 需要消耗锦囊/精力 suffix, and the row is invalid for another tricktype.
 */
export function parseTrickList(
  data: unknown,
  trickType: number,
): { items: TrickItemRow[]; bagCount: number } {
  const arr = Array.isArray(data) ? [...data] : [];
  const raw = arr.shift();
  const rows = Array.isArray(raw) ? (raw as TrickRow[]) : [];
  const items = rows.map((row) => {
    const cost = parseInt(String(row.cost ?? 0), 10) || 0;
    return {
      id: parseInt(String(row.id ?? 0), 10) || 0,
      name: String(row.name ?? ''),
      description:
        String(row.description ?? '') +
        i18n('Trick_TrickDialogSrc_6') +
        cost +
        i18n('Trick_TrickDialogSrc_7') +
        cost +
        i18n('Trick_TrickDialogSrc_8'),
      manual: String(row.manual ?? ''),
      usetype: parseInt(String(row.usetype ?? 0), 10) || 0,
      cost,
      invalid: (parseInt(String(row.usetype ?? 0), 10) || 0) !== trickType,
    };
  });
  const bagCount = parseInt(String(arr.shift() ?? 0), 10) || 0;
  return { items, bagCount };
}

/** `TrickDialog.useTrick`: `[hid, trickid, tricktype, target]` — the mTargetCid for types 0/1,
 *  the mTargetTroopid otherwise (both live in `TrickTarget.target` here). */
export function trickCommandArgs(target: TrickTarget, hid: number, trickid: number): CommandArg[] {
  return [hid, trickid, target.trickType, target.target];
}

/**
 * `TrickDialog.onCommand` for useTrick / useLuoyangTrick: `[文案, 剩余锦囊]` — the message goes to
 * a modal Alert and the 锦囊 count refreshes.
 */
export function parseUseTrickReply(data: unknown): { message: string; bagCount: number } {
  const arr = Array.isArray(data) ? [...data] : [];
  return {
    message: String(arr.shift() ?? ''),
    bagCount: parseInt(String(arr.shift() ?? 0), 10) || 0,
  };
}

/**
 * `Buffer/TrickBufferDialog.mCityBufType` (AS3 154): the name of a city buffer by buftype, for
 * the buffers the trick system writes (indices 1-8 and 15). Built per call — the strings load
 * after the module import.
 */
function cityBufType(buftype: number): string {
  const names: string[] = [
    '',
    i18n('Buffer_TrickBufferDialogSrc_1'),
    i18n('Buffer_TrickBufferDialogSrc_2'),
    i18n('Buffer_TrickBufferDialogSrc_3'),
    i18n('Buffer_TrickBufferDialogSrc_4'),
    i18n('Buffer_TrickBufferDialogSrc_5'),
    '',
    '',
    i18n('Buffer_TrickBufferDialogSrc_6'),
    '',
    '',
    '',
    '',
    '',
    '',
    i18n('Buffer_TrickBufferDialogSrc_29'),
  ];
  return names[buftype] ?? '';
}

/** `TrickBufferDialog.onCommand` (AS3 207-277): the row name per buftype/bufparam. */
export function trickBufferName(buftype: number, bufparam: number): string {
  if (buftype === 10001) return i18n('Buffer_TrickBufferDialogSrc_10001');
  if (buftype === 28) return i18n('Buffer_TrickBufferDialogSrc_28');
  if (bufparam === 705) {
    // The 名城 skins (City_NewMap_1..8) — buftype 10932..10937 / 12202 / 12203.
    const map: Record<number, number> = {
      10932: 1,
      10933: 2,
      10934: 3,
      10935: 4,
      10936: 5,
      10937: 6,
      12202: 7,
      12203: 8,
    };
    const index = map[buftype];
    return index ? i18n(`City_NewMap_${index}`) : '';
  }
  return cityBufType(buftype);
}

/** One TrickBufferDialog row: the name and the live remaining time. */
export interface TrickBufferRow {
  name: string;
  /** Seconds left, counted down every second. */
  time: number;
  leftTime: string;
  endtime: unknown;
}

/**
 * `TrickBufferDialog.onCommand` for getTrickBuffer: `[now, mem_city_buffer rows]`. `unit` formats
 * the remaining time (`Utils.MakeTimeLeftString`).
 */
export function parseTrickBuffer(
  data: unknown,
  unit: (key: string) => string = i18n,
): TrickBufferRow[] {
  const arr = Array.isArray(data) ? [...data] : [];
  const now = parseInt(String(arr.shift() ?? 0), 10) || 0;
  const raw = arr.shift();
  const rows = Array.isArray(raw) ? (raw as TrickRow[]) : [];
  return rows.map((row) => {
    const buftype = parseInt(String(row.buftype ?? 0), 10) || 0;
    const bufparam = parseInt(String(row.bufparam ?? 0), 10) || 0;
    const endtime = parseInt(String(row.endtime ?? 0), 10) || 0;
    const time = endtime - now;
    return {
      name: trickBufferName(buftype, bufparam),
      time,
      leftTime: timeLeftText(time, unit),
      endtime: row.endtime,
    };
  });
}
