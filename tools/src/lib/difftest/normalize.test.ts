import { describe, expect, it } from 'vitest';
import {
  canonicalScalar,
  compareTrees,
  diffMultisets,
  diffNormalizedRows,
  maskAt,
  normalizeRow,
  normalizeTree,
  offsetOf,
  rewriteTieRanks,
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

describe('rewriteTieRanks', () => {
  const rule = { tieRank: { column: 'rank', keys: ['level', 'command'] } };

  it("collapses tied rows to their group's lowest rank and leaves the rest exact", () => {
    const rows = [
      { hid: 61, level: 50, command: 133, rank: 906 },
      { hid: 693, level: 50, command: 133, rank: 904 },
      { hid: 769, level: 50, command: 133, rank: 905 },
      { hid: 750, level: 50, command: 132, rank: 907 },
    ];
    expect(rewriteTieRanks(rows, rule)).toEqual([
      { hid: 61, level: 50, command: 133, rank: '904' },
      { hid: 693, level: 50, command: 133, rank: '904' },
      { hid: 769, level: 50, command: 133, rank: '904' },
      { hid: 750, level: 50, command: 132, rank: '907' },
    ]);
  });

  it('treats numeric strings and numbers as the same key and passes rows through without a rule', () => {
    // Same tie group on both sides: the PHP side returns strings, the node side numbers.
    const legacy = [
      { hid: 61, level: '50', command: '133', rank: 3 },
      { hid: 693, level: '50', command: '133', rank: 5 },
    ];
    const fresh = [
      { hid: 693, level: 50, command: 133, rank: 4 },
      { hid: 61, level: 50, command: 133, rank: 3 },
    ];
    expect(
      rewriteTieRanks(legacy, rule)
        .map((r) => normalizeRow(r, rule, ctx()))
        .sort(),
    ).toEqual(
      rewriteTieRanks(fresh, rule)
        .map((r) => normalizeRow(r, rule, ctx()))
        .sort(),
    );
    const rows = [{ level: 50, command: 133, rank: 2 }];
    expect(rewriteTieRanks(rows, {})).toBe(rows);
  });
});

describe('diffNormalizedRows', () => {
  const rule = { tieRank: { column: 'rank', keys: ['level', 'command'] } };
  const snapshot = [
    { hid: 1, level: 50, command: 133, rank: 1, name: 'A' },
    { hid: 2, level: 50, command: 133, rank: 2, name: 'B' },
    { hid: 3, level: 50, command: 133, rank: 3, name: 'C' },
    { hid: 4, level: 49, command: 120, rank: 4, name: 'D' },
  ];

  it('equates different raw delta memberships, including an unchanged lowest-rank member', () => {
    // The first engine swaps only ranks 2/3; the other keeps the snapshot order. A raw delta
    // omits hid 1, so rewriting that subset would also choose the wrong group minimum (2).
    const live = snapshot.map((row) => ({
      ...row,
      rank: row.hid === 2 ? 3 : row.hid === 3 ? 2 : row.rank,
    }));
    expect(diffNormalizedRows(live, snapshot, rule, ctx())).toEqual({ added: [], removed: [] });
    expect(diffNormalizedRows(snapshot, snapshot, rule, ctx())).toEqual({ added: [], removed: [] });
    expect(snapshot[1]!.rank).toBe(2);
  });

  it('retains real field changes within a tie group', () => {
    const live = snapshot.map((row) => (row.hid === 2 ? { ...row, name: 'changed' } : row));
    const delta = diffNormalizedRows(live, snapshot, rule, ctx());
    expect(delta.added.map((row) => JSON.parse(row))).toEqual([
      { command: '133', hid: '2', level: '50', name: 'changed', rank: '1' },
    ]);
    expect(delta.removed.map((row) => JSON.parse(row))).toEqual([
      { command: '133', hid: '2', level: '50', name: 'B', rank: '1' },
    ]);
  });

  it('retains rank changes between distinct sort groups', () => {
    const live = snapshot.map((row) => (row.hid === 4 ? { ...row, rank: 5 } : row));
    const delta = diffNormalizedRows(live, snapshot, rule, ctx());
    expect(delta.added.map((row) => JSON.parse(row))).toEqual([
      { command: '120', hid: '4', level: '49', name: 'D', rank: '5' },
    ]);
    expect(delta.removed.map((row) => JSON.parse(row))).toEqual([
      { command: '120', hid: '4', level: '49', name: 'D', rank: '4' },
    ]);
  });

  it('retains additions, deletions and duplicate row counts', () => {
    const delta = diffNormalizedRows(
      [snapshot[0]!, snapshot[0]!, snapshot[2]!, snapshot[3]!],
      snapshot,
      rule,
      ctx(),
    );
    expect(delta.added.map((row) => JSON.parse(row)).map((row) => row.hid)).toEqual(['1']);
    expect(delta.removed.map((row) => JSON.parse(row)).map((row) => row.hid)).toEqual(['2']);
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

  it('tolerates a one-second execution gap at a minute boundary, but not two seconds', () => {
    expect(offsetOf(1_700_000_030, ctx(1_700_000_000))).toBe('<now+1m>');
    expect(offsetOf(1_700_000_030, ctx(1_700_000_001))).toBe('<now+1m>');
    expect(offsetOf(1_700_000_030, ctx(1_700_000_002))).toBe('<now+0m>');
  });

  it('keeps long-past times absolute, whatever minute each side started in', () => {
    const stale = 1_300_000_000;
    expect(offsetOf(stale, ctx(1_700_000_029))).toBe(String(stale));
    expect(offsetOf(stale, ctx(1_700_000_031))).toBe(String(stale));
  });
});
