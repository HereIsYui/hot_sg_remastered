import { describe, expect, it } from 'vitest';
import {
  heroGoodsPromptKey,
  heroLargessArgs,
  heroLargessReply,
  isHeroLargessGoods,
} from './heroGoods';

describe('UseGoodsDialog hero rewards', () => {
  it('routes every buff/pill family by gid, while recovery, experience and oath items stay on useTypeGoods', () => {
    for (const gid of [26, 29, 116, 10150, 10155, 160023, 160031, 160040, 160051, 19201, 19205])
      expect(isHeroLargessGoods(gid)).toBe(true);
    for (const gid of [
      25, 30, 10149, 10156, 160022, 160032, 160039, 160052, 19200, 19206, 2, 3, 4, 44, 45, 46, 151,
      158,
    ])
      expect(isHeroLargessGoods(gid)).toBe(false);
  });
  it('retains the required function-name prefix and original trailing params, without inserting a count', () => {
    expect(heroLargessArgs(10001, 876543, 10152, [876543])).toEqual([
      'largessHeroWithGid',
      10001,
      876543,
      10152,
      876543,
    ]);
    expect(heroLargessArgs(10001, 876543, 26, [])).toEqual([
      'largessHeroWithGid',
      10001,
      876543,
      26,
    ]);
  });
  it('uses the original conflict warnings only for affected item grades', () => {
    expect(heroGoodsPromptKey(26)).toBe('Goods_UseGoodsDialogSrc_Hufu');
    expect(heroGoodsPromptKey(160041)).toBe('Goods_UseGoodsDialogSrc_hufu2');
    expect(heroGoodsPromptKey(160042)).toBe('Goods_UseGoodsDialogSrc_hufu1');
    for (const gid of [10152, 160028, 160040, 160045, 160048, 160051, 158])
      expect(heroGoodsPromptKey(gid)).toBeNull();
  });
  it('separates an optional attribute-pill failure tip from the hero rows without mutating the reply', () => {
    const rows = [{ hid: 1 }, { hid: 2 }, 'MSG_ACTTIP failure'];
    expect(heroLargessReply(rows)).toEqual({
      heroes: [{ hid: 1 }, { hid: 2 }],
      tip: 'MSG_ACTTIP failure',
    });
    expect(rows).toHaveLength(3);
    expect(heroLargessReply([{ hid: 1 }])).toEqual({ heroes: [{ hid: 1 }], tip: '' });
  });
});
