import { i18n } from '../i18n';
import { makeMailTime } from './mail';

/**
 * Achivement/UserAchivement + Achivement/AchivementDialog: pure helpers of the 成就 dialogs. The
 * three read commands live in the `achivement` action (getOverviewStat / getAchivementsByGroup /
 * getAchivementDetail); the 成就排行 reuses the `rank` action's getPageRank / getRankRank /
 * getNameRank / getMyRank (the original sent them under the achivement action, whose server file
 * never had them — the port routes them where the commands are implemented).
 */

export type AchiveRow = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;

/**
 * `AchivementDialog.rankTypeData` (AS3 399): the two 排序 types of the 成就排行, in combobox order.
 */
export const ACHIVE_RANK_TYPES = ['achivement', 'achivement_point'] as const;

/** `AchivementDialog` rank row: `[updateTime, pageCount, page, type, rows]` (RankFunc reply). */
export interface AchiveRankReply {
  updateTime: number;
  pageCount: number;
  page: number;
  type: string;
  rows: AchiveRow[];
}

export function parseAchiveRankReply(data: unknown): AchiveRankReply {
  const arr = Array.isArray(data) ? data : [];
  return {
    updateTime: int(arr[0]),
    pageCount: int(arr[1]),
    page: int(arr[2]),
    type: String(arr[3] ?? ''),
    rows: Array.isArray(arr[4]) ? (arr[4] as AchiveRow[]) : [],
  };
}

/** One group row of `getOverviewStat`: {group, group_name, total_count, finish_count}. */
export interface AchiveGroup {
  group: number;
  groupName: string;
  totalCount: number;
  finishCount: number;
}

/** `UserAchivement.resetOverviewStatData` reply. */
export interface AchiveOverview {
  point: number;
  recent: AchiveRow[];
  groups: AchiveGroup[];
  /** `finish_count` / `total_count` over the shown groups (group 8 skipped without 战场网). */
  finished: number;
  total: number;
}

/**
 * `UserAchivement.resetOverviewStatData` (AS3 842-906): `[成就点数, 最近两项, 每组]`. Group 8
 * (跨服战场) joins neither the total nor the progress unless `battlenetEnabled`; the remade single
 * machine has neither battle net, so it is always skipped — matching the original's shipped flags.
 */
export function parseOverviewStat(data: unknown, battlenetEnabled = false): AchiveOverview {
  const arr = Array.isArray(data) ? [...data] : [];
  const point = int(arr.shift());
  const rawRecent = arr.shift();
  const recent = Array.isArray(rawRecent) ? (rawRecent as AchiveRow[]) : [];
  const rawGroups = arr.shift();
  const groups0 = Array.isArray(rawGroups) ? (rawGroups as AchiveRow[]) : [];
  const groups: AchiveGroup[] = [];
  let finished = 0;
  let total = 0;
  for (const row of groups0) {
    const group = int(row.group);
    if (!battlenetEnabled && group === 8) continue;
    const finishCount = int(row.finish_count);
    const totalCount = int(row.total_count);
    finished += finishCount;
    total += totalCount;
    groups.push({ group, groupName: String(row.group_name ?? ''), totalCount, finishCount });
  }
  return { point, recent, groups, finished, total };
}

/**
 * `UserAchivement.mProgressDict` order (init, AS3 1580-1592): group_name -> progress row. The
 * progress rows of the 总览 canvas are laid out in this fixed order.
 */
export const ACHIVE_PROGRESS_ORDER = [
  'Achivement_UserAchivement_6',
  'Achivement_UserAchivement_7',
  'Achivement_UserAchivement_8',
  'Achivement_UserAchivement_9',
  'Achivement_UserAchivement_12',
  'Achivement_UserAchivement_11',
  'Achivement_UserAchivement_10',
  'Achivement_UserAchivement_22',
  'Achivement_UserAchivement_23',
] as const;

/** `UserAchivement.OnCreate` group list: 总览 plus the fixed groups (跨服/赤壁 need the nets). */
export function achieveGroupNames(battlenetEnabled = false, chibinetEnabled = false): string[] {
  const names = [
    i18n('Achivement_UserAchivement_19'),
    i18n('Achivement_UserAchivement_6'),
    i18n('Achivement_UserAchivement_7'),
    i18n('Achivement_UserAchivement_8'),
    i18n('Achivement_UserAchivement_9'),
    i18n('Achivement_UserAchivement_12'),
    i18n('Achivement_UserAchivement_11'),
    i18n('Achivement_UserAchivement_10'),
  ];
  if (battlenetEnabled) names.push(i18n('Achivement_UserAchivement_22'));
  if (chibinetEnabled) names.push(i18n('Achivement_UserAchivement_23'));
  return names;
}

