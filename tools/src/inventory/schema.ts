export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  extra: string;
  comment: string;
}

export interface Table {
  name: string;
  engine: string;
  charset: string;
  comment: string;
  columns: Column[];
  primaryKey: string[];
  indexes: string[];
}

function unquote(s: string): string {
  return s
    .replace(/\\r\\n|\\n/g, ' ')
    .replace(/\\'/g, "'")
    .replace(/''/g, "'")
    .trim();
}

/** Parses the CREATE TABLE statements of a mysqldump file. */
export function parseSchema(sql: string): Table[] {
  const tables: Table[] = [];
  const re = /CREATE TABLE `(\w+)` \(\n([\s\S]*?)\n\) ([^;]*);/g;
  for (const m of sql.matchAll(re)) {
    const opts = m[3] ?? '';
    const table: Table = {
      name: m[1] as string,
      engine: /ENGINE=(\w+)/.exec(opts)?.[1] ?? '',
      charset: /CHARSET=(\w+)/.exec(opts)?.[1] ?? '',
      comment: unquote(/COMMENT='((?:[^'\\]|\\.|'')*)'/.exec(opts)?.[1] ?? ''),
      columns: [],
      primaryKey: [],
      indexes: [],
    };
    for (const raw of (m[2] ?? '').split('\n')) {
      const line = raw.trim().replace(/,$/, '');
      const col = /^`(\w+)` (.*)$/.exec(line);
      if (col) {
        table.columns.push(parseColumn(col[1] as string, col[2] as string));
        continue;
      }
      const pk = /^PRIMARY KEY \((.*)\)/.exec(line);
      if (pk) {
        table.primaryKey = [...(pk[1] ?? '').matchAll(/`(\w+)`/g)].map((x) => x[1] as string);
        continue;
      }
      if (/^(UNIQUE |FULLTEXT )?KEY /.test(line))
        table.indexes.push(line.replace(/ USING \w+/, ''));
    }
    tables.push(table);
  }
  return tables;
}

function parseColumn(name: string, def: string): Column {
  const comment = /COMMENT '((?:[^'\\]|\\.|'')*)'/.exec(def)?.[1];
  const body = def.replace(/ COMMENT '(?:[^'\\]|\\.|'')*'/, '');
  const type = /^([a-z]+(?:\([^)]*\))?(?: unsigned)?(?: zerofill)?)/i.exec(body)?.[1] ?? body;
  const dflt = /DEFAULT ('(?:[^'\\]|\\.|'')*'|\S+)/.exec(body)?.[1] ?? null;
  const extra = [
    /AUTO_INCREMENT/.test(body) ? 'AUTO_INCREMENT' : '',
    /ON UPDATE \S+/.exec(body)?.[0] ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    name,
    type,
    nullable: !/NOT NULL/.test(body),
    default: dflt,
    extra,
    comment: comment ? unquote(comment) : '',
  };
}

/**
 * Counts rows per table in a mysqldump data file by counting top-level value tuples in
 * `INSERT INTO ... VALUES (...),(...);`, honouring quoted strings and backslash escapes.
 */
export function countRows(sql: string): Map<string, number> {
  const counts = new Map<string, number>();
  const re = /^INSERT INTO `(\w+)` VALUES /gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const name = m[1] as string;
    let i = re.lastIndex;
    let depth = 0;
    let inStr = false;
    let n = 0;
    for (; i < sql.length; i++) {
      const c = sql.charCodeAt(i);
      if (inStr) {
        if (c === 92) i++;
        else if (c === 39) inStr = false;
        continue;
      }
      if (c === 39) inStr = true;
      else if (c === 40) {
        if (depth === 0) n++;
        depth++;
      } else if (c === 41) depth--;
      else if (c === 59 && depth === 0) break;
    }
    re.lastIndex = i;
    counts.set(name, (counts.get(name) ?? 0) + n);
  }
  return counts;
}

/** Parses docs/热血三国数据库词条解释.txt lines such as `cfg_building建筑` or `sys_goods 玩家拥有的宝物`. */
export function parseGlossary(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([a-z][a-z0-9_]*)\s*(.+)$/.exec(line.trim());
    if (m?.[2]) out.set(m[1] as string, m[2].trim());
  }
  return out;
}

/** Words that became reserved after MySQL 5.7 (8.0 window functions, 8.4 additions). */
export const MYSQL8_NEW_RESERVED = new Set([
  'cume_dist',
  'dense_rank',
  'empty',
  'except',
  'first_value',
  'grouping',
  'groups',
  'json_table',
  'lag',
  'last_value',
  'lateral',
  'lead',
  'manual',
  'nth_value',
  'ntile',
  'of',
  'over',
  'parallel',
  'percent_rank',
  'qualify',
  'rank',
  'recursive',
  'row_number',
  'system',
  'tablesample',
  'window',
]);

export function tablePrefix(name: string): string {
  const p = name.split('_')[0] ?? '';
  return ['sys', 'cfg', 'mem', 'log', 'rank'].includes(p) ? p : 'other';
}
