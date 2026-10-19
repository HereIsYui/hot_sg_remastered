import { Injectable } from '@nestjs/common';
import { DbScope } from '../db/database.module';
import { cellOf } from '../db/sql-fragments';

/** Rows of `mem_state` the code reads by number. */
export const GameState = {
  /** 1 open, 0 maintenance (message in sys_announce id 2), 2 closed (id 3). */
  ServerOpen: 2,
  /** Client version the server accepts. */
  ClientVersion: 3,
  MaxOnline: 4,
  OpenTime: 6,
  AdultContent: 18,
  AntiAddiction: 99,
  MaxUsers: 100,
  MinorityRegionOpen: 111,
  Operator: 197,
} as const;

@Injectable()
export class GameStateService {
  constructor(private readonly scope: DbScope) {}

  /** `sql_fetch_one_cell("select value from mem_state where state=N")`. */
  async value(state: number): Promise<number | false> {
    const row = await this.scope.db
      .selectFrom('mem_state')
      .select('value')
      .where('state', '=', state)
      .executeTakeFirst();
    return cellOf(row, 'value');
  }

  /** utils.php::isAdultOpen */
  async isAdultOpen(): Promise<boolean> {
    return (await this.value(GameState.AntiAddiction)) === 1;
  }
}
