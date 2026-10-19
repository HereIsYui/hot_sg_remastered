import { DESIGN_HEIGHT, DESIGN_WIDTH } from '@hot/shared';

export interface StageLayout {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Letterboxed fit of the 1000x600 design stage into the viewport. */
export function computeStageLayout(viewportWidth: number, viewportHeight: number): StageLayout {
  const scale = Math.min(viewportWidth / DESIGN_WIDTH, viewportHeight / DESIGN_HEIGHT);
  return {
    scale,
    offsetX: (viewportWidth - DESIGN_WIDTH * scale) / 2,
    offsetY: (viewportHeight - DESIGN_HEIGHT * scale) / 2,
  };
}
