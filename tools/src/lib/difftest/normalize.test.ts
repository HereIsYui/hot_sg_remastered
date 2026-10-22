import { describe, expect, it } from 'vitest';
import {
  canonicalScalar,
  compareTrees,
  diffMultisets,
  maskAt,
  normalizeRow,
  normalizeTree,
  offsetOf,
  sortAt,
  type SideContext,
} from './normalize.ts';

describe('maskAt', () => {
  it('masks values under wildcard array paths', () => {
    const tree = [
      1,
      [
        { a: 1, t: -5 },
        { a: 2, t: -6 },
      ],
      { t: 3 },
    ];
    expect(maskAt(tree, [1, '*', 't'])).toEqual([
      1,
      [
        { a: 1, t: '<masked>' },
        { a: 2, t: '<masked>' },
      ],
      { t: 3 },
    ]);
    expect(maskAt(tree, [5, 't'])).toEqual(tree);
  });
});

const ctx = (aliases: Record<string, string> = {}): SideContext => ({
  start: 1700000000,
  end: 1700000003,
  aliases: new Map(Object.entries(aliases)),
});

describe('canonicalScalar', () => {
  it('equates numbers and numeric strings', () => {
    expect(canonicalScalar('5000')).toBe(canonicalScalar(5000));
    expect(canonicalScalar('1.50')).toBe('1.5');
    expect(canonicalScalar('abc')).toBe('abc');
    expect(canonicalScalar(null)).toBe(null);
  });
});

describe('normalizeTree', () => {
  it('replaces aliases and timestamps inside the side window', () => {
    const tree = [1, 2, '1003', 99887766, { t: '1700000001', old: 1600000000 }];
    expect(normalizeTree(tree, ctx({ '99887766': '<sid>' }))).toEqual([
      '1',
      '2',
      '1003',
      '<sid>',
      { t: '<now>', old: '1600000000' },
    ]);
  });
});

describe('normalizeRow', () => {
  it('applies column rules', () => {
    const row = { id: 7, ip: 12345, endtime: 1700000601, junk: 'x', gid: 50187 };
    const rule = { ignore: ['junk'], offsets: ['endtime'], map: { gid: () => 'box' } };
    expect(normalizeRow(row, rule, ctx())).toBe(
      JSON.stringify({ endtime: '<now+10m>', gid: 'box', id: '7', ip: '<ip>' }),
    );
    expect(normalizeRow(row, { skip: (r) => r.gid === 50187 }, ctx())).toBeNull();
    expect(normalizeRow(row, { only: ['id'] }, ctx())).toBe('{"id":"7"}');
  });
});

describe('diffMultisets / compareTrees', () => {
  it('reports what only one side has', () => {
    expect(diffMultisets(['a', 'b', 'b'], ['b', 'c'])).toEqual({ onlyA: ['a', 'b'], onlyB: ['c'] });
  });

  it('lists differing paths', () => {
    expect(compareTrees(['1', { a: '2' }], ['1', { a: '3', b: '4' }])).toEqual([
      '[1].a: "2" != "3"',
      '[1].b: missing in legacy',
    ]);
  });
});

describe('sortAt', () => {
  it('sorts only the addressed array', () => {
    expect(sortAt([1, 2, 0, 'x', [0, ['b', 'a']]], [4, 1])).toEqual([
      1,
      2,
      0,
      'x',
      [0, ['a', 'b']],
    ]);
    expect(sortAt({ a: ['2', '1'] }, ['a'])).toEqual({ a: ['1', '2'] });
    expect(sortAt(['b', 'a'], [5])).toEqual(['b', 'a']);
  });
});

describe('offsetOf', () => {
  const ctx = (start: number): SideContext => ({ start, end: start + 5, aliases: new Map() });

  it('shows now-relative times as minutes from the case start', () => {
    expect(offsetOf(1_700_000_000 + 600, ctx(1_700_000_000))).toBe('<now+10m>');
    expect(offsetOf(0, ctx(1_700_000_000))).toBe('0');
  });

  it('keeps long-past times absolute, whatever minute each side started in', () => {
    const stale = 1_300_000_000;
    expect(offsetOf(stale, ctx(1_700_000_029))).toBe(String(stale));
    expect(offsetOf(stale, ctx(1_700_000_031))).toBe(String(stale));
  });
});
