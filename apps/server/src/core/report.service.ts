import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DbScope } from '../db/database.module';
import { unixNow } from '../db/sql-fragments';
import { cid2wid } from './city-rules.service';
import { MailService } from './mail.service';
import { phpEmpty, phpString } from './php';

/** sys_report.title values (the client's report title table). */
export const ReportTitle = {
  /** 天灾人祸、将领忠诚 */
  Curse: 16,
} as const;

/** Battle and event reports from utils.php. */
@Injectable()
export class ReportService {
  constructor(
    private readonly scope: DbScope,
    private readonly mail: MailService,
  ) {}

  /**
   * utils.php::sendReport: resolves both city names (a wild field's terrain name when no city
   * stands there) and files the report. The original's `$type` argument was never used.
   */
  async sendReport(
    touid: number,
    title: number,
    origincid: number,
    happencid: number,
    content: string,
  ): Promise<void> {
    const origincity = origincid > 0 ? await this.placeName(origincid) : '';
    let happencity = '';
    if (origincid === happencid) happencity = origincity;
    else if (happencid > 0) happencity = await this.placeName(happencid);
    await this.sendReportDetail(
      touid,
      title,
      origincid,
      origincity,
      happencid,
      happencity,
      content,
    );
  }

  /** utils.php::sendReportDetail: the report tab (`type`) follows from the title. */
  async sendReportDetail(
    touid: number,
    title: number,
    origincid: number,
    origincity: string,
    happencid: number,
    happencity: string,
    content: string,
  ): Promise<void> {
    let stype = 3;
    if (title <= 11) stype = 0;
    else if (title >= 12 && title <= 14) stype = 1;
    else if (title === 19) stype = 2;
    await sql`insert into sys_report (uid, origincid, origincity, happencid, happencity, title,
        type, time, \`read\`, battleid, content)
      values (${touid}, ${origincid}, ${origincity}, ${happencid}, ${happencity}, ${title},
        ${stype}, ${unixNow()}, 0, 0, ${content})`.execute(this.scope.db);
    await this.mail.raiseAlarm(touid, 'report');
  }

  private async placeName(cid: number): Promise<string> {
    const db = this.scope.db;
    const city = (
      await sql<{ name: unknown }>`select name from sys_city where cid = ${cid}`.execute(db)
    ).rows[0]?.name;
    if (!phpEmpty(city)) return phpString(city);
    const field = (
      await sql<{ name: unknown }>`select c.name from mem_world m
        left join cfg_world_type c on c.type = m.type
        where m.wid = ${cid2wid(cid)}`.execute(db)
    ).rows[0]?.name;
    return field === undefined || field === null ? '' : phpString(field);
  }
}
