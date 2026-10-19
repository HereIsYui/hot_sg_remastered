import { inflateSync } from 'node:zlib';

/**
 * Minimal SWF reader for 9-slice data: shape bounds, sprite placements, `DefineScalingGrid`
 * and the names attached by `ExportAssets` / `SymbolClass`. Only what is needed to turn a scaling
 * grid into CSS `border-image` insets.
 */

interface Rect {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

class Bits {
  private bytePos: number;
  private bitPos = 0;
  private readonly buf: Buffer;

  constructor(buf: Buffer, offset: number) {
    this.buf = buf;
    this.bytePos = offset;
  }

  ub(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const bit = (this.buf[this.bytePos]! >> (7 - this.bitPos)) & 1;
      v = v * 2 + bit;
      if (++this.bitPos === 8) {
        this.bitPos = 0;
        this.bytePos++;
      }
    }
    return v;
  }

  sb(n: number): number {
    if (n === 0) return 0;
    const v = this.ub(n);
    return v >= 2 ** (n - 1) ? v - 2 ** n : v;
  }

  fb(n: number): number {
    return this.sb(n) / 65536;
  }

  rect(): Rect {
    const n = this.ub(5);
    return { xMin: this.sb(n), xMax: this.sb(n), yMin: this.sb(n), yMax: this.sb(n) };
  }

  matrix(): Matrix {
    const m: Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    if (this.ub(1)) {
      const n = this.ub(5);
      m.a = this.fb(n);
      m.d = this.fb(n);
    }
    if (this.ub(1)) {
      const n = this.ub(5);
      m.b = this.fb(n);
      m.c = this.fb(n);
    }
    const n = this.ub(5);
    m.tx = this.sb(n);
    m.ty = this.sb(n);
    return m;
  }

  /** Byte offset after aligning to the next byte. */
  end(): number {
    return this.bitPos === 0 ? this.bytePos : this.bytePos + 1;
  }
}

interface Tag {
  code: number;
  body: Buffer;
}

function readTags(buf: Buffer, offset: number, end: number): Tag[] {
  const tags: Tag[] = [];
  let pos = offset;
  while (pos + 2 <= end) {
    const header = buf.readUInt16LE(pos);
    pos += 2;
    const code = header >> 6;
    let len = header & 0x3f;
    if (len === 0x3f) {
      len = buf.readUInt32LE(pos);
      pos += 4;
    }
    tags.push({ code, body: buf.subarray(pos, pos + len) });
    pos += len;
    if (code === 0) break;
  }
  return tags;
}

function cString(buf: Buffer, pos: number): [string, number] {
  const end = buf.indexOf(0, pos);
  return [buf.toString('utf8', pos, end), end + 1];
}

const SHAPE_TAGS = new Set([2, 22, 32, 83]);
const TAG_SPRITE = 39;
const TAG_PLACE2 = 26;
const TAG_PLACE3 = 70;
const TAG_GRID = 78;
const TAG_EXPORT = 56;
const TAG_SYMBOL_CLASS = 76;

export interface ScalingGrid {
  /** Bounds of the symbol in pixels. */
  width: number;
  height: number;
  /** CSS border-image-slice order: top, right, bottom, left (pixels from each edge). */
  slice: [number, number, number, number];
}

function transform(r: Rect, m: Matrix): Rect {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [r.xMin, r.yMin],
    [r.xMax, r.yMin],
    [r.xMin, r.yMax],
    [r.xMax, r.yMax],
  ] as const) {
    xs.push(m.a * x + m.c * y + m.tx);
    ys.push(m.b * x + m.d * y + m.ty);
  }
  return {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  };
}

function union(a: Rect | null, b: Rect): Rect {
  if (!a) return b;
  return {
    xMin: Math.min(a.xMin, b.xMin),
    xMax: Math.max(a.xMax, b.xMax),
    yMin: Math.min(a.yMin, b.yMin),
    yMax: Math.max(a.yMax, b.yMax),
  };
}

