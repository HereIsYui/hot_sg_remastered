import { describe, expect, it } from 'vitest';
import {
  goodsImage,
  itemPosition,
  pageCount,
  parseUserGoods,
  thingImage,
  treasureItems,
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
});
