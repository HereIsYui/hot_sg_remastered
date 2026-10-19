import { beforeAll, describe, expect, it } from 'vitest';
import { timeLeftText } from '../core/clock';
import { i18n, setStrings } from '../i18n';
import {
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
    Building_UpgradeBuildingItem_2_1: 'top',
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
