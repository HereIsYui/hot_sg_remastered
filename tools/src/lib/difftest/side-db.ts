import mysql from 'mysql2/promise';
import type { Row } from './normalize.ts';

const SNAP_PREFIX = '__snap_';
const META = '__snap_meta';
/** META row holding the snapshot's creation time instead of a counter. */
const CREATED = '__created';

interface TableInfo {
  name: string;
  engine: string;
  columns: string[];
  primaryKey: string[];
}

export interface TableDelta {
  added: Row[];
  removed: Row[];
}

const q = (identifier: string) => `\`${identifier.replace(/`/g, '``')}\``;

/**
 * One side's database (legacy MySQL 5.7 or MySQL 8.4). Every base table is copied once into a
 * `__snap_<table>` twin; after each case, the tables whose update_time moved are diffed against
 * their twin by primary key and restored, auto-increment counters included.
 */
export class SideDb {
  readonly label: string;
  private readonly conn: mysql.Connection;
  private readonly tables = new Map<string, TableInfo>();

  private constructor(label: string, conn: mysql.Connection) {
    this.label = label;
    this.conn = conn;
  }

  static async connect(label: string, url: string): Promise<SideDb> {
    const conn = await mysql.createConnection({
      uri: url,
      charset: 'UTF8MB4_GENERAL_CI',
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    const [rows] = await conn.query<mysql.RowDataPacket[]>('select version() as v');
    if (!String(rows[0]?.v).startsWith('5.')) {
      // MySQL 8 caches information_schema.tables statistics (update_time, auto_increment).
      await conn.query('set session information_schema_stats_expiry = 0');
    }
    const db = new SideDb(label, conn);
    await db.loadTables();
    return db;
  }

  async close(): Promise<void> {
    await this.conn.end();
  }

  async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await this.conn.query<mysql.RowDataPacket[]>(sql, params);
    return rows as unknown as T[];
  }

  get tableNames(): string[] {
    return [...this.tables.keys()];
  }

  private async loadTables(): Promise<void> {
    const tables = await this.query<{ name: string; engine: string }>(
      `select table_name as name, engine from information_schema.tables
       where table_schema = database() and table_type = 'BASE TABLE' and table_name not like '\\_\\_snap\\_%'`,
    );
    const columns = await this.query<{ t: string; c: string }>(
      `select table_name as t, column_name as c from information_schema.columns
       where table_schema = database() order by table_name, ordinal_position`,
    );
    const keys = await this.query<{ t: string; c: string }>(
      `select table_name as t, column_name as c from information_schema.key_column_usage
       where table_schema = database() and constraint_name = 'PRIMARY' order by table_name, ordinal_position`,
    );
    for (const { name, engine } of tables) {
      this.tables.set(name, { name, engine, columns: [], primaryKey: [] });
    }
    for (const { t, c } of columns) this.tables.get(t)?.columns.push(c);
    for (const { t, c } of keys) this.tables.get(t)?.primaryKey.push(c);
  }

  private info(table: string): TableInfo {
    const info = this.tables.get(table);
    if (!info) throw new Error(`${this.label}: unknown table ${table}`);
    return info;
  }

  async hasSnapshot(): Promise<boolean> {
    const rows = await this.query(
      `select 1 from information_schema.tables where table_schema = database() and table_name = ?`,
      [META],
    );
    return rows.length > 0;
  }

  async autoIncrements(): Promise<Map<string, number | null>> {
    const rows = await this.query<{ name: string; ai: string | null }>(
      `select table_name as name, auto_increment as ai from information_schema.tables
       where table_schema = database() and table_type = 'BASE TABLE'`,
    );
    return new Map(rows.map((r) => [r.name, r.ai === null ? null : Number(r.ai)]));
  }

  /** Copies every table into its twin and records the auto-increment counters to restore. */
  async createSnapshot(autoIncrement: Map<string, number | null>): Promise<void> {
    await this.dropSnapshot();
    for (const { name, engine } of this.tables.values()) {
      const snap = q(SNAP_PREFIX + name);
      await this.conn.query(`create table ${snap} like ${q(name)}`);
      // MEMORY twins would hit max_heap_table_size.
      if (engine === 'MEMORY') await this.conn.query(`alter table ${snap} engine = MyISAM`);
      await this.conn.query(`insert into ${snap} select * from ${q(name)}`);
    }
    await this.conn.query(
      `create table ${q(META)} (table_name varchar(64) primary key, auto_inc bigint null) engine = MyISAM`,
    );
    const current = await this.autoIncrements();
    for (const name of this.tables.keys()) {
      const ai = autoIncrement.get(name) ?? null;
      await this.conn.query(`insert into ${q(META)} values (?, ?)`, [name, ai]);
      if (ai !== null && current.get(name) !== ai) {
        await this.conn.query(`alter table ${q(name)} auto_increment = ${ai}`);
      }
    }
    await this.conn.query(`insert into ${q(META)} values (?, unix_timestamp())`, [CREATED]);
  }

  async dropSnapshot(): Promise<void> {
    const snaps = await this.query<{ name: string }>(
      `select table_name as name from information_schema.tables
       where table_schema = database() and table_name like '\\_\\_snap\\_%'`,
    );
    for (const { name } of snaps) await this.conn.query(`drop table ${q(name)}`);
  }

  /** count + CRC sum over all columns, comparable across MySQL versions for equal data. */
  async fingerprint(table: string): Promise<string> {
    const { columns } = this.info(table);
    const expr = columns.map((c) => `ifnull(${q(c)}, char(0))`).join(', ');
    const [row] = await this.query<{ n: string; h: string }>(
      `select count(*) as n, coalesce(sum(crc32(concat_ws(char(31), ${expr}))), 0) as h from ${q(table)}`,
    );
    return `${row?.n}:${row?.h}`;
  }

  /** Tables modified at or after `since` (update_time has one-second resolution). */
  async changedSince(since: number): Promise<string[]> {
    const rows = await this.query<{ name: string }>(
      `select table_name as name from information_schema.tables
       where table_schema = database() and table_type = 'BASE TABLE'
         and table_name not like '\\_\\_snap\\_%'
         and (update_time >= from_unixtime(?) or (update_time is null and engine = 'MEMORY'))`,
      [since - 1],
    );
    return rows.map((r) => r.name).filter((n) => this.tables.has(n));
  }

  private matchSql(
    table: string,
    a: string,
    b: string,
  ): { join: string; same: string; missing: string } {
    const { columns, primaryKey } = this.info(table);
    const same = columns.map((c) => `${a}.${q(c)} <=> ${b}.${q(c)}`).join(' and ');
    if (primaryKey.length === 0) return { join: '', same, missing: '' };
    return {
      join: primaryKey.map((c) => `${a}.${q(c)} = ${b}.${q(c)}`).join(' and '),
      same,
      missing: `${b}.${q(primaryKey[0]!)} is null`,
    };
  }

  /** Rows present now but not in the snapshot (added/changed) and vice versa. */
  async diff(table: string): Promise<TableDelta> {
    const live = q(table);
    const snap = q(SNAP_PREFIX + table);
    const select = async (from: string, other: string, chunk?: number) => {
      const m = this.matchSql(table, 'a', 'b');
      if (!m.join) {
        return this.query(
          `select a.* from ${from} a where not exists (select 1 from ${other} b where ${m.same})`,
        );
      }
      const key = q(this.info(table).primaryKey[0]!);
      const range =
        chunk === undefined
          ? ''
          : `and a.${key} > ${chunk * 10000} and a.${key} <= ${(chunk + 1) * 10000}`;
      return this.query(
        `select a.* from ${from} a left join ${other} b on ${m.join}
         where (${m.missing} or not (${m.same})) ${range}`,
      );
    };
    const key = this.info(table).primaryKey;
    if (key.length === 1) {
      const [counts] = await this.query<{ live: string; snap: string }>(
        `select (select count(*) from ${live}) as live, (select count(*) from ${snap}) as snap`,
      );
      if (Math.max(Number(counts?.live), Number(counts?.snap)) > 10000) {
        const chunks = await this.changedChunks(table, key[0]!);
        const added: Row[] = [];
        const removed: Row[] = [];
        for (const chunk of chunks) {
          added.push(...(await select(live, snap, chunk)));
          removed.push(...(await select(snap, live, chunk)));
        }
        return { added, removed };
      }
    }
    return { added: await select(live, snap), removed: await select(snap, live) };
  }

  /** Locate changed primary-key ranges with the same CRC32 row fingerprints used by snapshots. */
  private async changedChunks(table: string, key: string): Promise<number[]> {
    const columns = this.info(table).columns;
    const values = columns.map((c) => `ifnull(${q(c)}, char(0))`).join(', ');
    const fingerprint = (name: string) => `select floor((${q(key)} - 1) / 10000) as chunk,
      count(*) as n, coalesce(sum(crc32(concat_ws(char(31), ${values}))), 0) as h
      from ${q(name)} group by chunk`;
    const live = await this.query<{ chunk: number; n: string; h: string }>(fingerprint(table));
    const snap = await this.query<{ chunk: number; n: string; h: string }>(
      fingerprint(SNAP_PREFIX + table),
    );
    const signatures = new Map<number, string>();
    const chunks = new Set<number>();
    for (const row of live) {
      signatures.set(Number(row.chunk), `${row.n}:${row.h}`);
      chunks.add(Number(row.chunk));
    }
    for (const row of snap) chunks.add(Number(row.chunk));
    const snapSignatures = new Map(
      snap.map((row) => [Number(row.chunk), `${row.n}:${row.h}`] as const),
    );
    return [...chunks]
      .filter((chunk) => signatures.get(chunk) !== snapSignatures.get(chunk))
      .sort((a, b) => a - b);
  }

  async restore(table: string, autoIncrement?: number | null): Promise<void> {
    const live = q(table);
    const snap = q(SNAP_PREFIX + table);
    const m = this.matchSql(table, 't', 's');
    const key = this.info(table).primaryKey;
    let large = false;
    if (key.length === 1) {
      const [counts] = await this.query<{ live: string; snap: string }>(
        `select (select count(*) from ${live}) as live, (select count(*) from ${snap}) as snap`,
      );
      large = Math.max(Number(counts?.live), Number(counts?.snap)) > 10000;
    }
    if (large) {
      const id = q(key[0]!);
      const chunks = await this.changedChunks(table, key[0]!);
      const ranges = chunks.map(
        (chunk) => `${id} > ${chunk * 10000} and ${id} <= ${(chunk + 1) * 10000}`,
      );
      // Delete every changed block before inserting any: a newly created row can hold a unique
      // business key that belongs to an older snapshot id in another primary-key block.
      for (const range of ranges) await this.conn.query(`delete from ${live} where ${range}`);
      for (const range of ranges) {
        await this.conn.query(`replace into ${live} select * from ${snap} where ${range}`);
      }
    } else if (!m.join) {
      await this.conn.query(`delete from ${live}`);
      await this.conn.query(`insert into ${live} select * from ${snap}`);
    } else {
      await this.conn.query(
        `delete t from ${live} t left join ${snap} s on ${m.join} where ${m.missing} or not (${m.same})`,
      );
      const back = this.matchSql(table, 's', 't');
      await this.conn.query(
        `insert into ${live} select s.* from ${snap} s left join ${live} t on ${back.join} where ${back.missing}`,
      );
    }
    if (autoIncrement !== undefined && autoIncrement !== null) {
      await this.conn.query(`alter table ${live} auto_increment = ${autoIncrement}`);
    }
  }

  async snapshotAutoIncrements(): Promise<Map<string, number | null>> {
    const rows = await this.query<{ name: string; ai: string | null }>(
      `select table_name as name, auto_inc as ai from ${q(META)} where table_name <> ?`,
      [CREATED],
    );
    return new Map(rows.map((r) => [r.name, r.ai === null ? null : Number(r.ai)]));
  }

  /**
   * Brings tables changed since the snapshot (or with drifted counters) back to it. Relies on
   * update_time, which InnoDB forgets on restart: changes made outside difftest before a
   * database restart are not detected.
   */
  async resetToSnapshot(): Promise<string[]> {
    const [created] = await this.query<{ ai: string }>(
      `select auto_inc as ai from ${q(META)} where table_name = ?`,
      [CREATED],
    );
    const changed = await this.changedSince(Number(created?.ai ?? 0));
    const saved = await this.snapshotAutoIncrements();
    for (const table of changed) await this.restore(table, saved.get(table));
    const current = await this.autoIncrements();
    for (const [table, ai] of saved) {
      if (ai !== null && current.get(table) !== ai && !changed.includes(table)) {
        await this.conn.query(`alter table ${q(table)} auto_increment = ${ai}`);
      }
    }
    return changed;
  }
}
