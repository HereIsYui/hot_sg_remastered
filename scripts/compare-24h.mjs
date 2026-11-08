/**
 * 24h 差分结算对比 —— 冻结库对比脚本。
 *
 * 在两侧 tick 都停止、库冻结后运行；也可以在布夹具前后用 --fingerprint 做
 * 轻量全表指纹核对（count + CRC32 逐列聚合，与 tools/src/lib/difftest/side-db.ts
 * 的 SideDb.fingerprint 同式，跨 MySQL 5.7 / 8.4 可比）。
 *
 * 模式：
 *   node scripts/compare-24h.mjs --fingerprint     # 全表 count+crc32 指纹对比（快）
 *   node scripts/compare-24h.mjs [options]         # 全量多重集逐行对比（默认）
 *
 * 全量模式逻辑：
 *   - 先做指纹对比，只有指纹不同的表才逐行拉取做「多重集比较」（行序无关）；
 *   - 掩码规则：列名匹配 /time|_at$|_ts$|posttime|endtime|starttime|last/ 且值是数字、
 *     落在执行窗口 [start,end]（含 ±120s 摆动余量）内的，折叠为 "<window>"；
 *   - auto_increment 计数器漂移单独列出，不算失败；
 *   - 输出：完全一致表清单、差异表清单（每表前若干行差异样例）、auto-inc 漂移表、
 *     最终 PASS/FAIL 判定（PASS = 无结算语义差异）。
 *
 * 窗口来源：scripts/24h-baseline.json 的 startTs / endTs（或 --start/--end 覆盖，
 * --end 缺省取当前时刻）。
 *
 * 连接：LEGACY_DB_URI（默认 mysql://legacy:legacy@127.0.0.1:3317/bloodwar）、
 *       DEV_DB_URI（默认 mysql://root:hot@127.0.0.1:3318/bloodwar）。
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const mysql = require('mysql2/promise');

const LEGACY_URI = process.env.LEGACY_DB_URI ?? 'mysql://legacy:legacy@127.0.0.1:3317/bloodwar';
const DEV_URI = process.env.DEV_DB_URI ?? 'mysql://root:hot@127.0.0.1:3318/bloodwar';
const BASELINE_FILE = new URL('./24h-baseline.json', import.meta.url);

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const FINGERPRINT_ONLY = argv.includes('--fingerprint');
const SAMPLES = Number(flag('--samples') ?? 5);

// ── 时间窗口 ─────────────────────────────────────────────────────────────────
function loadWindow() {
  const startArg = flag('--start');
  const endArg = flag('--end');
  let startTs;
  let endTs;
  let source;
  if (startArg) {
    startTs = Number(startArg);
    source = '--start';
  } else {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
    startTs = Number(baseline.startTs);
    source = `${BASELINE_FILE.pathname} (startTs)`;
  }
  endTs = endArg ? Number(endArg) : Math.floor(Date.now() / 1000);
  return { startTs, endTs, source };
}

// 列名掩码：时间语义列（difftest normalize 的 offsets 思路的粗粒度版）。
const TIME_COL = /time|_at$|_ts$|posttime|endtime|starttime|last/i;
const SKEW = 120; // 两侧 tick 相位差 + 结算时刻秒级摆动的余量

function normalizeRow(columns, row, window) {
  const out = {};
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    let v = row[i];
    if (v !== null && TIME_COL.test(col) && window) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n) && n >= window.startTs - SKEW && n <= window.endTs + SKEW) {
        v = '<window>';
      }
    }
    out[col] = v === undefined ? null : v;
  }
  return out;
}

const rowKey = (row) => JSON.stringify(Object.entries(row));

// ── 连接 ─────────────────────────────────────────────────────────────────────
async function connect(label, uri) {
  const conn = await mysql.createConnection({
    uri,
    charset: 'UTF8MB4_GENERAL_CI',
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
  });
  try {
    await conn.query('set session information_schema_stats_expiry = 0');
  } catch {
    /* MySQL 5.7: variable does not exist */
  }
  await conn.query(`set session net_read_timeout = 600, net_write_timeout = 600`);
  console.log(`[${label}] connected`);
  return conn;
}

