import { describe, expect, it } from 'vitest';
import {
  convertChoices,
  convertDoneText,
  convertRate,
  convertedCount,
  maxConvertFrom,
  maxConvertTo,
  sourceCount,
} from './soldierConvert';
import type { ArmySoldierState } from './soldiers';

const soldier = (sid: number, count: number, techOk = true) =>
  ({
    sid,
    sname: `兵${sid}`,
    count,
    conditions: [
      { type: '前提建筑', upgradeNeed: '', currentOwn: '', canUpgrade: false },
      { type: '前提科技', upgradeNeed: '', currentOwn: '', canUpgrade: techOk },
    ],
  }) as unknown as ArmySoldierState;

const rates = [
  ['1:1', '1:1', '2:1'],
  ['1:1', '1:1', '2:1'],
  ['1:2', '1:2', '1:1'],
];

describe('soldier conversion', () => {
  it('offers owned soldiers to give up and researched ones to get, never the special ones', () => {
    const { from, to } = convertChoices([
      soldier(1, 100),
      soldier(2, 0),
      soldier(3, 5, false),
      soldier(45, 9),
    ]);
    expect(from.map((c) => c.sid)).toEqual([1, 3]);
    expect(to.map((c) => c.sid)).toEqual([1, 2]);
  });

  it('limits both sides by the day’s military population', () => {
    const from = { sid: 1, name: '', count: 100 };
    const archer = { sid: 3, name: '', count: 0 };
    const cavalry = { sid: 8, name: '', count: 0 };
    expect(maxConvertFrom(60, from)).toBe(60);
    expect(maxConvertFrom(500, from)).toBe(100);
    expect(maxConvertTo(60, from, archer, convertRate(rates, 1, 3))).toBe(30);
    expect(maxConvertTo(60, from, cavalry, '1:1')).toBe(10);
    expect(maxConvertTo(60, from, archer, '')).toBe(0);
    expect(maxConvertTo(60, null, archer, '1:1')).toBe(0);
  });

  it('turns counts over by the ratio, within the limits', () => {
    expect(convertedCount(7, '2:1', 30, 0)).toBe(3);
    expect(convertedCount(100, '1:2', 30, 0)).toBe(30);
    expect(convertedCount(5, '', 30, 4)).toBe(4);
    expect(sourceCount(3, '2:1', 60, 7)).toBe(6);
    expect(sourceCount(3, '2:1', 5, 7)).toBe(5);
  });

  it('announces the conversion', () => {
    expect(convertDoneText('n个XX成功转化为m个YY', 6, '民夫', 3, '弓箭手')).toBe(
      '6个民夫成功转化为3个弓箭手',
    );
  });
});
