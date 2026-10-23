import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { phpIntval } from '../core/php';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

/** ReportFunc.php `REPORT_PAGE_CPP`: rows per report page. */
const REPORT_PAGE_CPP = 10;

/** The report columns the list panel reads (ReportFunc.php's explicit column list). */
const LIST_COLUMNS = sql`id, origincid, origincity, happencid, happencity, title, type, time,
  \`read\`, battleid, from_battlenet`;

type Row = Record<string, unknown>;

/**
 * ReportFunc.php: the 战报 dialog's readers. `sys_report` rows are WRITTEN by the battle engine
 * (parallel wave) and by other modules through `ReportService.sendReport`; this is the read side
 * only — it never writes a report row, matching the original ReportFunc, which only lists, soft
 * deletes (`state=1`) and reads detail.
 *
 * `getReportDetail` returns the `sys_battle_report` rounds the engine agent writes exactly as PHP
 * does (`select * ... order by round`); this module only READS `sys_battle*` tables, never writes.
 */
@Injectable()
export class ReportCommands {
  constructor(private readonly scope: DbScope) {}

  private async rows(query: ReturnType<typeof sql<Row>>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows;
  }

  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = (await this.rows(query))[0];
    return row === undefined ? false : Object.values(row)[0];
  }

  /**
   * ReportFunc.php::getUnreadReport: clears the bottom-bar 战报 blink (`sys_alarm.report=0`) and
   * lists this player's unread, non-deleted reports (all types), newest first, one page at a time.
   * Returns `[pageCount, page, rows]`.
   */
  @GlobalCommand()
  async getUnreadReport(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const p = [...param];
    p.shift(); // type (unused for the unread list)
    let page = phpIntval(p.shift());
    await sql`update sys_alarm set report = 0 where uid = ${uid}`.execute(this.scope.db);

    const reportCount = phpIntval(
      await this.cell(
        sql<Row>`select count(*) from sys_report where uid = ${uid} and \`read\` = 0 and state = 0`,
      ),
    );
    const pageCount = Math.ceil(reportCount / REPORT_PAGE_CPP);
    if (page >= pageCount) page = pageCount - 1;
    if (page < 0) page = 0;

    const ret: unknown[] = [pageCount, page];
    if (reportCount > 0) {
      const start = page * REPORT_PAGE_CPP;
      ret.push(
        await this.rows(sql<Row>`select ${LIST_COLUMNS} from sys_report
          where uid = ${uid} and \`read\` = 0 and state = 0
          order by \`id\` desc limit ${start}, ${REPORT_PAGE_CPP}`),
      );
    } else {
      ret.push([]);
    }
    return ret;
  }

  /**
   * ReportFunc.php::getReport: one report tab (`type`), newest first. A negative type delegates to
   * getUnreadReport, exactly as the original (`if ($param[0] < 0) return getUnreadReport(...)`).
   */
  @GlobalCommand()
  async getReport(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    if (phpIntval(param[0]) < 0) return this.getUnreadReport(ctx, param);
    const { uid } = ctx;
    const p = [...param];
    const type = phpIntval(p.shift());
    let page = phpIntval(p.shift());

    const reportCount = phpIntval(
      await this.cell(sql<Row>`select count(*) from sys_report
        where uid = ${uid} and type = ${type} and state = 0`),
    );
    const pageCount = Math.ceil(reportCount / REPORT_PAGE_CPP);
    if (page >= pageCount) page = pageCount - 1;
    if (page < 0) page = 0;

    const ret: unknown[] = [pageCount, page];
    if (reportCount > 0) {
      const start = page * REPORT_PAGE_CPP;
      ret.push(
        await this.rows(sql<Row>`select ${LIST_COLUMNS} from sys_report
          where uid = ${uid} and type = ${type} and state = 0
          order by \`id\` desc limit ${start}, ${REPORT_PAGE_CPP}`),
      );
    } else {
      ret.push([]);
    }
    return ret;
  }

  /**
   * ReportFunc.php::delReport: soft-delete the chosen reports (`state=1`, the original kept the
   * hard delete commented out), then re-read the current tab. `param` is `[ids, type, page]`, and
   * after shifting `ids` the remaining `[type, page]` is exactly what getReport expects.
   */
  @GlobalCommand()
  async delReport(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const p = [...param];
    const idsRaw = p.shift();
    const ids = Array.isArray(idsRaw) ? idsRaw.map((v) => phpIntval(v)) : [];
    if (ids.length > 0) {
      await sql`update sys_report set state = 1
        where id in (${sql.join(ids)}) and uid = ${ctx.uid}`.execute(this.scope.db);
    }
    return this.getReport(ctx, p);
  }

  /**
   * ReportFunc.php::getReportDetail: the battle rounds of a report (`sys_battle_report`), ordered
   * by round. Returns `[rows]`, or `[]` when `battleid <= 0` (a plain text report has no rounds).
   * Read-only against a table the engine wave owns.
   */
  @GlobalCommand()
  async getReportDetail(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const battleid = phpIntval(param[0]);
    if (battleid <= 0) return [];
    return [
      await this.rows(
        sql<Row>`select * from sys_battle_report where battleid = ${battleid} order by round`,
      ),
    ];
  }

  /**
   * ReportFunc.php::readReportAll: mark every report read. The original takes no `$param` and the
   * client never calls it (接口清单: "待确认：客户端未引用"); ported for completeness since it is
   * trivial. Returns `[1]`.
   */
  @GlobalCommand()
  async readReportAll(ctx: CommandContext): Promise<unknown[]> {
    await sql`update sys_report set \`read\` = 1 where uid = ${ctx.uid}`.execute(this.scope.db);
    return [1];
  }
}
