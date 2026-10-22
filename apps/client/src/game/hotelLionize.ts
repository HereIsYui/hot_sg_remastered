import { serverTime } from '../core/clock';
import { i18n } from '../i18n';

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));

/** `Define.ID_BUILDING_HOTEL`: the 客栈 dialog that hosts 结交名将 / 市井传闻. */
export const ID_BUILDING_HOTEL = 10;

/**
 * `sys_lionize.state` of a row in the 结交名将 list: 结交 (1 pursuing), 断交 (0 befriended but
 * not pursuing), 自己人 (2 own) and 俘虏 (3 captive).
 */
export const LIONIZE_STATE = { FRIEND: 0, PURSUING: 1, OWN: 2, CAPTIVE: 3 } as const;

/** A row of the 结交名将 grid (`LionizeDialog.onLoadData`). */
export interface LionizeHero {
  hid: number;
  npcid: number;
  /** The npc hero's own name (`name`). */
  name: string;
  /** The current master's lord name, `*` when nobody owns the hero (`npcname`). */
  npcname: string;
  /** The master's friendship towards the hero, `*` when none (`npcstate`). */
  npcstate: string;
  state: number;
  /** The localized state label (`friendstate`). */
  friendstate: string;
  /** This player's friendship with the hero (`friend`). */
  friend: number;
  level: number;
  command_base: number;
  command_add_on: number;
  bravery_base: number;
  bravery_add: number;
  bravery_add_on: number;
  wisdom_base: number;
  wisdom_add: number;
  wisdom_add_on: number;
  affairs_base: number;
  affairs_add: number;
  affairs_add_on: number;
  /** Buff end times that boost the four attributes by 25% while live (`buf1`..`buf4`). */
  buf1: number;
  buf2: number;
  buf3: number;
  buf4: number;
  selected: boolean;
}

function stateLabel(state: number): string {
  if (state === LIONIZE_STATE.PURSUING) return i18n('Hotel_LionizeDialogSrc_5_1');
  if (state === LIONIZE_STATE.FRIEND) return i18n('Hotel_LionizeDialogSrc_4_1');
  if (state === LIONIZE_STATE.OWN) return i18n('Hotel_LionizeDialogSrc_6_1');
  if (state === LIONIZE_STATE.CAPTIVE) return i18n('Hotel_LionizeDialogSrc_7_1');
  return '';
}

/**
 * `LionizeDialog.onLoadData`: builds the grid rows from the `[mine, all, persuadeClosed]` reply.
 * Resolves each hero's state label and blanks a missing master name / friendship with `*`.
 */
export function parseLionizeData(reply: unknown[]): {
  heroes: LionizeHero[];
  persuadeClose: boolean;
} {
  const rest = [...reply];
  const mine = Array.isArray(rest[0]) ? (rest[0] as Row[]) : [];
  // rest[1] is the full sys_lionize table (the original's per-hero 争夺 count); the new grid
  // does not show it, so it is left unread. rest[2] is the 游说 flag.
  const persuadeClose = int(rest[2]) !== 0;
  const heroes = mine.map((r): LionizeHero => {
    const npcname = str(r.npcname);
    const npcstate = r.npcstate == null ? '' : str(r.npcstate);
    const state = int(r.state);
    return {
      hid: int(r.hid),
      npcid: int(r.npcid),
      name: str(r.name),
      npcname: npcname === '' ? '*' : npcname,
      npcstate: npcstate === '' ? '*' : npcstate,
      state,
      friendstate: stateLabel(state),
      friend: int(r.friend),
      level: int(r.level),
      command_base: int(r.command_base),
      command_add_on: int(r.command_add_on),
      bravery_base: int(r.bravery_base),
      bravery_add: int(r.bravery_add),
      bravery_add_on: int(r.bravery_add_on),
      wisdom_base: int(r.wisdom_base),
      wisdom_add: int(r.wisdom_add),
      wisdom_add_on: int(r.wisdom_add_on),
      affairs_base: int(r.affairs_base),
      affairs_add: int(r.affairs_add),
      affairs_add_on: int(r.affairs_add_on),
      buf1: int(r.buf1),
      buf2: int(r.buf2),
      buf3: int(r.buf3),
      buf4: int(r.buf4),
      selected: false,
    };
  });
  return { heroes, persuadeClose };
}

/** `getCommand`: 统率 counts the level, a live buf1 adds 25%, then the temporary bonus. */
export function lionizeCommand(h: LionizeHero, now = serverTime()): number {
  let v = h.level + h.command_base;
  if (h.buf1 > now) v = Math.round(v * 1.25);
  return v + h.command_add_on;
}

/** `getBravery`: 勇猛 = base + add, +25% while buf3 is live, then the temporary bonus. */
export function lionizeBravery(h: LionizeHero, now = serverTime()): number {
  let v = h.bravery_base + h.bravery_add;
  if (h.buf3 > now) v = Math.round(v * 1.25);
  return v + h.bravery_add_on;
}

/** `getWisdom`: 智谋 = base + add, +25% while buf4 is live, then the temporary bonus. */
export function lionizeWisdom(h: LionizeHero, now = serverTime()): number {
  let v = h.wisdom_base + h.wisdom_add;
  if (h.buf4 > now) v = Math.round(v * 1.25);
  return v + h.wisdom_add_on;
}

/** `getAffairs`: 内政 = base + add, +25% while buf2 is live, then the temporary bonus. */
export function lionizeAffairs(h: LionizeHero, now = serverTime()): number {
  let v = h.affairs_base + h.affairs_add;
  if (h.buf2 > now) v = Math.round(v * 1.25);
  return v + h.affairs_add_on;
}
