import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { phpIntval, phpNum } from '../core/php';
import { DbScope } from '../db/database.module';
import { TickHandler, TickOrder } from '../tick/tick.decorator';

type Row = Record<string, unknown>;

/** ReportCron.php::HandleAutoTrans: loads a scheduled transport sixty seconds before arrival. */
@Injectable()
export class AutoTransTick {
  constructor(private readonly scope: DbScope) {}

  @TickHandler(TickOrder.AutoTrans)
  async handleAutoTrans(): Promise<void> {
    const rows = (
      await sql<Row>`select * from mem_city_autotrans
        where end_time - 60 <= unix_timestamp()`.execute(this.scope.db)
    ).rows;
    for (const row of rows) {
      const loaded = await this.scope.transaction(() => this.load(row));
      if (!loaded) return;
    }
  }

  private async load(row: Row): Promise<boolean> {
    const db = this.scope.db;
    const id = phpIntval(row.id);
    if (!phpNum(row.trans_type)) {
      await sql`delete from mem_city_autotrans where id = ${id}`.execute(db);
    } else {
      await sql`update mem_city_autotrans set start_time = start_time + 86400,
        end_time = end_time + 86400 where id = ${id}`.execute(db);
    }

    const fromcid = phpIntval(row.fromcid);
    const count = phpNum(row.count);
    // The original switches on ${$v['res_type']}, an undefined variable-variable. Every resource
    // therefore takes case 0: food is checked and deducted, while the record keeps its res_type.
    const stock = (
      await sql<{
        food: unknown;
      }>`select food from mem_city_resource where cid = ${fromcid}`.execute(db)
    ).rows[0]?.food;
    if (phpNum(stock) < count) return false;
    await sql`update mem_city_resource set food = greatest(0, food - ${count})
      where cid = ${fromcid}`.execute(db);

    await sql`insert into sys_city_trade (cid, state, restype, count, price, gold, distance,
      endtime, buycid, unionid, limittime) values (${fromcid}, 1, ${phpIntval(row.res_type)},
      ${count}, 0, 0, ${phpNum(row.distance)}, ${phpIntval(row.end_time)}, ${phpIntval(row.tocid)},
      0, 0)`.execute(db);
    return true;
  }
}
