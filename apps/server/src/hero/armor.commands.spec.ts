import { describe, expect, it } from 'vitest';
import { armorChips } from './armor.commands';

describe('armorChips', () => {
  it('weights the level and the 统帅/内政/勇武/智谋/速度 points, rounding up per 10', () => {
    // 洛神玉佩: 100*4 + 20*2 + 20*8 + 25*4 + 10*4 = 740
    expect(armorChips({ hero_level: '100', attribute: '4,1,20,3,20,4,25,2,10' })).toBe(74);
    // 粗麻帽: 5*4, 防御 does not count
    expect(armorChips({ hero_level: '5', attribute: '1,9,2' })).toBe(2);
    expect(armorChips({ hero_level: '1', attribute: '1,11,3' })).toBe(2);
  });

  it('gives one chip for a weightless or missing config', () => {
    expect(armorChips({ hero_level: '0', attribute: '1,9,5' })).toBe(1);
    expect(armorChips(undefined)).toBe(1);
  });
});
