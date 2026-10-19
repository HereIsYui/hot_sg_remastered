/**
 * Normalization for differential tests. PHP returns every database value as a string while the
 * new server returns native types, and both sides produce values that legitimately differ
 * (clock, random ids, client address). Values are reduced to a canonical form before comparing.
 */

export type Row = Record<string, unknown>;

/** Per-side facts the normalizer needs. */
export interface SideContext {
  /** Unix time window (seconds) in which the side ran the case. */
  start: number;
  end: number;
  /** Canonical value -> placeholder, for values that are random by design (sid, new city id). */
  aliases: Map<string, string>;
}

/** How rows of one table are compared. */
export interface TableRule {
  /** Compare only these columns. */
  only?: string[];
  ignore?: string[];
  /** Times relative to "now" (e.g. now + 600); compared as minutes from the case start. */
  offsets?: string[];
  /** Column value rewrites applied after canonicalization. */
  map?: Record<string, (value: unknown) => unknown>;
  /** Rows left out of the comparison entirely. */
  skip?: (row: Row) => boolean;
}

const NUMERIC = /^-?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const ADDRESS_COLUMNS = new Set(['ip', 'sip']);
/** Clock skew tolerated around a side's window. */
const SLACK_SECONDS = 2;

/** Numbers and numeric strings become the same canonical string; other values pass through. */
export function canonicalScalar(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' && NUMERIC.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(Math.trunc(n)) ? String(n) : value;
  }
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString('hex')}`;
  return value;
}

function isTimestamp(canonical: unknown, ctx: SideContext): boolean {
  if (typeof canonical !== 'string' || !/^\d{9,10}$/.test(canonical)) return false;
  const n = Number(canonical);
  return n >= ctx.start - SLACK_SECONDS && n <= ctx.end + SLACK_SECONDS;
}

export function normalizeScalar(value: unknown, ctx: SideContext): unknown {
  const canonical = canonicalScalar(value);
  if (typeof canonical === 'string') {
    const alias = ctx.aliases.get(canonical);
    if (alias !== undefined) return alias;
  }
  return isTimestamp(canonical, ctx) ? '<now>' : canonical;
}

/** Normalizes a response tree (arrays, objects, scalars). */
export function normalizeTree(value: unknown, ctx: SideContext): unknown {
  if (Array.isArray(value)) return value.map((v) => normalizeTree(v, ctx));
  if (value !== null && typeof value === 'object' && !(value instanceof Uint8Array)) {
    return Object.fromEntries(
      Object.entries(value as Row).map(([k, v]) => [k, normalizeTree(v, ctx)]),
    );
  }
  return normalizeScalar(value, ctx);
}

/** Sorts the array found at `path` (canonical JSON order); missing paths are left alone. */
export function sortAt(tree: unknown, path: (string | number)[]): unknown {
  if (path.length === 0) {
    return Array.isArray(tree)
      ? [...tree].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : tree;
  }
  const [head, ...rest] = path;
  if (Array.isArray(tree) && typeof head === 'number' && head < tree.length) {
    return tree.map((v, i) => (i === head ? sortAt(v, rest) : v));
  }
  if (tree !== null && typeof tree === 'object' && !Array.isArray(tree) && String(head) in tree) {
    return { ...(tree as Row), [String(head)]: sortAt((tree as Row)[String(head)], rest) };
  }
  return tree;
}

/** Rewrites the values found at `path` (`'*'` matches every array element); missing paths are left alone. */
export function mapAt(
  tree: unknown,
  path: (string | number)[],
  fn: (value: unknown) => unknown,
): unknown {
  if (path.length === 0) return fn(tree);
  const [head, ...rest] = path;
  if (Array.isArray(tree)) {
    if (head === '*') return tree.map((v) => mapAt(v, rest, fn));
    if (typeof head === 'number' && head < tree.length) {
      return tree.map((v, i) => (i === head ? mapAt(v, rest, fn) : v));
    }
    return tree;
  }
  if (tree !== null && typeof tree === 'object' && String(head) in tree) {
    return { ...(tree as Row), [String(head)]: mapAt((tree as Row)[String(head)], rest, fn) };
  }
  return tree;
}

/** Replaces the values found at `path` with `<masked>`. */
export function maskAt(tree: unknown, path: (string | number)[]): unknown {
  return mapAt(tree, path, () => '<masked>');
}

export function offsetOf(value: unknown, ctx: SideContext): unknown {
  const canonical = canonicalScalar(value);
  if (typeof canonical !== 'string' || !/^\d+$/.test(canonical)) return canonical;
  // 0 stands for "no time set" (e.g. state_endtime of an idle queue).
  if (Number(canonical) === 0) return canonical;
  const minutes = Math.round((Number(canonical) - ctx.start) / 60);
  return `<now${minutes >= 0 ? '+' : ''}${minutes}m>`;
}

/** A row as a canonical JSON string (sorted keys), or null when the rule skips it. */
export function normalizeRow(row: Row, rule: TableRule, ctx: SideContext): string | null {
  if (rule.skip?.(row)) return null;
  const out: Row = {};
  for (const column of Object.keys(row).sort()) {
    if (rule.only && !rule.only.includes(column)) continue;
    if (rule.ignore?.includes(column)) continue;
    let value: unknown;
    if (ADDRESS_COLUMNS.has(column)) value = '<ip>';
    else if (rule.offsets?.includes(column)) value = offsetOf(row[column], ctx);
    else value = normalizeScalar(row[column], ctx);
    const map = rule.map?.[column];
    out[column] = map ? map(value) : value;
  }
  return JSON.stringify(out);
}

/** Multiset difference of two lists of canonical strings. */
export function diffMultisets(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const counts = new Map<string, number>();
  for (const s of a) counts.set(s, (counts.get(s) ?? 0) + 1);
  const onlyB: string[] = [];
  for (const s of b) {
    const n = counts.get(s) ?? 0;
    if (n > 0) counts.set(s, n - 1);
    else onlyB.push(s);
  }
  const onlyA = [...counts].flatMap(([s, n]) => Array<string>(n).fill(s));
  return { onlyA: onlyA.sort(), onlyB: onlyB.sort() };
}

/** Paths at which two normalized trees differ, e.g. `[4][0].name: "a" != "b"`. */
export function compareTrees(a: unknown, b: unknown, path = ''): string[] {
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: string[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length) out.push(`${path}[${i}]: missing in legacy`);
      else if (i >= b.length) out.push(`${path}[${i}]: missing in new`);
      else out.push(...compareTrees(a[i], b[i], `${path}[${i}]`));
    }
    return out;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => {
      if (!(k in a)) return [`${path}.${k}: missing in legacy`];
      if (!(k in b)) return [`${path}.${k}: missing in new`];
      return compareTrees(a[k], b[k], `${path}.${k}`);
    });
  }
  return a === b ? [] : [`${path || '(root)'}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`];
}

function isPlainObject(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
