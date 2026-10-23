import { i18n } from '../i18n';

/**
 * Pure parsing and geometry for the world map (`World/WorldPanel.as`, `WorldFunc.php`).
 * Everything here is side-effect free so it can be unit-tested against PHP-shaped fixtures;
 * the Vue panel keeps only the Pixi rendering and input handling.
 */

// ---- the 500x500 grid and its 10x10 blocks ----

/** `WorldPanel.MAX_RANGE_X` / `MAX_RANGE_Y`: coordinates run 1..500. */
export const MIN_RANGE = 1;
export const MAX_RANGE = 500;
/** `WorldPanel.LOADRANGE_X` / `LOADRANGE_Y`: Manhattan radius city info is auto-loaded within. */
export const LOADRANGE = 20;

/** Isometric cell size and the view centre (`GRID_OFFSET_X/Y`, `CENTER_GRID_X/Y`, `GRID_IMAGE_HEIGHT`). */
export const GRID_OFFSET_X = 54;
export const GRID_OFFSET_Y = 27;
export const GRID_IMAGE_HEIGHT = 75;
export const CENTER_GRID_X = 314;
export const CENTER_GRID_Y = 250;

/** `WorldPanel.MOVE_GRID_*`: the arrow-button step sizes. */
export const MOVE_GRID_HORI_STRAIGHT = 3;
export const MOVE_GRID_VERT_STRAIGHT = 4;
export const MOVE_GRID_OBLIQUE = 5;

export interface Point {
  x: number;
  y: number;
}

/** `Utils.wid2cid`: a world id packs 10x10 blocks as `YYXXyx`; a city id is `y * 1000 + x`. */
export function wid2cid(wid: number): number {
  const y = Math.floor(wid / 10000) * 10 + Math.floor((wid % 100) / 10);
  const x = Math.floor((wid % 10000) / 100) * 10 + (wid % 10);
  return y * 1000 + x;
}

/** `Utils.cid2wid`: the inverse of {@link wid2cid}. */
export function cid2wid(cid: number): number {
  const y = Math.floor(cid / 1000);
  const x = cid % 1000;
  return Math.floor(y / 10) * 10000 + Math.floor(x / 10) * 100 + (y % 10) * 10 + (x % 10);
}

/** `Utils.makeCid`: the `[x,y]` label shown for a coordinate. */
export function makeCid(cid: number): string {
  return `[${cid % 1000},${Math.floor(cid / 1000)}]`;
}

/** The (x, y) a city id decodes to. */
export function cidToXY(cid: number): Point {
  return { x: cid % 1000, y: Math.floor(cid / 1000) };
}

/** A coordinate's city id (`y * 1000 + x`). */
export function xyToCid(x: number, y: number): number {
  return y * 1000 + x;
}

/** The 10x10 block id a coordinate belongs to (`blockY * 100 + blockX`, each 0..50). */
export function blockOf(x: number, y: number): number {
  return Math.floor(y / 10) * 100 + Math.floor(x / 10);
}

/**
 * `WorldPanel.loadGridData`: the block ids covering the given coordinate window, clamped to the
 * 0..50 block grid. Each block covers ten coordinates in each axis.
 */
export function blocksForWindow(
  gxmin: number,
  gxmax: number,
  gymin: number,
  gymax: number,
): number[] {
  const bx0 = Math.max(Math.floor(gxmin / 10), 0);
  const bx1 = Math.min(Math.floor(gxmax / 10), 50);
  const by0 = Math.max(Math.floor(gymin / 10), 0);
  const by1 = Math.min(Math.floor(gymax / 10), 50);
  const out: number[] = [];
  for (let by = by0; by <= by1; by++) {
    for (let bx = bx0; bx <= bx1; bx++) out.push(by * 100 + bx);
  }
  return out;
}

// ---- isometric screen <-> grid conversion ----

/**
 * `WorldPanel.resetGridPosition`: top-left of the cell at grid (mx, my) when the view is centred
 * on (centreX, centreY). `local` is relative to the grid panel origin.
 */
export function cellToScreen(mx: number, my: number, centreX: number, centreY: number): Point {
  return {
    x: CENTER_GRID_X + (mx - centreX) * GRID_OFFSET_X - (my - centreY) * GRID_OFFSET_X,
    y: CENTER_GRID_Y + (mx - centreX) * GRID_OFFSET_Y + (my - centreY) * GRID_OFFSET_Y,
  };
}

/**
 * `WorldPanel.getCidByMousePosition`: the grid coordinate under a point local to the grid panel,
 * when the view is centred on (centreX, centreY).
 */
export function screenToCell(
  localX: number,
  localY: number,
  centreX: number,
  centreY: number,
): Point {
  const ox = CENTER_GRID_X + GRID_OFFSET_X;
  const oy = CENTER_GRID_Y + GRID_IMAGE_HEIGHT - GRID_OFFSET_X;
  return {
    x: Math.floor((2 * (localY - oy) + (localX - ox)) / (GRID_OFFSET_X * 2)) + centreX,
    y: Math.floor((2 * (localY - oy) - (localX - ox)) / (GRID_OFFSET_X * 2)) + centreY,
  };
}

