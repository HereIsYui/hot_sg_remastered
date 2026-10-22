import {
  type DatabaseConnection,
  type Driver,
  Kysely,
  MysqlAdapter,
  MysqlIntrospector,
  MysqlQueryCompiler,
  type QueryResult,
} from 'kysely';
import type { DB } from '../db/schema.generated';
import { DbScope } from '../db/database.module';

export interface ExecutedQuery {
  sql: string;
  parameters: readonly unknown[];
}

/** A response rule: when the compiled SQL matches `match`, return `rows` (and `insertId`). */
export interface Respond {
  match: RegExp;
  rows?: Record<string, unknown>[];
  insertId?: number;
}

/**
 * A fake DbScope backed by a real Kysely MySQL compiler and a scripted driver, so ported rules
 * can be unit-tested without a database: queries compile to SQL strings matched against `rules`,
 * the first match wins, and every query is recorded on `executed` for assertions.
 */
export class FakeDb {
  readonly executed: ExecutedQuery[] = [];
  readonly scope: DbScope;

  constructor(private rules: Respond[] = []) {
    const executed = this.executed;
    const matchRules = (sql: string) => this.rules.find((r) => r.match.test(sql));
    const connection: DatabaseConnection = {
      async executeQuery<R>(compiled: {
        sql: string;
        parameters: readonly unknown[];
      }): Promise<QueryResult<R>> {
        executed.push({ sql: compiled.sql, parameters: compiled.parameters });
        const rule = matchRules(compiled.sql);
        const rows = (rule?.rows ?? []) as R[];
        return {
          rows,
          numAffectedRows: BigInt(rows.length),
          insertId: rule?.insertId === undefined ? undefined : BigInt(rule.insertId),
        };
      },
      async *streamQuery() {
        // not used by the ported rules
      },
    };
    const driver: Driver = {
      async init() {},
      async acquireConnection() {
        return connection;
      },
      async beginTransaction() {},
      async commitTransaction() {},
      async rollbackTransaction() {},
      async releaseConnection() {},
      async destroy() {},
    };
    const db = new Kysely<DB>({
      dialect: {
        createAdapter: () => new MysqlAdapter(),
        createDriver: () => driver,
        createIntrospector: (k) => new MysqlIntrospector(k),
        createQueryCompiler: () => new MysqlQueryCompiler(),
      },
    });
    this.scope = new DbScope(db);
  }

  setRules(rules: Respond[]): void {
    this.rules = rules;
  }
}
