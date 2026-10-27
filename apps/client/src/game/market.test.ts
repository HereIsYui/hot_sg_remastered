import { beforeAll, describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  autoTransArgs,
  autoTransError,
  defaultAutoTransClock,
  marketCarryCap,
  parseAutoTrans,
  type AutoTransForm,
} from './market';

beforeAll(() => {
  setStrings({
    Market_AutoTransDialogSrc_1: '粮食',
    Market_AutoTransDialogSrc_2: '木材',
    Market_AutoTransDialogSrc_3: '石料',
    Market_AutoTransDialogSrc_4: '铁锭',
    Market_AutoTransDialogSrc_5: '黄金',
    Market_AddAutoTransDialogSrc_6: '年份错误',
    Market_AddAutoTransDialogSrc_7: '月份错误',
    Market_AddAutoTransDialogSrc_12: '小时错误',
    Market_AddAutoTransDialogSrc_15: '城市相同',
    Market_AddAutoTransDialogSrc_16: '时间已过',
    Market_AddAutoTransDialogSrc_17: '数量错误',
  });
});

const now = new Date(2026, 9, 26, 12, 0, 0).valueOf();
const form: AutoTransForm = {
  fromcid: 209355,
  tocid: 200350,
  resType: 2,
  count: '100',
  year: '2026',
  month: '10',
  day: '26',
  hour: '13',
  minute: '0',
  second: '0',
  daily: false,
};

describe('automatic transport form', () => {
  it('defaults to one hour later', () => {
    expect(defaultAutoTransClock(now)).toEqual({
      year: '2026',
      month: '10',
      day: '26',
      hour: '13',
      minute: '0',
      second: '0',
    });
  });

  it('accepts a valid form and builds the command arguments', () => {
    expect(autoTransError(form, now)).toBeNull();
    expect(autoTransArgs({ ...form, daily: true })).toEqual([
      209355,
      200350,
      2,
      100,
      1,
      new Date(2026, 9, 26, 13).valueOf(),
    ]);
  });

  it.each([
    [{ year: '2025' }, 'Market_AddAutoTransDialogSrc_6'],
    [{ month: '13' }, 'Market_AddAutoTransDialogSrc_7'],
    [{ hour: '24' }, 'Market_AddAutoTransDialogSrc_12'],
    [{ tocid: 209355 }, 'Market_AddAutoTransDialogSrc_15'],
    [{ hour: '11' }, 'Market_AddAutoTransDialogSrc_16'],
    [{ count: '0' }, 'Market_AddAutoTransDialogSrc_17'],
  ])('rejects %o', (patch, key) => {
    expect(autoTransError({ ...form, ...patch }, now)).toBe(key);
  });

  it('computes the market-level carrying cap', () => {
    expect(marketCarryCap(15)).toBe(1500000);
    expect(marketCarryCap(0)).toBe(0);
  });
});

describe('parseAutoTrans', () => {
  it('maps names, coordinates and the local start time', () => {
    const rows = parseAutoTrans([
      {
        id: '7',
        res_type: '1',
        count: '200',
        fromcid: '209355',
        tocid: '200350',
        fromcity: '主城',
        tocity: '分城',
        start_time: String(now / 1000),
      },
    ]);
    expect(rows[0]).toMatchObject({
      id: 7,
      resname: '木材',
      count: 200,
      fromcid: '(355,209)',
      tocid: '(350,200)',
      start_time: '2026-10-26 12:00:00',
    });
  });
});
