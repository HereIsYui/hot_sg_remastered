/**
 * Real-time push protocol. Procedure numbers are taken verbatim from the
 * original client (`Chat/ChatPanel.as`) so the original handlers can be
 * ported one-to-one. The legacy TCP framing was
 * `[byte frameType][int16 proc][int32 length][payload]` (little endian).
 */

export enum PushFrameType {
  Request = 1,
  Reply = 2,
  Notify = 3,
}

export const PushProc = {
  CHAT_LOGIN: 1,
  CHAT_LOGOUT: 2,
  CHAT_PUBLIC_CHAT: 3,
  NOTIFY_PUBLIC_CHAT: 4,
  CHAT_UNION_CHAT: 5,
  NOTIFY_UNION_CHAT: 6,
  CHAT_PRIVATE_CHAT: 7,
  NOTIFY_PRIVATE_CHAT: 8,
  CHAT_GET_KEY_WORDS: 9,
  NOTIFY_ADD_KEY_WORD: 10,
  NOTIFY_DEL_KEY_WORD: 11,
  NOTIFY_FORBIDDEN: 12,
  NOTIFY_UNFORBIDDEN: 13,
  NOTIFY_ADMIN_SPEEK: 14,
  NOTIFY_INFORM: 15,
  CHAT_CONTROL_CHANNEL: 16,
  NOTIFY_UNION_EVENT: 17,
  NOTIFY_UNION_USER_LOGIN: 18,
  NOTIFY_UNION_USER_LOGOUT: 19,
  CHAT_ADD_FRIEND: 20,
  CHAT_ADD_ENEMY: 21,
  CHAT_REMOVE_FRIEND: 22,
  CHAT_REMOVE_ENEMY: 23,
  CHAT_APPLY_ADMIN_CHAT: 25,
  NOTIFY_ADMIN_CHAT: 26,
  CHAT_PRIVATE_TO_ADMIN: 27,
  CHAT_WAR_CHAT: 50,
  CHAT_NOTIFY_WAR_CHAT: 51,
  NOTIFY_WAR_EVENT: 52,
  NOTIFY_BATTLENET_WAITING: 53,
  CHAT_CHIBI_CHAT: 60,
  CHAT_NOTIFY_CHIBI_CHAT: 61,
  NOTIFY_CHIBI_EVENT: 62,
  NOTIFY_CHIBINET_WAITING: 63,
} as const;

export type PushProcName = keyof typeof PushProc;
export type PushProcId = (typeof PushProc)[PushProcName];

export interface PushMessage<T = unknown> {
  type: PushFrameType;
  proc: PushProcId;
  data: T;
}

export const PUSH_ENDPOINT = '/ws';
