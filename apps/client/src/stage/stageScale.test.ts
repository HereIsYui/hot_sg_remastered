import { describe, expect, it } from 'vitest';
import { computeStageLayout } from './stageScale';

describe('computeStageLayout', () => {
  it('keeps 1:1 at the design size', () => {
    expect(computeStageLayout(1000, 600)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });

  it('letterboxes a wider viewport horizontally', () => {
    expect(computeStageLayout(1920, 600)).toEqual({ scale: 1, offsetX: 460, offsetY: 0 });
  });

  it('scales down and centers vertically on a narrow viewport', () => {
    expect(computeStageLayout(500, 600)).toEqual({ scale: 0.5, offsetX: 0, offsetY: 150 });
  });
});
