/** Isometric grid math of the city views (`Utils` inner grid, `CityPanel` outer grid). */

export interface Point {
  x: number;
  y: number;
}

export const BUILDING_GOVERNMENT = 6;
export const BUILDING_COLLEGE = 7;
export const BUILDING_GROUND = 8;
export const BUILDING_ARMY = 9;
export const BUILDING_HOTEL = 10;
export const BUILDING_MARKET = 13;
export const BUILDING_BLACKSMITH = 14;
export const BUILDING_BARN = 16;
export const BUILDING_STORE = 17;
export const BUILDING_WALL = 20;

export const INNER_GRID_LEFT = 356;
export const INNER_GRID_TOP = 130;
export const INNER_GRID_OFFX = 54;
export const INNER_GRID_OFFY = 27;
export const INNER_GRID_COUNT = 6;

export const OUTER_GRID_LEFT = 230;
export const OUTER_GRID_TOP = 135;
export const OUTER_GRID_OFFX = 54;
export const OUTER_GRID_OFFY = 27;
export const OUTER_GRID_COUNT_X = 9;
export const OUTER_GRID_COUNT_Y = 7;

/** Embedded building bitmaps: inner by `bid - 5`, fields by `bid - 1`. */
export const INNER_BUILDING_IMAGES = [
  'house',
  'cityhall',
  'institute',
  'forceyard',
  'barrack',
  'inn',
  'recruithall',
  'temple',
  'market',
  'blacksmith',
  'warhouse',
  'stable',
  'barn',
  'hotel',
  'tower',
  'citywall',
  'townwall',
].map((n) => `symbol:CityInnerPanel_${n}`);
export const OUTER_BUILDING_IMAGES = ['farm', 'logcamp', 'stonepit', 'mine'].map(
  (n) => `symbol:CityPanel_${n}`,
);

/** `CityPanel.VALID_GRID_ARRAY`: usable field cells (y * 10 + x) per government level 1-10. */
const VALID_GRID_ROWS = [
  '01000010000111111000001111',
  '010000110001111111000011111',
  '010000110001111111000011111000000111',
  '0100001100011111111000111111000001111',
  '0100001100111111111001111111000011111',
  '0100001100111111111001111111000011111000000111',
  '01000011001111111110011111111000111111000001111',
  '010000110011111111100111111110001111110000011110000000111',
  '010000110011111111101111111110011111110000111110000000111',
  '010000110011111111101111111110011111110000111110000001111000000011',
];
export const VALID_GRID: readonly (readonly number[])[] = VALID_GRID_ROWS.map((r) =>
  Array.from({ length: 70 }, (_, i) => (r[i] === '1' ? 1 : 0)),
);

/** `Utils.getInnerGridPoint`. */
export function innerGridPoint(p: Point): Point {
  return {
    x: Math.floor((2 * (p.y - INNER_GRID_TOP) + (p.x - INNER_GRID_LEFT)) / (INNER_GRID_OFFX * 2)),
    y: Math.floor((2 * (p.y - INNER_GRID_TOP) - (p.x - INNER_GRID_LEFT)) / (INNER_GRID_OFFX * 2)),
  };
}

/** `CityPanel.getGridPoint`. */
export function outerGridPoint(p: Point): Point {
  return {
    x: Math.floor((2 * (p.y - OUTER_GRID_TOP) + (p.x - OUTER_GRID_LEFT)) / (OUTER_GRID_OFFX * 2)),
    y: Math.floor((2 * (p.y - OUTER_GRID_TOP) - (p.x - OUTER_GRID_LEFT)) / (OUTER_GRID_OFFX * 2)),
  };
}

/** `Utils.IsWall`: the ring of two cells around the inner grid. */
export function isWall(p: Point): boolean {
  const n = INNER_GRID_COUNT;
  return (
    (p.x < 0 || p.x > n - 1 || p.y < 0 || p.y > n - 1) &&
    p.x > -3 &&
    p.x < n + 2 &&
    p.y > -3 &&
    p.y < n + 2
  );
}

/** `Utils.IsCityHall`: the government covers 2x2 cells, anchored at (2, 0). */
export function isCityHall(x: number, y: number): boolean {
  return (x === 2 || x === 3) && (y === 0 || y === 1);
}

/** `Utils.IsCityWall`: the walled city drawn in the middle of the fields. */
export function isCityWall(x: number, y: number): boolean {
  return x >= 2 && x <= 5 && y >= -3 && y <= 0;
}

/** `CityPanel.isValidGrid`. */
export function isValidOuterGrid(x: number, y: number, governmentLevel: number): boolean {
  if (x < 0 || x >= OUTER_GRID_COUNT_X || y < 0 || y >= OUTER_GRID_COUNT_Y) return false;
  const row = VALID_GRID[Math.min(governmentLevel, 10) - 1];
  return row?.[y * 10 + x] === 1;
}

/** Top-left of an inner `BuildingGrid` (108x79). */
export function innerCellPos(x: number, y: number): Point {
  return {
    x: INNER_GRID_LEFT + (x - y) * INNER_GRID_OFFX - INNER_GRID_OFFX,
    y: INNER_GRID_TOP + (x + y) * INNER_GRID_OFFY - 25,
  };
}

/** Top-left of a field `BuildingGrid` (112x66). */
export function outerCellPos(x: number, y: number): Point {
  return {
    x: OUTER_GRID_LEFT + (x - y) * OUTER_GRID_OFFX - OUTER_GRID_OFFX,
    y: OUTER_GRID_TOP + (x + y) * OUTER_GRID_OFFY - 12,
  };
}
