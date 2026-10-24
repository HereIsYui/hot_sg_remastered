import { beforeAll, describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  countyCode,
  governActions,
  governBlockAlert,
  governGate,
  governMessage,
  governOthersArgs,
  governPreview,
  governTypeName,
  leastGovernOffice,
  parseGovernInfo,
} from './govern';

beforeAll(() => {
  setStrings({
    World_GovernPanelSrc_1: '征税',
    World_GovernPanelSrc_2: '抽丁',
    World_GovernPanelSrc_3: '征粮',
    World_GovernPanelSrc_4: '收编',
    World_GovernPanelSrc_5: '裁军',
    World_GovernPanelSrc_6: '县城',
    World_GovernPanelSrc_7: '郡城',
    World_GovernPanelSrc_8: '州城',
    World_GovernPanelSrc_9: '都城',
    World_GovernPanelSrc_10: '县长',
    World_GovernPanelSrc_11: '太守',
    World_GovernPanelSrc_12: '州牧',
    World_GovernPanelSrc_13: '丞相',
    World_GovernPanelSrc_14: '向该城收税，可获得该城黄金的10%。',
    World_GovernPanelSrc_15: '向该城抽丁，可获得该城人口的20%。',
    World_GovernPanelSrc_16: '向该城征粮，可获得该城粮食的10%。',
    World_GovernPanelSrc_17: '向该城收编军队。',
    World_GovernPanelSrc_18: '责令该城裁军。',
    World_GovernPanelSrc_19: '在',
    World_GovernPanelSrc_20: '每天可以下达 ',
    World_GovernPanelSrc_21: ' 次政令',
    World_GovernPanelSrc_22: '这是你今天第 ',
    World_GovernPanelSrc_23: ' 次下达政令。',
    World_GovernPanelSrc_24: '你的官职必须达到',
    World_GovernPanelSrc_25: '以上，才能行使政令特权。',
    World_GovernPanelSrc_26: '在',
    World_GovernPanelSrc_27: '每天可以下达',
    World_GovernPanelSrc_28: '次政令,你今天已经下令',
    World_GovernPanelSrc_29: '次，不能再下令了',
  });
});

describe('govern tables (GovernPanel constructor, AS3 350-353)', () => {
  it('lists the five 政令 in governOthers type order', () => {
    expect(governActions()).toEqual(['征税', '抽丁', '征粮', '收编', '裁军']);
  });

  it('maps city type 1..4 to the 名城 and office names', () => {
    expect(governTypeName(1)).toBe('县城');
    expect(governTypeName(4)).toBe('都城');
    expect(leastGovernOffice(1)).toBe('县长');
    expect(leastGovernOffice(4)).toBe('丞相');
  });

  it('returns empty strings outside type 1..4 instead of undefined', () => {
    expect(governTypeName(0)).toBe('');
    expect(governTypeName(5)).toBe('');
    expect(leastGovernOffice(5)).toBe('');
    expect(governMessage(5)).toBe('');
    expect(governMessage(-1)).toBe('');
  });

  it('picks the per-政令 description by combo index', () => {
    expect(governMessage(0)).toContain('黄金的10%');
    expect(governMessage(4)).toContain('裁军');
  });
});

describe('parseGovernInfo (getGovernInfo reply)', () => {
  it('reads [officeName, maxCount, usedToday]', () => {
    expect(parseGovernInfo(['太守', 3, 0])).toEqual({
      officename: '太守',
      maxCount: 3,
      todayCount: 0,
    });
  });

  it('parses the string counts and tolerates a null office name', () => {
    expect(parseGovernInfo([null, '5', '2'])).toEqual({
      officename: '',
      maxCount: 5,
      todayCount: 2,
    });
  });

  it('survives a malformed reply', () => {
    expect(parseGovernInfo(undefined)).toEqual({ officename: '', maxCount: 0, todayCount: 0 });
  });
});

