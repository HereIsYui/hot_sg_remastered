import { describe, expect, it } from 'vitest';
import {
  goodsImage,
  itemPosition,
  pageCount,
  parseTypeGoods,
  parseUserGoods,
  thingImage,
  treasureItems,
  typeGoodsDialogWidth,
} from './goods';

describe('goods', () => {
  it('names images like the original', () => {
    expect(goodsImage({ gid: 67, image: 0, imagetype: 0 })).toBe('images/item_67.png');
    expect(goodsImage({ gid: 50101, image: 4, imagetype: 0 })).toBe('images/pack_4.png');
    expect(goodsImage({ gid: 210001, group: 6, image: 3 })).toBe('images/hero/hero_boy_3.jpg');
    expect(goodsImage({ gid: 211001, group: 6, image: 3 })).toBe('images/hero/hero_girl_3.jpg');
    expect(thingImage({ tid: 10400, image: 0 })).toBe('images/thing_10400.png');
    expect(thingImage({ tid: 1, image: 10012 })).toBe('images/hero/hero_boy_12.jpg');
    expect(thingImage({ tid: 1, image: 8012 })).toBe('images/hero/hero_girl_12.jpg');
  });

  it('sorts goods onto tabs and things onto the task tab', () => {
    const { tabs, goods, firstGroup } = parseUserGoods([
      [
        { gid: 2, group: 2, count: '1', value: '8', name: '神农锄' },
        { gid: 50101, group: 3, count: '1', value: '0' },
        { gid: 9999, group: 127, count: '1' },
      ],
      [{ tid: 10400, count: '5', image: 0 }],
    ]);
    expect(goods).toHaveLength(3);
    expect(tabs[2]!.map((g) => g.gid)).toEqual([2]);
    expect(tabs[2]![0]!.sellvalue).toBe(4000);
    expect(tabs[3]!.map((g) => g.gid)).toEqual([50101]);
    expect(tabs[5]!.map((g) => [g.gid, g.isThing])).toEqual([[10400, true]]);
    expect(firstGroup).toBe(2);
  });

  it('pages 21 items, 7 to a row', () => {
    expect(pageCount(0)).toBe(0);
    expect(pageCount(1)).toBe(1);
    expect(pageCount(21)).toBe(1);
    expect(pageCount(22)).toBe(2);
    expect(itemPosition(0)).toEqual({ x: 0, y: 5 });
    expect(itemPosition(8)).toEqual({ x: 88, y: 98 });
  });

  it('reads opened items of every kind', () => {
    const items = treasureItems([
      { name: '粮食', count: '4000', gid: 87, imagetype: 0, image: 0 },
      { id: 50000, name: '布衣', image: 0, cnt: '1', gtype: 1 },
      { tid: 10400, name: '令', count: '2', gtype: 2, image: 0 },
      false,
    ]);
    expect(items.map((i) => [i.imageName, i.count])).toEqual([
      ['images/item_87.png', '4000'],
      ['images/armor/50000.png', ''],
      ['images/thing_10400.png', '2'],
    ]);
  });

  it('lists the items of a use type, counting what is not owned as 0', () => {
    const items = parseTypeGoods([
      { gid: '73', name: '鲁班传人', count: '立即完成', imagetype: '0' },
      { gid: '67', name: '鲁班残页', count: null, imagetype: '0', description: 'd' },
      { gid: '68', count: '3', imagetype: '1', image: '5' },
    ]);
    expect(items.map((i) => [i.gid, i.count, i.imageName])).toEqual([
      [73, '立即完成', 'images/item_73.png'],
      [67, '0', 'images/item_67.png'],
      [68, '3', 'images/hero/hero_boy_5.jpg'],
    ]);
    expect(parseTypeGoods(null)).toEqual([]);
  });

  it('sizes the use dialog to its items', () => {
    expect(typeGoodsDialogWidth(1)).toBe(160);
    expect(typeGoodsDialogWidth(2)).toBe(213);
    expect(typeGoodsDialogWidth(6)).toBe(585);
    expect(typeGoodsDialogWidth(7)).toBe(682);
  });
});
