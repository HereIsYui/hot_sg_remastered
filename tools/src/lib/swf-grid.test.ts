import { describe, expect, it } from 'vitest';
import { readScalingGrids } from './swf-grid.ts';

class BitWriter {
  private bits: number[] = [];

  ub(n: number, v: number): this {
    for (let i = n - 1; i >= 0; i--) this.bits.push((v >> i) & 1);
    return this;
  }

  sb(n: number, v: number): this {
    return this.ub(n, v < 0 ? v + 2 ** n : v);
  }

  rect(xMin: number, xMax: number, yMin: number, yMax: number): this {
    return this.ub(5, 16).sb(16, xMin).sb(16, xMax).sb(16, yMin).sb(16, yMax);
  }

  bytes(): Buffer {
    const out = Buffer.alloc(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, i) => {
      if (bit) out[i >> 3]! |= 0x80 >> (i & 7);
    });
    return out;
  }
}

function tag(code: number, body: Buffer): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE((code << 6) | 0x3f, 0);
  header.writeUInt32LE(body.length, 2);
  return Buffer.concat([header, body]);
}

const u16 = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
};

describe('readScalingGrids', () => {
  it('turns a sprite scaling grid into border-image insets', () => {
    // Shape 1 spans (0,0)-(60,40) px; sprite 2 places it at (+10,+5) px with a grid inset by
    // 4px left, 6px top, 8px right, 10px bottom.
    const shape = Buffer.concat([u16(1), new BitWriter().rect(0, 1200, 0, 800).bytes()]);
    const place = Buffer.concat([
      Buffer.from([0x06]),
      u16(1),
      u16(1),
      new BitWriter().ub(1, 0).ub(1, 0).ub(5, 16).sb(16, 200).sb(16, 100).bytes(),
    ]);
    const sprite = Buffer.concat([
      u16(2),
      u16(1),
      tag(26, place),
      tag(1, Buffer.alloc(0)),
      tag(0, Buffer.alloc(0)),
    ]);
    const grid = Buffer.concat([u16(2), new BitWriter().rect(280, 1240, 220, 700).bytes()]);
    const exported = Buffer.concat([u16(1), u16(2), Buffer.from('board\0')]);
    const body = Buffer.concat([
      new BitWriter().rect(0, 20000, 0, 12000).bytes(),
      Buffer.from([0, 24, 1, 0]),
      tag(83, shape),
      tag(39, sprite),
      tag(78, grid),
      tag(56, exported),
      tag(0, Buffer.alloc(0)),
    ]);
    const header = Buffer.from('FWS\x0a\0\0\0\0', 'latin1');
    header.writeUInt32LE(header.length + body.length, 4);

    expect(readScalingGrids(Buffer.concat([header, body]))).toEqual(
      new Map([['board', { width: 60, height: 40, slice: [6, 8, 10, 4] }]]),
    );
  });
});
