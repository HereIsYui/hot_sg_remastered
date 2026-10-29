import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { phpDate } from '../core/php-time';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { ReportService } from '../core/report.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** LuoyangFunc.php::governLuoyangOthers: the reports and the schedule writes hard-code 洛阳. */
const LUOYANG_CID = 215265;
const LUOYANG_X = 265;
const LUOYANG_Y = 215;
/** mem_user_buffer.buftype 130527: the 王爵位 buffer luoyangAllocate grants (bufparam = 21-爵位). */
const BUFFER_NOBILITY = 130527;
/** mem_user_buffer.buftype 10333: the 诏安 buffer openUnionZhaoAn grants for 72h. */
const BUFFER_ZHAOAN = 10333;
/** cfg_battle_field.id read by getLYBelongInfo (the 洛阳战场 description row). */
const LUOYANG_BATTLE_FIELD = 12001;
/** luoyang_progress tids initCurUnionBeiZhanLuoYangProgress seeds (cfg_task group 112001). */
const UNION_TASK_TIDS = [112001, 112002, 112003, 112004];
/** cfg_task_goal.sort of the union-epic goal rows backing those tids. */
const UNION_TASK_GOAL_SORT = 203;

/**
 * LuoyangFunc.php (洛阳归属) + RankFunc.php:488 getBeiZhanLuoYangProgress — who holds 洛阳 and
 * what the holder may do: getLuoyangInfo / getLYBelongInfo / getLuoyangEvent (归属总览与事件),
 * getUnionRankPoint / getUserRankPoint / getUserInfoPoint (战场积分榜, C++ writes the scores),
 * luoyangAllocate (盟主分配), sendBelongInform (全服公告), openUnionZhaoAn (诏安), and the
 * holder's 政令 variant getLuoyangGovernCount / governLuoyangOthers. All 12 sit in the openfunc
 * whitelist (lang.php:2650/2652/2654/2656) and arrive as global commands. The 洛阳战场 battle
 * commands of the same file live in luoyang.commands.ts (LuoyangModule).
 *
 * Faithful quirks kept:
 * - mem_luoyang_info does not exist in either database, so the original getLuoyangInfo's
 *   sql_fetch_one dies through the PearDB error path (Command.sendCommand answers [0, <PearDB
 *   text>]); the gateway reproduces that generic in-band failure for raw SQL errors;
 * - getLYBelongInfo's `$isCanSend` can never be true: `empty($sendTime) || $sendTime > 0` is
 *   false only for a value that is non-empty AND <= 0, and MySQL renders 0 as "0" which PHP's
 *   empty() treats as empty (LuoyangFunc.php:574). Kept as written;
 * - luoyangAllocate's `$isGap = $preRecord < $startTime - 604800` compares an ARRAY with a
 *   number — PHP arrays always compare greater, so the 断续 gap check is dead and the 连续
 *   count continues from the last record whenever uid+unionid match (LuoyangFunc.php:395);
 * - the original inline-SQL `addslashes($name)` exists only to survive string interpolation;
 *   with parameter binding the raw name is bound, exactly what the parser reconstructed;
 * - multi-write commands run statement-by-statement without a transaction, like the original's
 *   autocommit: a mid-way failure (e.g. a second 王爵位 buffer row for a re-allocated member)
 *   keeps the earlier writes on the original, so it must here too;
 * - governLuoyangOthers' reports always cite 洛阳 itself (`$x=265; $y=215` hard-coded,
 *   LuoyangFunc.php:665-666) and the final `$msg` is RETURNED ([msg]) rather than thrown as
 *   WorldFunc.php::governOthers does; the 洛阳 schedule update assumes the mem_city_schedule
 *   row exists (the seeded cid=215265 row, re-created by getLuoyangGovernCount);
 * - checkGovernCondition's union guard is unguarded (`$targetUnionId == $userUnionId`): two
 *   union-less players (0 == 0) reject with target_can_not_union (LuoyangFunc.php:746);
 * - getLuoyangGovernCount decides the daily reset from the snapshot taken BEFORE its
 *   insert-if-missing, so a freshly created row still goes through the reset update
 *   (LuoyangFunc.php:626-632);
 * - openUnionZhaoAn extends an existing 诏安 buffer from its OLD endtime
 *   (`endtime = endtime + 259200`), even when that buffer expired long ago;
 * - the three point rankings have no write path here (the C++ battle server fills
 *   sys_user_luoyang), so on the single-machine data they are permanently empty.
 */