/** Whether a coordinate is inside the playable 1..500 square. */
export function inRange(x: number, y: number): boolean {
  return x >= MIN_RANGE && x <= MAX_RANGE && y >= MIN_RANGE && y <= MAX_RANGE;
}

/** `Utils.getCityDistance`: Euclidean distance between two city ids, in cells. */
export function cityDistance(cid1: number, cid2: number): number {
  const a = cidToXY(cid1);
  const b = cidToXY(cid2);
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ---- names (`Define.WORLD_TYPE_NAME` / `WORLD_STATE_NAME`, `Global.PROVINCE_NAME`) ----

/** Terrain type name (`_Define_1..8` for types 0..7). */
export function worldTypeName(type: number): string {
  return type >= 0 && type <= 7 ? i18n(`_Define_${type + 1}`) : '';
}

/** World cell state name (`_Define_9..11` for states 0..2: 平静 / 战乱 / ...). */
export function worldStateName(state: number): string {
  return state >= 0 && state <= 2 ? i18n(`_Define_${state + 9}`) : '';
}

/** Province name (`_Global_1..19`). Province 0 is unused in the original. */
export function provinceName(province: number): string {
  return province >= 1 && province <= 19 ? i18n(`_Global_${province}`) : '';
}

// ---- getBlockData: the block cells + union marks ----

export interface WorldCell {
  wid: number;
  cid: number;
  /** Terrain type: 0 city, 1 flatland, 2..7 wild terrains. */
  type: number;
  ownercid: number;
  /** 0 平静, 1 战乱, ... */
  state: number;
  level: number;
  provinceid: number;
  junid: number;
  /** `sys_union_mark.type`, 0 when not marked. */
  marktype: number;
}

export interface UnionMark {
  cid: number;
  type: number;
}

export interface BlockData {
  /** All cells, keyed by city id, exactly as `WorldPanel.gridInfo`. */
  cells: Map<number, WorldCell>;
  /** City ids (type 0) within {@link LOADRANGE} of the centre, needing `getWorldCityInfo`. */
  cityIdsToLoad: number[];
  marks: UnionMark[];
}

const int = (v: unknown): number => parseInt(String(v), 10) || 0;

/**
 * `WorldPanel.onGetBlockData`: `[blocks, marks]` where each block is
 * `[blockStart, "offset:type:ownercid:state:level:province:jun,..."]` (MySQL group_concat).
 * `centre` is the current view centre; cities within LOADRANGE of it are collected for loading.
 */
export function parseBlockData(data: unknown, centre: Point): BlockData {
  const arr = Array.isArray(data) ? (data as unknown[]) : [];
  const blocks = Array.isArray(arr[0]) ? (arr[0] as unknown[]) : [];
  const markRows = Array.isArray(arr[1]) ? (arr[1] as unknown[]) : [];

  const cells = new Map<number, WorldCell>();
  const cityIdsToLoad: number[] = [];

  for (const blockRaw of blocks) {
    const block = Array.isArray(blockRaw) ? (blockRaw as unknown[]) : [];
    const blockStart = int(block[0]);
    const concat = block[1] == null ? '' : String(block[1]);
    if (concat === '') continue;
    for (const entry of concat.split(',')) {
      const f = entry.split(':');
      const wid = blockStart + int(f[0]);
      const cid = wid2cid(wid);
      const type = int(f[1]);
      const cell: WorldCell = {
        wid,
        cid,
        type,
        ownercid: int(f[2]),
        state: int(f[3]),
        level: int(f[4]),
        provinceid: int(f[5]),
        junid: int(f[6]),
        marktype: 0,
      };
      cells.set(cid, cell);
      if (type === 0) {
        const { x, y } = cidToXY(cid);
        if (Math.abs(x - centre.x) + Math.abs(y - centre.y) <= LOADRANGE) cityIdsToLoad.push(cid);
      }
    }
  }

  const marks: UnionMark[] = [];
  for (const markRaw of markRows) {
    const m = (markRaw ?? {}) as Record<string, unknown>;
    const cid = int(m.cid);
    const type = int(m.type);
    marks.push({ cid, type });
    const cell = cells.get(cid);
    if (cell) cell.marktype = type;
  }

  return { cells, cityIdsToLoad, marks };
}

// ---- getWorldCityInfo: the detailed city rows (with the relationship flag) ----

export interface WorldCityInfo {
  cid: number;
  citytype: number;
  isSpecial: number;
  provinceId: number;
  cityname: string;
  uid: number;
  username: string;
  flagchar: string;
  unionId: number;
  unionname: string;
  prestige: number;
  userstate: number;
  userface: number;
  usersex: number;
  /** Relationship flag 0..8 (0 self, 1 ally, 2 friendly, 3 neutral, 4/8 at-war, 5 occupy, 6/7 ...). */
  flag: number;
}

export function parseWorldCityInfo(data: unknown): WorldCityInfo[] {
  const rows = Array.isArray(data) ? (data as unknown[]) : [];
  return rows.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      cid: int(r.cid),
      citytype: int(r.citytype),
      isSpecial: int(r.is_special),
      provinceId: int(r.provinceId),
      cityname: String(r.cityname ?? ''),
      uid: int(r.uid),
      username: String(r.username ?? ''),
      flagchar: String(r.flagchar ?? ''),
      unionId: int(r.union_id),
      unionname: r.unionname == null ? '' : String(r.unionname),
      prestige: int(r.prestige),
      userstate: int(r.userstate),
      userface: int(r.userface),
      usersex: int(r.usersex),
      flag: int(r.flag),
    };
  });
}