/**
 * `UserAchivement.reloadAchivementsByGroup` (AS3 1453-1470): `[uid, group, 0, viewType, page]`.
 * Without 战场网 a group index of 8 queries group 9 (the 赤壁 mapping quirk of the original —
 * `Global.chibinetEnabled && mCurrentViewGroup == 8` sent 9); the remade keeps the branch.
 */
export function groupQueryArgs(
  uid: number,
  viewGroup: number,
  viewType: number,
  page: number,
  battlenetEnabled = false,
  chibinetEnabled = false,
): unknown[] {
  const group = !battlenetEnabled && chibinetEnabled && viewGroup === 8 ? 9 : viewGroup;
  return [uid, group, 0, viewType, page];
}

/** `UserAchivement.resetAchivementsByGroupData` (AS3 1486-1520): `[count, rows]`, 5 per page. */
export interface AchiveGroupPage {
  pageCount: number;
  rows: AchiveRow[];
}

export function parseAchivementsByGroup(data: unknown): AchiveGroupPage {
  const arr = Array.isArray(data) ? [...data] : [];
  const count = int(arr.shift());
  const raw = arr.shift();
  const rows = Array.isArray(raw) ? (raw as AchiveRow[]) : [];
  // (count + 4) / 5 — integer division, exactly the original's page arithmetic.
  const pageCount = Math.floor((count + 4) / 5);
  return { pageCount, rows };
}

/**
 * `AchieveItem.setItem` (AS3 293-321): the image path and the gained/un-gained colouring of one
 * achievement row. `achieveGetTime` '--' means not gained yet.
 */
export interface AchiveItemView {
  id: number;
  title: string;
  intro: string;
  point: number;
  imagePath: string;
  gained: boolean;
  getTime: string;
}

export function achieveItemImage(id: number, image: unknown): string {
  return parseInt(String(image ?? 0), 10) > 0
    ? `images/achievement/${int(image)}.png`
    : `images/achievement/${id}.png`;
}

/** `Utils.MakeTime` of the achievement time (`YY年MM月DD日 HH时MM分SS秒`, as game/mail.ts). */
function makeTime(seconds: unknown): string {
  return makeMailTime(int(seconds), i18n);
}

export function achieveItemView(row: AchiveRow): AchiveItemView {
  const id = int(row.id);
  const gained = String(row.achieveGetTime ?? '--') !== '--';
  return {
    id,
    title: String(row.name ?? ''),
    intro: String(row.content ?? ''),
    point: int(row.point),
    imagePath: achieveItemImage(id, row.image),
    gained,
    getTime: gained ? makeTime(row.achieveGetTime) : '------',
  };
}

/**
 * `AchieveGuide.setAchieveItem` (AS3 995-1067): `[成就行, 进度数组, 完成人数]` of
 * getAchivementDetail; type 1 realtime (text only), type 2 cumulative (target/user value),
 * type 3 classified (per-goal done flags).
 */
export interface AchiveGuideView {
  id: number;
  name: string;
  todo: string;
  imagePath: string;
  type: number;
  userCount: unknown;
  /** type 2: the cumulative progress label (`userValue/targetValue` or the % form over 1000). */
  progressLabel: string;
  /** type 2 progress ratio 0..1. */
  progressRatio: number;
  /** type 3: the goals with their done state. */
  goals: { content: string; isDone: boolean }[];
}

export function parseAchiveDetail(data: unknown): AchiveGuideView | null {
  const arr = Array.isArray(data) ? [...data] : [];
  const info = (arr.shift() ?? null) as AchiveRow | null;
  if (!info || typeof info !== 'object') return null;
  const rawProgress = arr.shift();
  const progress = Array.isArray(rawProgress) ? (rawProgress as AchiveRow[]) : [];
  const userCount = arr.shift();
  const type = int(info.type);
  const view: AchiveGuideView = {
    id: int(info.id),
    name: String(info.name ?? ''),
    todo: String(info.todo ?? ''),
    imagePath: achieveItemImage(int(info.id), info.image),
    type,
    userCount,
    progressLabel: '',
    progressRatio: 0,
    goals: [],
  };
  if (type === 2) {
    const target = int(progress[0]?.targetValue);
    let user = int(progress[0]?.userValue);
    if (user > target) user = target;
    if (target > 1000) {
      // int(user / target * 100 + 0.5) + '%'
      view.progressLabel = `${Math.trunc((user / target) * 100 + 0.5)}%`;
    } else {
      view.progressLabel = `${user}/${target}`;
    }
    view.progressRatio = target > 0 ? Math.min(1, user / target) : 0;
  } else if (type === 3) {
    view.goals = progress.map((goal) => ({
      content: String(goal.content ?? ''),
      isDone: String(goal.isDone ?? '0') === '1',
    }));
  }
  return view;
}
