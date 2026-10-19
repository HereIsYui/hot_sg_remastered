/**
 * Flash `ColorMatrixFilter`s used on scene objects, as SVG filters (defined once by
 * ColorFilters.vue). Flash offsets are 0-255, SVG offsets 0-1.
 */

/** `BuildingGrid.mGreyFilter`. */
export const GREY_MATRIX = [
  0.3086, 0.6094, 0.082, 0, 0, 0.3086, 0.6094, 0.082, 0, 0, 0.3086, 0.6094, 0.082, 0, 0, 0.3086,
  0.6094, 0.082, 1, 0,
];

/** `BuildingGrid.mHilightFilter` / `mAnnounceHilightFilter`: +50 on each color channel. */
export const HILIGHT_MATRIX = [1, 0, 0, 0, 50, 0, 1, 0, 0, 50, 0, 0, 1, 0, 50, 0, 0, 0, 1, 0];

export function svgMatrix(flash: readonly number[]): string {
  return flash.map((v, i) => (i % 5 === 4 ? v / 255 : v)).join(' ');
}

/** CSS `filter` for a grey and/or highlighted object (grey applies first, as in `resetFilter`). */
export function colorFilter(grey: boolean, hilight: boolean): string | undefined {
  if (grey && hilight) return 'url(#fx-grey-hilight)';
  if (grey) return 'url(#fx-grey)';
  if (hilight) return 'url(#fx-hilight)';
  return undefined;
}
