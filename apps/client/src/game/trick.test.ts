import { describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  parseTrickBuffer,
  parseTrickList,
  parseUseTrickReply,
  trickBufferName,
  trickCommandArgs,
  trickTarget,
} from './trick';

setStrings({
  Trick_TrickDialogSrc_1: '前往',
  Trick_TrickDialogSrc_2: '进行',
  Trick_TrickDialogSrc_3: '任务的军队',
  Trick_TrickDialogSrc_4: '前往',
  Trick_TrickDialogSrc_5: '的军队',
  Trick_TrickDialogSrc_6: '\n需要消耗<font color="#00FF00"><b>',
  Trick_TrickDialogSrc_7: '</b></font>个锦囊。\n需要消耗用计将领<font color="#00FF00"><b>',
  Trick_TrickDialogSrc_8: '</b></font>点精力。',
  Buffer_TrickBufferDialogSrc_1: '草木皆兵',
  Buffer_TrickBufferDialogSrc_6: '十面埋伏',
  Buffer_TrickBufferDialogSrc_28: '上屋抽梯',
  Buffer_TrickBufferDialogSrc_29: '趁火打劫',
  Buffer_TrickBufferDialogSrc_10001: '建筑大师',
  City_NewMap_1: '权贵之城',
  _Utils_4: '已过期',
  _Utils_5: '小时',
  _Utils_6: '分',
  _Utils_7: '秒',
});

describe('trickTarget', () => {
  it('type 0 targets the current city', () => {
    const target = trickTarget(0, [], { cid: 209355, name: '主城', position: '(355,209)' });
    expect(target).toEqual({
      trickType: 0,
      label: '主城(355,209)',
      target: 209355,
      troopHid: 0,
      troopTargetCid: 0,
    });
  });

  it('type 1 renders the clicked city name and (x,y)', () => {
    const target = trickTarget(1, [310002, '敌城'], { cid: 1, name: '', position: '' });
    expect(target.label).toBe('敌城(2,310)');
    expect(target.target).toBe(310002);
  });

  it('type 2 composes the marching-troop line', () => {
    const target = trickTarget(2, [77, 12, '敌城(2,310)', '掠夺', 310002], {
      cid: 1,
      name: '',
      position: '',
    });
    expect(target.label).toBe('前往敌城(2,310)进行掠夺任务的军队');
    expect(target.target).toBe(77);
    expect(target.troopHid).toBe(12);
    expect(target.troopTargetCid).toBe(310002);
  });

  it('type 3 composes the incoming-troop line', () => {
    const target = trickTarget(3, [88, '敌城(2,310)'], { cid: 1, name: '', position: '' });
    expect(target.label).toBe('前往敌城(2,310)的军队');
    expect(target.target).toBe(88);
  });

  it('trickCommandArgs mirrors useTrick [hid, trickid, tricktype, target]', () => {
    const target = trickTarget(2, [77, 12, 'a', 'b', 310002], { cid: 1, name: '', position: '' });
    expect(trickCommandArgs(target, 12, 10)).toEqual([12, 10, 2, 77]);
  });
});

describe('parseTrickList', () => {
  const reply = [
    [
      { id: 1, name: '草木皆兵', description: '描述', manual: '说明', usetype: 0, cost: 2 },
      { id: 10, name: '金蝉脱壳', description: '描述2', manual: '说明2', usetype: 2, cost: 3 },
    ],
    '17',
  ];

  it('appends the cost suffix and marks another usetype invalid', () => {
    const { items, bagCount } = parseTrickList(reply, 0);
    expect(bagCount).toBe(17);
    expect(items[0]).toMatchObject({ id: 1, usetype: 0, cost: 2, invalid: false });
    expect(items[0]!.description).toBe(
      '描述\n需要消耗<font color="#00FF00"><b>2</b></font>个锦囊。\n需要消耗用计将领<font color="#00FF00"><b>2</b></font>点精力。',
    );
    expect(items[1]!.invalid).toBe(true);
  });
});

describe('parseUseTrickReply', () => {
  it('splits the message and the bag count', () => {
    expect(parseUseTrickReply(['成功了', '15'])).toEqual({ message: '成功了', bagCount: 15 });
  });
});

describe('trickBufferName', () => {
  it('maps the trick buffer names by buftype', () => {
    expect(trickBufferName(1, 6)).toBe('草木皆兵');
    expect(trickBufferName(8, 0)).toBe('十面埋伏');
    expect(trickBufferName(15, 2)).toBe('趁火打劫');
    expect(trickBufferName(28, 0)).toBe('上屋抽梯');
    expect(trickBufferName(10001, 0)).toBe('建筑大师');
  });

  it('maps the City_NewMap skins by bufparam 705', () => {
    expect(trickBufferName(10932, 705)).toBe('权贵之城');
    expect(trickBufferName(12203, 705)).toBe('');
  });
});

describe('parseTrickBuffer', () => {
  it('builds the rows with the remaining time', () => {
    const rows = parseTrickBuffer([1000, [{ buftype: 1, bufparam: 6, endtime: 4600 }]]);
    expect(rows).toEqual([
      { name: '草木皆兵', time: 3600, leftTime: '1小时00分00秒', endtime: 4600 },
    ]);
  });
});
