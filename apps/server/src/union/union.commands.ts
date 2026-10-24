import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { TaskRewards } from '../task/task-rewards.service';
import { UserRules } from '../core/user-rules.service';
import { LangService } from '../common/lang.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** ID_BUILDING_HONGLU (common.php:58): the 鸿胪寺 gate for union actions. */
const BUILDING_HONGLU = 12;
/** createUnion's cost and the founding donation. */
const CREATE_COST_GOLD = 10000;
/** 建盟冷却（sys_user_action_log 的 createunion 行）. */
const CREATE_COOLDOWN = 86400;
/** completeTask($uid, 67) — the create-union task. */
const CREATE_UNION_TASK = 67;
/** finishAchivement($uid, 13) — the create-union achievement. */
const CREATE_UNION_ACHIEVEMENT = 13;
/** EVT_ADD_UNION (UnionFunc's event types). */
const EVT_ADD_UNION = 0;
/** union_pos of the creator (盟主). */
const POS_LEADER = 5;

/**
 * UnionFunc.php wave 3a: createUnion (54-124), applyJoin (159-187), getUnionApplyInvite
 * (127-158) — founding, applying and the 鸿胪寺's own application/invitation view. The member
 * management, diplomacy and union-city families are later waves.
 *
 * notifyUnionChange (utils.php) writes a mem_union_buf row the clients poll; addUnionEvent
 * (UnionFunc.php) lands the event into both sys_union_event and mem_union_event.
 */
