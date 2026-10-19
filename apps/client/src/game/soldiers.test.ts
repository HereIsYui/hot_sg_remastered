import { beforeAll, describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import { dissolveTip, draftTip, maxDraftCount, parseArmyInfo, resourceLines } from './soldiers';

const city = {
  people_all: 1000,
  people_free: 30,
  food: 5000,
  wood: 2000,
  rock: 0,
  iron: 0,
  gold: 10,
};

const extra = [
  [
    {
      _explicitType: 'ArmySoldierState',
      sid: '1',
      sname: '民夫',
      count: 0,
      description: 'd',
      hp: '100',
      can_draft: true,
      food_use: '1',
      woodNeed: '150',
      rockNeed: '0',
      ironNeed: '0',
      foodNeed: '100',
      goldNeed: '0',
      peopleNeed: '1',
      draft_time: 12,
      conditions: [
        { type: '前提建筑', upgradeNeed: '军营(等级1)', currentOwn: '等级15', canUpgrade: true },
      ],
    },
  ],
  [
    { qid: '3', sid: '1', sname: '民夫', count: '10', state: '1', time_left: 8, accmark: '0' },
    { qid: '4', sid: '2', sname: '义兵', count: '5', state: '0', time_left: '5', accmark: '0' },
  ],
  [{ value: '5000', convert: '100' }, [['1:1', '1:1']]],
];

beforeAll(() => {
  setStrings({
    _Utils_4: '0秒',
    _Utils_7: '秒',
    Army_ArmySoldierItemSrc_1: '招募: ',
    Army_ArmySoldierItemSrc_2: '消耗粮食',
    Army_ArmySoldierItemSrc_3: '消耗木材',
    Army_ArmySoldierItemSrc_7: '解散: ',
    Army_ArmySoldierItemSrc_13: '获得粮食',
    Army_ArmySoldierItemSrc_14: '获得木材',
    Army_ArmySoldierItemSrc_15: '获得石料',
    Army_ArmySoldierItemSrc_16: '获得铁锭',
  });
});

describe('soldiers', () => {
  it('parses the 兵营 extra: soldiers, queue and the conversion allowance', () => {
    const info = parseArmyInfo(extra)!;
    expect(info.soldiers[0]).toMatchObject({
      sid: 1,
      foodNeed: 100,
      woodNeed: 150,
      draft_time: 12,
    });
    expect(info.queue.map((d) => [d.qid, d.state, d.time_left])).toEqual([
      [3, 1, 8],
      [4, 0, 5],
    ]);
    expect(info.convert).toEqual({ value: 5000, convert: 100 });
    expect(parseArmyInfo([[], [], [[0, 0], []]])!.convert).toEqual({ value: 0, convert: 0 });
    expect(parseArmyInfo(['没有该兵营信息'])).toBeNull();
  });

  it('caps the draft by people, resources and free people, ignoring gold', () => {
    const [soldier] = parseArmyInfo(extra)!.soldiers;
    expect(maxDraftCount(soldier!, city)).toBe(13);
    expect(maxDraftCount(soldier!, { ...city, people_free: 5 })).toBe(5);
    expect(maxDraftCount({ ...soldier!, goldNeed: 100 }, city)).toBe(13);
  });

  it('builds the draft tip from the conditions and costs', () => {
    const [soldier] = parseArmyInfo(extra)!.soldiers;
    const tip = draftTip(soldier!, city);
    expect(tip.title).toBe('招募: 民夫');
    expect(tip.time).toBe('12秒');
    expect(tip.rows.map((r) => [r.type, r.need, r.current, r.ok])).toEqual([
      ['前提建筑', '军营(等级1)', '等级15', true],
      ['消耗粮食', '100', '5000', true],
      ['消耗木材', '150', '2000', true],
    ]);
  });

  it('lists a third back on dissolving, keyed on the food cost as the original', () => {
    const [soldier] = parseArmyInfo(extra)!.soldiers;
    const tip = dissolveTip(soldier!, city);
    expect(tip.title).toBe('解散: 民夫');
    expect(tip.time).toBeNull();
    expect(tip.rows.map((r) => [r.type, r.need])).toEqual([
      ['获得粮食', '33'],
      ['获得木材', '50'],
      ['获得石料', '0'],
      ['获得铁锭', '0'],
    ]);
  });

  it('lists gold first in the dialog grids', () => {
    const [soldier] = parseArmyInfo(extra)!.soldiers;
    const lines = resourceLines(
      { ...soldier!, goldNeed: 3 },
      city,
      (n) => `r${n}`,
      (need) => Math.round(need * 10 * 0.33),
    );
    expect(lines).toEqual([
      { condition: 'r1', countNeed: 10, countCurrent: 10 },
      { condition: 'r2', countNeed: 330, countCurrent: 5000 },
      { condition: 'r3', countNeed: 495, countCurrent: 2000 },
    ]);
  });
});
