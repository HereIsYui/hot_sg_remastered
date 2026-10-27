export type ChatChannel = 'all' | 'world' | 'union' | 'private' | 'war';

export interface ChatLine {
  id: number;
  fromuid: number;
  fromuser: string;
  touid: number;
  touser: string;
  msg: string;
  fromdesignation: string;
  self: boolean;
  system: boolean;
}

export interface ChatSend {
  channel: Exclude<ChatChannel, 'all' | 'war'>;
  touser: string;
  msg: string;
}

const SPECIAL = new Set([
  ...` \n\r\t'".,;/?\`~!@#$%^&*()-_+=\\|[]{}！，。：；？、“”‘’￥…（）—【】`,
]);

export function parseChatInput(
  input: string,
  channel: Exclude<ChatChannel, 'all' | 'war'>,
  touser = '',
): ChatSend {
  const msg = input.replace(/[\r\n]/g, '').slice(0, 100);
  if (msg.startsWith('/')) {
    const match = /^\/([^ \u3000]+)[ \u3000]+([\s\S]+)$/.exec(msg);
    if (match) return { channel: 'private', touser: match[1]!, msg: match[2]! };
  }
  return { channel, touser: channel === 'private' ? touser.trim() : '', msg };
}

export function validChatMessage(msg: string): boolean {
  return msg.replace(/[ \u3000]/g, '').length > 0;
}

export function filterChatMessage(msg: string, keywords: string[]): string {
  let cleaned = [...msg].filter((char) => !SPECIAL.has(char)).join('');
  let filtered = false;
  for (const keyword of new Set(keywords.filter(Boolean))) {
    if (!cleaned.includes(keyword)) continue;
    cleaned = cleaned.split(keyword).join('!*%');
    filtered = true;
  }
  return filtered ? cleaned : msg;
}

export function parseChatLine(data: unknown, id: number, self = false): ChatLine {
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    id,
    fromuid: Number(row.fromuid ?? 0),
    fromuser: String(row.fromuser ?? ''),
    touid: Number(row.touid ?? 0),
    touser: String(row.touser ?? ''),
    msg: String(row.msg ?? ''),
    fromdesignation: String(row.fromdesignation ?? ''),
    self,
    system: false,
  };
}

export function chatReplyError(data: unknown): string {
  const row = (data ?? {}) as Record<string, unknown>;
  if (row.forbidden) return '你已被禁言。';
  if (row.nouser) return '私聊玩家不存在。';
  if (row.nounion) return '你尚未加入联盟。';
  if (row.empty) return '不能发送空白消息。';
  if (row.denied) return '只有管理员可以管理全服屏蔽词。';
  if (row.error) return '聊天频道设置无效。';
  return '';
}
