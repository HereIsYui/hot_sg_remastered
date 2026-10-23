import { describe, expect, it } from 'vitest';
import {
  MAIL_PAGE,
  canWriteUnionMail,
  makeMailTime,
  pageLabel,
  parseMailDetail,
  parseMailItem,
  parseMailList,
} from './mail';

const units: Record<string, string> = {
  _Utils_1: '年',
  _Utils_2: '月',
  _Utils_3: '日',
  _Utils_5: '时',
  _Utils_6: '分',
  _Utils_7: '秒',
};
const unit = (k: string) => units[k] ?? '';

describe('makeMailTime', () => {
  it('formats a unix time two-digit with year since 2000', () => {
    // 2008-08-08 20:08:08 local
    const ts = Math.floor(new Date(2008, 7, 8, 20, 8, 8).getTime() / 1000);
    expect(makeMailTime(ts, unit)).toBe('08年08月08日20时08分08秒');
  });
});

describe('parseMailItem', () => {
  it('marks unread rows bold and defaults selected false', () => {
    const item = parseMailItem({
      mid: '5',
      title: 't',
      fromname: '张三',
      read: '0',
      posttime: '1',
    });
    expect(item.mid).toBe(5);
    expect(item.bold).toBe(true);
    expect(item.selected).toBe(false);
  });

  it('read rows are not bold', () => {
    expect(parseMailItem({ mid: 1, read: 1 }).bold).toBe(false);
  });
});

describe('parseMailList', () => {
  it('decodes pageCount/page/rows', () => {
    const reply = parseMailList('getInboxMail', [
      3,
      1,
      [
        { mid: 1, read: 0 },
        { mid: 2, read: 1 },
      ],
    ]);
    expect(reply.pageCount).toBe(3);
    expect(reply.page).toBe(1);
    expect(reply.items).toHaveLength(2);
    expect(reply.openPage).toBeUndefined();
  });

  it('getMail flag 0 opens the inbox', () => {
    const reply = parseMailList('getMail', [1, 0, [], 0]);
    expect(reply.openPage).toBe(MAIL_PAGE.inbox);
  });

  it('getMail flag 1 opens 系统信', () => {
    const reply = parseMailList('getMail', [1, 0, [], 1]);
    expect(reply.openPage).toBe(MAIL_PAGE.sys);
  });

  it('tolerates a malformed reply', () => {
    expect(parseMailList('getSysMail', null).items).toEqual([]);
  });
});

describe('pageLabel', () => {
  it('is 1-based, 0/0 when empty', () => {
    expect(pageLabel(3, 1)).toBe('2/3');
    expect(pageLabel(0, 0)).toBe('0/0');
  });
});

describe('parseMailDetail', () => {
  it('shifts the body row out', () => {
    expect(parseMailDetail([{ title: 'hi', content: 'c' }]).content).toBe('c');
    expect(parseMailDetail([])).toEqual({});
  });
});

describe('canWriteUnionMail', () => {
  it('only a 盟主/副盟主 of a real union may group-send', () => {
    expect(canWriteUnionMail(10, 4)).toBe(true);
    expect(canWriteUnionMail(10, 5)).toBe(true);
    expect(canWriteUnionMail(10, 3)).toBe(false);
    expect(canWriteUnionMail(0, 4)).toBe(false);
  });
});
