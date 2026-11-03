import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { firstGetUserBattleInfo, type BattlefieldDeps } from '../battle/battlefield-troop-support';
import { GoodsRules } from '../core/goods-rules.service';
import { UserRules } from '../core/user-rules.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum } from '../core/php';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** utils.php `if($x)` on a command argument or row cell (0 / "0" / "" / null / false are falsy). */
const truthy = (v: unknown): boolean => !phpEmpty(v);

/** cfg_battle_field id of 赤壁, whose name getUserBattleInfo reports for an active chibi state. */
const CHIBI_FIELD_ID = 11000;
/** GoodsFunc.php::useQingZhanShuDirect — 请战书 gid, consumed by resetTodayWarCount. */
const QINGZHANSHU_GID = 138;
/** sys_user_battle_field.bid of 官渡之战 (2001) / 凤仪亭 (7001) — the winpoint-reporting fields. */
const WINPOINT_BIDS = [2001, 7001];

/**
 * BattleFunc.php battlefield hall (stage 9 / S1, 评审 §4 S1): the 15 read-mostly openfunc
 * commands the client fires from the 战况 entry and at login — refreshUserBattleState,
 * getUserBattleInfo, getBattleInfo, getChibiInfo, getUserBattleState, getChibiGongXun,
 * getMedalExchangeInfo, resetTodayWarCount, getPVPBattleInfo, getBattleNews, getBattleInfor,
 * getBattleActiveState, getBattleTime, getBattleNetUrl and utils.php's getChibiState4User.
 * Every one is a line-for-line port of its PHP function over Kysely `sql` templates with bound
 * parameters; PHP semantics (empty(), loose compares, `0 == ""`, string cells) come from
 * core/php.ts.
 *
 * Shared gates (`firstGetUserBattleInfo` / `ifFrozeExit`) are the exported helpers of the
 * sibling troop-support slice (battle/battlefield-troop-support.ts), not re-ported here.
 * `setFlags` / `getBattleStartCityInfo` / `getUserPVENetLevel` live here as private methods —
 * later slices (S4 战场内指令) should reuse them from this module rather than re-port.
 *
 * Out of scope, same verdict as every battlefield slice: the cross-server readers
 * (`sendRemoteRequest` / `sendChibiRemoteRequest`) — BATTLE_NET_ENABLE / CHIBI_NET_ENABLE are
 * false in the standalone package (config/db1.php), so those branches never run; the port keeps
 * only the disabled-branch shapes.
 */
