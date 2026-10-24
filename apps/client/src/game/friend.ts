/**
 * friend/FriendOperation.as pure logic: splitting the `getUserRelation` reply into the 好友 and
 * 仇人 lists (`onCommand`, FriendOperation.as:95-120) and the grid column sets of
 * FriendDialog.as. The reply's nobility id is mapped through the cfg_nobility names (the AS3's
 * Global.nobilityMap), and an enemy row's cid/tcid render as `[x,y]` strings.
 */

import { i18n } from '../i18n';

export interface FriendRow {
  tuid: number;
  tname: string;
  type: number;
  unionName: string;
  nobility: string;
  time: string;
  cid: string;
  tcid: string;
}

/** `Global.nobilityMap`: cfg_nobility id → name (as the client caches it). */
export type NobilityMap = Record<number, string>;

/** `xyToCid` inverse for display: a city id renders as `[x,y]` (FriendOperation.as:110-111). */
export function cidLabel(cid: number): string {
  return `[${cid % 1000},${Math.floor(cid / 1000)}]`;
}

const asRow = (r: unknown): Record<string, unknown> => (r ?? {}) as Record<string, unknown>;

/**
 * `onCommand` (FriendOperation.as:95-120): type 0 rows join the 好友 list, type 1 the 仇人 list
 * (with `[x,y]` coordinates); every nobility id becomes its name.
 */
export function parseUserRelation(
  data: unknown,
  nobilityMap: NobilityMap,
): { friends: FriendRow[]; enemies: FriendRow[] } {
  const outer = Array.isArray(data) ? (data as unknown[]) : [];
  const rows = Array.isArray(outer[0]) ? (outer[0] as unknown[]) : [];
  const friends: FriendRow[] = [];
  const enemies: FriendRow[] = [];
  for (const raw of rows) {
    const r = asRow(raw);
    const cid = Number(r.cid ?? 0);
    const tcid = Number(r.tcid ?? 0);
    const row: FriendRow = {
      tuid: Number(r.tuid ?? 0),
      tname: String(r.tname ?? ''),
      type: Number(r.type ?? 0),
      unionName: String(r.unionName ?? ''),
      nobility: nobilityMap[Number(r.nobility ?? 0)] ?? '',
      time: String(r.time ?? ''),
      cid: cidLabel(cid),
      tcid: cidLabel(tcid),
    };
    if (row.type === 0) friends.push(row);
    else if (row.type === 1) enemies.push(row);
  }
  return { friends, enemies };
}

/**
 * FriendDialog's grid columns (FriendDialog.as:226/248): the 好友 grid shows 君主名 / 爵位 /
 * 联盟 / 坐标 (the tcid column), the 仇人 grid 君主名 / 当前坐标 / 坐标 / 时间.
 */
export const FRIEND_COLUMNS: { header: string; field: keyof FriendRow; width: number }[] = [
  { header: i18n('friend_FriendDialog_4_1'), field: 'tname', width: 156 },
  { header: i18n('friend_FriendDialog_5_1'), field: 'nobility', width: 156 },
  { header: i18n('friend_FriendDialog_6_1'), field: 'unionName', width: 160 },
  { header: i18n('friend_FriendDialog_7_1'), field: 'tcid', width: 160 },
];

export const ENEMY_COLUMNS: { header: string; field: keyof FriendRow; width: number }[] = [
  { header: i18n('friend_FriendDialog_4_1'), field: 'tname', width: 156 },
  { header: i18n('friend_FriendDialog_12_1'), field: 'cid', width: 160 },
  { header: i18n('friend_FriendDialog_12_2'), field: 'tcid', width: 156 },
  { header: i18n('friend_FriendDialog_12_3'), field: 'time', width: 160 },
];
