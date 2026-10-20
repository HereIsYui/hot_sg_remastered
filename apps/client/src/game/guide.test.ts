import { describe, expect, it } from 'vitest';
import {
  GuideManager,
  guideTipHtml,
  hitsTarget,
  layoutTip,
  maskRects,
  parseGuides,
  tileCorners,
  type Guide,
} from './guide';

const step = (row: Record<string, unknown>) =>
  ({
    group: '1',
    name: '',
    content: '',
    triggertype: '0',
    triggerdetails: '',
    showpos: '',
    distype: '1',
    disdetails: '',
    ...row,
  }) as Record<string, unknown>;

const rows = [
  step({ gid: '1', pregid: '0', showpos: '17,172,56,21' }),
  step({ gid: '2', pregid: '1', showpos: '331,186,64,62' }),
  step({ gid: '3', pregid: '0', triggertype: '2', triggerdetails: '50101' }),
  step({ gid: '11', pregid: '0', triggertype: '3', triggerdetails: '5,1' }),
  step({ gid: '12', pregid: '11', showpos: '313,393,140,20' }),
  step({ gid: '14', pregid: '12', distype: '0' }),
];

function started(): GuideManager {
  const m = new GuideManager();
  m.justCreatedRole = true;
  m.onGuides([rows]);
  return m;
}

describe('guide steps', () => {
  it('shows the first step only for a role created in this session', () => {
    const idle = new GuideManager();
    idle.onGuides([rows]);
    expect(idle.current).toBeNull();
    expect(idle.tips).toHaveLength(6);
    expect(started().current?.gid).toBe(1);
  });

  it('follows the chain and waits for triggers between chains', () => {
    const m = started();
    m.completeCurrent();
    m.showNext();
    expect(m.current?.gid).toBe(2);
    m.completeCurrent();
    m.showNext();
    expect(m.current).toBeNull();

    m.triggerByBuildings([{ bid: 5, level: 1, state: 1 }]);
    expect(m.current).toBeNull();
    m.triggerByGoods(50101);
    expect(m.current?.gid).toBe(3);
    m.triggerByBuildings([{ bid: 5, level: 1, state: 0 }]);
    expect(m.current?.gid).toBe(3);
    m.completeCurrent();
    m.triggerByBuildings([{ bid: 5, level: 1, state: 0 }]);
    expect(m.current?.gid).toBe(11);
  });

  it('drops a pending step by gid, taking down the one on screen', () => {
    const m = started();
    m.complete(99);
    expect(m.current?.gid).toBe(1);
    m.complete(3);
    expect(m.current).toBeNull();
    expect(m.tips.map((t) => t.gid)).toEqual([1, 2, 11, 12, 14]);
    m.triggerByGoods(50101);
    expect(m.current).toBeNull();
  });

  it('ends the guide with the step of the highest gid', () => {
    const m = started();
    m.skip();
    expect(m.current).toBeNull();
    expect(m.justCreatedRole).toBe(false);

    const n = started();
    for (const gid of [1, 2, 3]) {
      n.show(gid);
      n.completeCurrent();
    }
    n.triggerByBuildings([{ bid: 5, level: 1, state: 0 }]);
    n.completeCurrent();
    n.showNext();
    n.completeCurrent();
    n.showNext();
    expect(n.current?.gid).toBe(14);
    expect(n.last).toBe(true);
    n.completeCurrent();
    expect(n.justCreatedRole).toBe(false);
  });
});

describe('guide tip', () => {
  const [g1, g2, , , g12, g14] = parseGuides(rows) as Guide[];

  it('marks quoted words red', () => {
    expect(guideTipHtml('请点击“建造”。')).toBe("请点击“<font color='#FF0000'>建造</font>”。");
  });

  it('puts the arrow beside the target and keeps the tip on stage', () => {
    expect(layoutTip(g1!, 120)).toEqual({
      arrow: { dir: 4, x: 73, y: 144.5 },
      tip: { x: 149, y: 144.5 },
    });
    expect(layoutTip(g2!, 120)).toEqual({
      arrow: { dir: 4, x: 395, y: 179 },
      tip: { x: 471, y: 179 },
    });
    expect(layoutTip(g12!, 120)).toEqual({
      arrow: { dir: 4, x: 453, y: 365 },
      tip: { x: 529, y: 365 },
    });
    expect(layoutTip(g14!, 100)).toEqual({ arrow: null, tip: { x: 376, y: 162 } });
  });

  it('masks the stage around the target and the tip', () => {
    const rects = maskRects([
      { x: 100, y: 100, w: 50, h: 20 },
      { x: 120, y: 300, w: 100, h: 50 },
    ]);
    const area = rects.reduce((sum, r) => sum + r.w * r.h, 0);
    expect(area).toBe(1000 * 600 - 50 * 20 - 100 * 50);
    expect(rects).toContainEqual({ x: 120, y: 120, w: 30, h: 180 });
    expect(rects).toContainEqual({ x: 220, y: 0, w: 780, h: 600 });
  });

  it('counts only the diamond of a city tile', () => {
    const tile = parseGuides([step({ gid: 6, showpos: '570,135,95,48' })])[0]!;
    expect(hitsTarget(tile, { x: 617, y: 159 })).toBe(true);
    expect(hitsTarget(tile, { x: 575, y: 140 })).toBe(false);
    expect(tileCorners(tile)).toHaveLength(4);
    expect(hitsTarget(g12!, { x: 320, y: 400 })).toBe(true);
    expect(hitsTarget(g12!, { x: 320, y: 420 })).toBe(false);
    expect(hitsTarget(g14!, { x: 0, y: 0 })).toBe(false);
  });
});
