import { describe, expect, it } from 'vitest';
import { maskHit } from './hitTest';

describe('maskHit', () => {
  // 2x1: an opaque red pixel, then a transparent one.
  const mask = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]) };

  it('hits opaque non-black pixels only, inside the bounds', () => {
    expect(maskHit(mask, 0.5, 0.2)).toBe(true);
    expect(maskHit(mask, 1, 0)).toBe(false);
    expect(maskHit(mask, -1, 0)).toBe(false);
    expect(maskHit(mask, 0, 1)).toBe(false);
  });
});
