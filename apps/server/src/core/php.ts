/**
 * PHP 5 semantics the ported game rules depend on. Inputs are whatever the client sent in the
 * command array (strings, numbers, null), so every helper accepts `unknown`.
 */

/** `(string)$value`: null/undefined/false -> "", true -> "1". */
export function phpString(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (value === true) return '1';
  return String(value);
}

/** `trim()` with its default character list (no Unicode whitespace). */
export function phpTrim(value: unknown): string {
  return phpString(value).replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g, '');
}

/** `intval()`: leading-integer parse of strings, truncation of numbers, 0 otherwise. */
export function phpIntval(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value !== 'string') return 0;
  const m = /^[ \t\n\r\v\f]*([+-]?\d+)/.exec(value);
  return m ? Number.parseInt(m[1]!, 10) : 0;
}

const NUMERIC = /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const NUMERIC_PREFIX = /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/;

/** `is_numeric()` for strings and numbers (PHP 5: no trailing whitespace). */
export function isPhpNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && NUMERIC.test(value);
}

/** String-to-number conversion used by arithmetic and loose comparison: leading number or 0. */
export function phpToNumber(value: string): number {
  const m = NUMERIC_PREFIX.exec(value);
  return m ? Number(m[0].trim()) : 0;
}

function phpBool(value: unknown): boolean {
  return !phpEmpty(value) && value !== 0.0;
}

/** `$a == $b` with PHP 5 type juggling for scalars. */
export function phpLooseEquals(a: unknown, b: unknown): boolean {
  const x = a === undefined ? null : a;
  const y = b === undefined ? null : b;
  if (x === null && typeof y === 'string') return y === '';
  if (y === null && typeof x === 'string') return x === '';
  if (x === null || y === null || typeof x === 'boolean' || typeof y === 'boolean') {
    return phpBool(x) === phpBool(y);
  }
  if (typeof x === 'string' && typeof y === 'string') {
    return isPhpNumeric(x) && isPhpNumeric(y) ? Number(x.trim()) === Number(y.trim()) : x === y;
  }
  const nx = typeof x === 'number' ? x : phpToNumber(String(x));
  const ny = typeof y === 'number' ? y : phpToNumber(String(y));
  return nx === ny;
}

/**
 * The sign of `$a <=> $b` under PHP 5 loose comparison of scalars: null against a string compares
 * as "", bools and null compare as bools, two numeric strings compare as numbers, other strings
 * lexically, and a string against a number by its numeric prefix.
 */
export function phpCompare(a: unknown, b: unknown): number {
  let x = a === undefined ? null : a;
  let y = b === undefined ? null : b;
  if (x === null && typeof y === 'string') x = '';
  else if (y === null && typeof x === 'string') y = '';
  if (x === null || y === null || typeof x === 'boolean' || typeof y === 'boolean') {
    return Number(phpBool(x)) - Number(phpBool(y));
  }
  if (typeof x === 'string' && typeof y === 'string') {
    if (isPhpNumeric(x) && isPhpNumeric(y)) return Math.sign(Number(x.trim()) - Number(y.trim()));
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const nx = typeof x === 'number' ? x : phpToNumber(String(x));
  const ny = typeof y === 'number' ? y : phpToNumber(String(y));
  return Math.sign(nx - ny);
}

/** `empty()`: false for "0", 0, "", null, false and empty arrays. */
export function phpEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return true;
  if (value === 0 || value === '' || value === '0') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** `mb_strlen()` with mb_internal_encoding utf-8: counts code points. */
export function mbStrlen(value: string): number {
  return [...value].length;
}

/** `addslashes()`. */
export function addslashes(value: string): string {
  return value.replace(/[\\'"\0]/g, (c) => (c === '\0' ? '\\0' : `\\${c}`));
}

const CSLASH_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  a: '\x07',
  v: '\v',
  b: '\b',
  f: '\f',
};

/** `stripcslashes()`: C-style escapes, `\xhh`, octal `\ooo`; other backslashes are dropped. */
export function stripcslashes(value: string): string {
  return value.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|[\s\S]?)/g, (_m, esc: string) => {
    if (esc === '') return '';
    if (esc[0] === 'x' && esc.length > 1)
      return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
    if (/^[0-7]+$/.test(esc)) return String.fromCharCode(Number.parseInt(esc, 8) & 0xff);
    return CSLASH_ESCAPES[esc] ?? esc;
  });
}

/**
 * `(string)$float` under PHP 5's `precision=14`: how computed numbers were written into SQL and
 * JSON. Integral values print without a fraction; exponents below -4 or from 14 up use `1.5E+20`.
 */
export function phpFloatString(n: number): string {
  if (Number.isNaN(n)) return 'NAN';
  if (!Number.isFinite(n)) return n > 0 ? 'INF' : '-INF';
  if (n === 0) return Object.is(n, -0) ? '-0' : '0';
  const rounded = Number(n.toPrecision(14));
  const exp = Math.floor(Math.log10(Math.abs(rounded)));
  if (exp >= -4 && exp < 14) return String(rounded);
  const [mantissa = '', e = ''] = n.toExponential(13).split('e');
  const digits = mantissa.replace(/\.?0+$/, '');
  return `${digits.includes('.') ? digits : `${digits}.0`}E${e.startsWith('-') ? '-' : '+'}${e.replace(/^[+-]/, '')}`;
}

/** A computed number as PHP would have serialized it (precision 14), e.g. in a JSON reply. */
export function phpFloat(n: number): number {
  return Number(phpFloatString(n));
}

/** PHP arithmetic on a fetched cell: numeric prefix of strings, false/null as 0. */
export function phpNum(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return phpToNumber(value);
  if (value === true) return 1;
  return 0;
}

/** `floor($a / $b)` on PHP numbers. */
export function phpFloorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** `$a % $b`: integer remainder with the sign of the dividend. */
export function phpMod(a: number, b: number): number {
  return Math.trunc(a) % Math.trunc(b);
}
