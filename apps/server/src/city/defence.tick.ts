import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { phpEmpty, phpNum } from '../core/php';
import { DbScope } from '../db/database.module';
import { TickHandler, TickOrder } from '../tick/tick.decorator';
import { DefenceRules } from './defence-rules.service';

type Row = Record<string, unknown>;

/**
 * ReportCron.php::UpdateUsersDeinforce: adds the finished defences to the city and starts the
 * 城墙's next entry.
 */
@Injectable()
export class DefenceTick {
  constructor(
    private readonly scope: DbScope,
    private readonly defences: DefenceRules,
  ) {}

  @TickHandler(TickOrder.Defence)
  async updateUsersDeinforce(): Promise<void> {
    // The original's `state_endtime <= state_endtime <= unix_timestamp()` is always true and
    // finished every entry on the next tick.
    const done = (
      await sql<Row>`select * from mem_city_reinforce
        where state_endtime <= unix_timestamp()`.execute(this.scope.db)
    ).rows;
    for (const row of done) await this.scope.transaction(() => this.finish(row));
  }

  private async finish(row: Row): Promise<void> {
    const db = this.scope.db;
    const { id, cid } = row;
    await this.defences.addCityDefence(cid, row.did, phpNum(row.count));
    await sql`delete from sys_city_reinforcequeue where id = ${id}`.execute(db);
    await sql`delete from mem_city_reinforce where id = ${id}`.execute(db);
    await sql`delete from sys_city_defence where count = 0`.execute(db);
    const next = (
      await sql<Row>`select id from sys_city_reinforcequeue
        where cid = ${cid} order by queuetime, id limit 1`.execute(db)
    ).rows[0];
    if (next && !phpEmpty(next.id)) {
      await sql`update sys_city_reinforcequeue set state = 1, state_starttime = unix_timestamp()
        where id = ${next.id}`.execute(db);
      await sql`insert into mem_city_reinforce (select id, cid, did, count,
          state_starttime + needtime from sys_city_reinforcequeue where id = ${next.id})`.execute(
        db,
      );
    }
  }
}
