import { describe, expect, it } from 'vitest';
import { AssetRegistry } from './registry';

function registry() {
  const r = new AssetRegistry('/assets/');
  r.setIndex({
    embeds: {
      'swf/UIParts.swf#board_listdown': 'swf/UIParts/sprites/DefineSprite_27_board_listdown/1.png',
    },
    slices: { 'images/button_red.png': { size: [65, 36], slice: [12, 13, 14, 12] } },
    styles: {
      Button: { color: 1, upSkin: 'images/button_red.png', fontWeight: 'bold' },
      '.Gold': { color: 2, upSkin: 'images/button_gold.png' },
      '.Big': { fontSize: 16 },
    },
  });
  return r;
}

describe('AssetRegistry', () => {
  it('maps embed sources to exported files and plain paths to themselves', () => {
    const r = registry();
    expect(r.url('swf/UIParts.swf#board_listdown')).toBe(
      '/assets/swf/UIParts/sprites/DefineSprite_27_board_listdown/1.png',
    );
    expect(r.url('images/PTELOGO.png?r=20110620')).toBe('/assets/images/PTELOGO.png');
    expect(r.url('/images/a.jpg')).toBe('/assets/images/a.jpg');
  });

  it('looks up 9-slice insets by source', () => {
    expect(registry().slice('images/button_red.png')?.slice).toEqual([12, 13, 14, 12]);
    expect(registry().slice('images/none.png')).toBeUndefined();
  });

  it('applies type selector, style names and inline styles in order', () => {
    expect(registry().style('Button', 'Gold Big', { fontSize: 14 })).toEqual({
      color: 2,
      upSkin: 'images/button_gold.png',
      fontWeight: 'bold',
      fontSize: 14,
    });
  });
});
