import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PushProc } from '@hot/shared';
import { sql } from 'kysely';
import { phpIntval, phpString } from '../core/php';
import { DbScope } from '../db/database.module';
import { PushService } from './push.service';

type Row = Record<string, unknown>;

/** Consumes mem_union_event into proc-17 union chat / global chat notifications. */
@Injectable()
export class UnionEventService {
  private readonly logger = new Logger(UnionEventService.name);
  private running = false;

  constructor(
    private readonly scope: DbScope,
    private readonly push: PushService,
  ) {}

  @Interval(1000)
  async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const rows = (
        await sql<Row>`select * from mem_union_event order by evttime`.execute(this.scope.db)
      ).rows;
      for (const row of rows) await this.deliver(row);
    } finally {
      this.running = false;
    }
  }

  private async deliver(row: Row): Promise<void> {
    const unionid = phpIntval(row.unionid);
    try {
      const members = await sql<{
        uid: unknown;
      }>`select uid from sys_user where union_id = ${unionid}`.execute(this.scope.db);
      const ids = new Set(members.rows.map((row) => phpIntval(row.uid)));
      const sent = this.push.broadcast(
        PushProc.NOTIFY_UNION_EVENT,
        { msg: phpString(row.content) },
        (uid) => ids.has(uid),
      );
      if (sent === 0) return;
      await sql`delete from mem_union_event where unionid = ${unionid}
        and type = ${phpIntval(row.type)} and content = ${phpString(row.content)}
        and evttime = ${phpIntval(row.evttime)}`.execute(this.scope.db);
    } catch (error) {
      this.logger.warn(`union ${unionid}: event delivery failed: ${String(error)}`);
    }
  }
}
