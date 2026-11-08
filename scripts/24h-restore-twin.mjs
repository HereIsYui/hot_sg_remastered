/**
 * 24h 差分结算对比 —— 两侧 twin 基线恢复。
 *
 * 把每侧的业务表恢复到 __snap_* twin 快照（final-regression 轮验证过的流程）：
 *   1. 列出该侧全部 __snap_* 表；
 *   2. 逐表 `truncate table T; insert into T select * from __snap_T;`；
 *   3. 按 __snap_meta 记录逐表 `alter table T auto_increment = <ai>`。
 *
 * 用法：
 *   node scripts/24h-restore-twin.mjs            # 两侧都恢复
 *   node scripts/24h-restore-twin.mjs legacy     # 只恢复 legacy
 *   node scripts/24h-restore-twin.mjs dev        # 只恢复 dev
 *
 * 连接信息可用环境变量覆盖：LEGACY_DB_URI / DEV_DB_URI（默认走本机映射端口）。
 */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const mysql = require('mysql2/promise');

const LEGACY_URI = process.env.LEGACY_DB_URI ?? 'mysql://legacy:legacy@127.0.0.1:3317/bloodwar';
const DEV_URI = process.env.DEV_DB_URI ?? 'mysql://root:hot@127.0.0.1:3318/bloodwar';

/** 逐条执行（复用一条连接，保证 LAST_INSERT_ID/变量语义一致），返回执行条数。 */
async function runAll(conn, statements, logEvery = 100) {
  let done = 0;
  for (const sql of statements) {
    await conn.query(sql);
    done++;
    if (done % logEvery === 0) process.stdout.write(`  ... ${done} statements\n`);
  }
  return done;
}

async function restoreSide(label, uri) {
  console.log(`[${label}] connecting ...`);
  const conn = await mysql.createConnection({
    uri,
    charset: 'UTF8MB4_GENERAL_CI',
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: false,
  });
  try {
    // MySQL 8 缓存 information_schema 统计；5.7 没有该变量，忽略失败即可。
    try {
      await conn.query('set session information_schema_stats_expiry = 0');
    } catch {
      /* MySQL 5.7: variable does not exist */
    }

    const [snaps] = await conn.query(
      `select table_name as name from information_schema.tables
       where table_schema = database() and table_name like '\\_\\_snap\\_%'
         and table_name <> '__snap_meta' order by table_name`,
    );
    const names = snaps.map((r) => String(r.name).replace(/^__snap_/, ''));
    console.log(`[${label}] ${names.length} snapshot twin(s) to restore`);

    const q = (id) => `\`${String(id).replace(/`/g, '``')}\``;
    const statements = [];
    for (const t of names) statements.push(`truncate table ${q(t)}`);
    for (const t of names) statements.push(`insert into ${q(t)} select * from ${q('__snap_' + t)}`);
    await runAll(conn, statements);

    // auto_inc 计数器按快照目录恢复（__snap_meta 里的 __created 行是快照时间戳，不是表）。
    const [meta] = await conn.query(`select table_name as t, auto_inc as ai from __snap_meta`);
    const known = new Set(names);
    let aiApplied = 0;
    for (const { t, ai } of meta) {
      if (ai === null || !known.has(String(t))) continue;
      await conn.query(`alter table ${q(t)} auto_increment = ${Number(ai)}`);
      aiApplied++;
    }
    console.log(`[${label}] restored ${names.length} table(s), ${aiApplied} auto_increment reset(s)`);
  } finally {
    await conn.end();
  }
}

const which = process.argv[2] ?? 'both';
if (which === 'legacy' || which === 'both') await restoreSide('legacy', LEGACY_URI);
if (which === 'dev' || which === 'both') await restoreSide('dev', DEV_URI);
console.log('done');
