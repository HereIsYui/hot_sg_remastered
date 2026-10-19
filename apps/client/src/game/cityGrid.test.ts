import { describe, expect, it } from 'vitest';
import {
  innerCellPos,
  innerGridPoint,
  isCityWall,
  isValidOuterGrid,
  isWall,
  outerCellPos,
  outerGridPoint,
  VALID_GRID,
} from './cityGrid';

describe('city grid', () => {
  it('maps the centre of each inner slot back to the slot', () => {
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        const pos = innerCellPos(x, y);
        // The diamond of a 108x79 slot is centred 54 px right, 25 + 27 px down.
        expect(innerGridPoint({ x: pos.x + 54, y: pos.y + 52 })).toEqual({ x, y });
      }
    }
  });

  it('maps the centre of each field slot back to the slot', () => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 9; x++) {
        const pos = outerCellPos(x, y);
        expect(outerGridPoint({ x: pos.x + 54, y: pos.y + 39 })).toEqual({ x, y });
      }
    }
  });

  it('treats the two-cell ring around the inner grid as the wall', () => {
    expect(isWall({ x: -1, y: 3 })).toBe(true);
    expect(isWall({ x: 7, y: 7 })).toBe(true);
    expect(isWall({ x: 8, y: 0 })).toBe(false);
    expect(isWall({ x: 3, y: 3 })).toBe(false);
  });

  it('knows the walled city and the usable fields per government level', () => {
    expect(isCityWall(2, 0)).toBe(true);
    expect(isCityWall(5, -3)).toBe(true);
    expect(isCityWall(6, 0)).toBe(false);
    expect(VALID_GRID).toHaveLength(10);
    expect(VALID_GRID.every((r) => r.length === 70)).toBe(true);
    expect(isValidOuterGrid(1, 0, 1)).toBe(true);
    expect(isValidOuterGrid(7, 0, 1)).toBe(false);
    expect(isValidOuterGrid(7, 0, 2)).toBe(true);
    expect(isValidOuterGrid(4, 6, 10)).toBe(true);
    expect(isValidOuterGrid(4, 6, 25)).toBe(true);
    expect(isValidOuterGrid(1, 0, 0)).toBe(false);
  });
});
