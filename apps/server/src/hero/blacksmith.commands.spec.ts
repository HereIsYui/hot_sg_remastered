import { describe, expect, it } from 'vitest';
import { xilianStoneCount, zuojiHoleFits } from './blacksmith.commands';

describe('zuojiHoleFits', () => {
  it('puts 讨逆 pieces 400-499 in hole (gid-400)/20', () => {
    expect(zuojiHoleFits(402, 0)).toBe(true);
    expect(zuojiHoleFits(402, 1)).toBe(false);
    expect(zuojiHoleFits(422, 1)).toBe(true);
    expect(zuojiHoleFits(489, 4)).toBe(true);
  });

  it('shifts the 圣诞 502-582, 1400-1500 and 战神 12178-12182 series to their own holes', () => {
    expect(zuojiHoleFits(502, 0)).toBe(true);
    expect(zuojiHoleFits(582, 4)).toBe(true);
    expect(zuojiHoleFits(1421, 1)).toBe(true);
    expect(zuojiHoleFits(1421, 2)).toBe(false);
    expect(zuojiHoleFits(12180, 2)).toBe(true);
    expect(zuojiHoleFits(12180, 0)).toBe(false);
  });

  it('refuses gids outside the 马装 series', () => {
    expect(zuojiHoleFits(305, 0)).toBe(false);
  });
});

describe('xilianStoneCount', () => {
  it('costs 1 stone up to 绿装, then 2 / 3 / 4 for 蓝 / 紫 / 橙', () => {
    expect([1, 2, 3, 4, 5, 6].map(xilianStoneCount)).toEqual([1, 1, 1, 2, 3, 4]);
  });

  it('cannot re-roll other colours', () => {
    expect(xilianStoneCount(0)).toBe(0);
    expect(xilianStoneCount(7)).toBe(0);
  });
});
