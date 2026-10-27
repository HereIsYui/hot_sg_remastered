import { beforeAll, describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  pagedRows,
  parseUnionStore,
  unionAreaText,
  unionEventText,
  unionPositionName,
  unionReportPageLabel,
} from './union';

beforeAll(() => {
  setStrings({ _Utils_11: '成员', _Utils_16: '盟主' });
});

describe('union client helpers', () => {
  it('parses pages, positions, areas and stores', () => {
    expect(pagedRows([2, 1, [{ id: 7 }]])).toEqual({ pageCount: 2, page: 1, rows: [{ id: 7 }] });
    expect(unionPositionName(0)).toBe('成员');
    expect(unionPositionName(5)).toBe('盟主');
    expect(unionAreaText([{ provincejun: '1_2' }, '3_4'])).toBe('1_2, 3_4');
    expect(parseUnionStore([9, 3, { gid: 35, goodInfo: { count: 2 } }])).toEqual({
      level: 9,
      remaining: 3,
      items: [{ gid: 35, goodInfo: { count: 2 } }],
    });
  });

  it('formats events and report pages', () => {
    expect(unionEventText([1, 0, [{ content: '甲' }, { content: '乙' }]])).toBe('甲\n乙');
    expect(unionReportPageLabel(2, 0)).toBe('1/2');
    expect(unionReportPageLabel(0, 0)).toBe('0/0');
  });
});
