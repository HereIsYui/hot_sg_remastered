/**
 * Differential test: runs each case against the legacy PHP server and the NestJS server, then
 * compares their responses and the database rows each side changed.
 *
 *   pnpm difftest [name filter] [--resnapshot] [--dump]
 *
 * `--dump` writes each case's normalized responses and row changes to the cache directory.
 *
 * Both databases must start from the same dump (pnpm legacy:reset && pnpm legacy:up,
 * pnpm db:migrate). The first run copies every table into __snap_* twins on both sides; each
 * case's changes are rolled back from them, so runs are repeatable.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cases } from './difftest/cases.ts';
import { tableRules } from './difftest/tables.ts';
import {
  compareTrees,
  diffMultisets,
  mapAt,
  maskAt,
  normalizeRow,
  normalizeTree,
  offsetOf,
  sortAt,
  type SideContext,
  type TableRule,
} from './lib/difftest/normalize.ts';
import { SideDb, type TableDelta } from './lib/difftest/side-db.ts';
import { legacyTarget, newTarget, Side, type Target } from './lib/difftest/side.ts';
import { paths, repoRoot } from './lib/paths.ts';
import { log, succeeds } from './lib/run.ts';

const LEGACY_DB_URL =
  process.env.HOT_LEGACY_DB_URL ?? 'mysql://legacy:legacy@127.0.0.1:3317/bloodwar';
const NEW_DB_URL = process.env.DATABASE_URL ?? 'mysql://hot:hot@127.0.0.1:3318/bloodwar';
const SERVER_PORT = Number(process.env.HOT_DIFFTEST_PORT ?? 3998);
const MAX_REPORT_LINES = 40;

const args = process.argv.slice(2);
let resnapshot = args.includes('--resnapshot');
const dump = args.includes('--dump');
const filter = args.find((a) => !a.startsWith('--'));
const selected = cases.filter((c) => !filter || c.name.includes(filter));
if (selected.length === 0) throw new Error(`no case matches "${filter}"`);

// The tick would keep changing the legacy database underneath the cases.
succeeds('docker', [
  'compose',
  '-f',
  join(repoRoot, 'docker/legacy/docker-compose.yml'),
  '--profile',
  'tick',
  'stop',
  'tick',
]);

const legacyDb = await SideDb.connect('legacy', LEGACY_DB_URL);
const newDb = await SideDb.connect('new', NEW_DB_URL);
let server: ChildProcess | undefined;
let failed = 0;

try {
  await prepareSnapshots();
  const target = newTarget(process.env.HOT_SERVER_URL ?? (await startServer()));
  for (const testCase of selected) {
    const legacy = await runSide('legacy', legacyTarget(), legacyDb, testCase.run, testCase.tables);
    const fresh = await runSide('new', target, newDb, testCase.run, testCase.tables);
    const problems = compareSides(legacy, fresh);
    if (dump) {
      const file = join(paths.cache, `difftest-${testCase.name.replace(/\W+/g, '-')}.json`);
      const plain = (r: SideResult) => ({ ...r, deltas: Object.fromEntries(r.deltas) });
      writeFileSync(file, JSON.stringify({ legacy: plain(legacy), new: plain(fresh) }, null, 1));
      log('difftest', `dumped ${file}`);
    }
    if (problems.length === 0) {
      log('difftest', `ok    ${testCase.name}`);
    } else {
      failed++;
      log('difftest', `FAIL  ${testCase.name}`);
      for (const line of problems.slice(0, MAX_REPORT_LINES)) console.log(`      ${line}`);
      if (problems.length > MAX_REPORT_LINES) {
        console.log(`      … ${problems.length - MAX_REPORT_LINES} more`);
      }
    }
  }
  log('difftest', `${selected.length - failed}/${selected.length} cases match`);
} finally {
  server?.kill('SIGTERM');
  await legacyDb.close();
  await newDb.close();
}
process.exitCode = failed ? 1 : 0;

async function ensureManeuverCombatColumns(db: SideDb): Promise<boolean> {
  const existing = await db.query<{ column: string }>(
    `select column_name as \`column\` from information_schema.columns
     where table_schema = database() and table_name = 'mem_maneuver'`,
  );
  const names = new Set(existing.map((row) => row.column));
  if (names.has('attackadd') && names.has('resistadd') && names.has('wallhp')) return false;
  if (names.has('attackadd') || names.has('resistadd') || names.has('wallhp')) {
    throw new Error(`${db.label}: mem_maneuver has an incomplete combat-column set`);
  }
  await db.query(
    `alter table mem_maneuver
      add column attackadd char(255) character set ascii not null default '',
      add column resistadd char(255) character set ascii not null default '',
      add column wallhp bigint not null default 0`,
  );
  return true;
}

async function prepareSnapshots(): Promise<void> {
  // The production 易语言 backend expects these columns, but the shipped PHP dump omitted them.
  // Restore them on both test databases so legacy patrols actually fight instead of failing the
  // mem_maneuver insert and silently returning its default victory.
  for (const db of [legacyDb, newDb]) {
    if (await ensureManeuverCombatColumns(db)) resnapshot = true;
  }
  if (!resnapshot && (await legacyDb.hasSnapshot()) && (await newDb.hasSnapshot())) {
    for (const db of [legacyDb, newDb]) {
      const restored = await db.resetToSnapshot();
      if (restored.length)
        log('difftest', `${db.label}: restored ${restored.length} tables to the snapshot`);
    }
    return;
  }
  log('difftest', 'comparing both databases before taking snapshots…');
  const tables = legacyDb.tableNames.sort();
  const missing = tables.filter((t) => !newDb.tableNames.includes(t));
  if (missing.length) throw new Error(`tables missing in the new database: ${missing.join(', ')}`);
  const differing: string[] = [];
  for (const table of tables) {
    if ((await legacyDb.fingerprint(table)) !== (await newDb.fingerprint(table)))
      differing.push(table);
  }
  if (differing.length) {
    throw new Error(
      `databases differ in ${differing.length} tables (${differing.slice(0, 20).join(', ')}); ` +
        'reset both: pnpm legacy:reset && pnpm legacy:up, then pnpm db:migrate',
    );
  }
  const legacyAi = await legacyDb.autoIncrements();
  const newAi = await newDb.autoIncrements();
  const aligned = new Map<string, number | null>();
  for (const table of tables) {
    const values = [legacyAi.get(table), newAi.get(table)].filter(
      (v): v is number => typeof v === 'number',
    );
    aligned.set(table, values.length ? Math.max(...values) : null);
  }
  for (const db of [legacyDb, newDb]) {
    log('difftest', `${db.label}: snapshotting ${tables.length} tables…`);
    await db.createSnapshot(aligned);
  }
}

async function startServer(): Promise<string> {
  const entry = join(repoRoot, 'apps/server/dist/main.js');
  if (!existsSync(entry))
    throw new Error(`${entry} missing; run "pnpm --filter @hot/server build"`);
  mkdirSync(paths.cache, { recursive: true });
  const logFile = join(paths.cache, 'difftest-server.log');
  const out = createWriteStream(logFile);
  server = spawn(process.execPath, [entry], {
    cwd: join(repoRoot, 'apps/server'),
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      DATABASE_URL: NEW_DB_URL,
      TICK_ENABLED: 'false',
      TICK_DEBUG_ENDPOINT: 'true',
      // Same identity as docker/legacy/php/db.php, echoed by loadGlobalData.
      SERVER_MARK: 'legacy',
      SERVER_NAME: 'legacy',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.pipe(out);
  server.stderr?.pipe(out);
  const url = `http://127.0.0.1:${SERVER_PORT}`;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`server exited early, see ${logFile}`);
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return url;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not become healthy, see ${logFile}`);
}

interface SideResult {
  responses: { label: string; value: unknown }[];
  error?: string;
  /** table -> normalized added / removed rows */
  deltas: Map<string, { added: string[]; removed: string[] }>;
}