@Injectable()
export class BattlefieldCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly users: UserRules,
  ) {}

  private get db() {
    return this.scope.db;
  }

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.db)).rows;
  }

  /** `sql_fetch_one`: the first row, or `false` when the query returned nothing. */
  private async one(query: RawBuilder<Row>): Promise<Row | false> {
    return (await this.rows(query))[0] ?? false;
  }

  /** `sql_fetch_one_cell`: the first column of the first row, or `false` without rows. */
  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const row = (await this.rows(query))[0];
    return row === undefined ? false : Object.values(row)[0];
  }

  /** The deps object the shared troop-support helpers take. */
  private deps(): BattlefieldDeps {
    return {
      db: this.db,
      query: async (q) => this.rows(q),
      one: async (q) => this.one(q),
      cell: async (q) => this.cell(q),
      lang: (key) => this.lang.t(key),
    };
  }

  // ─────────────────────────── refreshUserBattleState ───────────────────────────

  /**
   * BattleFunc.php::refreshUserBattleState — the whole battlefield snapshot for polling. Any
   * failure (not in battle / frozen / dangling rows) collapses to `[0]` exactly as the PHP
   * try/catch did, so the client reads it as "not in battle".
   */
  @GlobalCommand()
  async refreshUserBattleState(ctx: CommandContext): Promise<unknown[]> {
    try {
      const currentbattle = (await firstGetUserBattleInfo(this.deps(), ctx.uid)) as Row;
      const ret: unknown[] = [1, currentbattle];
      const cityinfo = await this.rows(
        sql<Row>`select * from sys_battle_city where battlefieldid = ${currentbattle.battlefieldid}`,
      );
      ret.push(await this.setFlags(currentbattle.unionid, cityinfo));
      ret.push(
        await this.rows(sql<Row>`select t.state, t.targetcid, t.soldiers, t.cid, t.id, t.ulimit,
            h.face, h.sex, h.name as heroname, h.level, h.hid, h.herotype
          from sys_troops t left join sys_city_hero h on t.hid = h.hid
          where t.uid = ${ctx.uid} and t.battlefieldid = ${currentbattle.battlefieldid}
          order by t.id asc`),
      );
      ret.push(await this.getBattleStartCityInfo(currentbattle.bid, currentbattle.unionid));
      if (WINPOINT_BIDS.some((b) => phpLooseEquals(currentbattle.bid, b))) {
        // 官渡之战：军粮点进度。
        ret.push(
          await this.rows(
            sql<Row>`select * from sys_battle_winpoint where battlefieldid = ${currentbattle.battlefieldid}`,
          ),
        );
      }
      return ret;
    } catch {
      return [0];
    }
  }

  // ─────────────────────────── getUserBattleInfo ───────────────────────────

  /**
   * BattleFunc.php::getUserBattleInfo — the login-time `[battleState, chibiState]` pair. The
   * battle half is `[0, 0, -1]` (unknown battlenet) unless the user sits in a field, then
   * `[1, in_cross_battle, bid, name]` plus the 1800s gate for 逐鹿中原; the chibi half is `[0]`
   * or `[1, name]` with the field name of 赤壁.
   */
  @GlobalCommand()
  async getUserBattleInfo(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const now = await this.cell(sql<Row>`select unix_timestamp()`);
    const currentbattle = await this.one(sql<Row>`select in_cross_battle, bid, name,
        unix_timestamp(jointime) as starttime
      from sys_user_battle_state a, cfg_battle_field b where a.bid = b.id and uid = ${uid}`);
    const info1: unknown[] = [];
    if (phpEmpty(currentbattle)) {
      // BATTLE_NET_ENABLE=false：不询问跨服等待态，直接回未知的 battlenet 类型。
      info1.push(0, 0, -1);
    } else {
      const battle = currentbattle as Row;
      info1.push(1);
      info1.push(phpLooseEquals(battle.in_cross_battle, 1) ? 1 : 0);
      info1.push(battle.bid);
      info1.push(battle.name);
      if (phpLooseEquals(battle.bid, 6001)) {
        // 逐鹿中原：不从远程取，超过 30 分钟即可开战。
        info1.push(phpNum(now) - phpIntval(battle.starttime) > 1800 ? 1 : 0);
      }
    }

    const currentchibi = await this.one(
      sql<Row>`select * from sys_user_chibi_state where uid = ${uid}`,
    );
    const info2: unknown[] = [];
    if (phpEmpty(currentchibi)) {
      // CHIBI_NET_ENABLE=false：赤壁等待态同样不询问。注意原版在 CHIBI_NET_ENABLE 分支之外还
      // 无条件补了第二个 0（BattleFunc.php getUserBattleInfo 的空态 pushes 两个 0）。
      info2.push(0);
      info2.push(0);
    } else {
      info2.push(1);
      info2.push(
        await this.cell(sql<Row>`select name from cfg_battle_field where id = ${CHIBI_FIELD_ID}`),
      );
    }
    return [info1, info2];
  }

  // ─────────────────────────── getBattleInfo / getChibiInfo ───────────────────────────

  /**
   * BattleFunc.php::getBattleInfo — the hall's battlefield list: `[version, 0, cfgbattles, 0, 0,
   * todayWarCount, 5]`. The in-battle tail of the PHP (a `return $ret` inside the commented-out
   * else) is dead code upstream and stays out here. Clears the 战况 alarm first.
   */
  @GlobalCommand()
  async getBattleInfo(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    await sql`update sys_alarm set battle = 0 where uid = ${uid}`.execute(this.db);
    await this.requireHallNobility(uid);
    await firstGetUserBattleInfo(this.deps(), uid, 0);
    return this.hallReply(uid, 0);
  }

  /**
   * BattleFunc.php::getChibiInfo — the same hall list, entered from the 赤壁 entry: the second
   * element mirrors `$enterChibi` instead of the fixed 0.
   */
  @GlobalCommand()
  async getChibiInfo(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const enterChibi = param[0];
    await sql`update sys_alarm set battle = 0 where uid = ${uid}`.execute(this.db);
    await this.requireHallNobility(uid);
    await firstGetUserBattleInfo(this.deps(), uid, 0);
    return this.hallReply(uid, truthy(enterChibi) ? 1 : 0);
  }

  /** utils.php::getBufferNobility raised nobility; below 公士 the hall stays closed. */
  private async requireHallNobility(uid: number): Promise<void> {
    const nobility = await this.users.bufferNobility(
      uid,
      phpIntval(await this.cell(sql<Row>`select nobility from sys_user where uid = ${uid}`)),
    );
    if (nobility < 1) throw GameError.lang('battle.nobility_not_rearch');
  }

  /**
   * The `[version, flag, cfgbattles, 0, 0, todayWarCount, 5]` tail shared by the three hall
   * readers. PHP seeds `$ret[2][]` inside the loop, so an empty cfg_battle_field leaves index 2
   * unset and the following zeros shift down — reproduced with the guarded index write.
   */
  private async hallReply(uid: number, flag: number): Promise<unknown[]> {
    const ret: unknown[] = [];
    ret.push(await this.cell(sql<Row>`select value from mem_state where state = 30`));
    ret.push(flag);
    const cfgbattles = await this.hallBattleList();
    if (cfgbattles.length > 0) ret[2] = cfgbattles;
    ret.push(0);
    ret.push(0);
    const todayWarCount = await this.cell(
      sql<Row>`select today_war_count from mem_user_schedule where uid = ${uid}`,
    );
    ret.push(phpEmpty(todayWarCount) ? 0 : todayWarCount);
    ret.push(5);
    return ret;
  }

  /**
   * BattleFunc.php:222-267 — the decorated `cfg_battle_field` rows (`type in (0,1,3,4,10)`):
   * `hasBattleAct` from the running 倍率活动 (whole-server state 1, per-bid state 2), and for
   * 普通战场 (type 0) `canCreate` from the free instance slots.
   */
  private async hallBattleList(): Promise<Row[]> {
    const cfgbattles = await this.rows(
      sql<Row>`select * from cfg_battle_field where state != 0 and type in (0, 1, 3, 4, 10)`,
    );
    const nowtimestamp = await this.cell(sql<Row>`select unix_timestamp()`);
    const act = await this.one(sql<Row>`select * from cfg_act_battle where state > 0 and
      (((weekday(from_unixtime(${nowtimestamp})) + 1) = actid and
        hour(from_unixtime(${nowtimestamp})) between starthour and endhour - 1) or
       (date > 0 and ${nowtimestamp} between date + starthour * 3600 and date + endhour * 3600))
      limit 1`);
    const list: Row[] = [];
    for (const cfgbattle of cfgbattles) {
      let baseRate: unknown = 1;
      if (!phpEmpty(act)) {
        const row = act as Row;
        if (phpLooseEquals(row.state, 1)) {
          baseRate = row.rate;
        } else if (
          phpLooseEquals(row.state, 2) &&
          !phpEmpty(
            await this.cell(sql<Row>`select count(*) from cfg_act_battle_details
              where actid = ${row.actid} and bid = ${cfgbattle.id}`),
          )
        ) {
          baseRate = row.rate;
        }
      }
      const out: Row = { ...cfgbattle, hasBattleAct: !phpLooseEquals(baseRate, 1) };
      if (phpLooseEquals(cfgbattle.type, 0)) {
        const battlecount = await this.cell(sql<Row>`select count(*) from sys_user_battle_field
          where bid = ${cfgbattle.id} and state = 0`);
        out.canCreate = phpNum(battlecount) < phpNum(cfgbattle.maxcount);
      }
      list.push(out);
    }
    return list;
  }

  // ─────────────────────────── getUserBattleState ───────────────────────────

  /**
   * BattleFunc.php::getUserBattleState — the full 战况 entry: the hall list when not in a
   * battlefield (with the cross-server waiting bid appended), the whole field snapshot when in
   * one. The PHP fetches mem_state, resets `$ret`, then fetches it again — kept as-is.
   */
  @GlobalCommand()
  async getUserBattleState(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const version = () => this.cell(sql<Row>`select value from mem_state where state = 30`);
    await version();
    await sql`update sys_alarm set battle = 0 where uid = ${uid}`.execute(this.db);
    await this.requireHallNobility(uid);
    const currentbattle = (await firstGetUserBattleInfo(this.deps(), uid, 0)) as Row | false;

    const ret: unknown[] = [];
    ret.push(await version());

    let waitingBid: unknown;
    if (phpEmpty(currentbattle)) {
      waitingBid = await this.cell(
        sql<Row>`select bid from sys_battlenet_waiting_queue where uid = ${uid}`,
      );
      ret.push(phpNum(waitingBid) > 0 ? 2 : 0);
      const cfgbattles = await this.hallBattleList();
      if (cfgbattles.length > 0) ret[2] = cfgbattles;
      ret.push(0);
      ret.push(0);
      const todayWarCount = await this.cell(
        sql<Row>`select today_war_count from mem_user_schedule where uid = ${uid}`,
      );
      ret.push(phpEmpty(todayWarCount) ? 0 : todayWarCount);
      ret.push(5);
      ret.push(await this.getUserPVENetLevel(uid));
      ret.push(waitingBid);
      return ret;
    }

    const battle = currentbattle as Row;
    ret.push(1);
    if (phpLooseEquals(battle.in_cross_battle, 1)) {
      ret.push(1);
      ret.push(
        await this.cell(sql<Row>`select bid from sys_user_battle_state where uid = ${uid} limit 1`),
      );
      return ret;
    }
    ret.push(0);
    ret.push(battle);
    const cityinfo = await this.rows(
      sql<Row>`select * from sys_battle_city where battlefieldid = ${battle.battlefieldid}`,
    );
    ret.push(await this.setFlags(battle.unionid, cityinfo));
    ret.push(
      await this.rows(sql<Row>`select t.state, t.targetcid, t.soldiers, t.cid, t.id,
          h.face, h.sex, h.name as heroname, h.level, h.hid, h.herotype
        from sys_troops t left join sys_city_hero h on t.hid = h.hid
        where t.uid = ${uid} and t.battlefieldid = ${battle.battlefieldid}
        order by t.id asc`),
    );
    ret.push(await this.getBattleStartCityInfo(battle.bid, battle.unionid));
    if (WINPOINT_BIDS.some((b) => phpLooseEquals(battle.bid, b))) {
      ret.push(
        await this.rows(
          sql<Row>`select * from sys_battle_winpoint where battlefieldid = ${battle.battlefieldid}`,
        ),
      );
    }
    ret.push(await this.getUserPVENetLevel(uid));
    return ret;
  }

  // ─────────────────────────── 赤壁 readers ───────────────────────────

  /**
   * BattleFunc.php::getChibiGongXun — the 赤壁 功勋, always a remote call. With
   * CHIBI_NET_ENABLE=false the request throws an empty Exception and the catch lands on 0, so
   * the command answers `[0]` here.
   */
  @GlobalCommand()
  async getChibiGongXun(ctx: CommandContext): Promise<unknown[]> {
    let gongxun: unknown;
    try {
      gongxun = await this.sendChibiRemoteRequest(ctx.uid, 'getGongXun');
    } catch {
      gongxun = 0;
    }
    if (phpLooseEquals(gongxun, -1)) gongxun = 0;
    return [gongxun];
  }

  /** ChibiNetFunc.php::sendChibiRemoteRequest — the disabled branch throws an empty Exception. */
  private async sendChibiRemoteRequest(_uid: number, _commandFunc: string): Promise<never> {
    throw new Error('chibi battle net disabled (CHIBI_NET_ENABLE=false)');
  }

  /**
   * utils.php::getChibiState4User — the 赤壁 gate: real nobility (推恩令 deliberately NOT
   * applied, the PHP line is commented out) must reach 大夫, and the 史诗 progress (mem_state 5)
   * must be done. Answers `[nobility, 1, enterChibi]`.
   */
  @GlobalCommand()
  async getChibiState4User(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const enterChibi = param[0];
    const nobility = phpIntval(
      await this.cell(sql<Row>`select nobility from sys_user where uid = ${uid}`),
    );
    if (nobility < 5) throw GameError.lang('battle.nobility_not_rearch_dafu');
    const ret: unknown[] = [nobility];
    const shishiDone = await this.rows(
      sql<Row>`select 1 from mem_state where state = 5 and value = 1`,
    );
    if (shishiDone.length < 1) throw GameError.lang('battle.not_complete_shishi');
    ret.push(1);
    ret.push(truthy(enterChibi) ? 1 : 0);
    return ret;
  }

  // ─────────────────────────── 勋章与参战次数 ───────────────────────────

  /**
   * BattleFunc.php::getMedalExchangeInfo — the medal exchange rates the 勋章 dialog shows:
   * `[name, tid, rate, count]` per medal tid 30001-30004 whose battlefield is not 剧情型 (type 3).
   * Rate matches medalChange: 12 for 30003, 20 for type-0 battlefields, else 10.
   */
  @GlobalCommand()
  async getMedalExchangeInfo(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const xunZhangInfos = await this.rows(sql<Row>`select T.tid, T.name, T.type,
        ifnull(sys_things.count, 0) as \`count\`
      from (select a.tid, a.name, b.type from cfg_things a, cfg_battle_field b
          where a.tid > 30000 and a.tid < 30500 and a.battlebelong != 0 and a.battleBelong = b.id
            and b.type != 3) T
      left join sys_things on sys_things.uid = ${uid} and T.tid = sys_things.tid`);
    const ret: unknown[] = [];
    for (const xunZhang of xunZhangInfos) {
      ret.push([
        xunZhang.name,
        xunZhang.tid,
        phpLooseEquals(xunZhang.tid, 30003) ? 12 : phpLooseEquals(xunZhang.type, 0) ? 20 : 10,
        xunZhang['count'],
      ]);
    }
    return ret;
  }

  /**
   * BattleFunc.php::resetTodayWarCount → GoodsFunc.php::useQingZhanShuDirect(uid, 138) — burn a
   * 请战书 to zero the 剧情战场参战次数. The PHP's `qingzhan_fail` branch is unreachable (an
   * sql_query failure is a PearDB die), so the port just runs the two writes.
   */
  @GlobalCommand()
  async resetTodayWarCount(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    let todayWarCount = await this.cell(
      sql<Row>`select today_war_count from mem_user_schedule where uid = ${uid}`,
    );
    if (phpEmpty(todayWarCount)) todayWarCount = 0;
    if (phpLooseEquals(todayWarCount, 0)) {
      throw GameError.lang('useGoods.today_war_count_zero');
    }
    if (!(await this.goods.checkGoods(uid, QINGZHANSHU_GID))) {
      throw GameError.raw('not_enough_goods138');
    }
    await sql`update mem_user_schedule set today_war_count = 0 where uid = ${uid}`.execute(this.db);
    await this.goods.reduceGoods(uid, QINGZHANSHU_GID, 1);
    // [gid, 0=弹出信息框, 成功文案] — the useGoods reply shape.
    return [QINGZHANSHU_GID, 0, this.lang.t('useGoods.qingzhan_suc')];
  }

  // ─────────────────────────── 战场列表 / 详情 ───────────────────────────

  /**
   * BattleFunc.php::getPVPBattleInfo — the join dialog's per-level instance list for `bid` (one
   * row per level, the lowest id of that level, with the joined-people count), then the camp
   * choices that only exist for 2001 / 4001 / 6001 / 7001 (other bids answer without a second
   * element, as the PHP if/else-if chain falling through did).
   */
  @GlobalCommand()
  async getPVPBattleInfo(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const bid = phpIntval(param[0]);
    // $GLOBALS['battle']['open_level'] — [1, 5, 10, 12] in lang.php.
    const openLevel = this.lang.value<Record<string, unknown>>('battle')?.['open_level'];
    const openLevels = (Array.isArray(openLevel) ? openLevel : []).map((v) => phpIntval(v));
    const allbattles = await this.rows(sql<Row>`select u.id, u.bid, c.name, u.level, u.maxpeople,
        u.minpeople, u.state
      from sys_user_battle_field u left join cfg_battle_field c on u.bid = c.id
      where u.bid = ${bid} and u.level in (${sql.join(
        openLevels.map((l) => sql`${l}`),
        sql`, `,
      )}) order by u.level desc, u.id`);
    const battles: Row[] = [];
    for (const battle of allbattles) {
      if (battles.some((item) => phpLooseEquals(item.level, battle.level))) continue;
      battles.push({
        ...battle,
        people: await this.cell(sql<Row>`select count(*) from sys_user_battle_state
          where state = 0 and battlefieldid = ${battle.id}`),
      });
    }
    const ret: unknown[] = [battles];
    if (bid === 2001) {
      ret.push(
        await this.rows(sql<Row>`select unionid, name from cfg_battle_union where bid = ${bid}`),
      );
    } else if (bid === 4001) {
      // 讨伐董卓只能加入汉室。
      ret.push(
        await this.rows(
          sql<Row>`select unionid, name from cfg_battle_union where bid = ${bid} and unionid = 7`,
        ),
      );
    } else if (bid === 6001) {
      // 逐鹿中原：unionid 即 uid（跨服，本仓库配置无此战场）。
      ret.push(
        await this.rows(sql<Row>`select 25 as unionid, name from sys_user where uid = ${uid}`),
      );
    } else if (bid === 7001) {
      ret.push(
        await this.rows(
          sql<Row>`select unionid, name from cfg_battle_union where bid = ${bid} and unionid in (26, 28)`,
        ),
      );
    }
    return ret;
  }

  /**
   * BattleFunc.php::getBattleNews — the 战报 pager: `[total, pageRows]` over log_battle_news,
   * newest first. `unionid` is shifted but unused, as upstream.
   */
  @GlobalCommand()
  async getBattleNews(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const battleid = phpIntval(param[0]);
    const page = phpIntval(param[2]);
    const pageCount = phpIntval(param[3]);
    const start = page * pageCount;
    return [
      await this.cell(sql<Row>`select count(*) from log_battle_news where battleid = ${battleid}`),
      await this.rows(sql<Row>`select * from log_battle_news where battleid = ${battleid}
        order by log_time desc limit ${start}, ${pageCount}`),
    ];
  }

  /**
   * BattleFunc.php::getBattleInfor — the join dialog's detail lines:
   * `[name, minpeople, maxpeople, level, content, total, winCondition, loseCondition]`.
   */
  @GlobalCommand()
  async getBattleInfor(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const bid = phpIntval(param[0]);
    const battleid = phpIntval(param[1]);
    const info1 = await this.one(sql<Row>`select name, minpeople, maxpeople, maxlevel, content,
      winCondition, loseCondition from cfg_battle_field where id = ${bid}`);
    if (phpEmpty(info1)) throw GameError.lang('battle.no_battle_infor');
    const info2 = await this.one(sql<Row>`select count(*) as total from sys_user_battle_state
      where state = 0 and battlefieldid = ${battleid}`);
    if (phpEmpty(info2)) throw GameError.lang('battle.no_battle_infor');
    const info3 = await this.one(sql<Row>`select * from sys_user_battle_field
      where state = 0 and id = ${battleid}`);
    if (phpEmpty(info3)) throw GameError.lang('battle.no_battle_infor');
    const cfg = info1 as Row;
    const total = info2 as Row;
    const field = info3 as Row;
    return [
      cfg.name,
      cfg.minpeople,
      cfg.maxpeople,
      field.level,
      cfg.content,
      total.total,
      cfg.winCondition,
      cfg.loseCondition,
    ];
  }

  /**
   * BattleFunc.php::getBattleActiveState — the 战场总览: open fields with their blurb, closed
   * ones with their unlock condition, and the fields whose condition is still running.
   */
  @GlobalCommand()
  async getBattleActiveState(): Promise<unknown[]> {
    const battleOpen = await this.rows(
      sql<Row>`select id, name, content from cfg_battle_field where state != 0`,
    );
    const battleClose = await this.rows(
      sql<Row>`select id, name, openCondition from cfg_battle_field where state = 0`,
    );
    const unknowStateBattle = await this.rows(sql<Row>`select distinct(a.battleId) as id
      from sys_battle_open_condition a, cfg_battle_field b
      where b.state = 0 and a.dependBattleId = b.id`);
    return [battleOpen, battleClose, unknowStateBattle];
  }

  /**
   * BattleFunc.php::getBattleTime — the double-rate timetable: running activities, each with its
   * date rewritten to `mm.dd` (weekly rows counted from today, dated rows from their own day)
   * and a `weekday` column appended.
   */
  @GlobalCommand()
  async getBattleTime(): Promise<unknown[]> {
    const rows = await this.rows(sql<Row>`select * from cfg_act_battle
      where state > 0 and (date = 0 or (date > 0 and unix_timestamp() <= date + 86400))
      order by date`);
    const ret: unknown[] = [];
    for (const row of rows) {
      const weektoday = phpIntval(
        await this.cell(sql<Row>`select weekday(from_unixtime(unix_timestamp())) + 1`),
      );
      let date: unknown;
      let weekday: unknown;
      if (phpLooseEquals(row.date, 0) && phpNum(row.actid) <= 7) {
        // 每周定期：actid 就是星期几（1-7），从今天折算出本周的 mm.dd。
        date = await this.cell(sql<Row>`select DATE_FORMAT(from_unixtime(unix_timestamp() +
          (${phpIntval(row.actid)} - ${weektoday}) * 86400), '%m.%d')`);
        weekday = row.actid;
      } else {
        date = await this.cell(
          sql<Row>`select DATE_FORMAT(from_unixtime(${phpIntval(row.date)}), '%m.%d')`,
        );
        weekday = await this.cell(
          sql<Row>`select weekday(from_unixtime(${phpIntval(row.date)})) + 1`,
        );
      }
      ret.push({ ...row, date, weekday });
    }
    return [ret];
  }

  /**
   * BattleFunc.php::getBattleNetUrl — with BATTLE_NET_ENABLE=false (config/db1.php:27) the
   * cfg_battlenet_server table is never read and the reply is an empty list.
   */
  @GlobalCommand()
  async getBattleNetUrl(_ctx: CommandContext): Promise<unknown[]> {
    return [[]];
  }

  // ─────────────────────────── internal helpers ───────────────────────────

  /**
   * BattleFunc.php::setFlags — per-city camp flag for the battlefield map: 空据点 5, 争夺中 3,
   * own npc 2 / own 1, enemy npc 0 / enemy 4, with `flagchar` from cfg_battle_union (or, for
   * pseudo-unions above 1000, the user's own flagchar). Mirrors the PHP exactly, including the
   * `unionid` param being unused and `$flagchar` persisting across loop iterations.
   */
  private async setFlags(unionid: unknown, cityinfos: Row[]): Promise<Row[]> {
    const flagcharmap = new Map<number, unknown>();
    for (const r of await this.rows(sql<Row>`select unionid, flag from cfg_battle_union`)) {
      flagcharmap.set(phpIntval(r.unionid), r.flag);
    }
    const result: Row[] = [];
    let flagchar: unknown;
    for (const cityinfo of cityinfos) {
      const cityunionid = cityinfo['unionid'];
      if (phpNum(cityunionid) >= 1) {
        if (phpNum(cityunionid) > 1000) {
          flagchar = await this.cell(
            sql<Row>`select flagchar from sys_user where uid = ${cityunionid}`,
          );
        } else {
          flagchar = flagcharmap.get(phpIntval(cityunionid));
        }
      }
      let out: Row;
      if (phpLooseEquals(cityunionid, -1)) {
        // 空据点，白旗
        out = { ...cityinfo, flag: 5, flagchar: '' };
      } else if (phpLooseEquals(cityunionid, 0)) {
        // 争夺中，玫瑰色
        out = { ...cityinfo, flag: 3, flagchar: '' };
      } else if (phpLooseEquals(cityunionid, unionid)) {
        // 同一阵营
        out = {
          ...cityinfo,
          flagchar: flagchar ?? null,
          flag: truthy(cityinfo['hasuser']) ? 1 : 2,
        };
      } else {
        // 敌方阵营
        out = {
          ...cityinfo,
          flagchar: flagchar ?? null,
          flag: truthy(cityinfo['hasuser']) ? 4 : 0,
        };
      }
      result.push(out);
    }
    return result;
  }

  /**
   * BattleFunc.php::getBattleStartCityInfo — the camps' starting cities (`needhonour` ascending);
   * 逐鹿中原 (6001, cross-server, no data in this package) would instead hand out a random
   * cfg_battle_city xy once. `bid == "" || unionid == ""` (0 included, PHP 5 loose) answers null.
   */
  private async getBattleStartCityInfo(bid: unknown, unionid: unknown): Promise<unknown> {
    if (phpLooseEquals(bid, '') || phpLooseEquals(unionid, '')) {
      return undefined;
    }
    if (phpLooseEquals(bid, 6001)) {
      const startcid = await this.cell(sql<Row>`select startcid from sys_user_battle_state
        where state = 0 and uid = ${unionid}`);
      let ret: Row[];
      if (phpLooseEquals(startcid, 0)) {
        ret = await this.rows(sql<Row>`SELECT xy, \`name\` FROM cfg_battle_city
          WHERE bid = 6001 AND xy NOT IN (407, 374, 97, 410, 285) ORDER BY RAND() LIMIT 1`);
        const xy = (ret[0] as Row | undefined)?.xy;
        await sql`update sys_user_battle_state set startcid = ${xy}
          where state = 0 and uid = ${unionid}`.execute(this.db);
      } else {
        ret = await this.rows(sql<Row>`SELECT xy, \`name\` FROM cfg_battle_city
          WHERE bid = 6001 AND xy = ${startcid}`);
      }
      return ret;
    }
    return this.rows(sql<Row>`select * from cfg_battle_start_city
      where bid = ${bid} and unionid = ${unionid} order by needhonour asc`);
  }

  /**
   * BattleFunc.php::getUserPVENetLevel — the 跨服等级 from the 70022-70024 achievements
   * (千里走单骑 chain); without them the default level is 1.
   */
  private async getUserPVENetLevel(uid: number): Promise<number> {
    const achivementId = await this.cell(sql<Row>`select max(achivement_id) from sys_user_achivement
      where uid = ${uid} and achivement_id between 70022 and 70024`);
    if (phpLooseEquals(achivementId, 70024)) return 4;
    if (phpLooseEquals(achivementId, 70023)) return 3;
    if (phpLooseEquals(achivementId, 70022)) return 2;
    return 1;
  }
}
