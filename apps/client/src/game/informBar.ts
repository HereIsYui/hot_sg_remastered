import { reactive } from 'vue';

/**
 * `Bar.InformBar`: the scrolling notice bar above the chat panel. The queue state machine lives
 * here; the view (`views/game/InformBar.vue`) plays `current` leftwards once per pass and calls
 * `triggleNext` when the animation ends, like the original Move effect + `onMoveEnd`.
 */

/** `InformBar.addInform` default color: yellow (`InformBar.as:245`). */
export const INFORM_COLOR_YELLOW = 16776960;

/** `ChatPanel.as:144-148`: the inform frame types of the original chat push. */
export const InformType = { Chat: 0, Scroll: 1, Popup: 2 } as const;

export interface InformItem {
  str: string;
  /** Passes the message scrolls across the bar; 0 keeps it running forever. */
  scrollTimes: number;
  color: number;
}

export const informBarState = reactive({
  /** Messages waiting for the bar (`InformBar.mInforms`). */
  queue: [] as InformItem[],
  /** The message on the bar, null while the bar is hidden. */
  current: null as InformItem | null,
  /** Bumped every time a message starts, so the view re-runs its animation. */
  play: 0,
});

const clampTimes = (v: unknown): number => {
  if (v == null || v === '') return 1;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 1;
};

/** `InformBar.addInform` (InformBar.as:245): queue a message; start it at once when idle. */
export function addInform(str: string, scrollTimes = 1, color = INFORM_COLOR_YELLOW): void {
  if (!str) return;
  informBarState.queue.push({ str, scrollTimes: clampTimes(scrollTimes), color });
  if (!informBarState.current) triggleNext();
}

/** `InformBar.triggleNext` (InformBar.as:195): the next message, or hide the empty bar. */
export function triggleNext(): void {
  informBarState.current = informBarState.queue.shift() ?? null;
  informBarState.play++;
}

/** One entry of the proc 15 sys_inform frame (`ChatPanel.onNotifyInform`, ChatPanel.as:3134). */
export interface InformFrameItem {
  id: number;
  type: number;
  scrollTimes: number;
  color: number;
  msg: string;
}

const int = (v: unknown): number => parseInt(String(v), 10) || 0;

function parseInformItem(row: unknown): InformFrameItem | null {
  if (Array.isArray(row)) {
    // The binary frame laid an item out as [int id][byte type][byte scrollTimes][int color]
    // [short len][utf msg]; the JSON gateway keeps the same order without the length.
    const msg = typeof row[5] === 'string' ? row[5] : typeof row[4] === 'string' ? row[4] : '';
    return {
      id: int(row[0]),
      type: int(row[1]),
      scrollTimes: clampTimes(row[2]),
      color: int(row[3]),
      msg,
    };
  }
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const msg = String(r.msg ?? r.str ?? r.text ?? '');
  if (!msg) return null;
  return {
    id: int(r.id),
    type: int(r.type),
    scrollTimes: clampTimes(r.scrollTimes ?? r.scrollcount),
    color: int(r.color),
    msg,
  };
}

/**
 * The proc 15 payload: `[int count]{items}` in the original; over JSON an item list (objects or
 * positional arrays), a `{informs|items|list: [...]}` wrapper, or one bare item.
 */
export function parseInformFrame(data: unknown): InformFrameItem[] {
  let rows: unknown[];
  if (Array.isArray(data)) rows = data;
  else if (data && typeof data === 'object') {
    const r = data as Record<string, unknown>;
    const wrapped = [r.informs, r.items, r.list].find((v) => Array.isArray(v));
    rows = (wrapped as unknown[] | undefined) ?? [data];
  } else return [];
  return rows.map(parseInformItem).filter((v): v is InformFrameItem => v !== null);
}

/** The proc 14 GM 喊话 row (`onNotifyGMSpeek`, ChatPanel.as:728); also carries a bare sys_inform. */
export interface GMSpeakFrame {
  type: number;
  fromuid: number;
  fromuser: string;
  touid: number;
  touser: string;
  msg: string;
  scrollTimes?: number;
  color?: number;
}

export function parseGMSpeek(data: unknown): GMSpeakFrame | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const r = data as Record<string, unknown>;
  const msg = String(r.msg ?? '');
  if (!msg) return null;
  return {
    type: int(r.type),
    fromuid: int(r.fromuid),
    fromuser: String(r.fromuser ?? ''),
    touid: int(r.touid),
    touser: String(r.touser ?? ''),
    msg,
    ...(r.scrollTimes === undefined ? {} : { scrollTimes: clampTimes(r.scrollTimes) }),
    ...(r.color === undefined ? {} : { color: int(r.color) }),
  };
}

/** The per-type routing of `ChatPanel.onNotifyInform` (ChatPanel.as:3152-3161). */
export interface InformSink {
  /** TYPE_SCROLL_INFORM: the scrolling bar. */
  scroll(str: string, scrollTimes: number, color: number): void;
  /** TYPE_POPUP_INFORM: a modal Alert. */
  popup(msg: string): void;
  /** TYPE_CHAT_INFORM: a colored tip line in the global chat channel. */
  tip(msg: string): void;
}

export function dispatchInform(item: InformFrameItem, sink: InformSink): void {
  if (item.type === InformType.Scroll) sink.scroll(item.msg, item.scrollTimes, item.color);
  else if (item.type === InformType.Popup) sink.popup(item.msg);
  else if (item.type === InformType.Chat) sink.tip(item.msg);
}
