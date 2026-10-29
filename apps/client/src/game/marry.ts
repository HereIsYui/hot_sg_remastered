import { parsePkBattle, type PkBattle } from './campaign-pk';

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v ?? 0), 10) || 0;
const row = (v: unknown): Row | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null;
const rows = (v: unknown): Row[] =>
  Array.isArray(v) ? ((v as unknown[]).filter(row) as Row[]) : [];

/**
 * MarrySystemFunc.php — the 喜结良缘 client helpers. MarryMainPanel hosts three tabs
 * (MarryKingExpr / MarryMadam / MarryChild), the action is `MarrySystem`.
 */

/** The favour stages of the 好感度 frame (Marry_System_culture_friend_1..4). */
export const FAVOR_STAGES = [
  'Marry_System_culture_friend_1',
  'Marry_System_culture_friend_2',
  'Marry_System_culture_friend_3',
  'Marry_System_culture_friend_4',
] as const;

/** The favour index 0-3 (冷漠 <20, 友善 <50, 喜欢 <80, 相爱 otherwise). */
export function favorStage(favor: number): number {
  if (favor < 20) return 0;
  if (favor < 50) return 1;
  if (favor < 80) return 2;
  return 3;
}

/** The next gift gid of a favour tier (MarrrySystemFunc gidByFavor, 12066-12069). */
export function favorGiftGid(favor: number): number {
  const f = favor >= 100 ? 99 : favor;
  if (f < 20) return 12066;
  if (f < 50) return 12067;
  if (f < 80) return 12068;
  return 12069;
}

/** A girlfriend (mem_marry_hero_favor state 0) row of MarryKingExpr. */
export interface Girlfriend extends Row {
  hid: number;
  name: string;
  favor: number;
  /** `proposeCoolTime - nowtime` seconds; <=0 may propose. */
  proposeLeftTime: number;
  heroImage: string;
  attribute: [string, string, string, string];
}

/** The girlfriend portrait (`MarryKingExpr` heroImage rule). */
export function girlImage(sex: unknown, face: unknown): string {
  return `images/hero/hero_${int(sex) === 0 ? 'girl_' : 'boy_'}${int(face)}.jpg`;
}

/** dealWithGirlfriendInfo: 9 per page with the propose cooldown (AS3:1674). */
export function parseGirlfriends(list: unknown): { girlfriends: Girlfriend[]; totalPage: number } {
  const listRows = rows(list).map((g) => {
    const girl: Row = { ...g };
    girl.proposeLeftTime = int(g.proposeCoolTime) - int(g.nowtime);
    girl.heroImage = girlImage(g.sex, g.face);
    girl.favor = int(g.favor);
    girl.attribute = [
      String(g.command ?? ''),
      String(g.affairs ?? ''),
      String(g.bravery ?? ''),
      String(g.wisdom ?? ''),
    ];
    return girl as Girlfriend;
  });
  return { girlfriends: listRows, totalPage: Math.ceil(listRows.length / 9) };
}

/** loadMarryInfo reply `[exprInfo, girlFriendInfo]`. */
export function parseMarryInfo(data: unknown): {
  kingExpr: Row | null;
  girlfriends: Girlfriend[];
  totalPage: number;
} {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const expr = row(d.shift());
  const girls = parseGirlfriends(d.shift());
  return { kingExpr: expr, ...girls };
}

/** loadMarryKingExpr / fasterKingExpr / cancelKingExpr reply `[kingExprRow]`. */
export function parseKingExpr(data: unknown): Row | null {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  return row(d.shift());
}

/** The remaining seconds of a running king expr (`endtime - nowtime`). */
export function exprLeftTime(expr: Row | null): number {
  if (!expr || expr.endtime == null) return 0;
  return Math.max(0, int(expr.endtime) - int(expr.nowtime));
}

/** A madam (mem_marry_hero_favor state <> 0) row of MarryMadam. */
export interface Madam extends Row {
  hid: number;
  name: string;
  favor: number;
  state: number;
  count: number;
  roomIsEnough: boolean;
  leaveCoolTime: number;
  nextGidName: string;
  nextGidCount: string;
  isSpeed: number;
  leaveDuringTime: number;
  heroImage: string;
}

export function parseMadams(list: unknown): Madam[] {
  return rows(list).map((m) => {
    const madam: Row = { ...m };
    madam.favor = int(m.favor);
    madam.roomIsEnough = Boolean(m.roomIsEnough);
    madam.leaveCoolTime = Math.max(0, int(m.leaveCoolTime));
    madam.nextGidName = String(m.nextGidName ?? '');
    madam.nextGidCount = String(m.nextGidCount ?? '0');
    madam.isSpeed = int(m.isSpeed);
    madam.leaveDuringTime = Math.max(0, int(m.leaveDuringTime));
    madam.heroImage = girlImage(m.sex, m.face);
    return madam as Madam;
  });
}

/** A child (sys_user_child) row of MarryChildRoom. */
export interface Child extends Row {
  hid: number;
  name: string;
  sex: number;
  roomindex: number;
  culture: number;
  motherName: string;
}

export function parseChildren(list: unknown): Child[] {
  return rows(list).map((c) => {
    const child: Row = { ...c };
    child.sex = int(c.sex);
    child.roomindex = int(c.roomindex);
    child.culture = int(c.culture);
    return child as Child;
  });
}

/** loadMarryChild reply `[roomCount, childInfos]`. */
export function parseMarryChild(data: unknown): { roomCount: number; children: Child[] } {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  return { roomCount: int(d.shift()), children: parseChildren(d.shift()) };
}

/** proposeMarry reply: with a guard NPC `[0, giftType, [king, npc], battle]`, else `[1, name]`. */
export type ProposeReply =
  { kind: 0; giftType: number; heroes: Row[]; battle: PkBattle | null } | { kind: 1; name: string };

export function parseProposeReply(data: unknown): ProposeReply | null {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  if (d.length === 0) return null;
  const kind = int(d.shift());
  if (kind === 1) return { kind: 1, name: String(d.shift() ?? '') };
  const giftType = int(d.shift());
  const heroes = rows(d.shift());
  return { kind: 0, giftType, heroes, battle: parsePkBattle(d) };
}

/** MarryHeroBattlePanel rows: one attacker + one defender from the propose heroes. */
export function proposeBattleHeroes(heroes: Row[]): { king: Row | null; npc: Row | null } {
  return { king: heroes[0] ?? null, npc: heroes[1] ?? null };
}

/** addMadamFavor reply `[message, {favor}]` (MarryKingExpr.onGetKingExprData, AS3:1815). */
export function parseAddFavor(data: unknown): { message: string; favor: number } {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const message = String(d.shift() ?? '');
  const info = row(d.shift());
  return { message, favor: info ? int(info.favor) : 0 };
}

/** loadChildCulture reply — the culture state of one child. */
export function parseChildCulture(data: unknown): Row | null {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  return row(d.shift());
}