async function businessTables(conn) {
  const [rows] = await conn.query(
    `select table_name as name from information_schema.tables
     where table_schema = database() and table_type = 'BASE TABLE'
       and table_name not like '\\_\\_snap\\_%' order by table_name`,
  );
  return rows.map((r) => String(r.name));
}

async function tableColumns(conn, table) {
  const q = `\`${table.replace(/`/g, '``')}\``;
  const [cols] = await conn.query(
    `select column_name as c from information_schema.columns
     where table_schema = database() and table_name = ? order by ordinal_position`,
    [table],
  );
  return { q, columns: cols.map((r) => String(r.c)) };
}

async function primaryKey(conn, table) {
  const [rows] = await conn.query(
    `select column_name as c from information_schema.key_column_usage
     where table_schema = database() and constraint_name = 'PRIMARY' and table_name = ?
     order by ordinal_position`,
    [table],
  );
  return rows.map((r) => String(r.c));
}

async function autoIncrements(conn) {
  const [rows] = await conn.query(
    `select table_name as name, auto_increment as ai from information_schema.tables
     where table_schema = database() and table_type = 'BASE TABLE'
       and table_name not like '\\_\\_snap\\_%'`,
  );
  return new Map(rows.map((r) => [r.name, r.ai === null ? null : Number(r.ai)]));
}

/** count + CRC32 全列聚合（行序无关）。 */
async function fingerprint(conn, q, columns) {
  const expr = columns.map((c) => `ifnull(\`${c.replace(/`/g, '``')}\`, char(0))`).join(', ');
  const [row] = await conn.query(
    `select count(*) as n, coalesce(sum(crc32(concat_ws(char(31), ${expr}))), 0) as h from ${q}`,
  );
  return `${row[0].n}:${row[0].h}`;
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
const window = FINGERPRINT_ONLY ? null : loadWindow();
if (!FINGERPRINT_ONLY) {
  console.log(
    `window: ${window.startTs} .. ${window.endTs} (${new Date(window.startTs * 1000).toISOString()} .. ${new Date(window.endTs * 1000).toISOString()}, from ${window.source})`,
  );
}

const legacy = await connect('legacy', LEGACY_URI);
const dev = await connect('dev', DEV_URI);

const legacyTables = await businessTables(legacy);
const devTables = await businessTables(dev);
const onlyLegacy = legacyTables.filter((t) => !devTables.includes(t));
const onlyDev = devTables.filter((t) => !legacyTables.includes(t));
const tables = legacyTables.filter((t) => devTables.includes(t));
console.log(`business tables: legacy ${legacyTables.length}, dev ${devTables.length}, common ${tables.length}`);
if (onlyLegacy.length) console.log(`only on legacy: ${onlyLegacy.join(', ')}`);
if (onlyDev.length) console.log(`only on dev: ${onlyDev.join(', ')}`);

const identical = [];
const differing = [];
const fpMismatch = [];
let tableIdx = 0;