/** Returns symbol name -> scaling grid for every named symbol that has one. */
export function readScalingGrids(file: Buffer): Map<string, ScalingGrid> {
  const signature = file.toString('ascii', 0, 3);
  let buf: Buffer;
  if (signature === 'FWS') buf = file;
  else if (signature === 'CWS')
    buf = Buffer.concat([file.subarray(0, 8), inflateSync(file.subarray(8))]);
  else throw new Error(`unsupported SWF signature ${signature}`);

  const header = new Bits(buf, 8);
  header.rect();
  const tags = readTags(buf, header.end() + 4, buf.length);

  const shapeBounds = new Map<number, Rect>();
  const sprites = new Map<number, { id: number; matrix: Matrix }[]>();
  const grids = new Map<number, Rect>();
  const names = new Map<number, string[]>();

  for (const tag of tags) {
    const b = tag.body;
    if (SHAPE_TAGS.has(tag.code)) {
      shapeBounds.set(b.readUInt16LE(0), new Bits(b, 2).rect());
    } else if (tag.code === TAG_SPRITE) {
      const placements: { id: number; matrix: Matrix }[] = [];
      for (const inner of readTags(b, 4, b.length)) {
        if (inner.code === 1) break;
        if (inner.code !== TAG_PLACE2 && inner.code !== TAG_PLACE3) continue;
        const ib = inner.body;
        const flags = ib[0]!;
        let pos = inner.code === TAG_PLACE3 ? 2 : 1;
        const flags2 = inner.code === TAG_PLACE3 ? ib[1]! : 0;
        pos += 2;
        if (inner.code === TAG_PLACE3 && (flags2 & 0x08 || (flags2 & 0x10 && flags & 0x02))) {
          [, pos] = cString(ib, pos);
        }
        if (!(flags & 0x02)) continue;
        const id = ib.readUInt16LE(pos);
        pos += 2;
        const matrix =
          flags & 0x04 ? new Bits(ib, pos).matrix() : { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
        placements.push({ id, matrix });
      }
      sprites.set(b.readUInt16LE(0), placements);
    } else if (tag.code === TAG_GRID) {
      grids.set(b.readUInt16LE(0), new Bits(b, 2).rect());
    } else if (tag.code === TAG_EXPORT || tag.code === TAG_SYMBOL_CLASS) {
      let pos = 2;
      for (let i = 0, n = b.readUInt16LE(0); i < n; i++) {
        const id = b.readUInt16LE(pos);
        let name: string;
        [name, pos] = cString(b, pos + 2);
        names.set(id, [...(names.get(id) ?? []), name]);
      }
    }
  }

  const boundsCache = new Map<number, Rect | null>();
  const boundsOf = (id: number, depth = 0): Rect | null => {
    if (shapeBounds.has(id)) return shapeBounds.get(id)!;
    if (boundsCache.has(id)) return boundsCache.get(id)!;
    let r: Rect | null = null;
    if (depth < 16) {
      for (const p of sprites.get(id) ?? []) {
        const child = boundsOf(p.id, depth + 1);
        if (child) r = union(r, transform(child, p.matrix));
      }
    }
    boundsCache.set(id, r);
    return r;
  };

  const px = (twips: number) => Math.round(twips / 20);
  const out = new Map<string, ScalingGrid>();
  for (const [id, grid] of grids) {
    const bounds = boundsOf(id);
    if (!bounds) continue;
    const entry: ScalingGrid = {
      width: px(bounds.xMax - bounds.xMin),
      height: px(bounds.yMax - bounds.yMin),
      slice: [
        px(grid.yMin - bounds.yMin),
        px(bounds.xMax - grid.xMax),
        px(bounds.yMax - grid.yMax),
        px(grid.xMin - bounds.xMin),
      ],
    };
    for (const name of names.get(id) ?? []) out.set(name, entry);
  }
  return out;
}
