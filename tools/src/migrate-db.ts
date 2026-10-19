import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { countRows } from './inventory/schema.ts';
import { paths, repoRoot } from './lib/paths.ts';
import { capture, log, run } from './lib/run.ts';
import { migrateDump } from './lib/migrate-sql.ts';

const COMPOSE = ['compose', '-f', join(repoRoot, 'docker/dev/docker-compose.yml')];
const DATABASE = 'bloodwar';

const source = join(paths.db, 'bloodwar_full.sql');
if (!existsSync(source)) throw new Error(`${source} missing; run "pnpm legacy:dump-db" first`);

const original = readFileSync(source, 'utf8');
const migrated = migrateDump(original);
const target = join(paths.db, 'bloodwar_mysql84.sql');
writeFileSync(target, migrated);
log('migrate-db', `wrote ${target}`);

run('docker', [...COMPOSE, 'up', '-d', '--wait', 'db']);

function mysql(args: string[], input?: string): string {
  return capture(
    'docker',
    [
      ...COMPOSE,
      'exec',
      '-T',
      'db',
      'mysql',
      '-uroot',
      '-phot',
      '--default-character-set=utf8mb4',
      ...args,
    ],
    input === undefined ? {} : { input },
  );
}

mysql([
  '-e',
  `DROP DATABASE IF EXISTS ${DATABASE}; CREATE DATABASE ${DATABASE} CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci; GRANT ALL ON ${DATABASE}.* TO 'hot'@'%';`,
]);
log('migrate-db', 'importing into MySQL 8.4…');
const started = Date.now();
const res = spawnSync(
  'docker',
  [
    ...COMPOSE,
    'exec',
    '-T',
    'db',
    'mysql',
    '-uroot',
    '-phot',
    '--default-character-set=utf8mb4',
    DATABASE,
  ],
  { input: migrated, stdio: ['pipe', 'inherit', 'pipe'], maxBuffer: 1 << 30 },
);
const stderr = String(res.stderr).replace(/^mysql: \[Warning\].*\n/gm, '');
if (res.status !== 0) throw new Error(`import failed: ${stderr}`);
log('migrate-db', `imported in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const expected = countRows(original);
const actual = new Map(
  mysql([
    '-N',
    '-e',
    `SELECT table_name, engine FROM information_schema.tables WHERE table_schema='${DATABASE}'`,
  ])
    .trim()
    .split('\n')
    .map((l) => l.split('\t') as [string, string]),
);
const expectedTables = (original.match(/^CREATE TABLE /gm) ?? []).length;
if (actual.size !== expectedTables) {
  throw new Error(`expected ${expectedTables} tables, found ${actual.size}`);
}
const notInnodb = [...actual].filter(([, e]) => e !== 'InnoDB').map(([t]) => t);
if (notInnodb.length) throw new Error(`tables not converted to InnoDB: ${notInnodb.join(', ')}`);

const countSql = [...expected.keys()]
  .map((t) => `SELECT '${t}', COUNT(*) FROM \`${t}\``)
  .join(' UNION ALL ');
const mismatched: string[] = [];
for (const line of mysql(['-N', DATABASE, '-e', countSql]).trim().split('\n')) {
  const [t, n] = line.split('\t');
  if (Number(n) !== expected.get(t as string))
    mismatched.push(`${t}: ${n} != ${expected.get(t as string)}`);
}
if (mismatched.length) throw new Error(`row count mismatch:\n${mismatched.join('\n')}`);
log(
  'migrate-db',
  `verified ${actual.size} InnoDB tables, ${[...expected.values()].reduce((a, b) => a + b, 0)} rows`,
);
