import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths, repoRoot } from '../lib/paths.ts';
import { code, generatedHeader, table } from './markdown.ts';
import {
  countRows,
  MYSQL8_NEW_RESERVED,
  parseGlossary,
  parseSchema,
  tablePrefix,
  type Table,
} from './schema.ts';

const PREFIX_TITLES: Record<string, string> = {
  sys: 'sys：玩家与世界的持久数据',
  cfg: 'cfg：静态配置（数值表）',
  mem: 'mem：运行时状态与队列',
  log: 'log：日志',
  rank: 'rank：排行榜快照',
  other: '其他',
};
const PREFIX_ORDER = ['sys', 'cfg', 'mem', 'log', 'rank', 'other'];

export function buildDataDictionary(): string {
  const schema = parseSchema(readFileSync(join(paths.db, 'bloodwar_schema.sql'), 'utf8'));
  const rows = countRows(readFileSync(join(paths.db, 'bloodwar_full.sql'), 'utf8'));
  const glossary = parseGlossary(
    readFileSync(join(repoRoot, 'docs/热血三国数据库词条解释.txt'), 'utf8'),
  );
  const describe = (t: Table) =>
    [t.comment, glossary.get(t.name) ? `词条：${glossary.get(t.name)}` : '']
      .filter(Boolean)
      .join('；');

  const byPrefix = new Map<string, Table[]>();
  for (const t of schema) {
    const p = tablePrefix(t.name);
    byPrefix.set(p, [...(byPrefix.get(p) ?? []), t]);
  }
  const engines = [...new Set(schema.map((t) => t.engine))].sort();
  const reserved = schema.flatMap((t) =>
    t.columns
      .filter((c) => MYSQL8_NEW_RESERVED.has(c.name.toLowerCase()))
      .map((c) => [t.name, c.name]),
  );
  const totalRows = [...rows.values()].reduce((s, n) => s + n, 0);

  const out: string[] = [
    generatedHeader('数据字典（初稿）', 'pnpm legacy:inventory'),
    '根据原库导出的建表语句（`legacy/db/bloodwar_schema.sql`）和数据（`bloodwar_full.sql`）生成，说明列合并了建表注释和 `docs/热血三国数据库词条解释.txt` 中的词条。H5 版沿用这套表结构，Kysely 类型由 `kysely-codegen` 从同一份结构生成。',
    '',
    '## 汇总',
    '',
    `共 ${schema.length} 张表、${schema.reduce((s, t) => s + t.columns.length, 0)} 列，存档数据共 ${totalRows} 行。`,
    '',
    table(
      ['前缀', '表数', ...engines, '数据行数'],
      PREFIX_ORDER.filter((p) => byPrefix.has(p)).map((p) => {
        const list = byPrefix.get(p) ?? [];
        return [
          PREFIX_TITLES[p],
          list.length,
          ...engines.map((e) => list.filter((t) => t.engine === e).length),
          list.reduce((s, t) => s + (rows.get(t.name) ?? 0), 0),
        ];
      }),
    ),
    '',
    '## 迁移到 MySQL 8.4 需要注意的列',
    '',
    `以下 ${reserved.length} 列的列名在 MySQL 8 中成为保留字，SQL 中必须用反引号引用（Kysely 默认会引用标识符，原版 PHP 中的裸写法需要在迁移时修正）。`,
    '',
    table(
      ['列名', '出现的表'],
      [...new Set(reserved.map(([, c]) => c as string))].sort().map((c) => [
        code(c),
        reserved
          .filter(([, col]) => col === c)
          .map(([t]) => code(t as string))
          .join(' '),
      ]),
    ),
    '',
    '## 表索引',
    '',
  ];

  for (const p of PREFIX_ORDER) {
    const list = byPrefix.get(p);
    if (!list) continue;
    out.push(
      `### ${PREFIX_TITLES[p]}`,
      '',
      table(
        ['表', '引擎', '行数', '列数', '说明'],
        list.map((t) => [
          `[${t.name}](#${t.name})`,
          t.engine,
          rows.get(t.name) ?? 0,
          t.columns.length,
          describe(t),
        ]),
      ),
      '',
    );
  }

  out.push('## 表结构', '');
  for (const t of schema) {
    out.push(
      `### ${t.name}`,
      '',
      [
        `${t.engine}，${t.charset}，${rows.get(t.name) ?? 0} 行`,
        t.primaryKey.length ? `主键 ${t.primaryKey.map(code).join(', ')}` : '无主键',
        describe(t),
      ]
        .filter(Boolean)
        .join('；') + '。',
      '',
      table(
        ['列', '类型', '可空', '默认值', '附加', '注释'],
        t.columns.map((c) => [
          code(c.name) + (MYSQL8_NEW_RESERVED.has(c.name.toLowerCase()) ? ' ⚠' : ''),
          c.type,
          c.nullable ? '是' : '',
          c.default ?? '',
          c.extra,
          c.comment,
        ]),
      ),
      '',
    );
    if (t.indexes.length) out.push(`索引：${t.indexes.map(code).join('；')}`, '');
  }
  return out.join('\n');
}
