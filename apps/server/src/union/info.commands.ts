import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { addslashes } from '../core/php';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { phpIntval, phpNum, phpString } from '../core/php';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { UnionRules } from './union-rules.service';

type Row = Record<string, unknown>;

/** UnionFunc.php: union profile, external detail and military reports. */
@Injectable()
export class InfoCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly rules: UnionRules,
    private readonly lang: LangService,
  ) {}

  /** `[]`: profile editable by 长老 and above. */
  @GlobalCommand()
  async getUnionIntro(ctx: CommandContext): Promise<unknown[]> {
    const user = await this.row(
      sql<Row>`select union_id, union_pos from sys_user where uid = ${ctx.uid}`,
    );
    if (phpIntval(user?.union_id) <= 0 || phpIntval(user?.union_pos) < 4) {
      throw GameError.lang('getUnionIntro.you_are_not_chief');
    }
    return this.rows(sql<Row>`select * from sys_union where id = ${phpIntval(user?.union_id)}`);
  }

  /** `[name, intro, announcement, flag]`: updates the profile. */
  @GlobalCommand()
  async modifyIntro(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const name = phpString(param[0]).trim();
    const intro = phpString(param[1]);
    const announce = phpString(param[2]);
    const flag = phpIntval(param[3]);
    if (name.length === 0) throw GameError.lang('modifyIntro.union_name_notNull');
    if (name.length > 8) throw GameError.lang('modifyIntro.union_name_tooLong');
    if (name.includes("'") || name.includes('\\') || name.includes(String.fromCharCode(13))) {
      throw GameError.lang('modifyIntro.invalid_char');
    }
    if (
      await this.check(sql<Row>`select 1 as v from cfg_baned_name where instr(${name}, name) > 0`)
    ) {
      throw GameError.lang('modifyIntro.invalid_char');
    }
    if (intro.length > 200) throw GameError.lang('modifyIntro.union_description_tooLong');
    if (announce.length > 500) throw GameError.lang('modifyIntro.union_announce_tooLong');
    for (const content of [announce, intro]) {
      if (
        await this.check(
          sql<Row>`select 1 as v from cfg_baned_mail_content where instr(${content}, content) > 0`,
        )
      ) {
        throw GameError.lang('banned.word_illegal');
      }
    }
    const user = await this.row(
      sql<Row>`select name, union_id, union_pos from sys_user where uid = ${ctx.uid}`,
    );
    const unionid = phpIntval(user?.union_id);
    const unionpos = phpIntval(user?.union_pos);
    const union = await this.row(sql<Row>`select * from sys_union where id = ${unionid}`);
    if (unionid <= 0 || unionpos < 4) throw GameError.lang('modifyIntro.you_are_not_chief');
    if (unionpos < 5 && flag === 1) throw GameError.lang('modifyIntro.you_are_not_chief');
    if (phpString(union?.name) !== name) {
      if (await this.check(sql<Row>`select id as v from sys_union where name = ${name}`)) {
        throw GameError.lang('modifyIntro.union_name_in_use');
      }
    }
    await sql`update sys_union set name = ${addslashes(name)}, intro = ${addslashes(intro)},
      announcement = ${addslashes(announce)} where id = ${unionid}`.execute(this.scope.db);
    if (phpString(union?.name) !== name) {
      await this.rules.addUnionEvent(
        unionid,
        4,
        this.lang.t('modifyIntro.addUnionEvent', phpString(user?.name), name),
      );
    }
    return [];
  }

  /** `[unionid]`: another union's public detail. */
  @GlobalCommand()
  async loadUnionDetail(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const unionid = phpIntval(param[0]);
    if (!(await this.check(sql<Row>`select id as v from sys_union where id = ${unionid}`))) {
      return [0, this.lang.t('loadUnionDetail.union_dissmissed')];
    }
    const union = await this.row(sql<Row>`select n.id, n.chieforder, r.leader, r.name, r.member,
      r.famouscity, r.rank, r.prestige, u.name as creator, n.intro
      from sys_user u, sys_union n left join rank_union r on r.uid = n.id
      where n.id = ${unionid} and u.uid = n.creator`);
    if (union && (union.famouscity === '' || union.famouscity == null)) union.famouscity = 0;
    return [1, union ?? {}, await this.rules.memberMaxCount(unionid)];
  }

  /** `[page]`: the caller's union military reports. */
  @GlobalCommand()
  async getUnionReport(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const unionid = phpIntval(
      await this.cell(sql<Row>`select union_id as v from sys_user where uid = ${ctx.uid}`),
    );
    if (!unionid) throw GameError.lang('getUnionReport.not_in_union');
    const count = phpNum(
      await this.cell(
        sql<Row>`select count(*) as v from sys_union_report where unionid = ${unionid}`,
      ),
    );
    let pageCount = Math.ceil(count / 10);
    let page = phpIntval(param[0]);
    if (page >= pageCount) page = pageCount - 1;
    if (page < 0) {
      page = 0;
      pageCount = 0;
    }
    const ret: unknown[] = [pageCount, page];
    if (count > 0) {
      ret.push(
        await this.rows(sql<Row>`select id, type, enemy, time, description from sys_union_report
          where unionid = ${unionid} order by id desc limit ${page * 10}, 10`),
      );
    } else {
      ret.push([]);
    }
    return ret;
  }

  /** `[id]`: one union military report. */
  @GlobalCommand()
  async getUnionReportDetail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const id = phpIntval(param[0]);
    const unionid = phpIntval(
      await this.cell(sql<Row>`select union_id as v from sys_user where uid = ${ctx.uid}`),
    );
    if (!unionid) throw GameError.lang('getUnionReportDetail.not_in_union');
    const report = await this
      .row(sql<Row>`select type, origincid, origincity, happencid, happencity,
      time, description from sys_union_report where id = ${id} and unionid = ${unionid}`);
    if (!report) throw GameError.lang('getUnionReportDetail.report_not_found');
    return [report];
  }

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows;
  }

  private async row(query: RawBuilder<Row>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : undefined;
  }

  private async check(query: RawBuilder<Row>): Promise<boolean> {
    return (await this.rows(query)).length > 0;
  }
}
