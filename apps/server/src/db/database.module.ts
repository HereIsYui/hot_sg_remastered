import { AsyncLocalStorage } from 'node:async_hooks';
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Kysely, MysqlDialect, sql, type Transaction } from 'kysely';
import { createPool } from 'mysql2';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { DB } from './schema.generated';

export type Database = Kysely<DB>;

export const DATABASE = Symbol('DATABASE');

export function createDatabase(url: string, poolSize = 10): Database {
  return new Kysely<DB>({
    dialect: new MysqlDialect({
      pool: createPool({
        uri: url,
        connectionLimit: poolSize,
        // Same collation as the tables, so literal comparisons behave like the original server.
        charset: 'UTF8MB4_GENERAL_CI',
        timezone: '+08:00',
        dateStrings: true,
        decimalNumbers: true,
        supportBigNumbers: true,
      }),
    }),
  });
}

/**
 * Gives services the connection of the surrounding `transaction()` call, so rule helpers
 * shared between commands join the caller's transaction without threading it through.
 */
@Injectable()
export class DbScope {
  private readonly current = new AsyncLocalStorage<Transaction<DB>>();

  constructor(@Inject(DATABASE) private readonly root: Database) {}

  get db(): Database {
    return this.current.getStore() ?? this.root;
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.current.getStore()) return fn();
    return this.root.transaction().execute((trx) => this.current.run(trx, fn));
  }
}

@Injectable()
export class DatabaseHealth {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async ping(): Promise<boolean> {
    try {
      await sql`select 1`.execute(this.db);
      return true;
    } catch {
      return false;
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        createDatabase(config.DATABASE_URL, config.DATABASE_POOL_SIZE),
    },
    DbScope,
    DatabaseHealth,
  ],
  exports: [DATABASE, DbScope, DatabaseHealth],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
