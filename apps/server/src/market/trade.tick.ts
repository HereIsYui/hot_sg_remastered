import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { LangService } from '../common/lang.service';
import { phpIntval, phpNum, phpString } from '../core/php';
import { ReportService } from '../core/report.service';
import { TaskRules } from '../core/task-rules.service';
import { DbScope } from '../db/database.module';
import { TickHandler, TickOrder } from '../tick/tick.decorator';

type Row = Record<string, unknown>;

const RESOURCE_COLUMNS = ['food', 'wood', 'rock', 'iron', 'gold'] as const;
const TRADE_REPORT_TITLE = 15;

/** ReportCron.php::HandleTrade: delivers due caravans and files both sides' reports. */
@Injectable()
export class TradeTick {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly tasks: TaskRules,
    private readonly reports: ReportService,
  ) {}

  @TickHandler(TickOrder.Trade)
  async handleTrade(): Promise<void> {
    const rows = (
      await sql<Row>`select * from sys_city_trade
        where endtime > 1 and endtime <= unix_timestamp()`.execute(this.scope.db)
    ).rows;
    for (const row of rows) await this.scope.transaction(() => this.finish(row));
  }

  private async finish(row: Row): Promise<void> {
    const db = this.scope.db;
    const id = phpIntval(row.id);
    const cid = phpIntval(row.cid);
    const buycid = phpIntval(row.buycid);
    const count = phpNum(row.count);
    const gold = phpNum(row.gold);
    const restype = phpIntval(row.restype);
    await sql`update mem_city_resource set gold = gold + ${gold} where cid = ${cid}`.execute(db);
    const column = RESOURCE_COLUMNS[restype];
    if (column) {
      await sql`update mem_city_resource set ${sql.id(column)} = ${sql.id(column)} + ${count}
        where cid = ${buycid}`.execute(db);
    }

    await sql`delete from mem_city_trade where id = ${id}`.execute(db);
    await sql`delete from sys_city_trade where id = ${id}`.execute(db);
    const uid = phpIntval(await this.cityValue(cid, 'uid'));
    const youruid = phpIntval(await this.cityValue(buycid, 'uid'));
    await this.tasks.completeTask(uid, 25);
    await this.tasks.completeTask(youruid, 26);

    const mycityname = await this.cityNamePosition(cid);
    const buycityname = await this.cityNamePosition(buycid);
    const resources = this.lang.value<{ resources?: unknown[] }>('report')?.resources ?? [];
    const resourceIndex = restype === 4 ? 0 : restype + 1;
    const resourcename = phpString(resources[resourceIndex] ?? '');
    let content = `与${buycityname}的买卖已达成，商队已经返回${mycityname}。`;
    content += `</br>出售：${resourcename} ${count}`;
    content += `</br>获得：黄金 ${gold}`;
    await this.reports.sendReport(uid, TRADE_REPORT_TITLE, cid, buycid, content);
    content = `与${mycityname}的买卖已达成，商队已经返回${buycityname}。`;
    content += `</br>购买：${resourcename} ${count}`;
    content += `</br>支付：黄金 ${gold}`;
    await this.reports.sendReport(youruid, TRADE_REPORT_TITLE, cid, buycid, content);
  }

  private async cityValue(cid: number, column: 'uid' | 'name'): Promise<unknown> {
    return (
      await sql<Row>`select ${sql.id(column)} as value from sys_city where cid = ${cid}`.execute(
        this.scope.db,
      )
    ).rows[0]?.value;
  }

  private async cityNamePosition(cid: number): Promise<string> {
    const name = phpString(await this.cityValue(cid, 'name'));
    return `${name}(${cid % 1000},${Math.floor(cid / 1000)})`;
  }
}
