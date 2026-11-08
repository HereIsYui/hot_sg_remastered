import type { ArmorTip } from './armor';

/**
 * The chat 装备展示 link protocol (`Chat.ArmorShow` / `UI.CTextInput`): the sender wraps the
 * queued `【名】` pieces as `[item=<sid>]【名】[/item]` and appends one
 * `[tooltip id=<sid>]<tip>[/tooltip] ` per piece (`textWithItemTip`); the receiver turns the
 * markers into clickable links and pulls the tooltips out (`ArmorShow.filterTip`).
 */

/** One queued 装备展示 in the chat input (`CTextInput.mItemAttr`). */
export interface ChatItemLink {
  sid: number;
  name: string;
  /** The piece tooltip html (`ArmorTooltip` htmlText), escaped when the message is built. */
  tip: string;
}

/** `CTextInput.mItemCountLimit` — at most three queued pieces per message. */
export const CHAT_ITEM_LIMIT = 3;

/** One rendered piece of a chat line: plain text or a `[item=…]` link with its sid. */
export interface ChatItemSegment {
  text: string;
  /** null for plain text; the armor sid for a 展示 link. */
  sid: number | null;
}

export interface DecodedChatMsg {
  segments: ChatItemSegment[];
  /** sid → tooltip html, `[n]`/`[`/`]` already restored (`ArmorShow.mTips`). */
  tips: Record<number, string>;
}

/**
 * `CTextInput.addItem`: queue a piece and append `【名】` to the input text. Returns null when
 * the limit is reached — the caller shows `UserArmorItem_Full_ArmorShow`.
 */
export function appendChatItem(
  text: string,
  items: ChatItemLink[],
  link: ChatItemLink,
): { text: string; items: ChatItemLink[] } | null {
  if (items.length >= CHAT_ITEM_LIMIT) return null;
  if (!link.name) return { text, items };
  return { text: `${text}【${link.name}】`, items: [...items, link] };
}

/** `textWithItemTip`'s tip escaping: `[n]` first, then the brackets, as the AS3 does. */
export function escapeItemTip(tip: string): string {
  return tip.replace(/\n/g, '[n]').replace(/</g, '[').replace(/>/g, ']');
}

/** The receive-side restore (`ArmorShow.filterTip`). */
function restoreItemTip(tip: string): string {
  return tip.replace(/\[n\]/g, '\n').replace(/\[/g, '<').replace(/\]/g, '>');
}

/**
 * `CTextInput.textWithItemTip`: wrap the queued `【名】` occurrences in message order and append
 * the tooltip segments. The original wrapped recorded caret positions; here the first remaining
 * `【名】` occurrence per queued piece is wrapped, which keeps editing the input usable.
 */
export function encodeChatItems(text: string, items: ChatItemLink[]): string {
  let out = text;
  for (const item of items) {
    const mark = `【${item.name}】`;
    const at = out.indexOf(mark);
    if (at < 0) continue;
    out = `${out.slice(0, at)}[item=${item.sid}]${mark}[/item]${out.slice(at + mark.length)}`;
  }
  for (const item of items) {
    out += `[tooltip id=${item.sid}]${escapeItemTip(item.tip)}[/tooltip] `;
  }
  return out;
}

/**
 * `ChatPanel.filterHtmlTags` → `ArmorShow.filterTip`: pull the `[tooltip id=…]` segments out of a
 * received line and split the rest into text / item-link segments (`[item=N]【名】[/item]`).
 */
export function decodeChatItems(msg: string): DecodedChatMsg {
  let body = msg;
  const tips: Record<number, string> = {};
  // The original scans the segments manually for the tips, then strips everything from the first
  // `[tooltip id=` to the last `[/tooltip]` with one greedy regex — replicate both passes.
  let from = 0;
  for (;;) {
    const start = body.indexOf('[tooltip id=', from);
    if (start < 0) break;
    const openEnd = body.indexOf(']', start + 1);
    const end = body.indexOf('[/tooltip]', start + 1);
    if (openEnd < 0 || end < 0) break;
    const sid = parseInt(body.slice(start + '[tooltip id='.length, openEnd), 10);
    if (Number.isFinite(sid)) tips[sid] = restoreItemTip(body.slice(openEnd + 1, end));
    from = end + '[/tooltip]'.length;
  }
  const first = body.indexOf('[tooltip id=');
  if (first >= 0) {
    const lastEnd = body.lastIndexOf('[/tooltip]');
    if (lastEnd >= first) body = body.slice(0, first) + body.slice(lastEnd + '[/tooltip]'.length);
  }

  const segments: ChatItemSegment[] = [];
  const itemRe = /\[item=(\d+)\]【([\s\S]*?)】\[\/item\]/g;
  let at = 0;
  for (const m of body.matchAll(itemRe)) {
    const start = m.index ?? 0;
    if (start > at) segments.push({ text: body.slice(at, start), sid: null });
    segments.push({ text: `【${m[2]}】`, sid: parseInt(m[1] ?? '', 10) });
    at = start + m[0].length;
  }
  if (at < body.length) segments.push({ text: body.slice(at), sid: null });
  return { segments, tips };
}

/**
 * The wire form of a piece tooltip (`UserArmorItem.menuHandler` 展示):
 * `generateTitle + "\n" + generateTipText + addArmorImg`, with the quotes the input stored as
 * `'` (`CTextInput.addItem`'s `"` → `'` pass).
 */
export function armorShowTip(tip: ArmorTip, imageName: string): string {
  const title = `<b><font size="15" color="${tip.color}">${tip.title}</font></b>`;
  return `${title}\n${tip.text}<image src=${imageName}`.replace(/"/g, "'");
}

/**
 * `ArmorShowTip.setTipText`: parse a received tooltip back into an `ArmorTip` — the title font,
 * the star count from `(LV. n)` (10 at most) and the body text before the trailing image.
 */
export function parseArmorShowTip(tip: string): ArmorTip | null {
  const title = /^<b><font size='15' color='(#[0-9a-fA-F]{6})'>([\s\S]*?)<\/font><\/b>/.exec(tip);
  if (!title) return null;
  const level = /\(LV\.\s*(\d+)\)/.exec(tip);
  const stars: string[] = [];
  if (level) {
    for (let i = 0; i < Math.min(parseInt(level[1] ?? '', 10), 10); i++) {
      stars.push('images/small_star.png');
    }
  }
  const imageAt = tip.indexOf('<image src=');
  const text = imageAt >= 0 ? tip.slice(title[0].length, imageAt) : tip.slice(title[0].length);
  return {
    title: title[2] ?? '',
    color: title[1] ?? '#ffffff',
    stars,
    text: text.replace(/^\n/, ''),
    image: imageAt >= 0 ? tip.slice(imageAt + '<image src='.length) : undefined,
  };
}
