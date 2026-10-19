/**
 * guide.GuideManager / GuideTip: the 新手引导 steps of cfg_guide. A step points an arrow at a
 * screen rectangle (`showpos`) next to its tip, masks the rest of the stage when it waits for a
 * click there (`distype` 1), and leads on to the step whose `pregid` it is.
 */

type Row = Record<string, unknown>;

export interface Guide {
  gid: number;
  group: number;
  pregid: number;
  name: string;
  content: string;
  triggertype: number;
  triggerdetails: string;
  showpos: string;
  distype: number;
  disdetails: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** cfg_guide.triggertype of steps started from outside the chain. */
export const GuideTrigger = { UsedGoods: 2, BuildingDone: 3 } as const;

const STAGE = { w: 1000, h: 600 };
export const TIP_WIDTH = 468;
const ARROW_SIZE = 76;

/** Steps whose target is a city slot: only the diamond of the tile counts as a hit. */
const TILE_STEPS = new Set([6, 8]);
const TILE = { x: 617, y: 159, w2: 48, h2: 24 };
const TILE_A = { x: TILE.x - TILE.w2, y: TILE.y };
const TILE_B = { x: TILE.x, y: TILE.y - TILE.h2 };
const TILE_C = { x: TILE.x + TILE.w2, y: TILE.y };
const TILE_D = { x: TILE.x, y: TILE.y + TILE.h2 };

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));

export function parseGuides(list: unknown): Guide[] {
  return (Array.isArray(list) ? (list as Row[]) : []).map((g) => ({
    gid: int(g.gid),
    group: int(g.group),
    pregid: int(g.pregid),
    name: str(g.name),
    content: str(g.content),
    triggertype: int(g.triggertype),
    triggerdetails: str(g.triggerdetails),
    showpos: str(g.showpos),
    distype: int(g.distype),
    disdetails: str(g.disdetails),
  }));
}

/** `showGuideTipNow`: what is quoted turns red. */
export function guideTipHtml(content: string): string {
  return content.split('“').join("“<font color='#FF0000'>").split('”').join('</font>”');
}

function parseRect(text: string): Rect {
  const [x = 0, y = 0, w = 0, h = 0] = text.split(',').map(int);
  return { x, y, w, h };
}

/** The rectangle a click has to land in, for steps that wait for one. */
export function clickTarget(guide: Guide): Rect | null {
  if (guide.distype !== 1) return null;
  return parseRect(guide.disdetails === '' ? guide.showpos : guide.disdetails);
}

/** `GuideTip.disEventHander`: does a click at `p` (stage coordinates) finish the step? */
export function hitsTarget(guide: Guide, p: Point): boolean {
  const r = clickTarget(guide);
  if (!r || p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) return false;
  if (!TILE_STEPS.has(guide.gid)) return true;
  const side = (a: Point, b: Point) => (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
  return (
    side(TILE_A, TILE_B) < 0 &&
    side(TILE_B, TILE_C) < 0 &&
    side(TILE_C, TILE_D) < 0 &&
    side(TILE_D, TILE_A) < 0
  );
}

/** `MaskShape` triangles that leave only the tile's diamond open in its bounding box. */
export function tileCorners(guide: Guide): Point[][] {
  if (guide.distype !== 1 || !TILE_STEPS.has(guide.gid)) return [];
  const [A, B, C, D] = [TILE_A, TILE_B, TILE_C, TILE_D];
  return [
    [A, B, { x: A.x, y: B.y }],
    [B, C, { x: C.x, y: B.y }],
    [C, D, { x: C.x, y: D.y }],
    [D, A, { x: A.x, y: D.y }],
  ];
}

export interface TipLayout {
  tip: Point;
  /** `images/arrow_<dir>`: 1 points up, 2 right, 3 down, 4 left. */
  arrow: (Point & { dir: number }) | null;
}

/** `GuideTip.setShowPos`: the arrow beside the target and the tip beyond it, kept on stage. */
export function layoutTip(guide: Guide, tipHeight: number): TipLayout {
  const hasTarget = guide.showpos !== '';
  const { x, y, w, h } = hasTarget ? parseRect(guide.showpos) : { x: 300, y: 200, w: 0, h: 0 };
  let dir = 1;
  if (x < STAGE.w / 10) dir = 4;
  else if (y < STAGE.h / 10) dir = 1;
  else if (x > (9 * STAGE.w) / 10) dir = 2;
  else if (y > (9 * STAGE.h) / 10) dir = 3;
  else if (x > (2 * STAGE.w) / 3) dir = 2;
  else if (y > (2 * STAGE.h) / 3) dir = 3;
  else if (x < STAGE.w / 3) dir = 4;

  let placed = place(dir, x, y, w, h, tipHeight);
  for (const d of [1, 2, 3, 4, dir]) {
    if (!placed.moved) break;
    placed = place(d, x, y, w, h, tipHeight);
  }
  return { tip: placed.tip, arrow: hasTarget ? placed.arrow : null };
}

/** `trySetShowPos`; `moved` when the tip had to be pushed back onto the stage. */
function place(dir: number, x: number, y: number, w: number, h: number, tipHeight: number) {
  const arrow = { dir, x: 0, y: 0 };
  const tip = { x: 0, y: 0 };
  const clampArrow = () => {
    if (arrow.x <= 0) arrow.x = 0;
    if (arrow.x + ARROW_SIZE > STAGE.w) arrow.x = STAGE.w - ARROW_SIZE - 10;
    if (arrow.y <= 0) arrow.y = 0;
    if (arrow.y + ARROW_SIZE > STAGE.h) arrow.y = STAGE.h - ARROW_SIZE - 10;
  };
  if (dir === 1) {
    arrow.x = x + (w - ARROW_SIZE) / 2;
    arrow.y = y + h;
    clampArrow();
    tip.x = x + (ARROW_SIZE - TIP_WIDTH) / 2;
    tip.y = arrow.y + ARROW_SIZE;
  } else if (dir === 2) {
    arrow.x = x - w;
    arrow.y = y + (h - ARROW_SIZE) / 2;
    clampArrow();
    tip.x = arrow.x - TIP_WIDTH;
    tip.y = arrow.y + (ARROW_SIZE - tipHeight) / 2;
  } else if (dir === 3) {
    arrow.x = x + (w - ARROW_SIZE) / 2;
    arrow.y = y - ARROW_SIZE;
    clampArrow();
    tip.x = x + (ARROW_SIZE - TIP_WIDTH) / 2;
    tip.y = arrow.y - tipHeight;
  } else {
    arrow.x = x + w;
    arrow.y = y + (h - ARROW_SIZE) / 2;
    clampArrow();
    tip.x = arrow.x + ARROW_SIZE;
    tip.y = arrow.y;
  }
  let moved = false;
  if (tip.x <= 0) {
    tip.x = 0;
    moved = true;
  } else if (tip.x + TIP_WIDTH > STAGE.w) {
    tip.x = STAGE.w - TIP_WIDTH - 10;
    moved = true;
  }
  if (tip.y <= 0) {
    tip.y = 0;
    moved = true;
  } else if (tip.y + tipHeight > STAGE.h) {
    tip.y = STAGE.h - tipHeight - 10;
    moved = true;
  }
  return { arrow, tip, moved };
}

/**
 * `GuideTip.getLeftRectangles`: the stage minus the open rectangles, as vertical strips cut at
 * every rectangle edge, each split around the rectangles crossing it.
 */
export function maskRects(open: Rect[]): Rect[] {
  const edges = new Set([0, STAGE.w]);
  for (const r of open) {
    for (const e of [r.x, r.x + r.w]) if (e > 0 && e < STAGE.w) edges.add(e);
  }
  const xs = [...edges].sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    const spans = open
      .filter((r) => r.w > 0 && r.h > 0 && r.x < x1 && r.x + r.w > x0)
      .map((r) => [Math.max(0, r.y), Math.min(STAGE.h, r.y + r.h)] as const)
      .sort((a, b) => a[0] - b[0]);
    let y = 0;
    for (const [top, bottom] of spans) {
      if (top > y) out.push({ x: x0, y, w: x1 - x0, h: top - y });
      y = Math.max(y, bottom);
    }
    if (y < STAGE.h) out.push({ x: x0, y, w: x1 - x0, h: STAGE.h - y });
  }
  return out;
}

