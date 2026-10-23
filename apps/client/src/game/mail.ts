/**
 * Mail.MailDialog / MailDetailDialog / MailWriteDialog logic: parsing the `getMail` family of
 * replies into a list with page info, formatting `posttime` as the original `Utils.MakeTime`, and
 * the 联盟群发 eligibility check. The views hold only layout and command dispatch.
 */

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));

/** `MailDialog.PAGE_*`: the three mailboxes. */
export const MAIL_PAGE = { inbox: 0, outbox: 1, sys: 2 } as const;
export type MailPage = (typeof MAIL_PAGE)[keyof typeof MAIL_PAGE];

/** One row of the mail list, as `MailDialog.onCommand` builds it from the server rows. */
export interface MailItem {
  mid: number;
  title: string;
  /** Inbox / 系统信: the sender. */
  fromname: string;
  /** Outbox: the receiver. */
  name: string;
  read: number;
  /** Already formatted by `makeMailTime`. */
  posttime: string;
  /** `fontWeight`: unread rows are bold. */
  bold: boolean;
  /** Checkbox state in the list. */
  selected: boolean;
}

/** `Utils.MakeTime`: a unix time as `YY年MM月DD日 HH时MM分SS秒` (two-digit, year since 2000). */
export function makeMailTime(unixSeconds: number, unit: (key: string) => string): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const year = d.getFullYear() - 2000;
  return (
    `${pad(year)}${unit('_Utils_1')}${pad(d.getMonth() + 1)}${unit('_Utils_2')}` +
    `${pad(d.getDate())}${unit('_Utils_3')}${pad(d.getHours())}${unit('_Utils_5')}` +
    `${pad(d.getMinutes())}${unit('_Utils_6')}${pad(d.getSeconds())}${unit('_Utils_7')}`
  );
}

/** `MailDialog.onCommand`: a server mail row -> a list item (time still raw unix seconds). */
export function parseMailItem(row: Row): MailItem {
  const read = int(row.read);
  return {
    mid: int(row.mid),
    title: str(row.title),
    fromname: str(row.fromname),
    name: str(row.name),
    read,
    posttime: str(row.posttime),
    bold: read === 0,
    selected: false,
  };
}

/** The decoded `[pageCount, page, rows, flag?]` of a get / delete reply. */
export interface MailListReply {
  pageCount: number;
  page: number;
  items: MailItem[];
  /** `getMail` only: 0 opened on the inbox, 1 on 系统信. */
  openPage?: MailPage;
}

/**
 * `MailDialog.onCommand`: decode a list reply. For `getMail` the trailing flag chooses the
 * mailbox the dialog opens on.
 */
export function parseMailList(command: string, data: unknown): MailListReply {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const pageCount = int(d.shift());
  const page = int(d.shift());
  const rowsRaw = d.shift();
  const rows = Array.isArray(rowsRaw) ? (rowsRaw as Row[]) : [];
  const items = rows.map(parseMailItem);
  const reply: MailListReply = { pageCount, page, items };
  if (command === 'getMail') {
    reply.openPage = int(d.shift()) === 1 ? MAIL_PAGE.sys : MAIL_PAGE.inbox;
  }
  return reply;
}

/** `MailDialog.pageLabel`: `page+1/pageCount`, or `0/0` when empty. */
export function pageLabel(pageCount: number, page: number): string {
  return pageCount > 0 ? `${page + 1}/${pageCount}` : '0/0';
}

/** `MailDetailDialog.onCommand`: the letter body shifted out of the reply. */
export function parseMailDetail(data: unknown): Row {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const row = d.shift();
  return row && typeof row === 'object' ? (row as Row) : {};
}

/** `User.canWriteUnionMail`: 盟主 (4) or 副盟主 (5) of a real union. */
export function canWriteUnionMail(unionId: number, unionPos: number): boolean {
  return unionId > 0 && unionPos >= 4 && unionPos <= 5;
}