describe('governBlockAlert (setGovernInfo, AS3 392-411)', () => {
  it('blocks a maxCount of 0 with the office alert', () => {
    expect(governBlockAlert(1, { officename: '平民', maxCount: 0, todayCount: 0 })).toBe(
      '你的官职必须达到县长以上，才能行使政令特权。',
    );
  });

  it('blocks once the daily count is spent', () => {
    expect(governBlockAlert(4, { officename: '丞相', maxCount: 10, todayCount: 10 })).toBe(
      '丞相在都城每天可以下达10次政令,你今天已经下令10次，不能再下令了',
    );
  });

  it('allows opening while counts remain', () => {
    expect(governBlockAlert(2, { officename: '太守', maxCount: 5, todayCount: 4 })).toBeNull();
  });
});

describe('governPreview (onChange, AS3 693-708)', () => {
  it('composes the description line and the daily counts', () => {
    expect(governPreview(3, 0, { officename: '州牧', maxCount: 8, todayCount: 2 })).toBe(
      '向该城收税，可获得该城黄金的10%。\n州牧在州城每天可以下达 8 次政令这是你今天第 3 次下达政令。',
    );
  });

  it('follows the selected 政令', () => {
    expect(governPreview(1, 1, { officename: '县长', maxCount: 1, todayCount: 0 })).toContain(
      '人口的20%',
    );
  });
});

describe('governOthersArgs (onSubmit, AS3 565-571)', () => {
  it('sends [type, target cid, target uid, own cid, own city name]', () => {
    expect(governOthersArgs(2, 188128, 1002, 209355, '南皮')).toEqual([
      2,
      188128,
      1002,
      209355,
      '南皮',
    ]);
  });
});

describe('governGate (WorldActionDialog.onGovern, AS3 2489-2536)', () => {
  const cell = { cid: 188128, junid: 5, provinceid: 10 };

  it('rejects a city that is not a 名城 (type 0, and the DB type 5 like the server)', () => {
    const ordinary = { cid: 209355, type: 5, govermentLevel: 15, junId: 8, provinceId: 4 };
    expect(governGate({ ...ordinary, type: 0 }, cell)).toBe('World_WorldActionDialogSrc_22');
    expect(governGate(ordinary, cell)).toBe('World_WorldActionDialogSrc_22');
  });

  it('rejects a 官府 below level 10', () => {
    expect(
      governGate({ cid: 209355, type: 2, govermentLevel: 9, junId: 5, provinceId: 10 }, cell),
    ).toBe('World_WorldActionDialogSrc_23');
  });

  it('checks the 县 for a 县城 by the packed county code', () => {
    const county = (cid: number) => ({
      cid,
      type: 1,
      govermentLevel: 15,
      junId: 8,
      provinceId: 4,
    });
    // same 县: 245315 and 245318 pack to the same code 2431
    expect(countyCode(245315)).toBe(2431);
    expect(countyCode(245318)).toBe(2431);
    expect(governGate(county(245315), { ...cell, cid: 245318 })).toBeNull();
    expect(governGate(county(245315), cell)).toBe('World_WorldActionDialogSrc_24');
  });

  it('checks the 郡 for a 郡城 and the 州 for a 州城', () => {
    const junCity = { cid: 209355, type: 2, govermentLevel: 15, junId: 8, provinceId: 4 };
    expect(governGate(junCity, cell)).toBe('World_WorldActionDialogSrc_25');
    expect(governGate(junCity, { ...cell, junid: 8 })).toBeNull();
    const zhou = { ...junCity, type: 3 };
    expect(governGate(zhou, { ...cell, junid: 8 })).toBe('World_WorldActionDialogSrc_26');
    expect(governGate(zhou, { ...cell, junid: 8, provinceid: 4 })).toBeNull();
  });

  it('runs no range gate for a 都城', () => {
    expect(
      governGate(
        { cid: 209355, type: 4, govermentLevel: 15, junId: 8, provinceId: 4 },
        { cid: 495435, junid: 49, provinceid: 13 },
      ),
    ).toBeNull();
  });
});