/** guide.GuideManager: the steps still to show and the one on screen. */
export class GuideManager {
  tips: Guide[] = [];
  current: Guide | null = null;
  /** `GuideTip.bLastGid`: the final step offers 关闭 instead of 跳过引导. */
  last = false;
  /** `BloodWar.mJustCreateRole`: steps only show for a role created in this session. */
  justCreatedRole = false;
  private curGid = -1;

  /** The getGuidesByGroup reply: `[steps]`; the first one shows at once. */
  onGuides(data: unknown): void {
    const list = Array.isArray(data) ? parseGuides(data[0]) : [];
    for (const guide of list) {
      const i = this.tips.findIndex((t) => t.gid === guide.gid);
      if (i >= 0) this.tips[i] = guide;
      else this.tips.push(guide);
    }
    if (list[0]) this.show(list[0].gid);
  }

  /** `tiggerGuideTip`: a used item starts the step waiting for it. */
  triggerByGoods(gid: number): void {
    const guide = this.tips.find(
      (t) => t.triggertype === GuideTrigger.UsedGoods && t.triggerdetails === String(gid),
    );
    if (guide) this.show(guide.gid);
  }

  /** `tiggerGuideByBuildingStates`: a finished building of some level starts its step. */
  triggerByBuildings(buildings: { bid: number; level: number; state: number }[]): void {
    const done = new Set(buildings.filter((b) => b.state === 0).map((b) => `${b.bid},${b.level}`));
    const guide = this.tips.find(
      (t) => t.triggertype === GuideTrigger.BuildingDone && done.has(t.triggerdetails),
    );
    if (guide) this.show(guide.gid);
  }

  show(gid: number): void {
    if (!this.justCreatedRole || this.current) return;
    const guide = this.tips.find((t) => t.gid === gid);
    if (!guide) return;
    this.current = guide;
    this.last = gid === Math.max(...this.tips.map((t) => t.gid));
    this.curGid = gid;
  }

  /** `GuideTip.completeGuide`: the step on screen is done; the final one ends the guide. */
  completeCurrent(): void {
    const i = this.tips.findIndex((t) => t.gid === this.curGid);
    if (i < 0) return;
    this.tips.splice(i, 1);
    if (this.last) this.justCreatedRole = false;
    this.current = null;
  }

  showNext(): void {
    const next = this.tips.find((t) => t.pregid === this.curGid);
    if (next) this.show(next.gid);
  }

  /** `skipCurGuide`: 跳过引导 drops every remaining step. */
  skip(): void {
    this.tips = [];
    this.current = null;
    this.justCreatedRole = false;
  }
}
