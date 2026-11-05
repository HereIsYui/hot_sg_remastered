import { beforeAll, describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  armorItemColor,
  armorItemName,
  armorTip,
  armorTipRow,
  dealWithOtherInfoOfArmor,
  emptyArmorInfo,
  filterStoreArmors,
  isEnhanced,
  needsRenovate,
  needsRepair,
  parseArmor,
  renovateCost,
  repairCost,
  sellPrice,
  sortArmorAttr,
} from './armor';

beforeAll(() => {
  setStrings({
    Tooltip_ArmorTooltip_1_1: '头盔',
    Tooltip_ArmorTooltip_25_1: '<font color="#ff0000">耐久：',
    Tooltip_ArmorTooltip_26_1: '<font color="#ffff00">耐久：',
    Tooltip_ArmorTooltip_27_1: '耐久：',
    Tooltip_ArmorTooltip_28_1: '装备等级：',
    BlackSmith_ArmorQuailtyDesc_7: '完美的',
  });
});

const row = {
  sid: '50938',
  armorid: '12100',
  id: '12100',
  name: '白虎盔',
  part: '1',
  type: '6',
  hp: '2045',
  hp_max: '250',
  ori_hp_max: '255',
  hero_level: '120',
  strong_level: '3',
  attribute: '',
  image: '0',
};

describe('armor pieces', () => {
  it('keeps durability in whole points', () => {
    const a = parseArmor(row);
    expect(a).toMatchObject({ sid: 50938, hp: 205, hpMax: 250, oriHpMax: 255, heroLevel: 120 });
    expect(armorTipRow(a)).toMatchObject({ sid: 50938, hp: 205, hp_max: 250, ori_hp_max: 255 });
  });

  it('prices repair in gold and renovation in 元宝', () => {
    const a = parseArmor(row);
    expect(repairCost(a)).toBe(4500);
    expect(renovateCost(a)).toBe(5 + 5);
    expect(needsRepair(a)).toBe(true);
    expect(needsRenovate(a)).toBe(true);
    const whole = parseArmor({ ...row, hp: '2550', hp_max: '255' });
    expect(needsRepair(whole)).toBe(false);
    expect(needsRenovate(whole)).toBe(false);
    expect(needsRenovate(parseArmor({ ...row, hp: '2500', hp_max: '250' }))).toBe(true);
  });

  it('orders attributes by value', () => {
    expect(sortArmorAttr('3,1,5,2,9,3,7')).toEqual([2, 3, 1]);
    expect(sortArmorAttr('2,1,5')).toEqual([]);
  });
});

describe('dealWithOtherInfoOfArmor', () => {
  it('reads the six tables and leaves the rest', () => {
    const info = emptyArmorInfo();
    const rest: unknown[] = [
      [12100, [{ name: '统率', value: '3' }], 12101, []],
      [{ gid: '901', attr: '1,2,3' }],
      [{ tieid: '12007', name: '白虎套装', count: '16', armed: '2' }],
      [
        { tieid: '12007', precond: '4', name: '攻击', value: '10' },
        { tieid: '12007', precond: '4', name: '攻击', value: '10' },
      ],
      [50938, [{ name: '速度', value: '2' }]],
      [1, 50938, [7, 1, 0, 0]],
      'tail',
    ];
    dealWithOtherInfoOfArmor(info, rest);
    expect(Object.keys(info.attributes)).toEqual(['12100']);
    expect(info.embedGoodsAttr[901]).toBe('1,2,3');
    expect(info.tieInfo[12007]?.armed).toBe('2');
    expect(info.tieAttributes[12007]).toHaveLength(1);
    expect(info.deify[50938]).toHaveLength(1);
    expect(info.fusion[50938]).toEqual([7, 1, 0, 0]);
    expect(rest).toEqual(['tail']);
  });
});

describe('armorTip', () => {
  it('shows quality, level stars and durability', () => {
    const info = emptyArmorInfo();
    info.fusion[50938] = [7, 1, 0, 0];
    const tip = armorTip(info, armorTipRow(parseArmor(row)));
    expect(tip.title).toBe('完美的白虎盔  (LV. 3)');
    expect(tip.color).toBe('#ffff00');
    expect(tip.stars).toEqual(Array(3).fill('images/small_star.png'));
    expect(tip.text).toContain('头盔');
    expect(tip.text).toContain('耐久：205/250</font>');
    expect(tip.text).toContain('装备等级：120');
  });

  it('switches to moons past level ten', () => {
    const tip = armorTip(emptyArmorInfo(), { ...row, sid: undefined, strong_level: '12' });
    expect(tip.title).toBe('白虎盔  (LV. 12)');
    expect(tip.stars).toEqual(Array(12).fill('images/small_moon.png'));
  });
});

describe('gear store helpers', () => {
  const piece = (over: Record<string, unknown>) => parseArmor({ ...row, ...over });

  it('names a piece with its 熔炼 quality and colours it by type', () => {
    expect(armorItemName({ name: '白虎盔', combine_level: '7' })).toBe('完美的白虎盔');
    expect(armorItemName({ name: '白虎盔', combine_level: '0' })).toBe('白虎盔');
    expect(armorItemColor({ type: '6' })).toBe(16776960);
    expect(armorItemColor({ type: '7' })).toBe(7368816);
  });

  it('filters by part and type, 0 keeping all', () => {
    const list = [
      piece({ sid: '1', part: '1', type: '5' }),
      piece({ sid: '2', part: '2', type: '5' }),
      piece({ sid: '3', part: '1', type: '6' }),
    ];
    const sids = (part: number, type: number) =>
      filterStoreArmors(list, part, type).map((a) => a.sid);
    expect(sids(0, 0)).toEqual([1, 2, 3]);
    expect(sids(1, 0)).toEqual([1, 3]);
    expect(sids(0, 5)).toEqual([1, 2]);
    expect(sids(1, 6)).toEqual([3]);
  });

  it('prices a sale at 500 per value point, doubled by double durability', () => {
    expect(sellPrice(piece({ hp: '2050', hp_max: '250', ori_hp_max: '250', value: '4' }))).toBe(
      2000,
    );
    expect(sellPrice(piece({ hp: '5000', hp_max: '250', ori_hp_max: '250', value: '4' }))).toBe(
      4000,
    );
    expect(sellPrice(piece({ hp: '10', ori_hp_max: '0', value: '1' }))).toBe(500);
  });

  it('warns about gems, strengthening and 熔炼 before analyzing', () => {
    expect(isEnhanced({ embed_pearls: '0,0,0', strong_level: '0', combine_level: '0' })).toBe(
      false,
    );
    expect(isEnhanced({ embed_pearls: '0,305', strong_level: '0' })).toBe(true);
    expect(isEnhanced({ embed_pearls: '', strong_level: '1' })).toBe(true);
    expect(isEnhanced({ embed_pearls: '', combine_level: '2' })).toBe(true);
  });
});
