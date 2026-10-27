import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { UnionRules } from './union-rules.service';

type Row = Record<string, unknown>;

const PAGE = 10;
const BUILDING_HONGLU = 12;

/** UnionFunc.php: applications, invitations, offices and member removal. */
@Injectable()
export class MemberCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly rules: UnionRules,
    private readonly users: UserRules,
    private readonly tasks: TaskRules,
    private readonly lang: LangService,
  ) {}

  /** `[page]`: pending applications for an officer. */
  @GlobalCommand()
  async getApplyList(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const user = await this.row(
      sql<Row>`select union_id, union_pos from sys_user where uid = ${ctx.uid}`,
    );
    const unionid = phpIntval(user?.union_id);
    if (unionid <= 0 || phpIntval(user?.union_pos) === 0) {
      throw GameError.lang('getApplyList.not_official');
    }
    const count = phpNum(
      await this.cell(
        sql<Row>`select count(*) as v from sys_union_apply where unionid = ${unionid}`,
      ),
    );
    let pageCount = Math.ceil(count / PAGE);
    let page = phpIntval(param[0]);
    if (page >= pageCount) page = pageCount - 1;
    if (page < 0) {
      page = 0;
      pageCount = 0;
    }
    const ret: unknown[] = [pageCount, page];
    if (count > 0) {
      ret.push(
        await this.rows(sql<Row>`select u.uid as userid, u.name, a.time, r.prestige, r.rank, r.city
          from sys_union_apply a
          left join sys_user u on a.uid = u.uid
          left join rank_user r on u.name = r.name
          where a.unionid = ${unionid} order by a.time limit ${page * PAGE}, ${PAGE}`),
      );
    } else {
      ret.push([]);
    }
    return ret;
  }

  /** `[page, applicantUid]`: accepts an application and joins the player. */
  @GlobalCommand()
  async acceptApply(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const auid = phpIntval(param[1]);
    const target = await this.row(
      sql<Row>`select name, union_id from sys_user where uid = ${auid}`,
    );
    if (phpIntval(target?.union_id) > 0) {
      throw GameError.lang('acceptApply.taget_joined_other_union');
    }
    const honglu = await this.cell(sql<Row>`select max(b.level) as v from sys_building b, sys_city c
      where b.bid = ${BUILDING_HONGLU} and b.cid = c.cid and c.uid = ${auid}`);
    if (phpEmpty(honglu)) throw GameError.lang('acceptApply.target_has_no_HongLu');
    const my = await this.row(
      sql<Row>`select name, union_id, union_pos from sys_user where uid = ${ctx.uid}`,
    );
    const unionid = phpIntval(my?.union_id);
    if (unionid <= 0 || phpIntval(my?.union_pos) < 2) {
      throw GameError.lang('acceptApply.not_official');
    }
    const union = await this.row(
      sql<Row>`select leader, member, chieforder from sys_union where id = ${unionid}`,
    );
    if (!union) throw GameError.lang('acceptApply.union_not_exist');
    if (
      !(await this.check(
        sql<Row>`select uid as v from sys_union_apply where uid = ${auid} and unionid = ${unionid}`,
      ))
    ) {
      throw GameError.lang('acceptApply.data_record_not_exist');
    }
    if (phpEmpty(union.chieforder)) {
      const leaderHonglu = await this
        .cell(sql<Row>`select max(b.level) as v from sys_building b, sys_city c
        where b.bid = ${BUILDING_HONGLU} and b.cid = c.cid and c.uid = ${union.leader}`);
      if (phpEmpty(leaderHonglu)) throw GameError.lang('acceptApply.no_HongLu_built');
    }
    const maxmember = await this.rules.memberMaxCount(unionid);
    if (phpNum(union.member) + 1 > maxmember) throw GameError.lang('acceptApply.union_is_full');

    await this.scope.transaction(async () => {
      await sql`update sys_user set union_id = ${unionid}, union_pos = 0 where uid = ${auid}`.execute(
        this.scope.db,
      );
      await sql`update sys_union set member = member + 1 where id = ${unionid}`.execute(
        this.scope.db,
      );
      const famouscity = phpNum(
        await this.cell(
          sql<Row>`select count(*) as v from sys_city where uid = ${auid} and type > 0 and type < 5`,
        ),
      );
      if (famouscity > 0) {
        await sql`update sys_union_city set count = greatest(0, count + ${famouscity}) where unionid = ${unionid}`.execute(
          this.scope.db,
        );
      }
      await this.tasks.completeTask(auid, 67);
      await this.rules.notifyUnionChange(auid, unionid, 1);
      await this.users.updateUnionRank(unionid);
      await sql`delete from sys_union_apply where uid = ${auid}`.execute(this.scope.db);
      await this.rules.addUnionEvent(
        unionid,
        0,
        this.lang.t('acceptApply.addUnionEvent', phpString(my?.name), phpString(target?.name)),
      );
    });
    return this.getApplyList(ctx, [0]);
  }

  /** `[page, applicantUid]`: rejects an application. */
  @GlobalCommand()
  async rejectApply(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const auid = phpIntval(param[1]);
    const user = await this.row(
      sql<Row>`select union_id, union_pos from sys_user where uid = ${ctx.uid}`,
    );
    if (phpIntval(user?.union_id) <= 0 || phpIntval(user?.union_pos) < 2) {
      throw GameError.lang('rejectApply.not_official');
    }
    await sql`delete from sys_union_apply where uid = ${auid}`.execute(this.scope.db);
    return this.getApplyList(ctx, [0]);
  }

  /** `[]`: cancels the caller's own application. */
  @GlobalCommand()
  async cancelApply(ctx: CommandContext): Promise<unknown[]> {
    await sql`delete from sys_union_apply where uid = ${ctx.uid}`.execute(this.scope.db);
    return [];
  }

  /** `[]`: pending invitations for an officer. */
  @GlobalCommand()
  async getInviteList(ctx: CommandContext): Promise<unknown[]> {
    return this.rules.inviteList(ctx.uid);
  }

  /** `[targetUid]`: cancels an invitation. */
  @GlobalCommand()
  async cancelInvite(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const target = phpIntval(param[0]);
    const user = await this.row(
      sql<Row>`select union_id, union_pos from sys_user where uid = ${ctx.uid}`,
    );
    const unionid = phpIntval(user?.union_id);
    if (unionid <= 0 || phpIntval(user?.union_pos) < 2) {
      throw GameError.lang('cancelInvite.you_are_not_official');
    }
    await sql`delete from sys_union_invite where unionid = ${unionid} and uid = ${target}`.execute(
      this.scope.db,
    );
    return this.rules.inviteList(ctx.uid);
  }

  /** `[unionid]`: rejects an invitation. */
  @GlobalCommand()
  async rejectInvite(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const unionid = phpIntval(param[0]);
    if (
      !(await this.check(
        sql<Row>`select 1 as v from sys_union_invite where unionid = ${unionid} and uid = ${ctx.uid}`,
      ))
    ) {
      throw GameError.lang('rejectInvite.invalid_invitation');
    }
    if (!(await this.check(sql<Row>`select 1 as v from sys_union where id = ${unionid}`))) {
      throw GameError.lang('rejectInvite.union_not_exist');
    }
    await sql`delete from sys_union_invite where unionid = ${unionid} and uid = ${ctx.uid}`.execute(
      this.scope.db,
    );
    return [];
  }

  /** `[targetUid, position]`: changes a member's office. */
  @GlobalCommand()
  async setUnionProvicy(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const target = phpIntval(param[0]);
    const position = phpIntval(param[1]);
    const my = await this.row(
      sql<Row>`select name, union_id, union_pos from sys_user where uid = ${ctx.uid}`,
    );
    const unionid = phpIntval(my?.union_id);
    const unionpos = phpIntval(my?.union_pos);
    const targetinfo = await this.row(
      sql<Row>`select name, union_id, union_pos from sys_user where uid = ${target}`,
    );
    const targetpos = phpIntval(targetinfo?.union_pos);
    if (
      unionid < 0 ||
      phpIntval(targetinfo?.union_id) !== unionid ||
      unionpos === 0 ||
      (targetpos !== 0 && unionpos >= targetpos) ||
      (position !== 0 && position <= unionpos)
    ) {
      throw GameError.lang('setUnionProvicy.not_authorizied');
    }
    await sql`update sys_user set union_pos = ${position} where uid = ${target}`.execute(
      this.scope.db,
    );
    const targetname = this.lang.t(
      `setUnionProvicy.${position === 0 ? 'union_memeber' : position === 2 ? 'union_vice_chief' : position === 3 ? 'union_elder' : 'union_official'}`,
    );
    if (position !== targetpos) {
      const down = position === 0 || (targetpos > 0 && position > targetpos);
      await this.rules.addUnionEvent(
        unionid,
        9,
        this.lang.t(
          `setUnionProvicy.${down ? 'descend_level' : 'upgrade_level'}`,
          phpString(my?.name),
          phpString(targetinfo?.name),
          targetname,
        ),
      );
    }
    return [target, position];
  }

  /** `[]`: resigns from an officer position, never from leadership. */
  @GlobalCommand()
  async demissionUnion(ctx: CommandContext): Promise<unknown[]> {
    const my = await this.row(
      sql<Row>`select name, union_id, union_pos from sys_user where uid = ${ctx.uid}`,
    );
    const unionid = phpIntval(my?.union_id);
    const unionpos = phpIntval(my?.union_pos);
    if (!unionid) throw GameError.lang('demissionUnion.not_in_union');
    if (unionpos === 0) throw GameError.lang('demissionUnion.no_any_position');
    const union = await this.row(sql<Row>`select leader from sys_union where id = ${unionid}`);
    if (!union) throw GameError.lang('demissionUnion.union_dissmissed');
    if (phpIntval(union.leader) === ctx.uid)
      throw GameError.lang('demissionUnion.chief_cant_resign');
    await sql`update sys_user set union_pos = 0 where uid = ${ctx.uid}`.execute(this.scope.db);
    const targetname = this.lang.t(
      `demissionUnion.${unionpos === 0 ? 'union_memeber' : unionpos === 2 ? 'union_vice_chief' : unionpos === 3 ? 'union_elder' : 'union_official'}`,
    );
    await this.rules.addUnionEvent(
      unionid,
      10,
      this.lang.t('demissionUnion.add_union_event', phpString(my?.name), targetname),
    );
    return [];
  }

  /** `[unionid]`: upgrades the caller's office using donation and the position cap. */
  @GlobalCommand()
  async upgradePosition(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const unionid = phpIntval(param[0]);
    const union = await this.row(
      sql<Row>`select union_id, union_pos, name from sys_user where uid = ${ctx.uid}`,
    );
    if (!union || phpIntval(union.union_id) !== unionid) {
      throw GameError.lang('acceptApply.union_not_exist');
    }
    if (
      await this.check(
        sql<Row>`select 1 as v from sys_user where union_pos >= 4 and uid = ${ctx.uid}`,
      )
    ) {
      throw GameError.lang('upgradePosition.max_level');
    }
    if (
      await this.check(
        sql<Row>`select 1 as v from mem_union_remove where uid = ${ctx.uid} and unionid = ${unionid}`,
      )
    ) {
      throw GameError.lang('union.user_can_not_upgrade');
    }
    const donate = await this.row(
      sql<Row>`select * from sys_user_donate where unionid = ${unionid} and uid = ${ctx.uid}`,
    );
    const houseLevel = phpNum(
      await this.cell(
        sql<Row>`select level as v from sys_union_building where bid = 2 and unionid = ${unionid}`,
      ),
    );
    const next = phpIntval(union.union_pos) + 1;
    let flag: boolean;
    let maxMembers = 0;
    if (next === 1) {
      flag = phpNum(donate?.donate) >= 100;
      maxMembers = 3 + Math.floor((10 + houseLevel) / 10);
    } else if (next === 2) {
      flag = phpNum(donate?.donate) >= 500;
      maxMembers = 2 + Math.floor((10 + houseLevel) / 20);
    } else if (next === 3) {
      flag = phpNum(donate?.donate) >= 1000;
      maxMembers = 1 + Math.floor((10 + houseLevel) / 30);
    } else if (next === 4) {
      flag = phpNum(donate?.donate) >= 5000;
      maxMembers = 1 + Math.floor((10 + houseLevel) / 30);
    } else if (next === 5) {
      flag = phpNum(donate?.donate) >= 10000;
      maxMembers = 1;
    } else {
      flag = false;
    }
    if (!flag) throw GameError.lang('upgradePosition.not_enogh');
    const minDonate = await this
      .cell(sql<Row>`select min(a.donate) as v from sys_user_donate a, sys_user b
      where a.uid = b.uid and a.unionid = b.union_id and b.union_id = ${unionid} and b.union_pos = ${next}`);
    if (!phpEmpty(minDonate)) {
      if (phpNum(donate?.donate) <= phpNum(minDonate))
        throw GameError.lang('upgradePosition.not_enogh');
      const minUid = phpIntval(
        await this.cell(sql<Row>`select a.uid as v from sys_user_donate a, sys_user b
          where a.uid = b.uid and a.unionid = b.union_id and a.donate = ${phpNum(minDonate)}
          and a.unionid = ${unionid} and b.union_pos = ${next} limit 1`),
      );
      const count = phpNum(
        await this.cell(
          sql<Row>`select count(*) as v from sys_user where union_id = ${unionid} and union_pos = ${next}`,
        ),
      );
      if (count >= maxMembers) {
        await sql`update sys_user set union_pos = greatest(0, union_pos - 1) where uid = ${minUid}`.execute(
          this.scope.db,
        );
      }
    }
    await sql`update sys_user set union_pos = least(5, union_pos + 1) where uid = ${ctx.uid}`.execute(
      this.scope.db,
    );
    const msg = this.lang.t(`upgradePosition.${next}`, phpString(union.name));
    await this.rules.addUnionEvent(unionid, 4, msg);
    return [msg];
  }

  /** `[targetUid]`: cancels a scheduled kick. */
  @GlobalCommand()
  async cancelKickMember(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const target = phpIntval(param[0]);
    const user = await this.row(
      sql<Row>`select union_id, union_pos from sys_user where uid = ${ctx.uid}`,
    );
    if (!user || phpIntval(user.union_pos) < 4) throw GameError.lang('kickMember.not_elder');
    const targetUser = await this.row(
      sql<Row>`select union_id, union_pos from sys_user where uid = ${target}`,
    );
    if (phpIntval(user.union_id) !== phpIntval(targetUser?.union_id)) {
      throw GameError.lang('kickMember.not_cancel');
    }
    await sql`delete from mem_union_remove where uid = ${target} and unionid = ${phpIntval(targetUser?.union_id)}`.execute(
      this.scope.db,
    );
    return [];
  }

  /** `[]`: scheduled kicks and their countdowns. */
  @GlobalCommand()
  async getKickLeavingTime(ctx: CommandContext): Promise<unknown[]> {
    const unionid = phpIntval(
      await this.cell(sql<Row>`select union_id as v from sys_user where uid = ${ctx.uid}`),
    );
    const rows = await this.rows(
      sql<Row>`select * from mem_union_remove where unionid = ${unionid}`,
    );
    const ret: unknown[] = [];
    for (const row of rows) {
      ret.push({
        doName: await this.cell(
          sql<Row>`select name as v from sys_user where uid = ${phpIntval(row.douid)}`,
        ),
        name: await this.cell(
          sql<Row>`select name as v from sys_user where uid = ${phpIntval(row.uid)}`,
        ),
        lefttime: Math.max(
          0,
          phpNum(row.time) - phpNum(await this.cell(sql<Row>`select unix_timestamp() as v`)),
        ),
        kickuid: phpIntval(row.uid),
      });
    }
    return ret;
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
