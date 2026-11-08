import { i18n } from '../i18n';

/** `Battle.InviteUserDialog` / `Battle.BattleInviteDialog`: the battlefield member + invite UI. */

type Row = Record<string, unknown>;
const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => String(v ?? '');

/** One row of the 战场成员 grid (members first, then the pending invites). */
export interface BattleMemberRow {
  id: number;
  name: string;
  camp: string;
  state: string;
  herocount: number;
  honour: number;
  cancel: boolean;
}

/** `getBattleFieldUsers` → `[rows, joinedCount, isCreator]`. */
export function parseBattleFieldUsers(d: unknown[]): {
  rows: BattleMemberRow[];
  count: number;
  isCreator: boolean;
} {
  const rows = (Array.isArray(d[0]) ? (d[0] as Row[]) : []).map((row) => ({
    id: int(row.id ?? row.uid),
    name: str(row.name),
    camp: str(row.camp),
    state: str(row.state),
    herocount: int(row.herocount),
    honour: int(row.honour),
    cancel: Boolean(row.cancel),
  }));
  return { rows, count: int(d[1]), isCreator: Boolean(d[2]) };
}

/** `InviteUserDialog.resetCount`: `count/maxpeople`, doubled for the two-side 官渡 field. */
export function memberCountStr(count: number, maxpeople: number, bid: number): string {
  return bid === 2001 ? `${count}/${maxpeople * 2}` : `${count}/${maxpeople}`;
}

/** `inviteBattleUser` → `[flag, message, count, row?]`; the row joins the member grid. */
export function parseInviteBattleUserReply(d: unknown[]): {
  flag: number;
  message: string;
  count: number;
  row: BattleMemberRow | null;
} {
  const flag = int(d.shift());
  const message = str(d.shift());
  const count = int(d.shift());
  const raw = flag === 1 ? (d.shift() as Row | undefined) : undefined;
  const row: BattleMemberRow | null = raw
    ? {
        id: int(raw.id),
        name: str(raw.name),
        camp: str(raw.camp),
        state: str(raw.state),
        herocount: int(raw.herocount),
        honour: int(raw.honour),
        cancel: Boolean(raw.cancel),
      }
    : null;
  return { flag, message, count, row };
}

/** The private-chat line the creator's client sends the invited player (`sendBattleInvite`). */
export function battleInviteChatMessage(name: string, battlefieldid: number): string {
  return (
    i18n('Battle_BattlePanelSrc_3') +
    name +
    i18n('Battle_BattlePanelSrc_4') +
    battlefieldid +
    i18n('Battle_BattlePanelSrc_5')
  );
}

/** `cancelBattleInvite` → `[message, id]`; id 0 removes nothing. */
export function parseCancelBattleInviteReply(d: unknown[]): { message: string; id: number } {
  return { message: str(d.shift()), id: int(d.shift()) };
}

/** One 战场邀请 row (`BattleInviteDialog.showBattleInvite`); time through `Utils.MakeTime`. */
export interface BattleInviteRow {
  /** The `sys_battle_invite` id — `joinToBattle` resolves it into the battlefield. */
  id: number;
  battlename: string;
  name: string;
  level: string;
  battlefieldid: number;
  time: string;
}

/** `Utils.MakeTime` (BattleInviteDialog re-uses it for the invite list). */
export function makeInviteTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return (
    `${pad(d.getFullYear() - 2000)}${i18n('_Utils_1')}${pad(d.getMonth() + 1)}${i18n('_Utils_2')}` +
    `${pad(d.getDate())}${i18n('_Utils_3')}${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** `getBattleInvite` / `ignoreBattle` → `[rows?]` (null keeps the list empty). */
export function parseBattleInviteRows(d: unknown[]): BattleInviteRow[] {
  const rows = d[0];
  if (!Array.isArray(rows)) return [];
  return (rows as Row[]).map((row) => ({
    id: int(row.id),
    battlename: str(row.battlename),
    name: str(row.fromname),
    level: str(row.level),
    battlefieldid: int(row.battlefieldid),
    time: makeInviteTime(int(row.time)),
  }));
}
