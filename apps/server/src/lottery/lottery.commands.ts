import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpCompare, phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { TaskRewards } from '../task/task-rewards.service';

type Row = Record<string, unknown>;

/**
 * LotteryFunc.php — the 幸运宝盒 wheel (one free draw at 11点/19点 on the DB clock, one 重开).
 * Every gate command first reads mem_state state=150: both shipped databases keep it at 1
 * (verified on dev and legacy), so the feature is closed and startLottery / getLotteryReward /
 * autoGetReward / addCount / restart always answer lottery.not_available. The gate is ported
 * as-is, so the port stays correct if a GM ever flips the state.
 */
@Injectable()
export class LotteryCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly random: RandomService,
    private readonly goods: GoodsRules,
    private readonly rewards: TaskRewards,
    private readonly tasks: TaskRules,
    private readonly users: UserRules,
  ) {}

  /** LotteryFunc.php:82 startLottery. */
  @GlobalCommand()
  async startLottery(ctx: CommandContext): Promise<unknown> {
    return this.scope.transaction(async () => {
      // 公士及以上 (LotteryFunc.php:84-89) — checked before the open gate.
      const nobility = await this.cell(
        sql<Row>`select nobility as v from sys_user where uid = ${ctx.uid}`,
      );
      if ((await this.users.bufferNobility(ctx.uid, nobility)) < 1) {
        throw GameError.lang('lottery.nobility_limit');
      }
      await this.assertOpen();
      await this.checkLotteryTime();
      let count = await this.todayCount(ctx.uid);
      if (count >= 1) {
        // 19989 无限次 / 10191 每天 4 次 / 159 每天 20 次 (LotteryFunc.php:103-105).
        const paid =
          (await this.useGoodsToPayAgain(ctx.uid, 19989, 0)) ||
          (await this.useGoodsToPayAgain(ctx.uid, 10191, 4)) ||
          (await this.useGoodsToPayAgain(ctx.uid, 159, 20));
        if (!paid) return [-1, -2, -1, count];
      }
      const infor = await this.row(
        sql<Row>`select * from mem_lottery_goods where uid = ${ctx.uid} and got = 0`,
      );
      if (!infor) throw GameError.lang('waigua.invalid');
      const records = await this.retrieveGoods(phpString(infor.records));
      const win = await this.randWin(ctx.uid, records);
      await sql`insert into log_lottery (uid, time, gid, type)
        values (${ctx.uid}, now(), ${win[1]}, ${win[0]})`.execute(this.scope.db);
      count = await this.todayCount(ctx.uid);
      return [win[0], win[1], win[2], count];
    });
  }

  /** LotteryFunc.php:156 getLotteryReward — pays the pending win, then deals a fresh round. */
  @GlobalCommand()
  async getLotteryReward(ctx: CommandContext): Promise<unknown> {
    return this.scope.transaction(async () => {
      await this.assertOpen();
      await this.checkLotteryTime();
      await this.assertPendingRound(ctx.uid);
      await this.addCountBase(ctx.uid);
      return this.getGoodsBase(ctx.uid);
    });
  }

  /** LotteryFunc.php:175 autoGetReward — `[win, fresh round]` in one reply. */
  @GlobalCommand()
  async autoGetReward(ctx: CommandContext): Promise<unknown> {
    return this.scope.transaction(async () => {
      await this.assertOpen();
      await this.checkLotteryTime();
      await this.assertPendingRound(ctx.uid);
      const winObj = await this.addCountBase(ctx.uid);
      const newRoundGoods = await this.getGoodsBase(ctx.uid);
      return [winObj, newRoundGoods];
    });
  }

  /**
   * LotteryFunc.php:460 getWin as a whitelisted command. Command.php:117 dispatches
   * `$commandFunc($uid, $param)`, so the param array lands in `$type` while `$id` (argument 3)
   * is never passed — the original dies with the fatal below before the body runs (observed on
   * the legacy gateway). Only the internal addCount path ever reaches the real body.
   */
  @GlobalCommand()
  async getWin(): Promise<never> {
    throw GameError.raw(
      'Missing argument 3 for getWin(), called in /var/www/html/server/game/Command.php on line 117 and defined',
    );
  }

  /** LotteryFunc.php:565 addCount as a whitelisted command (the client never sends it). */
  @GlobalCommand()
  async addCount(ctx: CommandContext): Promise<unknown> {
    return this.scope.transaction(() => this.addCountBase(ctx.uid));
  }

  /** LotteryFunc.php:201 getTodayCount — no gates, a plain read. */
  @GlobalCommand()
  async getTodayCount(ctx: CommandContext): Promise<number> {
    return this.todayCount(ctx.uid);
  }

  /** LotteryFunc.php:538 restart — reroll once per round, avoiding the previous win. */
  @GlobalCommand()
  async restart(ctx: CommandContext, param: unknown[]): Promise<unknown> {
    await this.assertOpen();
    await this.checkLotteryTime();
    // LotteryFunc.php:549-551 shifts win_id, win_type and the client's records copy; the records
    // argument is never used, the stored ones are re-parsed below.
    const winId = param.shift();
    const winType = param.shift();
    const infor = await this.row(
      sql<Row>`select * from mem_lottery_goods where uid = ${ctx.uid} and got = 0`,
    );
    if (!infor) throw GameError.lang('waigua.invalid');
    if (phpNum(infor.restart_count) >= 1) throw GameError.lang('lottery.restart_limit');
    const records = await this.retrieveGoods(phpString(infor.records));
    return this.randWin(ctx.uid, records, true, winId, winType);
  }

  /**
   * LotteryFunc.php:609 useMoney. Command.php passes the param array as `$count`, and PHP ranks
   * any array above every int (legacy PHP 5.6: `array() > 1 === true`), so the deduction branch
   * always runs — observed on the legacy gateway: uid 1001 with 83763 元宝 answered `[1]` and
   * silently dropped to 83757 with no log row. Under 6 元宝 it answers `[0]` untouched.
   */
  @GlobalCommand()
  async useMoney(ctx: CommandContext): Promise<unknown[]> {
    const money = await this.cell(sql<Row>`select money as v from sys_user where uid = ${ctx.uid}`);
    if (phpEmpty(money) || phpNum(money) < 6) return [0];
    await sql`update sys_user set money = money - 6 where uid = ${ctx.uid}`.execute(this.scope.db);
    return [1];
  }

  // ---- internals (not whitelisted) ----

  /**
   * LotteryFunc.php:9 getGoods. NOT in openfunc — the client calls it when the dialog opens
   * (MainDialog.as:966) and the original always answered command_exception; the wheel is fed by
   * getLotteryReward/autoGetReward, which both end here.
   */
  private async getGoodsBase(uid: number): Promise<unknown[]> {
    await this.assertOpen();
    await this.checkLotteryTime();
    let infor = await this.row(sql<Row>`select * from mem_lottery_goods where uid = ${uid}`);
    let records: Row[][];
    if (!infor || phpLooseEquals(infor.got, 1)) {
      records = await this.getAllLevelGoods();
      const recordStr = this.recordString(records);
      if (!infor) {
        await sql`insert into mem_lottery_goods (uid, records, time, win, got, restart_count)
          values (${uid}, ${recordStr}, current_date(), '-1,0,0', 0, 0)`.execute(this.scope.db);
      } else {
        await sql`update mem_lottery_goods set records = ${recordStr}, time = current_date(),
          win = '-1,0,0', got = 0, restart_count = 0 where uid = ${uid}`.execute(this.scope.db);
      }
      infor = await this.row(sql<Row>`select * from mem_lottery_goods where uid = ${uid}`);
    } else {
      records = await this.retrieveGoods(phpString(infor.records));
    }
    const win = phpString(infor?.win).split(',');
    const tcount = await this.todayCount(uid);
    return [records, win[0], win[1], win[2], infor?.restart_count ?? null, tcount];
  }

  /** LotteryFunc.php:167,186 — a `got=0` row must exist. */
  private async assertPendingRound(uid: number): Promise<void> {
    const infor = await this.cell(
      sql<Row>`select uid as v from mem_lottery_goods where uid = ${uid} and got = 0`,
    );
    if (phpEmpty(infor)) throw GameError.lang('waigua.invalid');
  }

  /** LotteryFunc.php:11-18 et al. — mem_state state=150 non-zero closes the feature. */
  private async assertOpen(): Promise<void> {
    const open = await this.cell(sql<Row>`select value as v from mem_state where state = 150`);
    const openLottery = phpEmpty(open) ? 0 : open;
    if (!phpLooseEquals(openLottery, 0)) throw GameError.lang('lottery.not_available');
  }

  /** LotteryFunc.php:669 checkLottoryTime — the DB clock's hour must read 11 or 19. */
  private async checkLotteryTime(): Promise<void> {
    const now = phpString(await this.cell(sql<Row>`select now() as v`));
    // strtotime()+date("H") round-trips the very hour the DB printed (both shipped DBs run UTC).
    const hour = now.slice(11, 13);
    if (hour !== '11' && hour !== '19') throw GameError.lang('lottery.not_available_time');
  }

  /** LotteryFunc.php:201 — a sliding 1-hour window (`<=3600`), not a calendar day. */
  private async todayCount(uid: number): Promise<number> {
    const count = await this.cell(sql<Row>`select count(*) as v from log_lottery
      where uid = ${uid} and (unix_timestamp() - unix_timestamp(time)) <= 3600`);
    return phpEmpty(count) ? 0 : phpNum(count);
  }

  /**
   * LotteryFunc.php:145 useGoodsToPayAgain — burns one 续抽 item; `dayUseLimit` 0 = unlimited,
   * otherwise the day's log_goods `count=-1, type=0` rows must stay under it.
   */
  private async useGoodsToPayAgain(
    uid: number,
    gid: number,
    dayUseLimit: number,
  ): Promise<boolean> {
    const owned = await this.cell(
      sql<Row>`select count as v from sys_goods where uid = ${uid} and gid = ${gid}`,
    );
    if (phpNum(owned) >= 1) {
      if (dayUseLimit === 0) {
        await this.goods.reduceGoods(uid, gid, 1);
        return true;
      }
      const used = await this.cell(sql<Row>`select count(*) as v from log_goods
        where uid = ${uid} and gid = ${gid} and type = 0 and count = -1
        and time >= unix_timestamp(curdate())`);
      if (phpNum(used) < dayUseLimit) {
        await this.goods.reduceGoods(uid, gid, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * LotteryFunc.php:218 randWin. One mt_rand(1,10000) against specialProp's table picks the
   * grade (unhit sums stay at 8等); from there the first non-empty grade wins, consuming one
   * mt_rand(0,count-1) per non-empty grade. When the pick repeats the previous win the scan
   * restarts at 8等 downwards. winCount is only assigned in the goods branch, so an armor win
   * keeps the previous count — original quirk, kept.
   */
  private async randWin(
    uid: number,
    records: Row[][],
    isRestartReq = false,
    lastWinId: unknown = -100,
    lastWinType: unknown = -1,
  ): Promise<[number, unknown, unknown]> {
    const prob = await this.specialProp(uid);
    const winRand = this.random.mtRand(1, 10000);
    let winId: unknown = -1;
    let winType = 0;
    let winCount: unknown = 1;
    let winIndex = 7;
    let sum = 0;
    for (let i = 0; i < 8; i++) {
      sum += phpNum(prob[i]);
      if (sum >= winRand) {
        winIndex = i;
        break;
      }
    }
    const sameAsLast = () =>
      phpLooseEquals(lastWinId, winId) && phpLooseEquals(lastWinType, winType);
    const pickFrom = async (from: number, to: number, step: number): Promise<void> => {
      for (let i = from; step > 0 ? i < to : i >= to; i += step) {
        const grade = records[i] ?? [];
        if (grade.length === 0) continue;
        const chosen = grade[this.random.mtRand(0, grade.length - 1)]!;
        if (!phpLooseEquals(chosen.gid, null)) {
          winId = chosen.gid;
          winType = 0;
          winCount = chosen.count;
        } else {
          winId = chosen.id;
          winType = 1;
        }
        if (sameAsLast()) continue;
        break;
      }
    };
    await pickFrom(winIndex, 8, 1);
    if (sameAsLast()) await pickFrom(7, -1, -1);
    const winStr = `${phpString(winType)},${phpString(winId)},${phpString(winCount)}`;
    if (isRestartReq) {
      await sql`update mem_lottery_goods set win = ${winStr},
        restart_count = restart_count + 1 where uid = ${uid}`.execute(this.scope.db);
    } else {
      await sql`update mem_lottery_goods set win = ${winStr} where uid = ${uid}`.execute(
        this.scope.db,
      );
    }
    return [winType, winId, winCount];
  }

  /** LotteryFunc.php:303 logIDs — `type,id,count`; 0 goods, 1 armor. */
  private logIDs(rs: Row): string {
    if (!phpLooseEquals(rs.gid, null)) return `0,${phpString(rs.gid)},${phpString(rs.count)}`;
    return `1,${phpString(rs.id)},${phpString(rs.count)}`;
  }

  /**
   * LotteryFunc.php:29-41 — the comma placement runs on a per-item counter that skips exactly
   * one comma (after the 8th item overall); an over-full round therefore stores a trailing one.
   */
  private recordString(records: Row[][]): string {
    let str = '';
    let rcount = 1;
    for (const grade of records) {
      for (const record of grade) {
        str += this.logIDs(record);
        if (rcount !== 8) str += ',';
        rcount++;
      }
    }
    return str;
  }

  /**
   * LotteryFunc.php:320 retrieveGoods — parses the stored triples back into grade buckets.
   * A missing cfg row (or the degenerate tail of an over-full string) lands in a `-1` bucket
   * the rolls never read; the original's `where gid=` dies() in PearDB there — parameterized
   * as gid=0 instead.
   */
  private async retrieveGoods(ids: string): Promise<Row[][]> {
    const ret: Row[][] = [[], [], [], [], [], [], [], []];
    const idAry = ids.split(',');
    for (let i = 0; i < idAry.length; i += 3) {
      const type = idAry[i] ?? null;
      const id = idAry[i + 1] ?? null;
      const count = idAry[i + 2] ?? null;
      let goods: Row | undefined;
      if (phpLooseEquals(type, 1)) {
        goods = await this.row(sql<Row>`select * from cfg_armor where id = ${phpIntval(id)}`);
      } else if (phpLooseEquals(type, 0)) {
        goods = await this.row(sql<Row>`select * from cfg_goods where gid = ${phpIntval(id)}`);
      }
      const level = phpIntval((goods ?? {}).level) - 1;
      (ret[level] ??= []).push({ ...(goods ?? {}), count });
    }
    return ret;
  }

  /** LotteryFunc.php:343 getAllLevelGoods — fills the eight grades in the original's odd order. */
  private async getAllLevelGoods(): Promise<Row[][]> {
    let total = 0;
    // 1等
    let count = this.random.mtRand(0, 1);
    const records1 = await this.goodsByType(count, 1, total);
    total += records1.length;
    // 2等
    count = this.random.mtRand(0, 1);
    const records2 = await this.goodsByType(count, 2, total);
    total += records2.length;
    // 3等
    count = this.random.mtRand(0, 1);
    if (total === 0) count = 1;
    const records3 = await this.goodsByType(count, 3, total);
    total += records3.length;
    // 7等
    count = this.random.mtRand(1, 2);
    const records7 = await this.goodsByType(count, 7, total);
    total += records7.length;
    // 8等
    count = this.random.mtRand(1, 2);
    const records8 = await this.goodsByType(count, 8, total);
    total += records8.length;
    // 4等
    count = this.random.mtRand(0, 2);
    const records4 = await this.goodsByType(count, 4, total);
    total += records4.length;
    // 5等
    count = this.random.mtRand(0, 2);
    const records5 = await this.goodsByType(count, 5, total);
    total += records5.length;
    // 6等 — tops the wheel up to eight items.
    count = this.random.mtRand(0, 2);
    if (total + count < 8) count = 8 - total;
    const records6 = await this.goodsByType(count, 6, total, 1);
    return [records1, records2, records3, records4, records5, records6, records7, records8];
  }

  /** LotteryFunc.php:396 getGoodsByType — `order by rand()` verbatim, like the original. */
  private async goodsByType(
    count: number,
    level: number,
    total: number,
    isLast = 0,
  ): Promise<Row[]> {
    const ret: Row[] = [];
    if (total + count > 8) count = Math.max(0, 8 - total);
    for (let i = 0; i < count; i++) {
      let type = this.randType();
      if (level === 8 || level === 7) type = 1;
      let record: Row | undefined;
      switch (type) {
        case 0:
          record = await this.row(sql<Row>`select * from cfg_goods where gid < 10000
            and \`group\` in (4, 5) and level = ${level} order by rand() limit 1`);
          if (!record) break;
          record.count = phpIntval(
            (this.random.mtRand(0, 30) / 100) * (phpIntval(record.level) - 1) + 1,
          );
          break;
        case 1:
          record = await this.row(sql<Row>`select * from cfg_goods where gid < 10000
            and \`group\` in (0, 1, 2, 3) and level = ${level} order by rand() limit 1`);
          if (!record) break;
          record.count = 1;
          break;
        case 2:
          record = await this.row(
            sql<Row>`select * from cfg_armor where level = ${level} order by rand() limit 1`,
          );
          if (!record) break;
          record.count = 1;
          break;
        default:
          // case 3 (礼金) is unreachable: randType never returns it since cxy 2009.10.29.
          break;
      }
      if (record) ret.push(record);
    }
    if (isLast && total + ret.length < 8) {
      const left = 8 - total - ret.length;
      for (let i = 0; i < left; i++) {
        // A miss here still appends: PHP vivifies the false row into {count:1}.
        const record = await this.row(sql<Row>`select * from cfg_goods where gid < 10000
          and \`group\` in (0, 1, 2, 3) and level = 6 order by rand() limit 1`);
        ret.push({ ...(record ?? {}), count: 1 });
      }
    }
    return ret;
  }

  /** LotteryFunc.php:446 randType — 50% 材料, 25% 道具, 25% 装备. */
  private randType(): number {
    const rand = this.random.mtRand(1, 100);
    if (rand <= 50) return 0;
    if (rand <= 75) return 1;
    return 2;
  }

  /** LotteryFunc.php:565 addCount — pays out the pending win and completes task 293. */
  private async addCountBase(uid: number): Promise<Row> {
    await this.assertOpen();
    await this.checkLotteryTime();
    const rec = await this.row(
      sql<Row>`select * from mem_lottery_goods where uid = ${uid} and got = 0`,
    );
    // No row: PHP reads $rec["win"] (null) → explode(",", null) === [""] and missing gid/count.
    const win = phpString(rec?.win).split(',');
    const winObj = await this.winAward(uid, win[0], win[1] ?? null, win[2] ?? null);
    await this.tasks.completeTaskWithTaskid(uid, 293);
    return winObj;
  }

  /** LotteryFunc.php:460 getWin — pays out one win (log reason 1000) and closes the round. */
  private async winAward(uid: number, type: unknown, id: unknown, count: unknown): Promise<Row> {
    let winObj: Row | undefined;
    if (phpLooseEquals(id, 0) && phpLooseEquals(type, 0)) {
      // gid 0 is the 礼金 pseudo-item.
      winObj = await this.row(sql<Row>`select * from cfg_goods where gid = ${phpIntval(id)}`);
      if (!winObj) throw GameError.lang('lottery.no_such_goods');
      await this.rewards.addGift(uid, phpNum(count), 1000);
    } else if (phpLooseEquals(type, 1)) {
      winObj = await this.row(sql<Row>`select * from cfg_armor where id = ${phpIntval(id)}`);
      if (!winObj) throw GameError.lang('lottery.no_such_armor');
      await this.rewards.addArmor(uid, phpIntval(winObj.id), 1, 1000);
    } else if (phpLooseEquals(type, 0)) {
      winObj = await this.row(sql<Row>`select * from cfg_goods where gid = ${phpIntval(id)}`);
      if (!winObj) throw GameError.lang('lottery.no_such_goods');
      await this.goods.addGoods(uid, phpIntval(id), phpNum(count), 1000);
    } else {
      throw GameError.lang('lottery.no_such_goods');
    }
    await sql`update mem_lottery_goods set got = 1 where uid = ${uid}`.execute(this.scope.db);
    await this.sendSysInformHere(uid, type, id, count);
    winObj.count = count; // the raw $count — an explode string or null, as the original returns
    return winObj;
  }

  /** LotteryFunc.php:512 sendSysInformHere — a scrolling notice for wins of grade ≤ 5. */
  private async sendSysInformHere(
    uid: number,
    type: unknown,
    id: unknown,
    count: unknown,
  ): Promise<void> {
    if (phpLooseEquals(type, 1)) {
      const arminfo = await this.row(sql<Row>`select * from cfg_armor where id = ${phpIntval(id)}`);
      if (arminfo && phpNum(arminfo.level) <= 5) {
        await this.informWin(uid, phpString(arminfo.name));
      }
    } else if (phpLooseEquals(type, 0)) {
      const goods = await this.row(sql<Row>`select * from cfg_goods where gid = ${phpIntval(id)}`);
      if (goods && phpNum(goods.level) <= 5) {
        let goodname = phpString(goods.name);
        if (phpNum(count) > 0) goodname = `${goodname}*${phpString(count)}`;
        await this.informWin(uid, goodname);
      }
    }
  }

  private async informWin(uid: number, goodname: string): Promise<void> {
    const name = await this.cell(sql<Row>`select name as v from sys_user where uid = ${uid}`);
    const msg = this.lang.t('lottery.inform_win_goods', name, goodname);
    await this.users.sendSysInform({
      type: 0,
      inuse: 1,
      starttime: 0,
      endtime: 59,
      interval: 0,
      scrollcount: 1,
      color: 49151,
      msg,
    });
  }

  /**
   * LotteryFunc.php:626 specialProp — the default table, unless the 7th (resp. 4th) draw of the
   * day came up empty of sub-6等 (resp. sub-7等) drops: then the 5等 9000 (resp. 6等 8000) pity
   * weight applies.
   */
  private async specialProp(uid: number): Promise<number[]> {
    const prob = [10, 190, 300, 500, 1000, 1500, 2500, 4000];
    const logs = await this.rows(sql<Row>`select * from log_lottery l left join cfg_goods c
      on l.gid = c.gid where uid = ${uid} and to_days(\`time\`) = to_days(now())
      order by \`time\` desc`);
    const count = logs.length;
    if (count % 7 === 6) {
      let hasLevelBetter6 = false;
      for (let i = 0; i < 6; i++) {
        if (phpCompare(logs[i]!.level, 6) < 0) {
          hasLevelBetter6 = true;
          break;
        }
      }
      if (!hasLevelBetter6) return [10, 190, 300, 500, 9000, 0, 0, 0];
    } else if (count % 4 === 3) {
      let hasLevelBetter7 = false;
      for (let i = 0; i < 3; i++) {
        if (phpCompare(logs[i]!.level, 7) < 0) {
          hasLevelBetter7 = true;
          break;
        }
      }
      if (!hasLevelBetter7) return [10, 190, 300, 500, 1000, 8000, 0, 0];
    }
    return prob;
  }

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async row(query: RawBuilder<Row>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const row = (await this.rows(query))[0];
    return row ? Object.values(row)[0] : undefined;
  }
}