for (const table of tables) {
  tableIdx++;
  const l = await tableColumns(legacy, table);
  const d = await tableColumns(dev, table);
  if (l.columns.join(',') !== d.columns.join(',')) {
    differing.push({ table, reason: 'schema-mismatch', added: [], removed: [] });
    console.log(`[${tableIdx}/${tables.length}] ${table}: SCHEMA MISMATCH`);
    continue;
  }
  const fpL = await fingerprint(legacy, l.q, l.columns);
  const fpD = await fingerprint(dev, d.q, d.columns);
  if (FINGERPRINT_ONLY) {
    if (fpL !== fpD) {
      fpMismatch.push({ table, fpL, fpD });
      console.log(`[${tableIdx}/${tables.length}] ${table}: FINGERPRINT DIFF ${fpL} vs ${fpD}`);
    }
    continue;
  }
  if (fpL === fpD) {
    identical.push(table);
    continue;
  }
  fpMismatch.push({ table, fpL, fpD });

  // 逐行多重集比较（rowsAsArray 省 内存/时间）。
  const pull = async (conn, { q, columns }) => {
    const [rows] = await conn.query({
      sql: `select * from ${q}`,
      rowsAsArray: true,
    });
    const counts = new Map();
    for (const r of rows) {
      const key = rowKey(normalizeRow(columns, r, window));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const [cl, cd] = [await pull(legacy, l), await pull(dev, d)];
  const added = [];
  const removed = [];
  for (const [key, n] of cd) {
    const rest = n - (cl.get(key) ?? 0);
    if (rest > 0) for (let i = 0; i < rest; i++) added.push(key);
  }
  for (const [key, n] of cl) {
    const rest = n - (cd.get(key) ?? 0);
    if (rest > 0) for (let i = 0; i < rest; i++) removed.push(key);
  }
  if (added.length === 0 && removed.length === 0) {
    // 指纹不同但掩码后多重集一致（时间列窗口内摆动）→ 视为一致。
    identical.push(table);
    console.log(
      `[${tableIdx}/${tables.length}] ${table}: masked-identical (raw fp ${fpL} vs ${fpD})`,
    );
  } else {
    differing.push({ table, reason: 'row-multiset', added, removed, fpL, fpD });
    console.log(
      `[${tableIdx}/${tables.length}] ${table}: DIFF +${added.length} / -${removed.length}`,
    );
  }
}

console.log('\n===== auto_increment 计数器对比（漂移不算失败） =====');
const aiL = await autoIncrements(legacy);
const aiD = await autoIncrements(dev);
const aiDrift = [];
for (const [t, ai] of aiL) {
  if (aiD.has(t) && aiD.get(t) !== ai) aiDrift.push({ table: t, legacy: ai, dev: aiD.get(t) });
}
for (const t of aiD.keys()) {
  if (!aiL.has(t)) aiDrift.push({ table: t, legacy: '(absent)', dev: aiD.get(t) });
}
if (aiDrift.length === 0) console.log('auto_increment 全部一致');
else for (const d of aiDrift) console.log(`  ${d.table}: legacy=${d.legacy} dev=${d.dev}`);

console.log('\n===== 结果 =====');
if (FINGERPRINT_ONLY) {
  console.log(`tables fingerprinted: ${tables.length}`);
  console.log(`fingerprint mismatches: ${fpMismatch.length}`);
  console.log(fpMismatch.length === 0 ? 'FINGERPRINT PASS (0 差异)' : 'FINGERPRINT FAIL');
  console.log(
    JSON.stringify(
      {
        tables: tables.length,
        identical: tables.length - fpMismatch.length,
        mismatch: fpMismatch,
        generatedAt: Math.floor(Date.now() / 1000),
      },
      null,
      2,
    ),
  );
} else {
  console.log(`identical tables: ${identical.length}`);
  console.log(identical.join(', '));
  console.log(`\ndiffering tables: ${differing.length}`);
  for (const d of differing) {
    console.log(`\n--- ${d.table} (${d.reason})`);
    if (d.fpL) console.log(`  fingerprint: legacy=${d.fpL} dev=${d.fpD}`);
    const show = (keys, tag) => {
      console.log(`  ${tag} ${keys.length} row(s):`);
      for (const key of keys.slice(0, SAMPLES)) console.log(`    ${key.slice(0, 2000)}`);
    };
    show(d.added ?? [], 'dev-only/added');
    show(d.removed ?? [], 'legacy-only/removed');
  }
  console.log(`\nauto_increment drift tables: ${aiDrift.length}`);
  const pass = differing.length === 0;
  console.log(pass ? 'PASS（无结算语义差异）' : 'FAIL（存在表级差异，见上）');
  process.exitCode = pass ? 0 : 1;
}

await legacy.end();
await dev.end();
