import { sql } from 'kysely';
import type { Database } from './database.module';

/** The database clock, as the PHP code used `unix_timestamp()` inside its statements. */
export const unixNow = () => sql<number>`unix_timestamp()`;

/** `sql_fetch_one_cell` semantics: the first column of the first row, or `false` without rows. */
export function cellOf<R extends object, K extends keyof R>(
  row: R | undefined,
  key: K,
): R[K] | false {
  return row === undefined ? false : row[key];
}

/** `select unix_timestamp()`. */
export async function dbNow(db: Database): Promise<number> {
  const row = await sql<{ now: number }>`select unix_timestamp() as now`.execute(db);
  return Number(row.rows[0]!.now);
}