@Injectable()
export class LuoyangBelongCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cityRules: CityRules,
    private readonly report: ReportService,
  ) {}

  private get db() {
    return this.scope.db;
  }

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.db)).rows;
  }

  private async one(query: RawBuilder<Row>): Promise<Row | false> {
    return (await this.rows(query))[0] ?? false;
  }

  /** utils.php::sql_fetch_one_cell: the first column, or false without a row. */
  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const row = await this.one(query);
    return row === false ? false : Object.values(row)[0];
  }

  private async check(query: RawBuilder<Row>): Promise<boolean> {
    return (await this.one(query)) !== false;
  }

  // ───────────────────────────── 归属总览 ─────────────────────────────

  /** LuoyangFunc.php:430 getLuoyangInfo: the battlefield state row of mem_luoyang_info. */
  @GlobalCommand()
  async getLuoyangInfo(): Promise<unknown> {
    // mem_luoyang_info is missing from both databases: the original sql_fetch_one dies through
    // the PearDB error path and Command.php answers the generic in-band failure text.
    return this.one(sql<Row>`select * from mem_luoyang_info limit 1`);
  }

  /** LuoyangFunc.php:417 getLuoyangEvent: the mem_luoyang_record 分配/易主 events with names. */
  @GlobalCommand()
  async getLuoyangEvent(): Promise<unknown[]> {
    // 原版无 order by；加 order by id 固定行序（MyISAM 自然序即插入序）。
    const eventInfos = await this.rows(sql<Row>`select * from mem_luoyang_record order by id`);
    const eventInfoArr: Row[] = [];
    for (const eventInfo of eventInfos) {
      eventInfo.unionName = await this.cell(
        sql<Row>`select name from sys_union where id = ${phpIntval(eventInfo.unionid)}`,
      );
      eventInfo.userName = await this.cell(
        sql<Row>`select name from sys_user where uid = ${phpIntval(eventInfo.uid)}`,
      );
      eventInfoArr.push(eventInfo);
    }
    return eventInfoArr;
  }

  /** LuoyangFunc.php:560 getLYBelongInfo: `[归属信息, 战场说明, 是否可发公告]`. */
  @GlobalCommand()
  async getLYBelongInfo(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const luoyangInfo: Row | false = await this.one(sql<Row>`select * from sys_luoyang_info`);
    if (luoyangInfo !== false) {
      luoyangInfo.userName = await this.cell(
        sql<Row>`select name from sys_user where uid = ${phpIntval(luoyangInfo.uid)}`,
      );
      luoyangInfo.unionName = await this.cell(
        sql<Row>`select name from sys_union where id = ${phpIntval(luoyangInfo.unionid)}`,
      );
    }
    const startTime = await this.assignStartTime();
    const luoyangBattle = await this.one(
      sql<Row>`select * from cfg_battle_field where id = ${LUOYANG_BATTLE_FIELD}`,
    );
    const battle = luoyangBattle === false ? {} : luoyangBattle;
    const yearSign = await this.one(
      sql<Row>`select * from log_luoyang_belong where time >= ${startTime} limit 1`,
    );
    let info: Row | false = luoyangInfo;
    if (yearSign !== false) {
      // PHP 写 false['yearCount'] 会把 false 撑成数组，这里同构。
      info = { ...(luoyangInfo === false ? {} : luoyangInfo), yearCount: yearSign.count };
    }
    let isCanSend = true;
    const sendTime = await this.cell(
      sql<Row>`select last_send_inform from sys_luoyang_info where uid = ${uid}`,
    );
    // "0" 是 PHP empty → isCanSend 恒为 false（原版即如此，见类注释）。
    if (phpEmpty(sendTime) || phpNum(sendTime) > 0) {
      isCanSend = false;
    }
    return [info, battle, isCanSend];
  }

  // ───────────────────────────── 积分榜 ─────────────────────────────

  /** LuoyangFunc.php:517 getUnionRankPoint: sys_user_luoyang 联盟总分榜（C++ 写分，单机恒空）。 */
  @GlobalCommand()
  async getUnionRankPoint(): Promise<unknown[]> {
    const unionPointRankInfos = await this.rows(sql<Row>`select unionid, sum(score) as totalScore
      from sys_user_luoyang group by unionid order by totalScore desc`);
    const arr: Row[] = [];
    let rank = 0;
    for (const unionPointRankInfo of unionPointRankInfos) {
      rank++;
      unionPointRankInfo.rank = rank;
      const unionInfo = await this.one(sql<Row>`select name,
          (select name from sys_user where uid = leader) as leaderName
        from sys_union where id = ${phpIntval(unionPointRankInfo.unionid)}`);
      // 联盟不存在时 PHP 读 false['name'] 得 null（带 notice），照抄为 null。
      unionPointRankInfo.unionName = unionInfo === false ? null : unionInfo.name;
      unionPointRankInfo.leaderName = unionInfo === false ? null : unionInfo.leaderName;
      arr.push(unionPointRankInfo);
    }
    return arr;
  }

  /** LuoyangFunc.php:532 getUserRankPoint: sys_user_luoyang 个人分榜。 */
  @GlobalCommand()
  async getUserRankPoint(): Promise<unknown[]> {
    const userPointRankInfos = await this.rows(
      sql<Row>`select * from sys_user_luoyang order by score desc`,
    );
    const arr: Row[] = [];
    let rank = 0;
    for (const userPointRankInfo of userPointRankInfos) {
      rank++;
      userPointRankInfo.rank = rank;
      userPointRankInfo.name = await this.cell(
        sql<Row>`select name from sys_user where uid = ${phpIntval(userPointRankInfo.uid)}`,
      );
      userPointRankInfo.unionName = await this.cell(
        sql<Row>`select name from sys_union where id = ${phpIntval(userPointRankInfo.unionid)}`,
      );
      arr.push(userPointRankInfo);
    }
    return arr;
  }

  /** LuoyangFunc.php:547 getUserInfoPoint: `[自己的积分, 自己参与的个人战斗事件]`. */
  @GlobalCommand()
  async getUserInfoPoint(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    let userScore = await this.cell(
      sql<Row>`select score from sys_user_luoyang where uid = ${uid}`,
    );
    const userBattleInfo = await this.rows(sql<Row>`select uid, name, cityname, touid, toname,
      score, flag from mem_luoyang_event where uid = ${uid} or touid = ${uid}`);

    if (phpEmpty(userScore)) userScore = 0;

    return [userScore, userBattleInfo];
  }

  // ───────────────────────────── 分配与公告 ─────────────────────────────

  /** LuoyangFunc.php:361 luoyangAllocate: 盟主把洛阳分配给本盟成员（加连续次数与王爵位）。 */
  @GlobalCommand()
  async luoyangAllocate(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    // 原版 addslashes 只为内联 SQL 逃生；参数绑定下绑定原始名字，与解析后的原文一致。
    const name = phpString(param.shift());

    const luoyangInfo = await this.one(sql<Row>`select * from sys_luoyang_info`);
    if (luoyangInfo === false || phpIntval(luoyangInfo.uid) < 1000) {
      throw GameError.lang('luoyang.can_not_assign');
    }

    // 洛阳城是不是在本盟手上
    if (
      !(await this.check(sql<Row>`select 1 from sys_user where uid = ${uid}
        and union_id = ${phpIntval(luoyangInfo.unionid)}`))
    ) {
      throw GameError.lang('luoyang.city_not_in_union');
    }
    // 只有盟主才能才操作
    if (
      !(await this
        .check(sql<Row>`select 1 from sys_union where id = ${phpIntval(luoyangInfo.unionid)}
        and leader = ${uid}`))
    ) {
      throw GameError.lang('luoyang.not_union_leader');
    }

    const preRecord = await this.one(
      sql<Row>`select * from log_luoyang_belong order by time desc limit 1`,
    );
    const startTime = await this.assignStartTime();
    if (!phpEmpty(preRecord)) {
      // 洛阳城是否已分配
      if (await this.check(sql<Row>`select 1 from log_luoyang_belong where time >= ${startTime}`)) {
        throw GameError.lang('luoyang.has_allocated');
      }
    }
    // 成员要存在，并且必须是本盟成员
    const memberUid = await this.cell(sql<Row>`select uid from sys_user
      where union_id = ${phpIntval(luoyangInfo.unionid)} and name = ${name}`);
    if (phpEmpty(memberUid)) {
      throw GameError.lang('luoyang.not_union_member');
    }

    // 加分配记录
    let count = 1;
    if (preRecord !== false) {
      // PHP 数组与数字比较恒为数组大，$isGap 恒 false（原版死分支，见类注释）。
      const isGap = false;
      if (
        phpIntval(preRecord.uid) === phpIntval(memberUid) &&
        phpLooseEquals(preRecord.unionid, luoyangInfo.unionid) &&
        !isGap
      ) {
        count = phpIntval(preRecord.count) + 1;
      }
    }
    await sql<Row>`insert into log_luoyang_belong (uid, unionid, time, count)
      values (${phpIntval(memberUid)}, ${phpIntval(luoyangInfo.unionid)}, unix_timestamp(), ${count})`.execute(
      this.db,
    );

    // 把洛阳分配给该成员
    await sql<Row>`update sys_luoyang_info set uid = ${phpIntval(memberUid)}, name = ${name}`.execute(
      this.db,
    );
    await sql<Row>`insert into mem_luoyang_record (time, unionid, type, uid)
      values (unix_timestamp(), ${phpIntval(luoyangInfo.unionid)}, 1, ${phpIntval(memberUid)})`.execute(
      this.db,
    );
    // 给玩家添加王爵位的 buffer
    const addLevel = await this.cell(
      sql<Row>`select (21 - nobility) as addLevel from sys_user where uid = ${phpIntval(memberUid)}`,
    );
    await sql<Row>`insert into mem_user_buffer (uid, buftype, endtime, bufparam)
      values (${phpIntval(memberUid)}, ${BUFFER_NOBILITY}, unix_timestamp() + 864000,
        ${phpIntval(addLevel)})`.execute(this.db);
    await sql<Row>`update sys_user set nobility = '21' where uid = ${phpIntval(memberUid)}`.execute(
      this.db,
    );

    return [this.lang.t('luoyang.assign_succ', name)];
  }

  /** LuoyangFunc.php:583 sendBelongInform: 归属者每天一次的全服飘公告。 */
  @GlobalCommand()
  async sendBelongInform(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    await this.checkLuoyangOwn(uid);
    const curDate = await this.cell(sql<Row>`select unix_timestamp(curdate()) as t`);
    if (
      await this.check(sql<Row>`select 1 from sys_luoyang_info
        where last_send_inform < ${phpNum(curDate)}`)
    ) {
      await sql<Row>`update sys_luoyang_info set last_send_inform = '0'`.execute(this.db);
    }
    if (await this.check(sql<Row>`select 1 from sys_luoyang_info where last_send_inform > 0`)) {
      throw GameError.lang('luoyang.has_send_inform');
    }
    const msg = this.lang.t('luoyang.inform_content');
    await sql<Row>`insert into sys_inform (type, inuse, starttime, endtime, interval,
        scrollcount, color, msg)
      values (1, 1, unix_timestamp(), unix_timestamp() + 60, 0, 2, 49151, ${msg})`.execute(this.db);
    await sql<Row>`update sys_luoyang_info set last_send_inform = unix_timestamp()`.execute(
      this.db,
    );

    return [false];
  }

  /** LuoyangFunc.php:603 openUnionZhaoAn: 归属者给全盟开 72 小时诏安 buffer。 */
  @GlobalCommand()
  async openUnionZhaoAn(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    await this.checkLuoyangOwn(uid);
    if (await this.check(sql<Row>`select 1 from sys_luoyang_info where last_use_buffer > 0`)) {
      throw GameError.lang('luoyang.has_used');
    }
    const unionid = await this.cell(sql<Row>`select union_id from sys_user where uid = ${uid}`);
    const unionUids = await this.rows(
      sql<Row>`select uid from sys_user where union_id = ${phpIntval(unionid)}`,
    );
    const buftime = 259200; // 72 小时
    for (const unionUid of unionUids) {
      const memberUid = phpIntval(unionUid.uid);
      await sql<Row>`insert into mem_user_buffer (uid, buftype, endtime)
        values (${memberUid}, ${BUFFER_ZHAOAN}, unix_timestamp() + ${buftime})
        on duplicate key update endtime = endtime + ${buftime}`.execute(this.db);
    }
    await sql<Row>`update sys_luoyang_info set last_use_buffer = unix_timestamp()`.execute(this.db);
    return [true];
  }

  // ───────────────────────────── 洛阳政令 ─────────────────────────────

  /** LuoyangFunc.php:622 getLuoyangGovernCount: 洛阳当日已下达的政令数（跨日清零）。 */
  @GlobalCommand()
  async getLuoyangGovernCount(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    await this.checkLuoyangOwn(uid);
    const curDate = await this.cell(sql<Row>`select unix_timestamp(curdate()) as t`);
    const lastGovernInfo = await this.one(
      sql<Row>`select * from mem_city_schedule where cid = ${LUOYANG_CID}`,
    );
    if (phpEmpty(lastGovernInfo)) {
      await sql<Row>`insert into mem_city_schedule (cid, last_govern_time)
        values (${LUOYANG_CID}, '0')`.execute(this.db);
    }
    // 快照取自 insert 之前：刚补建的行也照走清零分支（原版顺序，见类注释）。
    if (
      phpIntval(lastGovernInfo === false ? null : lastGovernInfo.last_govern_time) <
      phpIntval(curDate)
    ) {
      await sql<Row>`update mem_city_schedule set last_govern_time = '0', govern_count = '0'
        where cid = ${LUOYANG_CID}`.execute(this.db);
    }

    const hasGovernCount = await this.cell(
      sql<Row>`select govern_count from mem_city_schedule where cid = ${LUOYANG_CID}`,
    );
    return [hasGovernCount];
  }

  /** LuoyangFunc.php:650 governLuoyangOthers: 洛阳归属者对任意城下达政令（0 收税 1 抽丁
   * 2 征粮 3 收编 4 裁军），成功文案按原版 RETURN（[msg]），不抛异常。 */
  @GlobalCommand()
  async governLuoyangOthers(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const type = phpIntval(param.shift());
    const xCoord = phpIntval(param.shift());
    const yCoord = phpIntval(param.shift());
    if (xCoord < 0 || yCoord < 0 || xCoord > 500 || yCoord > 500) {
      throw GameError.lang('luoyang.govern_coord_error');
    }

    await this.checkLuoyangOwn(uid);
    const targetCid = yCoord * 1000 + xCoord;
    const userCid = await this.cell(sql<Row>`select lastcid from sys_user where uid = ${uid}`);
    await this.checkGovernCondition(uid, targetCid);

    const cityname = await this.cell(
      sql<Row>`select name from sys_city where cid = ${LUOYANG_CID}`,
    );
    let msg = '';
    const x = LUOYANG_X;
    const y = LUOYANG_Y;
    const tuid = await this.cell(sql<Row>`select uid from sys_city where cid = ${targetCid}`);
    if (type === 0) {
      // 征税
      const totalCount = await this.cell(
        sql<Row>`select gold from mem_city_resource where cid = ${targetCid}`,
      );
      const addCount = Math.floor(phpNum(totalCount) * 0.2);

      await this.cityRules.addCityResources(targetCid, 0, 0, 0, 0, -addCount);
      await this.cityRules.addCityResources(phpIntval(userCid), 0, 0, 0, 0, addCount);

      const reportTxt = this.lang.t(
        'governOthers.gold_report',
        phpString(cityname),
        x,
        y,
        addCount,
      );
      await this.report.sendReport(phpIntval(tuid), 26, phpIntval(userCid), targetCid, reportTxt);
      msg = this.lang.t('governOthers.gold_suc', addCount);
    } else if (type === 1) {
      // 抽丁
      const totalCount = await this.cell(
        sql<Row>`select people from mem_city_resource where cid = ${targetCid}`,
      );
      const addCount = Math.floor(phpNum(totalCount) * 0.3);

      await this.cityRules.addCityPeople(targetCid, -addCount);
      await this.cityRules.addCityPeople(phpIntval(userCid), addCount);

      const reportTxt = this.lang.t(
        'governOthers.people_report',
        phpString(cityname),
        x,
        y,
        addCount,
      );
      await this.report.sendReport(phpIntval(tuid), 28, phpIntval(userCid), targetCid, reportTxt);
      msg = this.lang.t('governOthers.people_suc', addCount);
    } else if (type === 2) {
      // 征粮
      const totalCount = await this.cell(
        sql<Row>`select food from mem_city_resource where cid = ${targetCid}`,
      );
      const addCount = Math.floor(phpNum(totalCount) * 0.5);

      await this.cityRules.addCityResources(targetCid, 0, 0, 0, -addCount, 0);
      await this.cityRules.addCityResources(phpIntval(userCid), 0, 0, 0, addCount, 0);

      const reportTxt = this.lang.t(
        'governOthers.food_report',
        phpString(cityname),
        x,
        y,
        addCount,
      );
      await this.report.sendReport(phpIntval(tuid), 42, phpIntval(userCid), targetCid, reportTxt);
      msg = this.lang.t('governOthers.food_suc', addCount);
    } else if (type === 3) {
      // 收编
      const row = await this.one(sql<Row>`select a.sid, a.count from sys_city_soldier a,
        cfg_soldier b where cid = ${targetCid} and a.sid = b.sid and b.fromcity = 1
        order by count desc limit 1`);
      let sid = 1;
      let totalCount = 0;
      if (row) {
        sid = phpIntval(row.sid);
        totalCount = phpNum(row.count);
      }
      const sname = phpString(
        await this.cell(sql<Row>`select name from cfg_soldier where sid = ${sid}`),
      );
      const addCount = Math.floor(totalCount * 0.05);
      await this.cityRules.addCitySoldier(targetCid, sid, -addCount);
      const reportTxt = this.lang.t(
        'governOthers.incorporation_report',
        phpString(cityname),
        x,
        y,
        sname,
        addCount,
      );
      await this.report.sendReport(phpIntval(tuid), 43, phpIntval(userCid), targetCid, reportTxt);

      const meaddcount = Math.floor(addCount / 2);
      await this.cityRules.addCitySoldier(phpIntval(userCid), sid, meaddcount);
      msg = this.lang.t('governOthers.incorporation_suc', sname, meaddcount);
    } else if (type === 4) {
      // 裁军
      const row = await this.one(sql<Row>`select sid, count from sys_city_soldier
        where cid = ${targetCid} order by count desc limit 1`);
      let sid = 1;
      let totalCount = 0;
      if (row) {
        sid = phpIntval(row.sid);
        totalCount = phpNum(row.count);
      }
      const sname = phpString(
        await this.cell(sql<Row>`select name from cfg_soldier where sid = ${sid}`),
      );
      const addCount = Math.floor(totalCount * 0.1);
      await this.cityRules.addCitySoldier(targetCid, sid, -addCount);
      const reportTxt = this.lang.t(
        'governOthers.disarmament_report',
        phpString(cityname),
        x,
        y,
        sname,
        addCount,
      );
      await this.report.sendReport(phpIntval(tuid), 44, phpIntval(userCid), targetCid, reportTxt);
      msg = this.lang.t('governOthers.disarmament_suc', sname, addCount);
    }
    await sql<Row>`update mem_city_schedule set govern_count = govern_count + 1,
      last_govern_time = unix_timestamp() where cid = ${LUOYANG_CID}`.execute(this.db);
    await sql<Row>`update mem_city_schedule set last_be_govern_time = unix_timestamp()
      where cid = ${targetCid}`.execute(this.db);
    return [msg];
  }

  // ───────────────────────────── 备战洛阳（联盟史诗） ─────────────────────────────

  /** RankFunc.php:488 getBeiZhanLuoYangProgress: 本联盟的备战洛阳任务进度（4 条，含剩余）。 */
  @GlobalCommand()
  async getBeiZhanLuoYangProgress(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const type = phpIntval(param.shift());
    const unionid = await this.cell(sql<Row>`select union_id from sys_user where uid = ${uid}`);
    if (type === 0 && phpNum(unionid) > 0) {
      await this.initCurUnionBeiZhanLuoYangProgress(uid);
      return this.rows(sql<Row>`select tid, name, maxvalue, curvalue,
        maxvalue - curvalue as remainvalue from luoyang_progress where union_id = ${phpNum(unionid)}
        order by tid`);
    }
    throw GameError.lang('rankfunc.uniontask');
  }

  /** RankFunc.php:501 initCurUnionBeiZhanLuoYangProgress: 补齐本盟 112001-112004 的进度行
   * （已存在的行 curvalue 原样保留）。 */
  private async initCurUnionBeiZhanLuoYangProgress(uid: number): Promise<void> {
    const unionid = phpNum(
      await this.cell(sql<Row>`select union_id from sys_user where uid = ${uid}`),
    );
    for (const tid of UNION_TASK_TIDS) {
      const task = await this.one(sql<Row>`select * from cfg_task where id = ${tid} limit 1`);
      const taskMax = await this.cell(
        sql<Row>`select count from cfg_task_goal where sort = ${UNION_TASK_GOAL_SORT}
          and type = ${tid}`,
      );
      // 原版把 false 插成 ''，MySQL 非严格模式归零；这里直接取数值 0。
      await sql<Row>`insert into luoyang_progress (union_id, tid, maxvalue, curvalue, \`group\`, name)
        values (${unionid}, ${tid}, ${phpNum(taskMax)}, 0, ${phpIntval(task === false ? null : task.group)},
          ${phpString(task === false ? null : task.name)})
        on duplicate key update curvalue = curvalue`.execute(this.db);
    }
  }

  // ───────────────────────────── 共享校验 ─────────────────────────────

  /** LuoyangFunc.php:639 checkLuoyangOwn: 本周分到洛阳的记录 + sys_luoyang_info 的现任 uid。 */
  private async checkLuoyangOwn(uid: number): Promise<void> {
    const startTime = await this.assignStartTime();
    if (
      !(await this.check(sql<Row>`select 1 from log_luoyang_belong
        where uid = ${uid} and time >= ${startTime}`))
    ) {
      throw GameError.lang('luoyang.can_not_send');
    }
    const luoyangInfo = await this.one(sql<Row>`select * from sys_luoyang_info`);
    // 行缺失时 PHP intval(null)=0 != uid，同样拒绝。
    if (luoyangInfo === false || phpIntval(luoyangInfo.uid) !== uid) {
      throw GameError.lang('luoyang.can_not_send');
    }
  }

  /** LuoyangFunc.php:737 checkGovernCondition: 洛阳政令的目标校验（与 governOthers 的 checks
   * 同源但独立：管辖范围改为十三州、每日上限固定 10 次且挂在洛阳城的 schedule 行上）。 */
  private async checkGovernCondition(uid: number, tCid: number): Promise<void> {
    const targetCity = await this.one(sql<Row>`select uid, type, province from sys_city
      where cid = ${tCid}`);
    if (!targetCity) throw GameError.lang('luoyang.target_is_not_city');
    if (uid === phpIntval(targetCity.uid)) throw GameError.lang('luoyang.target_can_not_user');
    if (phpIntval(targetCity.province) < 1 || phpIntval(targetCity.province) > 13) {
      throw GameError.lang('luoyang.over_govern_range');
    }

    const targetUnionId = await this.cell(
      sql<Row>`select union_id from sys_user where uid = ${phpIntval(targetCity.uid)}`,
    );
    const userUnionId = await this.cell(sql<Row>`select union_id from sys_user where uid = ${uid}`);
    // 无守卫比较：双方都无联盟（0 == 0）同样拒绝，照抄。
    if (phpLooseEquals(targetUnionId, userUnionId)) {
      throw GameError.lang('luoyang.target_can_not_union');
    }

    if (
      await this.check(sql<Row>`select 1 from mem_city_schedule where cid = ${LUOYANG_CID}
        and govern_count >= 10`)
    ) {
      throw GameError.lang('luoyang.target_over_max');
    }

    const lastBeGovernInfo = await this.one(
      sql<Row>`select * from mem_city_schedule where cid = ${tCid}`,
    );
    let lastBeGovernTime: unknown;
    if (!lastBeGovernInfo) {
      await sql<Row>`insert into mem_city_schedule (cid, last_be_govern_time)
        values (${tCid}, '0')`.execute(this.db);
      lastBeGovernTime = 0;
    } else {
      lastBeGovernTime = lastBeGovernInfo.last_be_govern_time;
    }
    const curDate = await this.cell(sql<Row>`select unix_timestamp(curdate()) as t`);
    if (phpIntval(lastBeGovernTime) >= phpIntval(curDate)) {
      throw GameError.lang('governOthers.target_has_been_govern');
    }

    let targetCityType = phpIntval(targetCity.type);
    if (targetCityType === 5) targetCityType = 0;
    if (targetCityType === 0) {
      const myuserstate = await this.one(sql<Row>`select forbiend, vacend,
        unix_timestamp() as nowtime from sys_user_state where uid = ${phpIntval(targetCity.uid)}
        and (forbiend > unix_timestamp() or vacend > unix_timestamp())`);
      if (myuserstate !== false) {
        if (phpNum(myuserstate.forbiend) > phpNum(myuserstate.nowtime)) {
          // 封禁
          throw GameError.lang('governOthers.target_not_in_war');
        } else if (phpNum(myuserstate.vacend) > phpNum(myuserstate.nowtime)) {
          // 休假
          throw GameError.lang('governOthers.target_not_in_war');
        }
      }
    }
  }

  /** utils.php::getAssingStartTime: 本周分配窗口起点（周三 23:00；周三当日 23:00 前仍算上周）。
   * 与 world.commands.ts 的 log_luoyang_belong 周界同一条规则；date('N') 走 php-time 的
   * Asia/Shanghai 语义。 */
  private async assignStartTime(): Promise<number> {
    const now = phpIntval(await this.cell(sql<Row>`select unix_timestamp() as t`));
    const cur23Hour =
      phpIntval(await this.cell(sql<Row>`select unix_timestamp(curdate()) as t`)) + 82800;
    const curday = phpIntval(phpDate('N', now));
    if (curday < 3) return cur23Hour - (curday + 4) * 86400;
    if (curday > 3) return cur23Hour - (curday - 3) * 86400;
    return now >= cur23Hour ? cur23Hour : cur23Hour - (curday + 4) * 86400;
  }
}
