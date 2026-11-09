import { beforeAll, describe, expect, it } from 'vitest';
import { timeLeftText } from '../core/clock';
import { i18n, setStrings } from '../i18n';
import { parseBuilding, type BuildingState } from '../stores/city';
import {
  buildingQueueRow,
  buildingQueueRows,
  cancelQueueText,
  createBuildingTip,
  destroyBuildingTip,
  maxBuildingLevel,
  parseBuildingInfo,
  upgradeBuildingTip,
} from './buildings';

const city = { people_all: 100, food: 500, wood: 50, rock: 0, iron: 0, gold: 10.6 };

const house = parseBuildingInfo({
  _explicitType: 'BuildingInfo',
  bid: '5',
  name: '民居',
  description: 'd',
  levelDescription: 'ld',
  level: 2,
  woodNeed: '100',
  rockNeed: '0',
  ironNeed: '0',
  foodNeed: '30',
  goldNeed: '0',
  peopleNeed: 0,
  upgradeTime: '125',
  canUpgrade: false,
  conditions: [
    {
      type: '建筑图纸',
      upgradeNeed: '6个',
      currentOwn: '1个',
      canUpgrade: false,
      pre_type: '2',
      pre_id: '20',
      pre_level: '6',
    },
  ],
})!;

beforeAll(() => {
  setStrings({
    _Utils_4: '0秒',
    _Utils_5: '小时',
    _Utils_6: '分',
    _Utils_7: '秒',
    Bar_BuildingItem_3_1: '→',
    Bar_BuildingItem_4: '↑',
    Bar_BuildingItem_6: '↓',
    Building_UpgradeBuildingItem_2_1: 'top',
    Building_UpgradeBuildingItemSrc_18: '取消建造只会返还部分资源。是否取消建造',
    Building_UpgradeBuildingItemSrc_19: '(等级',
    Building_UpgradeBuildingItemSrc_20: '是否取消拆除',
    Building_UpgradeBuildingItemSrc_21: '(等级',
    Building_UpgradeBuildingItemSrc_31: '拆除到:',
    Building_UpgradeBuildingItemSrc_32: '(等级',
  });
});

describe('timeLeftText', () => {
  it('formats like Utils.MakeTimeLeftString', () => {
    expect(timeLeftText(9, i18n)).toBe('09秒');
    expect(timeLeftText(309, i18n)).toBe('05分09秒');
    expect(timeLeftText(3909, i18n)).toBe('1小时05分09秒');
    expect(timeLeftText(3600, i18n)).toBe('1小时00分00秒');
    expect(timeLeftText(-1, i18n)).toBe('0秒');
  });
});

describe('maxBuildingLevel', () => {
  it('follows the city type for resource fields', () => {
    expect(maxBuildingLevel(1, 0, 0)).toBe(12);
    expect(maxBuildingLevel(1, 4, 0)).toBe(20);
    expect(maxBuildingLevel(4, 5, 9)).toBe(15);
  });

  it('raises the king-level buildings and big cities to 15', () => {
    expect(maxBuildingLevel(20, 0, 3)).toBe(10);
    expect(maxBuildingLevel(20, 0, 4)).toBe(15);
    expect(maxBuildingLevel(5, 5, 0)).toBe(15);
  });
});

describe('building tips', () => {
  it('parses the PHP object with numeric strings', () => {
    expect(house.bid).toBe(5);
    expect(house.upgradeTime).toBe(125);
    expect(house.conditions[0]).toMatchObject({ pre_type: 2, pre_level: 6, canUpgrade: false });
  });

  it('lists conditions, then the needed resources against the city', () => {
    const tip = createBuildingTip(house, city)!;
    expect(tip.time).toBe('02分05秒');
    expect(tip.rows.map((r) => [r.need, r.current, r.ok])).toEqual([
      ['6个', '1个', false],
      ['30', '500', true],
      ['100', '50', false],
    ]);
  });

  it('answers a text at the top level', () => {
    expect(upgradeBuildingTip(house, house, 2, city)).toBe('top');
    expect(upgradeBuildingTip(null, house, 2, city)).toBeNull();
  });

  it('refunds a third and keeps the food guard of the original', () => {
    const tip = destroyBuildingTip(house, city)!;
    expect(tip.title).toBe('拆除到:民居(等级1)');
    expect(tip.time).toBe('01分02秒');
    expect(tip.rows.map((r) => r.need)).toEqual(['2个', '10', '33', '0', '0']);
  });
});

describe('building queue (TopPanel.buildingListPanel)', () => {
  const state = (over: Partial<BuildingState>): BuildingState => ({
    bid: 5,
    bname: '民居',
    description: '',
    inner: 1,
    x: 2,
    y: 3,
    level: 2,
    state: 0,
    state_starttime: 0,
    state_endtime: 0,
    state_timeleft: 0,
    ...over,
  });

  it('marks an upgrade green with the ↑ marker and cur→dst (BuildingItem.init)', () => {
    const row = buildingQueueRow(state({ level: 2, state: 1, state_endtime: 3909 }), 0);
    expect(row.name).toBe('民居↑');
    expect(row.levelText).toBe('2→3');
    expect(row.levelColor).toBe(65280);
    expect(row.left).toBe(3909);
    expect(row.leftText).toBe('1小时05分09秒');
  });

  it('marks a demolition red with the ↓ marker and the level below', () => {
    const row = buildingQueueRow(state({ level: 5, state: 2, state_endtime: 309 }), 9);
    expect(row.name).toBe('民居↓');
    expect(row.levelText).toBe('5→4');
    expect(row.levelColor).toBe(16711680);
    expect(row.leftText).toBe('05分00秒');
  });

  it('filters state>0 in city order and fills the six row slots', () => {
    const buildings: BuildingState[] = [
      state({ bid: 1, state: 0 }),
      state({ bid: 2, state: 1, state_endtime: 100 }),
      state({ bid: 3, state: 2, state_endtime: 200 }),
      state({ bid: 4, state: 1, state_endtime: 300 }),
      state({ bid: 6, state: 1, state_endtime: 400 }),
      state({ bid: 7, state: 1, state_endtime: 500 }),
      state({ bid: 8, state: 1, state_endtime: 600 }),
      state({ bid: 9, state: 1, state_endtime: 700 }),
    ];
    const rows = buildingQueueRows(buildings, 0);
    expect(rows.map((r) => r.state.bid)).toEqual([2, 3, 4, 6, 7, 8]);
    expect(buildingQueueRows(buildings, 0, 3).map((r) => r.state.bid)).toEqual([2, 3, 4]);
    expect(buildingQueueRows([], 0)).toEqual([]);
  });

  it('asks the UpgradeBuildingItem confirmation before stopping', () => {
    expect(cancelQueueText(state({ level: 2, state: 1 }))).toBe(
      '取消建造只会返还部分资源。是否取消建造民居(等级3)?',
    );
    expect(cancelQueueText(state({ level: 5, state: 2 }))).toBe('是否取消拆除民居(等级5)?');
  });

  it('builds rows from parsed sys_building rows', () => {
    const parsed = parseBuilding({
      bid: '6',
      bname: '官府',
      description: '',
      xy: '123',
      level: '4',
      state: '1',
      state_starttime: '0',
      state_endtime: '65',
      state_timeleft: '0',
    });
    expect(buildingQueueRow(parsed, 5).leftText).toBe('01分00秒');
  });
});
