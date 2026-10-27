import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { MailService } from '../core/mail.service';
import { addslashes, phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { UnionCommands } from './union.commands';
import { UnionRules } from './union-rules.service';

type Row = Record<string, unknown>;

/** UnionFunc.php: diplomacy by name, friendly replies and relation removal. */
@Injectable()
export class DiplomacyCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly rules: UnionRules,
    private readonly lang: LangService,
    private readonly mail: MailService,
    private readonly base: UnionCommands,
  ) {}

  /** `[type, unionName]`: resolves a union then follows the normal diplomacy write. */
  @GlobalCommand()
  async addUnionRelationByName(ctx: CommandContext, param: unknown[]): Promise<never> {
    const type = phpIntval(param[0]);
    const name = phpString(param[1]);
    if (name.length === 0) throw GameError.lang('addUnionRelation.enter_target_name');
    if (name.length > 8) throw GameError.lang('addUnionRelation.union_name_tooLong');
    const union = await this.row(
      sql<Row>`select * from sys_union where name = ${addslashes(name)} limit 1`,
    );
    if (!union) throw GameError.lang('addUnionRelation.target_union_not_exist');
    return this.base.addUnionRelation(ctx, [type, phpIntval(union.id)]);
  }

  /** `[accept, targetUnionid]`: accepts or rejects a friendly attempt. */
  @GlobalCommand()
  async pendingFriendly(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const accept = phpIntval(param[0]);
    const target = phpIntval(param[1]);
    const { unionid, union, targetunion } = await this.context(ctx.uid, target, 'addUnionRelation');
    const attempt = await this.row(sql<Row>`select *, unix_timestamp() as nowtime
      from mem_union_relation where type = 0 and unionid = ${target} and target = ${unionid}`);
    if (!attempt) throw GameError.lang('addUnionRelation.target_union_dont_request');
    if (accept === 1) {
      await sql`insert into sys_union_relation (type, unionid, target, time)
        values (0, ${unionid}, ${target}, unix_timestamp())
        on duplicate key update type = 0, time = unix_timestamp()`.execute(this.scope.db);
      await sql`insert into sys_union_relation (type, unionid, target, time)
        values (0, ${target}, ${unionid}, unix_timestamp())
        on duplicate key update type = 0, time = unix_timestamp()`.execute(this.scope.db);
    }
    await sql`delete from mem_union_relation where type = 0 and unionid = ${target} and target = ${unionid}`.execute(
      this.scope.db,
    );
    await this.notifyOfficers(
      target,
      accept === 1 ? 'friendly_mail_content' : 'friendly_reject_mail_content_BtoA',
      accept === 1 ? 'friendly_accept_alarm_info_BtoA' : 'friendly_reject_alarm_info_BtoA',
      phpString(union?.name),
    );
    await this.notifyOfficers(
      unionid,
      accept === 1 ? 'friendly_mail_content' : 'friendly_reject_mail_content_AtoB',
      accept === 1 ? 'friendly_accept_alarm_info_AtoB' : 'friendly_reject_alarm_info_AtoB',
      phpString(targetunion?.name),
    );
    if (accept === 1) {
      await this.rules.addUnionEvent(
        unionid,
        5,
        this.lang.t('addUnionRelation.friendly_union_message_A_to_B', phpString(targetunion?.name)),
      );
      await this.rules.addUnionEvent(
        target,
        5,
        this.lang.t('addUnionRelation.friendly_union_message_B_to_A', phpString(union?.name)),
      );
    } else {
      await this.rules.addUnionEvent(
        unionid,
        5,
        this.lang.t(
          'addUnionRelation.friendly_reject_union_message_A_to_B',
          phpString(targetunion?.name),
        ),
      );
      await this.rules.addUnionEvent(
        target,
        5,
        this.lang.t(
          'addUnionRelation.friendly_reject_union_message_B_to_A',
          phpString(union?.name),
        ),
      );
    }
    return this.base.getRequestList(ctx);
  }

  /** `[type, targetUnionid]`: removes friendly or hostile relations. */
  @GlobalCommand()
  async removeUnionRelation(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const type = phpIntval(param[0]);
    if (type < 0 || type > 2) throw GameError.lang('removeUnionRelation.no_this_diplomacy');
    const target = phpIntval(param[1]);
    const { unionid, union, targetunion } = await this.context(
      ctx.uid,
      target,
      'removeUnionRelation',
    );
    const old = await this
      .row(sql<Row>`select *, unix_timestamp() as nowtime from sys_union_relation
      where unionid = ${unionid} and target = ${target}`);
    if (!phpEmpty(old) && phpNum(old!.time) > phpNum(old!.nowtime) - 900) {
      throw GameError.lang(
        'removeUnionRelation.too_frequency',
        makeTimeLeft(900 + phpNum(old!.time) - phpNum(old!.nowtime)),
      );
    }
    if (!phpEmpty(old) && phpIntval(old!.type) !== type) {
      const relation = this.lang.t(
        `removeUnionRelation.${type === 0 ? 'friendly' : type === 1 ? 'neutral' : 'hostile'}`,
      );
      throw GameError.lang('removeUnionRelation.have_done', relation);
    }
    if (type === 0) {
      await sql`update sys_union_relation set type = 1, time = unix_timestamp()
        where unionid = ${unionid} and target = ${target} and type = 0`.execute(this.scope.db);
      await sql`update sys_union_relation set type = 1, time = unix_timestamp()
        where unionid = ${target} and target = ${unionid} and type = 0`.execute(this.scope.db);
      await this.notifyMembers(
        target,
        'cancel_friendly_mail_content_BtoA',
        'cancel_friendly_alarm_info_BtoA',
        phpString(union?.name),
      );
      await this.notifyMembers(
        unionid,
        'cancel_friendly_mail_content_AtoB',
        'cancel_friendly_alarm_info_AtoB',
        phpString(targetunion?.name),
      );
      await this.rules.addUnionEvent(
        target,
        5,
        this.lang.t(
          'removeUnionRelation.cancel_friendly_union_message_B_to_A',
          phpString(union?.name),
        ),
      );
      await this.rules.addUnionEvent(
        unionid,
        5,
        this.lang.t(
          'removeUnionRelation.cancel_friendly_union_message_A_to_B',
          phpString(targetunion?.name),
        ),
      );
    } else if (type === 2) {
      await sql`update sys_union_relation set type = 1, time = unix_timestamp()
        where unionid = ${unionid} and target = ${target} and type = 2`.execute(this.scope.db);
      const oneside = phpNum(
        await this.cell(sql<Row>`select count(*) as v from sys_union_relation
          where unionid = ${target} and target = ${unionid} and type = 2`),
      );
      await this.notifyMembers(
        target,
        oneside === 1
          ? 'cancel_hostile_mail_content_BtoA'
          : 'cancel_hostile_mail_content_BtoA_allclear',
        'cancel_hostile_alarm_info_BtoA',
        phpString(union?.name),
      );
      await this.notifyMembers(
        unionid,
        oneside === 1
          ? 'cancel_hostile_mail_content_AtoB'
          : 'cancel_hostile_mail_content_AtoB_allclear',
        'cancel_hostile_alarm_info_AtoB',
        phpString(targetunion?.name),
      );
      await this.rules.addUnionEvent(
        target,
        5,
        this.lang.t(
          'removeUnionRelation.cancel_hostile_union_message_B_to_A',
          phpString(union?.name),
        ),
      );
      await this.rules.addUnionEvent(
        unionid,
        5,
        this.lang.t(
          'removeUnionRelation.cancel_hostile_union_message_A_to_B',
          phpString(targetunion?.name),
        ),
      );
    }
    return this.base.getUnionRelation(ctx, [type]);
  }

  private async context(uid: number, target: number, group: string) {
    const my = await this.row(
      sql<Row>`select name, union_id, union_pos from sys_user where uid = ${uid}`,
    );
    const unionid = phpIntval(my?.union_id);
    const unionpos = phpIntval(my?.union_pos);
    const union = await this.row(
      sql<Row>`select name, leader from sys_union where id = ${unionid}`,
    );
    if (unionid <= 0 || unionpos === 0 || unionpos < 3) {
      throw GameError.lang(`${group}.you_are_not_chief`);
    }
    if (unionid === target) throw GameError.lang(`${group}.cant_contact_with_oneself`);
    const targetunion = await this.row(
      sql<Row>`select * from sys_union where id = ${target} limit 1`,
    );
    if (!targetunion) throw GameError.lang(`${group}.target_union_not_exist`);
    return { unionid, union, targetunion };
  }

  private async notifyOfficers(
    unionid: number,
    contentKey: string,
    alarmKey: string,
    name: string,
  ): Promise<void> {
    const receivers = await this.rows(sql<Row>`select uid from sys_user
      where union_id = ${unionid} and union_pos >= 1 and union_pos <= 3`);
    for (const receiver of receivers) {
      const uid = phpIntval(receiver.uid);
      await this.mail.send(
        uid,
        this.lang.t('addUnionRelation.friendly_mail_title'),
        this.lang.t(`addUnionRelation.${contentKey}`, name),
      );
      await this.infoAlarm(uid, this.lang.t(`addUnionRelation.${alarmKey}`, name));
    }
  }

  private async notifyMembers(
    unionid: number,
    contentKey: string,
    alarmKey: string,
    name: string,
  ): Promise<void> {
    const receivers = await this.rows(
      sql<Row>`select uid from sys_user where union_id = ${unionid}`,
    );
    for (const receiver of receivers) {
      const uid = phpIntval(receiver.uid);
      const title = contentKey.includes('hostile')
        ? 'cancel_hostile_mail_title'
        : 'cancel_friendly_mail_title';
      await this.mail.send(
        uid,
        this.lang.t(`removeUnionRelation.${title}`),
        this.lang.t(`removeUnionRelation.${contentKey}`, name, name),
      );
      await this.infoAlarm(uid, this.lang.t(`removeUnionRelation.${alarmKey}`, name));
    }
  }

  private async infoAlarm(uid: number, info: string): Promise<void> {
    await sql`insert into sys_info_alarm (uid, type, info, time)
      values (${uid}, 0, ${info}, unix_timestamp())`.execute(this.scope.db);
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
}

function makeTimeLeft(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}小时${m}分${s}秒` : `${m}分${s}秒`;
}
