import { beforeAll, describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  defenceTip,
  dissolveDefenceTip,
  maxReinforceCount,
  parseWallInfo,
  reinforceTip,
} from './defences';

const city = { people_all: 1000, food: 5000, wood: 2000, rock: 450, iron: 0, gold: 10 };

const extra = [
  [
    {
      _explicitType: 'WallDefenceState',
      did: '1',
      dname: '陷阱',
      count: '4',
      description: 'd',
      hp: '0',
      ap: '0',
      dp: '0',
      range: '2000',
      can_reinforce: true,
      woodNeed: '500',
      rockNeed: '100',
      ironNeed: '0',
      foodNeed: '50',
      goldNeed: '0',
      areaNeed: '1',
      reinforce_time: 42.857142857143,
      conditions: [
        { type: '前提建筑', upgradeNeed: '城墙(等级1)', currentOwn: '等级15', canUpgrade: true },
      ],
    },
  ],
  [
    { qid: '7', did: '1', dname: '陷阱', count: '10', state: '1', time_left: 60, accmark: '1' },
    { qid: '8', did: '2', dname: '拒马', count: '5', state: '0', time_left: '428', accmark: '0' },
  ],
  '150000',
  13,
];

beforeAll(() => {
  setStrings({
    _Utils_4: '0秒',
    _Utils_7: '秒',
    Wall_WallDefenceItemSrc_1: '建造: ',
    Wall_WallDefenceItemSrc_2: '消耗粮食',
    Wall_WallDefenceItemSrc_3: '消耗木材',
    Wall_WallDefenceItemSrc_4: '消耗石料',
    Wall_WallDefenceItemSrc_7: '拆除: ',
    Wall_WallDefenceItemSrc_13: '获得粮食',
    Wall_WallDefenceItemSrc_14: '获得木材',
    Wall_WallDefenceItemSrc_15: '获得石料',
    Wall_WallDefenceItemSrc_16: '获得铁锭',
    Wall_WallDefenceItemSrc_18: '\n生命 ',
    Wall_WallDefenceItemSrc_19: '\n攻击 ',
    Wall_WallDefenceItemSrc_20: '\n防御 ',
    Wall_WallDefenceItemSrc_21: '\n射程 ',
    Wall_WallDefenceItemSrc_22: '\n空间 ',
  });
});

describe('defences', () => {
  it('parses the 城墙 extra: defences, queue and wall space', () => {
    const info = parseWallInfo(extra)!;
    expect(info.defences[0]).toMatchObject({ did: 1, count: 4, woodNeed: 500, areaNeed: 1 });
    expect(info.queue.map((r) => [r.qid, r.state, r.time_left, r.accmark])).toEqual([
      [7, 1, 60, 1],
      [8, 0, 428, 0],
    ]);
    expect([info.area, info.areaUsed]).toEqual([150000, 13]);
    expect(parseWallInfo(['没有该城墙信息'])).toBeNull();
  });

  it('caps the build by people and all five resources', () => {
    const [defence] = parseWallInfo(extra)!.defences;
    expect(maxReinforceCount(defence!, city)).toBe(4);
    expect(maxReinforceCount({ ...defence!, goldNeed: 5 }, city)).toBe(2);
    expect(maxReinforceCount(defence!, { ...city, people_all: 1 })).toBe(1);
  });

  it('builds the tips from the conditions, costs and stats', () => {
    const [defence] = parseWallInfo(extra)!.defences;
    const tip = reinforceTip(defence!, city);
    expect(tip.title).toBe('建造: 陷阱');
    expect(tip.time).toBe('42秒');
    expect(tip.rows.map((r) => [r.type, r.need, r.ok])).toEqual([
      ['前提建筑', '城墙(等级1)', true],
      ['消耗粮食', '50', true],
      ['消耗木材', '500', true],
      ['消耗石料', '100', true],
    ]);
    expect(dissolveDefenceTip(defence!, city).rows.map((r) => [r.type, r.need])).toEqual([
      ['获得粮食', '16'],
      ['获得木材', '166'],
      ['获得石料', '33'],
      ['获得铁锭', '0'],
    ]);
    expect(defenceTip(defence!)).toBe('陷阱\nd\n\n生命 0\n攻击 0\n防御 0\n射程 2000\n空间 1');
  });
});
