import { describe, expect, it } from 'vitest';
import {
  canonicalScalar,
  compareTrees,
  diffMultisets,
  normalizeRow,
  normalizeTree,
  sortAt,
  type SideContext,
} from './normalize.ts';

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