@Injectable()
export class UnionCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly users: UserRules,
    private readonly tasks: TaskRules,
    private readonly lang: LangService,
    private readonly rewards: TaskRewards,
  ) {}

  /** `[unionname]`: founds a union for 10000 gold of the 鸿胪寺 city, once per day. */
  @GlobalCommand()
  async createUnion(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const user = await this.row(sql<Row>`select name, union_id from sys_user where uid = ${uid}`);
    if (phpIntval(user?.union_id) > 0) {
      throw GameError.lang('createUnion.already_joined_other_union');
    }
    const unionname = phpString(param[0]).trim();
    if (phpEmpty(unionname)) throw GameError.lang('createUnion.union_name_notNull');
    if (unionname.length > 8) throw GameError.lang('createUnion.union_name_tooLong');
    if (unionname.includes("'") || unionname.includes('\\')) {
      throw GameError.lang('createUnion.has_ivalid_char');
    }
    if (
      await this.check(
        sql<Row>`select 1 as v from cfg_baned_name where instr(${unionname}, name) > 0`,
      )
    ) {
      throw GameError.lang('createUnion.has_ivalid_char');
    }
    const since = phpNum(
      await this.cell(sql<Row>`select unix_timestamp() - time as v from sys_user_action_log
        where uid = ${uid} and action = 'createunion' limit 1`),
    );
    if (since > 0 && since < CREATE_COOLDOWN) {
      throw GameError.lang('createUnion.add_union_event_time_near');
    }
    const cid = phpIntval(
      await this.cell(sql<Row>`select lastcid as v from sys_user where uid = ${uid}`),
    );
    // 需要联盟2级（鸿胪寺）
    const honglulevel = phpNum(
      await this.cell(sql<Row>`select max(b.level) as v from sys_building b, sys_city c
        where b.bid = ${BUILDING_HONGLU} and b.cid = c.cid and c.uid = ${uid}`),
    );
    if (honglulevel < 2) throw GameError.lang('createUnion.level_lessThen_2');
    const citygold = phpNum(
      await this.cell(sql<Row>`select gold as v from mem_city_resource where cid = ${cid}`),
    );
    if (citygold < CREATE_COST_GOLD) throw GameError.lang('createUnion.gold_not_enough');
    if (await this.check(sql<Row>`select 1 as v from sys_union where name = ${unionname}`)) {
      throw GameError.lang('createUnion.use_another_name');
    }

    await sql`update mem_city_resource set gold = gold - ${CREATE_COST_GOLD} where cid = ${cid}`.execute(
      this.scope.db,
    );
    const inserted =
      await sql`insert into sys_union (name, leader, creator, createtime, intro, announcement)
      values (${unionname}, ${uid}, ${uid}, unix_timestamp(), '', '')`.execute(this.scope.db);
    const unionid = Number(inserted.insertId);
    await sql`update sys_user set union_id = ${unionid}, union_pos = ${POS_LEADER} where uid = ${uid}`.execute(
      this.scope.db,
    );
    await sql`delete from sys_user_action_log where uid = ${uid} and action = 'createunion'`.execute(
      this.scope.db,
    );
    const mark = this.lang.t('actionlog.createunion');
    await sql`insert into sys_user_action_log (uid, time, action, mark)
      values (${uid}, unix_timestamp(), 'createunion', ${mark})`.execute(this.scope.db);
    await sql`insert into sys_user_donate (uid, unionid, donate) values (${uid}, ${unionid}, ${CREATE_COST_GOLD})`.execute(
      this.scope.db,
    );
    await sql`insert into sys_union_building (unionid, bid, level)
      select ${unionid}, bid, 1 from cfg_union_building_upgrade group by bid`.execute(
      this.scope.db,
    );
    await this.notifyUnionChange(uid, unionid, 1);
    await this.tasks.completeTask(uid, CREATE_UNION_TASK);
    await this.users.updateUnionRank(unionid);
    await this.addUnionEvent(
      unionid,
      EVT_ADD_UNION,
      this.lang.t('createUnion.add_union_event', phpString(user?.name), unionname),
    );
    await this.rewards.finishAchievement(uid, CREATE_UNION_ACHIEVEMENT);
    return [unionid, 0, unionname];
  }

  /** `[]`: the 鸿胪寺 view — union membership or the pending application and invitations. */
  @GlobalCommand()
  async getUnionApplyInvite(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const user = await this.row(
      sql<Row>`select union_id, union_pos from sys_user where uid = ${uid}`,
    );
    const ret: unknown[] = [phpIntval(user?.union_id), phpIntval(user?.union_pos)];
    const unionid = phpIntval(user?.union_id);
    if (unionid > 0) {
      const unionname = phpString(
        await this.cell(sql<Row>`select name as v from sys_union where id = ${unionid}`),
      );
      ret.push(unionname);
      ret.push('［' + unionname + this.lang.t('getUnionApplyInvite.succ'));
    } else {
      // `union` is a MySQL 8 reserved word — the original backtick-free statement would fail
      // on a modern server too; backticks keep the legacy intent (clear the union alarm).
      await sql`update sys_alarm set \`union\` = 0 where uid = ${uid}`.execute(this.scope.db);
      ret.push(
        phpString(
          await this.cell(sql<Row>`select name as v from sys_union_apply where uid = ${uid}`),
        ),
      );
      ret.push(
        (await this.rows(sql<Row>`select u.* from sys_union_invite i
          left join sys_union u on u.id = i.unionid where i.uid = ${uid}`)) as unknown[],
      );
    }
    return ret;
  }

  /** `[unionid]`: applies to join; the player may hold only one pending application. */
  @GlobalCommand()
  async applyJoin(ctx: CommandContext, param: unknown[]): Promise<never> {
    const uid = ctx.uid;
    const honglulevel = await this.cell(sql<Row>`select max(b.level) as v from sys_building b,
      sys_city c where b.bid = ${BUILDING_HONGLU} and b.cid = c.cid and c.uid = ${uid}`);
    if (phpEmpty(honglulevel)) throw GameError.lang('applyJoin.no_HongLu_built');
    const userunion = phpIntval(
      await this.cell(sql<Row>`select union_id as v from sys_user where uid = ${uid}`),
    );
    if (userunion > 0) throw GameError.lang('applyJoin.already_joined_other_union');
    const unionid = phpIntval(param[0]);
    const pending = phpString(
      await this.cell(sql<Row>`select name as v from sys_union_apply where uid = ${uid}`),
    );
    if (!phpEmpty(pending)) {
      throw GameError.lang('applyJoin.reset_application', pending);
    }
    const unionname = phpString(
      await this.cell(sql<Row>`select name as v from sys_union where id = ${unionid}`),
    );
    if (phpEmpty(unionname)) throw GameError.lang('applyJoin.union_not_exist');
    await sql`insert into sys_union_apply (uid, unionid, name, time)
      values (${uid}, ${unionid}, ${unionname}, unix_timestamp())`.execute(this.scope.db);
    throw GameError.lang('applyJoin.send_application_succ');
  }

  /** `[unionid]`: the union detail header for a member (getUnionDetail($id, 1) + own pos). */
  @GlobalCommand()
  async loadUnionInfo(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const union = await this.row(
      sql<Row>`select union_id, union_pos from sys_user where uid = ${uid}`,
    );
    const unionid = phpIntval(union?.union_id);
    if (unionid === 0 || phpIntval(union?.union_pos) <= 0 || phpIntval(union?.union_pos) >= 3) {
      // `union` is a MySQL 8 reserved word (backticked; see the wave-3a note)
      await sql`update sys_alarm set \`union\` = 0 where uid = ${uid}`.execute(this.scope.db);
    }
    if (unionid <= 0) throw GameError.lang('loadUnionInfo.not_belongTo_union');
    if (!(await this.check(sql<Row>`select 1 as v from sys_union where id = ${unionid}`))) {
      throw GameError.lang('loadUnionInfo.your_union_is_out');
    }
    const detail = await this.getUnionDetail(unionid, 1);
    detail.push(phpIntval(union?.union_pos));
    return detail;
  }

  /** The member rows of the caller's union; officers see the online stamp (loadUnionMemberList). */
  @GlobalCommand()
  async loadUnionMemberList(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const union = await this.row(
      sql<Row>`select union_id, union_pos from sys_user where uid = ${uid}`,
    );
    const unionid = phpIntval(union?.union_id);
    if (unionid <= 0) throw GameError.lang('loadUnionMemberList.you_belongTo_none_union');
    const online =
      phpIntval(union?.union_pos) > 0
        ? sql<Row>`select u.*, r.rank as srank, count(c.cid) as cityCount, s.lastupdate,
          d.donate from sys_user u
        left join sys_city c on c.uid = u.uid
        left join sys_online s on s.uid = u.uid
        left join rank_user r on r.uid = u.uid
        left join sys_user_donate d on d.uid = u.uid and d.unionid = u.union_id
        where u.union_id = ${unionid} group by u.uid`
        : sql<Row>`select u.*, r.rank as srank, count(c.cid) as cityCount, 0 as lastupdate,
          d.donate from sys_user u
        left join sys_city c on c.uid = u.uid
        left join sys_online s on s.uid = u.uid
        left join rank_user r on r.uid = u.uid
        left join sys_user_donate d on d.uid = u.uid and d.unionid = u.union_id
        where u.union_id = ${unionid} group by u.uid`;
    return (await online.execute(this.scope.db)).rows as Row[];
  }

  /** UnionFunc.php:2486: the member cap follows the union 官府 building's level. */
  private async memberMaxCount(unionid: number): Promise<number> {
    const level = phpNum(
      await this.cell(sql<Row>`select level as v from sys_union_building
        where unionid = ${unionid} and bid = 2 limit 1`),
    );
    const gov = phpEmpty(level) ? 1 : level;
    return gov >= 50 ? 60 : gov + 10;
  }

  /** UnionFunc.php:424 getUnionDetail: the header row plus the member cap. */
  private async getUnionDetail(unionid: number, inner: number): Promise<unknown[]> {
    const ret: unknown[] = [1];
    const union =
      inner === 1
        ? await this.row(sql<Row>`select n.*, u.name as leadername, u2.name as creator
          from sys_union n
          left join sys_user u on n.leader = u.uid
          left join sys_user u2 on n.creator = u2.uid where n.id = ${unionid}`)
        : await this.row(sql<Row>`select n.id, n.chieforder, r.leader, r.name, r.member,
          r.famouscity, r.rank, r.prestige, u.name as creator, n.intro
        from sys_user u, sys_union n left join rank_union r on r.uid = n.id
        where n.id = ${unionid} and u.uid = n.creator`);
    if (union && (union.famouscity === '' || union.famouscity == null)) union.famouscity = 0;
    ret.push(union ?? {});
    ret.push(await this.memberMaxCount(unionid));
    return ret;
  }

  /** utils.php::notifyUnionChange: the polled union-change cache row. */
  private async notifyUnionChange(uid: number, unionid: number, state: number): Promise<void> {
    const name = phpString(
      await this.cell(sql<Row>`select name as v from sys_user where uid = ${uid}`),
    );
    await sql`insert into mem_union_buf (uid, nick, union_id, state, updatetime)
      values (${uid}, ${name}, ${unionid}, ${state}, unix_timestamp())`.execute(this.scope.db);
  }

  /** UnionFunc.php::addUnionEvent: the event lands in both the persistent and polled tables. */
  private async addUnionEvent(unionid: number, type: number, content: string): Promise<void> {
    await sql`insert into sys_union_event (unionid, type, content, evttime)
      values (${unionid}, ${type}, ${content}, unix_timestamp())`.execute(this.scope.db);
    await sql`insert into mem_union_event (unionid, type, content, evttime)
      values (${unionid}, ${type}, ${content}, unix_timestamp())`.execute(this.scope.db);
  }

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
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
