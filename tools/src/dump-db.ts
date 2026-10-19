import { cpSync, existsSync, mkdirSync, openSync, closeSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { images } from './lib/docker.ts';
import { paths, requireExtracted } from './lib/paths.ts';
import { log, run, succeeds } from './lib/run.ts';

const DATABASE = 'bloodwar';
const CONTAINER = 'hot-legacy-dump';

requireExtracted();
const force = process.argv.includes('--force');
const fullSql = join(paths.db, `${DATABASE}_full.sql`);
const schemaSql = join(paths.db, `${DATABASE}_schema.sql`);

if (existsSync(fullSql) && statSync(fullSql).size > 0 && !force) {
  log('dump-db', `already dumped to ${paths.db} (use --force to redo)`);
  process.exit(0);
}

const dataCopy = join(paths.cache, 'mysql57-data');
rmSync(dataCopy, { recursive: true, force: true });
mkdirSync(paths.cache, { recursive: true });
cpSync(paths.mysql51Data, dataCopy, { recursive: true });

spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
log('dump-db', `starting ${images.mysql57()} on a copy of the MySQL 5.1 data files`);
run('docker', [
  'run',
  '-d',
  '--name',
  CONTAINER,
  '--platform',
  'linux/amd64',
  '-v',
  `${dataCopy}:/var/lib/mysql`,
  images.mysql57(),
  'mysqld',
  '--user=root',
  '--skip-grant-tables',
  '--lower-case-table-names=1',
  '--innodb-log-file-size=5M',
  '--character-set-server=utf8',
]);

function mysql(sql: string): boolean {
  return succeeds('docker', ['exec', CONTAINER, 'mysql', '-uroot', '-e', sql]);
}

try {
  const deadline = Date.now() + 180_000;
  while (!mysql('select 1')) {
    if (Date.now() > deadline) throw new Error('MySQL 5.7 did not become ready within 180s');
    spawnSync('sleep', ['2']);
  }
  mysql('set global show_compatibility_56=ON');

  mkdirSync(paths.db, { recursive: true });
  const common = [
    'exec',
    CONTAINER,
    'mysqldump',
    '-uroot',
    '--default-character-set=utf8',
    '--set-gtid-purged=OFF',
    '--skip-dump-date',
  ];
  for (const [file, extra] of [
    [schemaSql, ['--no-data']],
    [fullSql, []],
  ] as const) {
    const fd = openSync(file, 'w');
    try {
      run('docker', [...common, ...extra, DATABASE], { stdio: ['ignore', fd, 'inherit'] });
    } finally {
      closeSync(fd);
    }
    log('dump-db', `${file} (${(statSync(file).size / 1048576).toFixed(1)} MiB)`);
  }
} finally {
  spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
  rmSync(dataCopy, { recursive: true, force: true });
}
