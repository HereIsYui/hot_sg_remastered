import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { GoodsRules } from '../core/goods-rules.service';
import { TaskRules } from '../core/task-rules.service';
import { TaskRewards } from '../task/task-rewards.service';
import { UserRules } from '../core/user-rules.service';
import { MailService } from '../core/mail.service';
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
/** EVENT_PAGE_CPP (UnionFunc.php:8): the union-event page size. */
const EVENT_PAGE = 10;
/** EVT_CHANGE_LEADER (UnionFunc.php:13). */
/** EVT_RELATION_FRIEND (UnionFunc.php:15): the diplomacy event type. */
const EVT_RELATION_FRIEND = 5;
/** EVT_CHANGE_NAME (UnionFunc.php:14): the donate/upgrade event type. */
const EVT_CHANGE_NAME = 4;
/** The union-donation item gid. */
const DONATE_GID = 19210;
const EVT_CHANGE_LEADER = 3;
/** The leader-transfer badge gid (exchangeUnionState). */
const LEADER_BADGE_GID = 161501;

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
    private readonly mail: MailService,
    private readonly goods: GoodsRules,
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

  /** `[page]`: the union-event pages of the caller's union (getUnionEvent, 1690-1719). */
  @GlobalCommand()
  async getUnionEvent(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const unionid = phpIntval(
      await this.cell(sql<Row>`select union_id as v from sys_user where uid = ${uid}`),
    );
    if (unionid <= 0) throw GameError.lang('getUnionEvent.not_in_union');
    const evtCount = phpNum(
      await this.cell(
        sql<Row>`select count(*) as v from sys_union_event where unionid = ${unionid}`,
      ),
    );
    let page = phpIntval(param[0]);
    let pageCount = Math.ceil(evtCount / EVENT_PAGE);
    if (page >= pageCount) page = pageCount - 1;
    if (page < 0) {
      page = 0;
      pageCount = 0;
    }
    const ret: unknown[] = [pageCount, page];
    if (evtCount > 0) {
      ret.push(
        (await this.rows(sql<Row>`select * from sys_union_event where unionid = ${unionid}
          order by evttime desc limit ${page * EVENT_PAGE}, ${EVENT_PAGE}`)) as unknown[],
      );
    } else {
      ret.push([]);
    }
    return ret;
  }

  /** `[username]`: a 正式成员+ invites a player into the union (inviteUser, 610-660). */
  @GlobalCommand()
  async inviteUser(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const username = phpString(param[0]).trim();
    if (phpEmpty(username)) throw GameError.lang('inviteUser.enter_target_name');
    if (username.length > 8) throw GameError.lang('inviteUser.name_length_most');
    const my = await this.row(
      sql<Row>`select name, union_id, union_pos from sys_user where uid = ${uid}`,
    );
    const unionid = phpIntval(my?.union_id);
    const unionpos = phpIntval(my?.union_pos);
    if (unionid <= 0 || unionpos < 2) throw GameError.lang('inviteUser.you_are_not_official');
    const user = await this.row(
      sql<Row>`select uid, name, union_id from sys_user where name = ${username}`,
    );
    if (phpEmpty(user)) throw GameError.lang('inviteUser.named_user_not_exist');
    if (phpIntval(user!.uid) === uid) throw GameError.lang('inviteUser.cant_invite_yourself');
    if (phpIntval(user!.union_id) > 0) {
      throw GameError.lang('inviteUser.taget_joined_other_union');
    }
    const maxmember = await this.memberMaxCount(unionid);
    const inviteCount = phpNum(
      await this.cell(
        sql<Row>`select count(*) as v from sys_union_invite where unionid = ${unionid}`,
      ),
    );
    const member = phpNum(
      await this.cell(sql<Row>`select member as v from sys_union where id = ${unionid}`),
    );
    if (member + inviteCount > maxmember) throw GameError.lang('inviteUser.your_union_is_full');
    await sql`replace into sys_union_invite (unionid, inviter, uid, time)
      values (${unionid}, ${phpString(my?.name)}, ${phpIntval(user!.uid)}, unix_timestamp())`.execute(
      this.scope.db,
    );
    return this.getInviteList(uid);
  }

  /** UnionFunc.php:586 getInviteList: the union's pending invitations. */
  private async getInviteList(uid: number): Promise<unknown[]> {
    const union = await this.row(
      sql<Row>`select union_id, union_pos from sys_user where uid = ${uid}`,
    );
    const unionid = phpIntval(union?.union_id);
    if (unionid <= 0 || phpIntval(union?.union_pos) === 0) {
      throw GameError.lang('getInviteList.you_are_not_official');
    }
    return (await this.rows(sql<Row>`select u.uid as userid, u.name, u.rank, u.prestige,
      i.inviter, i.time from sys_union_invite i left join sys_user u on u.uid = i.uid
      where i.unionid = ${unionid}`)) as unknown[];
  }

  /** `[unionid]`: accepts an invitation and joins (acceptInvite, 321-362). */
  @GlobalCommand()
  async acceptInvite(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const unionid = phpIntval(param[0]);
    const invite = await this.row(
      sql<Row>`select * from sys_union_invite where unionid = ${unionid} and uid = ${uid}`,
    );
    if (phpEmpty(invite)) throw GameError.lang('acceptInvite.invalid_invitation');
    if (!(await this.check(sql<Row>`select 1 as v from sys_union where id = ${unionid}`))) {
      throw GameError.lang('acceptInvite.union_not_exist');
    }
    const honglu = await this.cell(sql<Row>`select max(b.level) as v from sys_building b,
      sys_city c where b.bid = ${BUILDING_HONGLU} and b.cid = c.cid and c.uid = ${uid}`);
    if (phpEmpty(honglu)) throw GameError.lang('acceptInvite.no_HongLu_built');
    const user = await this.row(sql<Row>`select name, union_id from sys_user where uid = ${uid}`);
    if (phpIntval(user?.union_id) > 0) {
      throw GameError.lang('acceptInvite.already_joined_other_union');
    }
    await sql`update sys_user set union_id = ${unionid}, union_pos = 0 where uid = ${uid}`.execute(
      this.scope.db,
    );
    await sql`update sys_union set member = member + 1 where id = ${unionid}`.execute(
      this.scope.db,
    );
    const famouscity = phpNum(
      await this.cell(sql<Row>`select count(*) as v from sys_city where uid = ${uid}
        and type > 0 and type < 5`),
    );
    if (famouscity > 0) {
      await sql`update sys_union_city set count = GREATEST(0, count + ${famouscity})
        where unionid = ${unionid}`.execute(this.scope.db);
    }
    await this.tasks.completeTask(uid, CREATE_UNION_TASK);
    await this.notifyUnionChange(uid, unionid, 1);
    await this.users.updateUnionRank(unionid);
    await sql`delete from sys_union_invite where uid = ${uid}`.execute(this.scope.db);
    await this.addUnionEvent(
      unionid,
      EVT_ADD_UNION,
      this.lang.t('acceptInvite.addUnionEvent', phpString(invite!.inviter), phpString(user?.name)),
    );
    // the PUSH_SNS_UNION_MSG platform event is skipped, as in the single build
    return [unionid, 1];
  }

  /** `[username]`: kicks a member (kickMember, 662-714): 长老+ only, the target below officer,
   * never oneself — the removal schedules a mem_union_remove row whose delay scales with the
   * target's position (the actual ejection is the cron's later wave). */
  @GlobalCommand()
  async kickMember(ctx: CommandContext, param: unknown[]): Promise<never> {
    const uid = ctx.uid;
    const username = phpString(param[0]).trim();
    if (phpEmpty(username)) throw GameError.lang('kickMember.enter_target_name');
    if (username.length > 8) throw GameError.lang('kickMember.name_length_most');
    const me = await this.row(
      sql<Row>`select name, union_id, union_pos from sys_user where uid = ${uid}`,
    );
    const unionid = phpIntval(me?.union_id);
    const unionpos = phpIntval(me?.union_pos);
    if (unionid <= 0 || unionpos === 0 || unionpos < 4) {
      throw GameError.lang('kickMember.not_elder');
    }
    const target = await this.row(
      sql<Row>`select uid, name, union_id, union_pos from sys_user
        where name = ${username} and union_id = ${unionid}`,
    );
    if (phpEmpty(target)) throw GameError.lang('kickMember.target_not_in_your_union');
    if (phpIntval(target!.union_pos) > 3) {
      throw GameError.lang('kickMember.descend_target_level');
    }
    if (phpIntval(target!.uid) === uid) throw GameError.lang('kickMember.cant_kick_oneself');
    if (
      await this.check(
        sql<Row>`select 1 as v from mem_union_remove where uid = ${phpIntval(target!.uid)}`,
      )
    ) {
      throw GameError.lang('kickMember.union_member_removed');
    }
    const needTime = { 0: 10800, 1: 21600, 2: 43200 }[phpIntval(target!.union_pos)] ?? 86400;
    await sql`insert into mem_union_remove (douid, uid, unionid, time)
      values (${uid}, ${phpIntval(target!.uid)}, ${unionid}, unix_timestamp() + ${needTime})`.execute(
      this.scope.db,
    );
    throw GameError.lang('kickMember.kick_succ');
  }

  /** `[username]`: the 盟主 transfers leadership (changeLeader, 780-833). */
  @GlobalCommand()
  async changeLeader(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const username = phpString(param[0]).trim();
    if (phpEmpty(username)) throw GameError.lang('changeLeader.enter_target_name');
    if (username.length > 8) throw GameError.lang('changeLeader.name_length_most');
    const old = await this.row(sql<Row>`select name, union_id from sys_user where uid = ${uid}`);
    const unionid = phpIntval(old?.union_id);
    const union = await this.row(sql<Row>`select * from sys_union where id = ${unionid}`);
    if (phpIntval(union?.leader) !== uid) throw GameError.lang('changeLeader.you_are_not_chief');
    const user = await this.row(sql<Row>`select uid, name, union_id from sys_user
      where name = ${username}`);
    if (phpEmpty(user)) throw GameError.lang('changeLeader.target_name_not_exist');
    if (phpIntval(user!.union_id) !== unionid) {
      throw GameError.lang('changeLeader.target_not_in_your_union');
    }
    if (
      await this.check(
        sql<Row>`select 1 as v from mem_union_remove where uid = ${phpIntval(user!.uid)}
          and unionid = ${unionid}`,
      )
    ) {
      throw GameError.lang('union.user_can_not_transfer');
    }
    const leader = phpIntval(user!.uid);
    if (leader !== uid) {
      await sql`update sys_user set union_pos = 0 where uid = ${uid}`.execute(this.scope.db);
      await sql`update sys_user set union_pos = 5 where uid = ${leader}`.execute(this.scope.db);
      await sql`update sys_union set leader = ${leader} where id = ${unionid}`.execute(
        this.scope.db,
      );
      await this.exchangeUnionState(uid, leader);
      await this.addUnionEvent(
        unionid,
        EVT_CHANGE_LEADER,
        this.lang.t('changeLeader.addUnionEvent', phpString(old?.name), username),
      );
      await this.rewards.finishAchievement(uid, CREATE_UNION_ACHIEVEMENT);
    }
    return this.loadUnionInfo(ctx);
  }

  /** GoodsFunc.php::exchangeUnionState: the leader badge/buffers/task move to the new leader. */
  private async exchangeUnionState(fromleader: number, toleader: number): Promise<void> {
    const gid = LEADER_BADGE_GID;
    const count = await this.cell(
      sql<Row>`select count as v from sys_goods where uid = ${fromleader} and gid = ${gid}`,
    );
    if (!phpEmpty(count)) {
      await sql`insert into sys_goods (uid, gid, count) values (${toleader}, ${gid}, ${phpNum(count)})
        on duplicate key update count = ${phpNum(count)}`.execute(this.scope.db);
    }
    await sql`delete from sys_goods where uid = ${fromleader} and gid = ${gid}`.execute(
      this.scope.db,
    );
    const now = phpNum(await this.cell(sql<Row>`select unix_timestamp() as v`));
    const bufs = await this.rows(sql<Row>`select * from mem_user_buffer where uid = ${fromleader}
      and endtime > ${now} and buftype = ${gid}`);
    if (bufs.length > 0) {
      await sql`delete from mem_user_buffer where uid = ${toleader} and buftype = ${gid}`.execute(
        this.scope.db,
      );
      await sql`update mem_user_buffer set uid = ${toleader} where uid = ${fromleader}
        and buftype = ${gid}`.execute(this.scope.db);
    }
    await sql`delete from sys_user_task where uid = ${toleader} and tid = 112005`.execute(
      this.scope.db,
    );
    await sql`update sys_user_task set uid = ${toleader} where uid = ${fromleader}
      and tid = 112005`.execute(this.scope.db);
  }

  /** `[type]`: the diplomacy list of the caller's union (getUnionRelation, 918-935). */
  @GlobalCommand()
  async getUnionRelation(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const type = phpString(param[0]);
    const unionid = phpIntval(
      await this.cell(sql<Row>`select union_id as v from sys_user where uid = ${ctx.uid}`),
    );
    if (unionid <= 0) {
      return [0, this.lang.t('getUnionRelation.not_belongTo_union')];
    }
    const rows = (await this.rows(sql<Row>`select ${sql.raw(type)} as relationtype,
        ur.target as unionid, u.name, r.leader, u.prestige, u.member, r.rank
      from sys_union_relation ur
      left join sys_union u on u.id = ur.target
      left join rank_union r on r.uid = ur.target
      where ur.unionid = ${unionid} and ur.type = ${sql.raw(type)}`)) as unknown[];
    return [1, rows];
  }

  /** `[]`: the pending friendly-union attempts toward the caller (getRequestList, 937-969). */
  @GlobalCommand()
  async getRequestList(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const unionid = phpIntval(
      await this.cell(sql<Row>`select union_id as v from sys_user where uid = ${uid}`),
    );
    const unionpos = phpIntval(
      await this.cell(sql<Row>`select union_pos as v from sys_user where uid = ${uid}`),
    );
    if (unionid <= 0) return [0, this.lang.t('getUnionRelation.not_belongTo_union')];
    const requests = await this.rows(sql<Row>`select * from mem_union_relation
      where target = ${unionid} and type = 0`);
    for (const request of requests) {
      const fromunionid = phpIntval(request.unionid);
      if (!(await this.check(sql<Row>`select 1 as v from sys_union where id = ${fromunionid}`))) {
        await sql`delete from mem_union_relation where target = ${unionid}
          and unionid = ${fromunionid} and type = 0`.execute(this.scope.db);
      }
    }
    const ret: unknown[] = [
      1,
      (await this.rows(sql<Row>`select -1 as flag, ur.unionid as unionid,
          from_unixtime(ur.time) as time, u.name, r.leader, u.prestige, u.member, r.rank
        from mem_union_relation ur
        left join sys_union u on u.id = ur.unionid
        left join rank_union r on r.uid = ur.unionid
        where ur.target = ${unionid} and ur.type = 0`)) as unknown[],
    ];
    const count = phpNum(
      await this.cell(
        sql<Row>`select count(*) as v from mem_union_relation where target = ${unionid}`,
      ),
    );
    if (count === 0 || unionpos >= 3 || unionpos <= 0) {
      await sql`update sys_alarm set \`union\` = 0 where uid = ${uid}`.execute(this.scope.db);
    }
    return ret;
  }

  /** `[type, targetUnionid]`: the diplomacy write (addUnionRelation, 995-1156). Type 0 sends a
   * friendly attempt (the mem_union_relation ask + officer mail/alarm), type 1 applies
   * immediately, type 2 declares hostilities bilaterally (the original timestamp kept so the
   * 8-hour windows do not restart) with mail/alarm/scroll/union events on both sides. Every
   * path ends by throwing the diplomacy_send_succ text. */
  @GlobalCommand()
  async addUnionRelation(ctx: CommandContext, param: unknown[]): Promise<never> {
    const uid = ctx.uid;
    const type = phpIntval(param[0]);
    if (type < 0 || type > 2) throw GameError.lang('addUnionRelation.no_this_diplomacy');
    const target = phpIntval(param[1]);
    const my = await this.row(
      sql<Row>`select name, union_id, union_pos from sys_user where uid = ${uid}`,
    );
    const unionid = phpIntval(my?.union_id);
    const unionpos = phpIntval(my?.union_pos);
    const union = await this.row(
      sql<Row>`select name, leader from sys_union where id = ${unionid}`,
    );
    // 盟主 副盟主 有权限，长老也不行
    if (unionid <= 0 || unionpos === 0 || unionpos < 3) {
      throw GameError.lang('addUnionRelation.you_are_not_chief');
    }
    if (unionid === target) throw GameError.lang('addUnionRelation.cant_contact_with_oneself');
    const targetunion = await this.row(
      sql<Row>`select name, leader from sys_union where id = ${target} limit 1`,
    );
    if (phpEmpty(targetunion)) throw GameError.lang('addUnionRelation.target_union_not_exist');
    const old = await this.row(sql<Row>`select *, unix_timestamp() as nowtime
      from sys_union_relation where unionid = ${unionid} and target = ${target}`);
    if (!phpEmpty(old) && phpNum(old!.time) > phpNum(old!.nowtime) - 900) {
      throw GameError.lang(
        'addUnionRelation.too_frequency',
        this.makeTimeLeft(900 + phpNum(old!.time) - phpNum(old!.nowtime)),
      );
    }
    if (!phpEmpty(old) && phpIntval(old!.type) === type) {
      const relation =
        type === 0
          ? this.lang.t('addUnionRelation.friendly')
          : type === 1
            ? this.lang.t('addUnionRelation.neutral')
            : this.lang.t('addUnionRelation.hostile');
      throw GameError.lang('addUnionRelation.have_done', relation);
    }
    if (type === 0) {
      const attempt = await this.row(sql<Row>`select *, unix_timestamp() as nowtime
        from mem_union_relation where unionid = ${unionid} and target = ${target} and type = 0`);
      if (!phpEmpty(attempt)) throw GameError.lang('addUnionRelation.friendly_have_sent');
      await sql`insert into mem_union_relation (type, unionid, target, time)
        values (0, ${unionid}, ${target}, unix_timestamp())
        on duplicate key update type = 0, time = unix_timestamp()`.execute(this.scope.db);
      const receivers = await this.rows(sql<Row>`select uid, union_pos from sys_user
        where union_id = ${target} and union_pos >= 3 and union_pos <= 5`);
      for (const receiver of receivers) {
        await this.mail.send(
          phpIntval(receiver.uid),
          this.lang.t('addUnionRelation.friendly_attempt_mail_title'),
          this.lang.t(
            'addUnionRelation.friendly_attempt_mail_content_AtoB',
            phpString(union?.name),
          ),
        );
        if (phpIntval(receiver.union_pos) >= 4) {
          await sql`insert into sys_alarm (uid, \`union\`) values (${phpIntval(receiver.uid)}, 1)
            on duplicate key update \`union\` = 1`.execute(this.scope.db);
        }
        await sql`insert into sys_info_alarm (uid, type, info, time)
          values (${phpIntval(receiver.uid)}, 0, ${this.lang.t('addUnionRelation.friendly_attempt_alarm_info', phpString(union?.name))}, unix_timestamp())`.execute(
          this.scope.db,
        );
      }
    } else if (type === 2) {
      if (!phpEmpty(old) && phpIntval(old!.type) === 2) {
        throw GameError.lang('addUnionRelation.hostile_have_done');
      }
      const otherside = await this.cell(sql<Row>`select time as v from sys_union_relation
        where type = 2 and unionid = ${target} and target = ${unionid}`);
      if (phpEmpty(otherside)) {
        await sql`insert into sys_union_relation (type, unionid, target, time)
          values (2, ${unionid}, ${target}, unix_timestamp())
          on duplicate key update type = 2, time = unix_timestamp()`.execute(this.scope.db);
        await sql`insert into sys_union_relation (type, unionid, target, time)
          values (2, ${target}, ${unionid}, unix_timestamp())
          on duplicate key update type = 2, time = unix_timestamp()`.execute(this.scope.db);
      } else {
        // 之前打过，按照之前的时间，避免重新计算8小时
        await sql`insert into sys_union_relation (type, unionid, target, time)
          values (2, ${unionid}, ${target}, ${otherside})
          on duplicate key update type = 2, time = ${otherside}`.execute(this.scope.db);
      }
      const declareTo = async (receiverUnion: number, textKey: string, alarmKey: string) => {
        const receivers = await this.rows(
          sql<Row>`select uid from sys_user where union_id = ${receiverUnion}`,
        );
        for (const receiver of receivers) {
          const targetName = phpString(receiverUnion === target ? union?.name : targetunion?.name);
          await this.mail.send(
            phpIntval(receiver.uid),
            this.lang.t('addUnionRelation.hostile_mail_title'),
            this.lang.t(textKey, targetName, targetName),
          );
          await sql`insert into sys_info_alarm (uid, type, info, time)
            values (${phpIntval(receiver.uid)}, 0, ${this.lang.t(alarmKey, targetName)}, unix_timestamp())`.execute(
            this.scope.db,
          );
        }
      };
      await declareTo(
        target,
        'addUnionRelation.hostile_mail_content_BtoA',
        'addUnionRelation.hostile_attempt_alarm_info_BtoA',
      );
      await declareTo(
        unionid,
        'addUnionRelation.hostile_mail_content_AtoB',
        'addUnionRelation.hostile_attempt_alarm_info_AtoB',
      );
      const scroll = `select id from sys_inform where scrollcount = ${100000 + unionid}`;
      if (!(await this.check(sql<Row>`${scroll}`))) {
        await sql`insert into sys_inform (type, inuse, starttime, endtime, \`interval\`, scrollcount, color, msg)
          values (0, 1, unix_timestamp(), unix_timestamp() + 600, 50000, ${100000 + unionid}, 16727871,
          ${this.lang.t('addUnionRelation.hostile_unionWar', phpString(union?.name), phpString(targetunion?.name))})`.execute(
          this.scope.db,
        );
      }
      await this.addUnionEvent(
        target,
        EVT_RELATION_FRIEND,
        this.lang.t('addUnionRelation.hostile_union_message_B_to_A', phpString(union?.name)),
      );
      await this.addUnionEvent(
        unionid,
        EVT_RELATION_FRIEND,
        this.lang.t('addUnionRelation.hostile_union_message_A_to_B', phpString(targetunion?.name)),
      );
      // the PUSH_SNS_UNION_MSG platform events are skipped, as in the single build
    }
    // type 1 (中立) applies immediately with no side effects beyond the relation row below
    if (type === 1 || type === 2) {
      await sql`insert into sys_union_relation (type, unionid, target, time)
        values (${type}, ${unionid}, ${target}, unix_timestamp())
        on duplicate key update type = ${type}, time = unix_timestamp()`.execute(this.scope.db);
    }
    throw GameError.lang('addUnionRelation.diplomacy_send_succ');
  }

  /** utils.php::MakeTimeLeft, the countdown text of a remaining window. */
  private makeTimeLeft(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}小时${m}分` : `${m}分`;
  }

  /** `[bid, count]`: donates 联盟捐献 items into a union building (donateGoods, 2127-2195). */
  @GlobalCommand()
  async donateGoods(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const bid = phpIntval(param[0]);
    const count = phpIntval(param[1]);
    const user = await this.row(
      sql<Row>`select name, union_id, union_pos from sys_user where uid = ${uid}`,
    );
    const unionid = phpIntval(user?.union_id);
    if (unionid <= 0) throw GameError.lang('leaveUnion.you_belongTo_none_union');
    if (!(await this.check(sql<Row>`select 1 as v from sys_union where id = ${unionid}`))) {
      throw GameError.lang('leaveUnion.you_belongTo_none_union');
    }
    if (bid > 16 || bid < 0) throw GameError.lang('upgradeBuilding.not_exist');
    if (count < 1) throw GameError.raw('');
    if (![1, 2, 9].includes(bid)) throw GameError.lang('goods.not_available');
    const myGoodsNum = phpNum(
      await this.cell(
        sql<Row>`select count as v from sys_goods where uid = ${uid} and gid = ${DONATE_GID}`,
      ),
    );
    if (myGoodsNum < count) throw GameError.lang('duihuan.not_enogh');
    const building = await this.row(sql<Row>`select * from sys_union_building
      where bid = ${bid} and unionid = ${unionid}`);
    const curLevel = phpIntval(building?.level);
    if (curLevel >= 100) throw GameError.lang('donate.max_level');
    const totalNum = await this.maxDonate(uid, unionid);
    const donatedNum = phpNum(
      await this.cell(sql<Row>`select curnum as v from sys_user_donate where uid = ${uid}
        and unionid = ${unionid}`),
    );
    if (count + donatedNum > totalNum) throw GameError.lang('donate.too_much');
    const num = count * 100;
    await sql`insert into sys_user_donate (uid, unionid, donate) values (${uid}, ${unionid}, ${num})
      on duplicate key update donate = donate + ${num}`.execute(this.scope.db);
    await sql`update sys_user_donate set curnum = curnum + ${count}, time = unix_timestamp()
      where uid = ${uid} and unionid = ${unionid}`.execute(this.scope.db);
    await sql`update sys_union set donate = donate + ${num} where id = ${unionid}`.execute(
      this.scope.db,
    );
    await this.reduceGoods(uid, DONATE_GID, count);
    let upgradeLevel = 0;
    let needNum = phpNum(
      await this.cell(sql<Row>`select num as v from cfg_union_building_upgrade
        where level = ${curLevel} + 1 and bid = ${bid}`),
    );
    const curNum = phpNum(
      await this.cell(sql<Row>`select curnum as v from sys_union_building
        where unionid = ${unionid} and bid = ${bid}`),
    );
    const totalDonateNum = curNum + count;
    while (totalDonateNum >= needNum) {
      upgradeLevel++;
      const level = curLevel + upgradeLevel;
      if (level < 100) {
        needNum = phpNum(
          await this.cell(sql<Row>`select num as v from cfg_union_building_upgrade
            where level = ${level} + 1 and bid = ${bid}`),
        );
      } else {
        needNum = totalDonateNum + 1; // 到100级强制退出
      }
    }
    await sql`update sys_union_building set curnum = curnum + ${count}
      where bid = ${bid} and unionid = ${unionid}`.execute(this.scope.db);
    await this.addUnionEvent(
      unionid,
      EVT_CHANGE_NAME,
      this.lang.t('donate.donate', phpString(user?.name), count),
    );
    if (upgradeLevel > 0) {
      await sql`update sys_union_building set level = level + ${upgradeLevel}
        where bid = ${bid} and unionid = ${unionid}`.execute(this.scope.db);
      const name = phpString(
        await this.cell(sql<Row>`select name as v from cfg_union_building_upgrade
          where bid = ${bid} limit 1`),
      );
      await this.addUnionEvent(
        unionid,
        EVT_CHANGE_NAME,
        this.lang.t('upgradeBuilding.upgrade', name, curLevel + upgradeLevel),
      );
    }
    const left = totalNum - count - donatedNum;
    return [this.lang.t('donate.can_donate', left)];
  }

  /** utils.php::reduceGoods. */
  private async reduceGoods(uid: number, gid: number, count: number): Promise<void> {
    await sql`insert into sys_goods (uid, gid, count) values (${uid}, ${gid}, ${count})
      on duplicate key update count = count - ${count}`.execute(this.scope.db);
    await sql`delete from sys_goods where uid = ${uid} and gid = ${gid} and count <= 0`.execute(
      this.scope.db,
    );
  }

  /** UnionFunc.php:2119 getMaxDonate: 君主将等级/5 * 3 + 联盟官府等级/5. */
  private async maxDonate(uid: number, unionid: number): Promise<number> {
    const heroLevel = phpNum(
      await this.cell(sql<Row>`select level as v from sys_city_hero where uid = ${uid}
        and herotype = 1000`),
    );
    const buildingLevel = phpNum(
      await this.cell(sql<Row>`select level as v from sys_union_building
        where unionid = ${unionid} and bid = 1`),
    );
    return Math.trunc(heroLevel / 5) * 3 + Math.trunc(buildingLevel / 5);
  }

  /** `[flag, fromids, count]`: the union store exchange (exchangeUnionGoods, 2204-2313). */
  @GlobalCommand()
  async exchangeUnionGoods(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const fromids = (Array.isArray(param[0]) ? (param[0] as unknown[]) : [param[0]]).map((v) =>
      phpIntval(v),
    );
    const count = phpIntval(param[1]);
    const flag = phpIntval(param[2]); // fromid;0:gid;1:sid
    if (count < 0) throw GameError.raw('');
    if (count !== fromids.length && flag === 1) throw GameError.raw('');
    const user = await this.row(
      sql<Row>`select name, union_id, union_pos from sys_user where uid = ${uid}`,
    );
    const unionid = phpIntval(user?.union_id);
    // 商票不进行最大次数检测
    if (flag === 1 || phpIntval(fromids[0]) !== 19302) {
      const info = await this.row(sql<Row>`select * from sys_user_donate where uid = ${uid}
        and unionid = ${unionid}`);
      if (phpEmpty(info)) {
        await sql`insert into sys_user_donate (uid, unionid, duihuan)
          values (${uid}, ${unionid}, 0)`.execute(this.scope.db);
      }
      const hasDuihuan = phpNum(
        await this.cell(sql<Row>`select duihuan as v from sys_user_donate where uid = ${uid}
          and unionid = ${unionid}`),
      );
      const maxDuihuan = await this.maxDuihuan(uid, unionid);
      if (hasDuihuan + count > maxDuihuan) throw GameError.lang('donate.too_much');
    }
    if (await this.checkMarketLevel(unionid, flag, fromids)) {
      throw GameError.lang('donate.level_low');
    }
    if (flag === 1 && count < 1) throw GameError.lang('duihuan.not_enogh');
    let fromid = 0;
    if (flag === 0) {
      fromid = phpIntval(fromids[0]);
      const rates: Record<number, [number, number]> = {
        35: [1, 1],
        36: [5, 2],
        37: [10, 3],
        38: [10, 5],
        152: [100, 5],
        10960: [100, 5],
        19302: [1, 10],
      };
      const [needMul, getMul] = rates[fromid] ?? [0, 0];
      const need = count * needMul;
      const get = count * getMul;
      const tmpCount = phpNum(
        await this.cell(
          sql<Row>`select count as v from sys_goods where uid = ${uid} and gid = ${fromid}`,
        ),
      );
      if (phpEmpty(tmpCount) || tmpCount < need) throw GameError.lang('duihuan.not_enogh');
      await this.reduceGoods(uid, fromid, need);
      await this.goods.addGoods(uid, 19210, get, 1);
    }
    if (flag === 1) {
      for (const sid of fromids) {
        const armorType = await this.cell(sql<Row>`select a.type as v from cfg_armor a,
          sys_user_armor b where a.id = b.armorid and b.sid = ${sid}`);
        if (phpIntval(armorType) !== 4) throw GameError.lang('duihuan.not_blue_armor');
        if (
          await this.check(
            sql<Row>`select 1 as v from sys_user_armor where hid > 0 and sid = ${sid}`,
          )
        ) {
          throw GameError.lang('duihuan.not_blue_armor');
        }
        await sql`delete from sys_user_armor where sid = ${sid}`.execute(this.scope.db);
        await this.goods.addGoods(uid, 19210, 5, 1011);
      }
    }
    if (!(flag === 0 && fromid === 19302)) {
      // 商票兑换不影响每日兑换上限
      await sql`update sys_user_donate set duihuan = duihuan + ${count}, time = unix_timestamp()
        where uid = ${uid} and unionid = ${unionid}`.execute(this.scope.db);
    }
    const store = await this.getUnionStoreInfo(uid);
    return [store, this.lang.t('unionreward.recieve_reward')];
  }

  /** UnionFunc.php:2434 getUnionStoreInfo: the market level, the remaining exchanges and rows. */
  private async getUnionStoreInfo(uid: number): Promise<unknown[]> {
    const user = await this.row(
      sql<Row>`select union_id, union_pos from sys_user where uid = ${uid}`,
    );
    const unionid = phpIntval(user?.union_id);
    const day = phpNum(await this.cell(sql<Row>`select unix_timestamp(substr(now(), 1, 10)) as v`));
    if (
      await this.check(sql<Row>`select 1 as v from sys_user_donate where uid = ${uid}
        and unionid = ${unionid} and time < ${day}`)
    ) {
      await sql`update sys_user_donate set duihuan = 0, curnum = 0 where uid = ${uid}
        and unionid = ${unionid}`.execute(this.scope.db);
    }
    const markLevel = phpNum(
      await this.cell(sql<Row>`select level as v from sys_union_building
        where unionid = ${unionid} and bid = 9 limit 1`),
    );
    const level = phpEmpty(markLevel) ? 1 : markLevel;
    const ret: unknown[] = [level];
    const hasDuihuan = phpNum(
      await this.cell(sql<Row>`select duihuan as v from sys_user_donate where uid = ${uid}
        and unionid = ${unionid}`),
    );
    const maxDuihuan = await this.maxDuihuan(uid, unionid);
    ret.push(maxDuihuan - hasDuihuan > 0 ? maxDuihuan - hasDuihuan : 0);
    const allGoods = await this.rows(sql<Row>`select * from cfg_union_store order by level asc`);
    for (const goods of allGoods) {
      const goodInfo = await this.row(
        sql<Row>`select * from cfg_goods where gid = ${phpIntval(goods.gid)} limit 1`,
      );
      const owned = phpIntval(
        await this.cell(sql<Row>`select count as v from sys_goods where uid = ${uid}
          and gid = ${phpIntval(goods.gid)}`),
      );
      ret.push({ ...goods, goodInfo: { ...(goodInfo ?? {}), count: owned <= 0 ? 0 : owned } });
    }
    return ret;
  }

  /** UnionFunc.php:2196 getMaxDuihuan: 3 + 君主将等级/5 exchanges per day. */
  private async maxDuihuan(uid: number, unionid: number): Promise<number> {
    if (
      !(await this.check(sql<Row>`select 1 as v from sys_user where uid = ${uid}
        and union_id = ${unionid}`))
    ) {
      return 0;
    }
    const heroLevel = phpNum(
      await this.cell(sql<Row>`select level as v from sys_city_hero where uid = ${uid}
        and herotype = 1000`),
    );
    return 3 + Math.trunc(heroLevel / 5);
  }

  /** UnionFunc.php:2495 checkMarketLevel: true when the market level gates the exchange. */
  private async checkMarketLevel(unionid: number, flag: number, gids: number[]): Promise<boolean> {
    const level = phpNum(
      await this.cell(sql<Row>`select level as v from sys_union_building
        where unionid = ${unionid} and bid = 9 limit 1`),
    );
    if (flag === 1) return level < 70;
    const gates: Record<number, number> = {
      35: 1,
      19302: 1,
      36: 10,
      37: 20,
      38: 30,
      152: 40,
      10960: 50,
    };
    const gid = phpIntval(gids[0]);
    return level < (gates[gid] ?? 0);
  }

  /** `[unionid]`: claims the union-rank reward (getUnionReward, 2315-2338). */
  @GlobalCommand()
  async getUnionReward(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const unionid = phpIntval(param[0]);
    if (
      !(await this.check(sql<Row>`select 1 as v from sys_user where uid = ${uid}
      and union_id = ${unionid}`))
    ) {
      throw GameError.lang('unionreward.not_in_union');
    }
    if (
      !(await this.check(sql<Row>`select 1 as v from sys_union_reward where uid = ${uid}
        and unionid = ${unionid}`))
    ) {
      throw GameError.lang('unionreward.not_in_rank');
    }
    if (
      await this.check(sql<Row>`select 1 as v from sys_union_reward where uid = ${uid}
        and unionid = ${unionid} and time > 1`)
    ) {
      throw GameError.lang('unionreward.has_got_reward');
    }
    const rewards = await this.rows(sql<Row>`select a.gid, a.count from cfg_union_reward a,
      sys_union_reward b where a.rank = b.rank and a.pos = b.pos and b.uid = ${uid}
      and b.unionid = ${unionid}`);
    for (const reward of rewards) {
      await this.goods.addGoods(uid, phpIntval(reward.gid), phpIntval(reward.count), 1);
    }
    await sql`update sys_union_reward set time = unix_timestamp() where uid = ${uid}
      and unionid = ${unionid}`.execute(this.scope.db);
    return [await this.loadUnionRewardData(ctx), this.lang.t('unionreward.recieve_reward')];
  }

  /** `[]`: the top-10 union ranks and the caller's reward stamp (loadUnionRewardData). */
  @GlobalCommand()
  async loadUnionRewardData(ctx: CommandContext): Promise<unknown[]> {
    const rankInfo = await this.rows(sql<Row>`select rank, name from rank_union
      order by rank asc limit 10`);
    const userInfo =
      (await this.row(sql<Row>`select r.rank, u.union_pos from rank_union r, sys_user u
        where r.uid = u.union_id and u.uid = ${ctx.uid} limit 1`)) ?? {};
    const rewardInfo = await this.row(
      sql<Row>`select * from sys_union_reward where uid = ${ctx.uid} limit 1`,
    );
    userInfo.getrewardtime = phpEmpty(rewardInfo) ? 0 : phpNum(rewardInfo!.time);
    return [rankInfo, userInfo];
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