// ---- getWorldFieldInfo: one field/city row for the action dialog ----

export interface WorldFieldInfo {
  wid: number;
  type: number;
  ownercid: number;
  province: number;
  level: number;
  uid: number;
  cityname: string;
  username: string;
  prestige: number;
  unionId: number;
  unionname: string;
}

/** `[fieldRow]`; the row is null when the field is empty flatland. */
export function parseWorldFieldInfo(data: unknown): WorldFieldInfo | null {
  const arr = Array.isArray(data) ? (data as unknown[]) : [];
  const r = arr[0];
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  return {
    wid: int(o.wid),
    type: int(o.type),
    ownercid: int(o.ownercid),
    province: int(o.province),
    level: int(o.level),
    uid: int(o.uid),
    cityname: String(o.cityname ?? ''),
    username: String(o.username ?? ''),
    prestige: int(o.prestige),
    unionId: int(o.union_id),
    unionname: o.unionname == null ? '' : String(o.unionname),
  };
}

// ---- getMapCity: the famous cities (type 2..4) for the overview ----

export interface MapCity {
  cid: number;
  name: string;
  type: number;
  ownername: string;
  unionName: string;
}

export function parseMapCity(data: unknown): MapCity[] {
  const rows = Array.isArray(data) ? (data as unknown[]) : [];
  return rows.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      cid: int(r.cid),
      name: String(r.name ?? ''),
      type: int(r.type),
      ownername: r.ownername == null ? '' : String(r.ownername),
      unionName: r.union_name == null ? '' : String(r.union_name),
    };
  });
}

// ---- getActionField: the special-event field coordinates ----

/** `[type, [wid, ...]]`: type 0 drag-triggered, 1 button-triggered; -1 wids mean "no event". */
export function parseActionField(data: unknown): { type: number; cids: number[] } {
  const arr = Array.isArray(data) ? (data as unknown[]) : [];
  const type = int(arr[0]);
  const widArr = Array.isArray(arr[1]) ? (arr[1] as unknown[]) : [];
  const cids = widArr
    .map((w) => int(w))
    .filter((wid) => wid >= 0)
    .map((wid) => wid2cid(wid));
  return { type, cids };
}

// ---- getUserFields: the player's own owned field wids ----

/** `[[{wid}, ...]]` -> the city ids of the player's fields. */
export function parseUserFields(data: unknown): number[] {
  const arr = Array.isArray(data) ? (data as unknown[]) : [];
  const rows = Array.isArray(arr[0]) ? (arr[0] as unknown[]) : [];
  return rows.map((raw) => wid2cid(int((raw as Record<string, unknown> | undefined)?.wid)));
}

// ---- getFavouritesList: the player's cities + saved favourites ----

export interface FavouriteCity {
  cid: number;
  name: string;
  location: string;
}

export interface FavouriteTarget {
  id: number;
  cid: number;
  name: string;
  comments: string;
  location: string;
}

export interface FavouritesList {
  /** The player's own cities (left grid of CampaignFavouritesDialog). */
  cities: FavouriteCity[];
  /** The saved favourite targets (right grid). */
  targets: FavouriteTarget[];
}

/** `[cities, favourites]`; `location` is the `[x,y]` label the dialog shows. */
export function parseFavouritesList(data: unknown): FavouritesList {
  const arr = Array.isArray(data) ? (data as unknown[]) : [];
  const cityRows = Array.isArray(arr[0]) ? (arr[0] as unknown[]) : [];
  const favRows = Array.isArray(arr[1]) ? (arr[1] as unknown[]) : [];
  const cities = cityRows.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const cid = int(r.cid);
    return { cid, name: String(r.name ?? ''), location: makeCid(cid) };
  });
  const targets = favRows.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const cid = int(r.cid);
    return {
      id: int(r.id),
      cid,
      name: String(r.name ?? ''),
      comments: r.comments == null ? '' : String(r.comments),
      location: makeCid(cid),
    };
  });
  return { cities, targets };
}
