import { i18n } from '../i18n';

/** `Battle.BattleInfor`: the 战场说明 dialog over `getBattleInfor` / `getBattleNews`. */

type Row = Record<string, unknown>;
const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => String(v ?? '');

/** The 战况 tab's view model (`setAllInfor`). */
export interface BattleInforState {
  name: string;
  /** `images/<bid>_battle_info.jpg`, built from the current battle's bid. */
  image: string;
  content: string;
  difficulty: string;
  /** `max == level` shows the bare max, else `min~max` (the loose `==` of the AS3). */
  people: string;
  attend: string;
  winCondition: string;
  loseCondition: string;
}

/**
 * `BattlePanel.onCommand` getBattleInfor: `[name, min, max, level, content, total, win, lose]`
 * over `images/<bid>_battle_info.jpg`.
 */
export function parseBattleInforReply(d: unknown[], bid: number): BattleInforState {
  const name = str(d.shift());
  const min = d.shift();
  const max = d.shift();
  const level = d.shift();
  const content = str(d.shift());
  const attend = str(d.shift());
  const win = str(d.shift());
  const lose = str(d.shift());
  const people =
    // the cross branch always shows `max人`; locally `max == level` (loose) drops the range
    max == level ? str(max) : `${str(min)}~${str(max)}`;
  return {
    name,
    image: `images/${bid}_battle_info.jpg`,
    content,
    difficulty: str(level),
    people,
    attend,
    winCondition: win,
    loseCondition: lose,
  };
}

/** One 战报 row (`setAllNews`): time through `Utils.MakeTime`, content kept as sent. */
export interface BattleNewsItem {
  time: string;
  evtContent: string;
  /** 8161263 for the own camp's rows, 16451364 otherwise. */
  color: number;
}

/** `Utils.MakeTime`: `yy年mm月dd日 hh:mm` (two digits, year since 2000). */
export function makeNewsTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return (
    `${pad(d.getFullYear() - 2000)}${i18n('_Utils_1')}${pad(d.getMonth() + 1)}${i18n('_Utils_2')}` +
    `${pad(d.getDate())}${i18n('_Utils_3')}${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** `removeTags` — the AS3 replaces on a throw-away result, so the tags stay; kept verbatim. */
const removeTags = (msg: string): string => msg;

/** `setAllNews` over the `[total, rows]` of `getBattleNews`. */
export function parseBattleNewsReply(
  d: unknown[],
  unionid: number,
): { items: BattleNewsItem[]; pageCount: number } {
  const total = int(d.shift());
  const rows = (Array.isArray(d[0]) ? (d[0] as Row[]) : []).map((row) => ({
    time: makeNewsTime(int(row.log_time)),
    evtContent: removeTags(str(row.content)),
    color: int(unionid) === int(row.unionid) ? 8161263 : 16451364,
  }));
  const PAGE_COUNT = 10;
  return { items: rows, pageCount: Math.floor(total / PAGE_COUNT) + (total % PAGE_COUNT ? 1 : 0) };
}

/** `TaskStatusPanel.combat`: the task rows with their `okcount/count` progress label. */
export interface BattleTaskRow {
  name: string;
  todo: string;
  oklabel: string;
}

/**
 * `TaskStatusPanel.onResultLastMainTask` (+ `combat`): the 8001 chain rows of `getLastMainTask`;
 * the per-任务 counts come from the cross-server `getUserBattleThingsCount`, which the standalone
 * has no socket for — every row keeps `okcount` 0, as the panel would show without it.
 */
export function parseBattleTaskRows(d: unknown[]): BattleTaskRow[] {
  return (Array.isArray(d[0]) ? (d[0] as Row[]) : []).map((row) => {
    const count = int(row.count);
    const okcount = 0;
    return {
      name: str(row.name),
      todo: str(row.todo),
      oklabel: count > 0 ? `${okcount}/${count}` : '----',
    };
  });
}
