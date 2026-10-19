import { describe, expect, it } from 'vitest';
import { boxStyle, cssColor, textStyle } from './skin';

describe('skin helpers', () => {
  it('formats Flex colors', () => {
    expect(cssColor(15136376)).toBe('#e6f678');
    expect(cssColor('#FF0000')).toBe('#ff0000');
    expect(cssColor(0, 0.5)).toBe('rgba(0, 0, 0, 0.5)');
    expect(cssColor('red')).toBeUndefined();
  });

  it('maps coordinates and edge constraints', () => {
    expect(boxStyle({ x: 10, y: 4 }, [65, 36])).toMatchObject({
      left: '10px',
      top: '4px',
      width: '65px',
      height: '36px',
    });
    expect(boxStyle({ right: 283, bottom: 4 })).toMatchObject({
      right: '283px',
      bottom: '4px',
      left: undefined,
    });
    expect(boxStyle({ left: 6, right: 6, y: 210, h: 102 }, [50, 50])).toMatchObject({
      left: '6px',
      right: '6px',
      width: undefined,
      height: '102px',
    });
  });

  it('extracts text styles', () => {
    expect(
      textStyle({ color: 55295, fontWeight: 'bold', fontSize: 12, upSkin: 'x' }),
    ).toMatchObject({
      color: '#00d7ff',
      fontWeight: 'bold',
      fontSize: '12px',
    });
  });
});