async function dbNow(db: SideDb): Promise<number> {
  const [row] = await db.query<{ now: string }>('select unix_timestamp() as now');
  return Number(row?.now);
}

async function runSide(
  label: 'legacy' | 'new',
  target: Target,
  db: SideDb,
  run: (side: Side) => Promise<unknown>,
  tableOverrides: Record<string, TableRule> = {},
): Promise<SideResult> {
  const side = new Side(label, target, db);
  const start = await dbNow(db);
  let error: string | undefined;
  try {
    await run(side);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const end = await dbNow(db);
  const ctx: SideContext = { start, end, aliases: side.aliases };

  const saved = await db.snapshotAutoIncrements();
  const deltas = new Map<string, { added: string[]; removed: string[] }>();
  for (const table of await db.changedSince(start)) {
    const delta: TableDelta = await db.diff(table);
    await db.restore(table, saved.get(table));
    const rule = tableOverrides[table] ?? tableRules[table] ?? {};
    const norm = (rows: TableDelta['added']) =>
      rows.map((r) => normalizeRow(r, rule, ctx)).filter((r): r is string => r !== null);
    const added = norm(delta.added);
    const removed = norm(delta.removed);
    if (added.length || removed.length) deltas.set(table, { added, removed });
  }
  return {
    responses: side.responses.map((r) => ({
      label: r.label,
      value: r.unordered.reduce(
        sortAt,
        r.masked.reduce(
          maskAt,
          normalizeTree(
            r.offsets.reduce((t, path) => mapAt(t, path, (v) => offsetOf(v, ctx)), r.value),
            ctx,
          ),
        ),
      ),
    })),
    error,
    deltas,
  };
}

function compareSides(legacy: SideResult, fresh: SideResult): string[] {
  const out: string[] = [];
  if (legacy.error) out.push(`legacy error: ${legacy.error}`);
  if (fresh.error) out.push(`new error: ${fresh.error}`);
  const count = Math.max(legacy.responses.length, fresh.responses.length);
  for (let i = 0; i < count; i++) {
    const a = legacy.responses[i];
    const b = fresh.responses[i];
    const label = a?.label ?? b?.label;
    if (!a || !b) {
      out.push(`response #${i} ${label}: only ${a ? 'legacy' : 'new'} answered`);
      continue;
    }
    for (const d of compareTrees(a.value, b.value)) out.push(`response #${i} ${label} ${d}`);
  }
  const tables = [...new Set([...legacy.deltas.keys(), ...fresh.deltas.keys()])].sort();
  for (const table of tables) {
    const a = legacy.deltas.get(table) ?? { added: [], removed: [] };
    const b = fresh.deltas.get(table) ?? { added: [], removed: [] };
    for (const kind of ['added', 'removed'] as const) {
      const sign = kind === 'added' ? '+' : '-';
      const { onlyA, onlyB } = diffMultisets(a[kind], b[kind]);
      for (const row of onlyA) out.push(`${table} legacy only ${sign} ${row}`);
      for (const row of onlyB) out.push(`${table} new only    ${sign} ${row}`);
    }
  }
  return out;
}
