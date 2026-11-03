import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GameStateService } from '../core/game-state.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpFloat, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { ReportService } from '../core/report.service';
import { TaskRules } from '../core/task-rules.service';
import { DbScope } from '../db/database.module';
import { DefaultBoxService } from '../goods/default-box.service';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { battleRate, getAvailableBattleActs, isLucky } from './act-battle';
import { playerExitBattle, resetBattleFieldUid, type BattlefieldDeps } from './battlefield-helpers';
import { getSoldierMap, getSoldierString } from './battlefield-troop-support';

type Row = Record<string, unknown>;

/**
 * BattleFunc.php:2244-2634 / 3840-3902 / 3998-4033 / 4235-4275 — the battlefield lifecycle
 * commands around quitting and inviting:
 *
 *   - `getQuitResult` / `quitBattle` — the mid-battle quit: sends every garrisoned troop home
 *     (task 7), converts the 援军 it had called back into battlefield honour (per-soldier
 *     SOLDIER_PEOPLE / 100), grades the honour by 胜(±level²·8·rate) / 败(-level²·5) /
 *     逃(-level²·20), grants the win medal (cfg_battle_union.metal_gid) and the win reward goods
 *     (19990-19995), runs the 戰場活動 box rolls, files log_battle_honour (the rank_battle_*
 *     source) and the title 40/48 report.
 *   - `inviteBattleUser` / `ignoreBattle` / `cancelBattleInvite` — the sys_battle_invite flow.
 *   - `dropBattleGoods` / `autoTransferCaptain` / `punishNotAdult` — internal helpers, kept here
 *     alongside their only callers. The shared battlefield helpers (`resetBattleFieldUid`,
 *     `playerExitBattle`, `getSoldierMap`, `getSoldierString`) are the ones ported with the
 *     sibling slices (battlefield-helpers.ts / battlefield-troop-support.ts), reused here so both
 *     halves of S2 run one implementation.
 *
 * No scope.transaction() wraps quitBattle: the original runs bare, and a failure part-way (e.g.
 * an openDefaultBox sort this port does not carry) leaves the earlier writes standing, as in PHP.
 */

/** BattleFunc.php:2325 — people (荣誉 weight) per soldier sid; sids beyond 12 read as 0. */
const SOLDIER_PEOPLE: Record<number, number> = {
  0: 0,
  1: 1,
  2: 1,
  3: 1,
  4: 1,
  5: 1,
  6: 2,
  7: 3,
  8: 6,
  9: 4,
  10: 5,
  11: 10,
  12: 8,
};

/** BattleFunc.php:2384-2391 — the win reward goods (战场犒赏) per battlefield bid. */
const WIN_REWARD_GOAL: Record<number, number> = {
  1001: 19990,
  2001: 19994,
  3001: 19991,
  4001: 19995,
  5001: 19993,
  8001: 19992,
};

/** The bids whose empty battlefield (nobody in state 0) is closed on quit (BattleFunc.php:2492). */
const CLOSEABLE_BIDS = [1001, 3001, 4001, 5001];

/** BattleFunc.php:3840-2634 command implementations. */
@Injectable()
export class BattleLifecycleCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly tasks: TaskRules,
    private readonly report: ReportService,
    private readonly state: GameStateService,
    private readonly random: RandomService,
    private readonly box: DefaultBoxService,
  ) {}

  /** The BattlefieldDeps face battlefield-helpers.ts reads (the battle-arrival.ts pattern). */
  private deps(): BattlefieldDeps {
    return {
      db: this.scope.db,
      rows: async (query) => (await query.execute(this.scope.db)).rows as Row[],
      one: async (query) => ((await query.execute(this.scope.db)).rows as Row[])[0] ?? false,
      cell: async (query) => {
        const row = ((await query.execute(this.scope.db)).rows as Row[])[0];
        return row ? Object.values(row)[0] : undefined;
      },
      lang: (key, ...args) => this.lang.t(key, ...args),
    };
  }

  /** BattleFunc.php::getQuitResult:2244 — `[2]` 准备 / `[1]` win / `[-1]` flee / `[0]` other. */
  @GlobalCommand()
  async getQuitResult(ctx: CommandContext): Promise<unknown[]> {
    const battleinfo = await this.firstGetUserBattleInfo(ctx.uid);
    if (phpLooseEquals(battleinfo.state, 2)) return [2];
    if (phpLooseEquals(battleinfo.winner, battleinfo.unionid)) return [1];
    if (phpLooseEquals(battleinfo.winner, -1)) return [-1];
    return [0];
  }

  /** BattleFunc.php::quitBattle:2266 — the mid-battle quit and honour settlement. */
  @GlobalCommand()
  async quitBattle(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const db = this.scope.db;
    const nick = await this.cell(sql<Row>`select name from sys_user where uid = ${uid}`);
    const battleinfo = await this.firstGetUserBattleInfo(uid);

    // 战场倍率活动 (BattleFunc.php:2272-2283): the battlefield's start hour picks the weekend
    // window; a battlefield without starttime rates from "now".
    let nowtimestamp: unknown = battleinfo.starttime;
    if (phpEmpty(nowtimestamp)) {
      nowtimestamp = await this.cell(sql<Row>`select unix_timestamp() as v`);
    }
    const baseRate = await battleRate(db, nowtimestamp, battleinfo.bid);

    // 清理该用户的数据: every troop of this user inside the battlefield must be a garrison.
    const troops = (
      await sql<Row>`select * from sys_troops where uid = ${uid}
        and battlefieldid = ${battleinfo.battlefieldid}`.execute(db)
    ).rows as Row[];
    for (const troop of troops) {
      if (!phpLooseEquals(troop.state, 4)) {
        // 4驻军
        throw GameError.lang('battle.troop_in_fight_when_quit');
      }
    }
    const level = phpNum(battleinfo.level);
    // 退出后的战场荣誉
    const orihonour = phpNum(battleinfo.honour);
    // 援军返还荣誉
    let newhonour = 0;

    for (const troop of troops) {
      // 返还援军 (sys_battle_reinforce rows grouped by type; type 0 援军令 calls refund honour)
      const reinforceDatas = (
        await sql<Row>`select type, group_concat(sid, ',', count) as soldiers
          from sys_battle_reinforce where troopid = ${phpIntval(troop.id)} group by type`.execute(
          db,
        )
      ).rows as Row[];
      // 返还的战场荣誉
      let backhonour = 0;
      // 剩下的兵种map
      const orisoldiersmap = getSoldierMap(phpString(troop.soldiers));
      for (const reinforceData of reinforceDatas) {
        const reinforcearray = phpString(reinforceData.soldiers).split(',');
        const reinforcearraycount = reinforcearray.length / 2;
        // 计算每个兵种的返还，如果返还后小于0，则视为0。
        for (let i = 0; i < reinforcearraycount; i++) {
          const sid = phpIntval(reinforcearray.shift());
          // 调遣过的援军数目
          const reinforcemapcount = phpNum(reinforcearray.shift());
          // 现在剩下的数目
          const oricount = orisoldiersmap.get(sid);
          let newcount = 0;
          if (!phpEmpty(oricount)) {
            newcount = phpNum(oricount) - reinforcemapcount;
            if (newcount < 0) newcount = 0;
            // 该兵种返还的数值
            const backcount = phpNum(oricount) - newcount;
            if (phpLooseEquals(reinforceData.type, 0)) {
              backhonour += Math.floor((backcount * phpNum(SOLDIER_PEOPLE[sid] ?? 0)) / 100);
            }
          }
          orisoldiersmap.set(sid, newcount);
        }
      }
      const newsoldiers = getSoldierString(orisoldiersmap);
      newhonour += backhonour;
      if (newsoldiers !== '') {
        // 所有军队设置为返回状态
        await sql`update sys_troops set starttime = unix_timestamp(), task = 7, state = 1,
          soldiers = ${newsoldiers}, endtime = unix_timestamp() + pathtime, battlefieldid = 0,
          cid = startcid where id = ${phpIntval(troop.id)}`.execute(db);
      } else {
        // 返还援军后军队为0，则直接把将领扔回城。
        await sql`delete from sys_troops where id = ${phpIntval(troop.id)}`.execute(db);
        await sql`update sys_city_hero set state = 0 where hid = ${phpIntval(troop.hid)}`.execute(
          db,
        );
      }
      await resetBattleFieldUid(this.deps(), phpIntval(troop.cid));
    }

    const result = battleinfo.winner;
    let quittype = 0;
    // 胜利，失败，或者逃跑扣除的荣誉
    let winhonour: number;
    let canwin = true;
    // 黄巾 要检查刷子
    if (phpLooseEquals(battleinfo.unionid, 1)) {
      // 看是不是胜利推出过 (the original's `if (!check) $canwin = true` — kept for its query)
      const wonBefore = await this.checkLogBattleHonourWin(uid, battleinfo.battlefieldid);
      if (!wonBefore) canwin = true;
      if (canwin) {
        // 如果没有胜利退出过，要参与完成主线任务，否则不能胜利
        const goalsid = await this.cell(
          sql<Row>`select group_concat(id) as v from cfg_task_goal where tid in (60000, 60001, 60002)`,
        );
        const goalCount = phpNum(
          await this.cell(sql<Row>`select count(*) as v from sys_user_goal where uid = ${uid}
            and gid in (${sql.raw(phpString(goalsid))})`),
        );
        if (!phpLooseEquals(goalCount, 3)) canwin = false;
        // 否则：检查并更新黄巾史诗任务开启状态 (the original block is commented out)
      }
    }
    if (await this.checkLogBattleHonourWin(uid, battleinfo.battlefieldid)) canwin = false;

    if (phpLooseEquals(result, battleinfo.unionid)) {
      // 胜利退出 — 战场活动任务之战场犒赏 (the switch's $mytid is never read; an unknown bid
      // leaves $goalid unset, and the original's `gid=` SQL dies through the PearDB path).
      const goalid = WIN_REWARD_GOAL[phpIntval(battleinfo.bid)];
      const usrInfo = await this.row(
        sql<Row>`select * from sys_goods where uid = ${uid} and gid = ${sql.raw(phpString(goalid))}`,
      );
      if (!usrInfo) {
        await sql`insert into sys_goods (uid, gid, count) values (${uid}, ${sql.raw(phpString(goalid))}, 1)`.execute(
          db,
        );
      } else {
        await sql`update sys_goods set count = count + 1 where uid = ${uid}
          and gid = ${sql.raw(phpString(goalid))}`.execute(db);
      }
      winhonour = level * level * 8 * baseRate;
      if (!canwin) winhonour = 0;
    } else if (phpLooseEquals(result, -1)) {
      // 中途逃跑
      winhonour = 0 - level * level * 20;
      quittype = 2;
    } else {
      // 失败退出
      winhonour = 0 - level * level * 5;
      quittype = 1;
    }
    if (phpLooseEquals(result, battleinfo.unionid)) {
      await this.dropBattleGoods(uid, battleinfo.bid, battleinfo.level);
    }

    // 防沉迷
    if (await this.state.isAdultOpen()) {
      const punish = await this.punishNotAdult(uid);
      if (!phpLooseEquals(quittype, 1) && !phpLooseEquals(quittype, 2)) {
        newhonour = phpIntval(newhonour * punish);
        winhonour = phpIntval(winhonour * punish);
      }
    }

    if (phpLooseEquals(battleinfo.state, 2)) quittype = 3; // 准备状态
    if (phpLooseEquals(battleinfo.type, 1)) winhonour = 0; // 据点战场清理的时候再计算荣誉

    const nowhonour = orihonour + newhonour + winhonour;
    await sql`update sys_user set honour = ${nowhonour} where uid = ${uid}`.execute(db);

    if (phpLooseEquals(uid, battleinfo.createuid) && (quittype === 2 || quittype === 3)) {
      // 中途逃跑 转化队长
      await this.autoTransferCaptain(uid);
    }

    const battlefieldid = battleinfo.battlefieldid;
    if (phpLooseEquals(battleinfo.type, 1) && quittype !== 3) {
      await sql`update sys_user_battle_state set state = 1 where uid = ${uid}
        and battlefieldid = ${battlefieldid}`.execute(db);
    } else {
      await sql`delete from sys_user_battle_state where uid = ${uid}
        and battlefieldid = ${battlefieldid}`.execute(db);
    }
    if (CLOSEABLE_BIDS.includes(phpIntval(battleinfo.bid))) {
      // 黄巾 / 十常侍：没人了就直接关场；十常侍未决出胜负必然副本失败
      const peopleCount = phpNum(
        await this.cell(sql<Row>`select count(*) as v from sys_user_battle_state
          where state = 0 and battlefieldid = ${battlefieldid}`),
      );
      if (phpLooseEquals(peopleCount, 0)) {
        await sql`update sys_user_battle_field set state = 1 where id = ${battlefieldid}`.execute(
          db,
        );
        await sql`update sys_user_battle_field set winner = 6 where id = ${battlefieldid}
          and bid = 3001 and winner = -1`.execute(db);
      }
    }
    const infounionid = phpLooseEquals(battleinfo.bid, 6001) ? 25 : battleinfo.unionid;
    const unioninfo =
      (await this.row(sql<Row>`select a.*, b.name as metal_name from cfg_battle_union a
        left join cfg_things b on a.metal_gid = b.tid where a.unionid = ${infounionid}`)) ?? {};
    // 勋章数目
    let xunzhangcount = 0;
    const battlefieldname = phpString(battleinfo.name);
    // 勋章名 / 勋章 gid / 任务组 / 阵营名
    const metalname = unioninfo.metal_name;
    const metalgid = unioninfo.metal_gid;
    const unionname = unioninfo.name;
    // 退出的时候不再清掉任务 (the original's task-deletion block is commented out)
    let msg = '';
    let extMsg: string | false | undefined;
    if (quittype === 0) {
      // 完成战场随机任务
      if (phpLooseEquals(battleinfo.bid, 1001)) {
        // 黄巾之乱
        await this.tasks.completeTaskGoalBySortandType(uid, 54, 1);
      } else if (phpLooseEquals(battleinfo.bid, 2001)) {
        // 官渡
        await this.tasks.completeTaskGoalBySortandType(uid, 54, 2);
      }
      // 如果胜利，加勋章
      xunzhangcount = level;
      if (phpLooseEquals(uid, battleinfo.createuid)) {
        // 创建者可多获得勋章
        if (level > 10) xunzhangcount += level - 10;
      }
      if (!canwin) xunzhangcount = 0;
      if (phpLooseEquals(battleinfo.type, 0)) {
        xunzhangcount = xunzhangcount * baseRate;
        if (await this.state.isAdultOpen()) {
          const punish = await this.punishNotAdult(uid);
          if (!phpLooseEquals(quittype, 1) && !phpLooseEquals(quittype, 2)) {
            xunzhangcount = phpIntval(xunzhangcount * punish);
          }
        }
        await this.goods.addThings(uid, phpNum(metalgid), xunzhangcount, 4);
        msg = this.lang.t(
          'battle.pve_quit_win',
          battlefieldname,
          phpFloat(winhonour),
          phpFloat(newhonour),
          metalname,
          phpFloat(xunzhangcount),
          phpFloat(nowhonour),
        );
      } else {
        msg = this.lang.t(
          'battle.pvp_quit_win',
          battlefieldname,
          phpFloat(winhonour),
          phpFloat(newhonour),
          phpFloat(nowhonour),
        );
      }
      // 战场活动ACT
      if (canwin) {
        const myrand = this.random.mtRand(1, 100);
        if (myrand > 90 && phpLooseEquals(battleinfo.bid, 1001)) {
          // 对于12级的黄巾之战赠送乾坤珠宝 (the comment's level gate is not in the code)
          const goalid = 10414;
          const usrInfo = await this.row(
            sql<Row>`select * from sys_goods where uid = ${uid} and gid = ${goalid}`,
          );
          if (!usrInfo) {
            await sql`insert into sys_goods (uid, gid, count) values (${uid}, ${goalid}, 1)`.execute(
              db,
            );
          } else {
            await sql`update sys_goods set count = count + 1 where uid = ${uid}
              and gid = ${goalid}`.execute(db);
          }
        }
        const battleActs = await getAvailableBattleActs(db);
        for (const battleAct of battleActs) {
          const actType = phpNum(battleAct.type);
          let actRate = phpNum(battleAct.rate);
          const actid = battleAct.actid;
          let levelRate = false;
          if (phpIntval(actType) % 100 === 20) {
            // 处理等级概率
            levelRate = true;
            actRate = level * actRate;
          }
          if (
            phpLooseEquals(battleinfo.bid, Math.floor((actType - 3000) / 100) * 1000 + 1) &&
            (phpLooseEquals(level, actType % 100) || actType % 100 === 0 || levelRate) &&
            isLucky(this.random, actRate, 100)
          ) {
            // actype: 3211 表示 bid=2001 的 12 级战场
            const cid = await this.cell(
              sql<Row>`select lastcid as v from sys_user where uid = ${uid}`,
            );
            const ext = await this.box.openEvent(uid, phpIntval(cid), phpIntval(actid), 3000);
            if (ext) extMsg = `${ext}。<br/>`;
          }
        }
      }
      msg = `${msg}<br/>${phpString(extMsg)}`;
    } else if (quittype === 1) {
      if (phpLooseEquals(battleinfo.type, 0)) {
        msg = this.lang.t(
          'battle.quit_lose',
          battlefieldname,
          phpFloat(0 - winhonour),
          phpFloat(newhonour),
          phpFloat(nowhonour),
        );
        if (phpLooseEquals(battleinfo.bid, 5001)) {
          msg = this.lang.t('battle.5001_quit_lose') + msg;
        }
      } else {
        msg = this.lang.t(
          'battle.pvp_quit_lose',
          battlefieldname,
          phpFloat(newhonour),
          phpFloat(nowhonour),
        );
      }
    } else if (quittype === 2) {
      if (phpLooseEquals(battleinfo.type, 0)) {
        msg = this.lang.t(
          'battle.quit_leave',
          battlefieldname,
          phpFloat(0 - winhonour),
          phpFloat(newhonour),
          phpFloat(nowhonour),
        );
      } else {
        msg = this.lang.t(
          'battle.pvp_quit_leave',
          battlefieldname,
          phpFloat(newhonour),
          phpFloat(nowhonour),
        );
      }
    } else if (quittype === 3) {
      msg = this.lang.t('battle.quit_leave_notstartbattle', battlefieldname, phpFloat(orihonour));
    }

    // 清理用户副本任务中得到的任务道具
    const taskthing = unioninfo.taskthing;
    if (!phpEmpty(taskthing)) {
      await sql`delete from sys_things where uid = ${uid}
        and tid in (${sql.raw(phpString(taskthing))})`.execute(db);
      await sql`delete from sys_troop_things where uid = ${uid}
        and thing_id in (${sql.raw(phpString(taskthing))})`.execute(db);
    }

    // 荣誉和勋章log
    if (quittype !== 3) {
      await sql`insert into log_battle_honour (uid, battleid, battlefieldid, starttime, quittime,
          result, honour, metal, unionid, level)
        values (${uid}, ${phpString(battleinfo.bid)}, ${battlefieldid}, ${battleinfo.starttime},
          unix_timestamp(), ${quittype}, ${nowhonour}, ${xunzhangcount},
          ${phpString(battleinfo.unionid)}, ${phpString(battleinfo.level)})`.execute(db);
    }

    await playerExitBattle(this.deps(), battlefieldid, battleinfo.unionid, uid, nick, unionname);

    // 发战报
    if (phpLooseEquals(battleinfo.type, 1) && quittype !== 3) {
      msg = msg + this.lang.t('battle.medal_info_after');
      await this.report.sendReport(uid, 48, 0, 0, msg);
    } else {
      await this.report.sendReport(uid, 40, 0, 0, msg);
    }
    return [this.lang.t('battle.exit_suc')];
    // 战场荣誉减少
  }

  /** BattleFunc.php::inviteBattleUser:3840 — invite a player into the creator's battlefield. */
  @GlobalCommand()
  async inviteBattleUser(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const db = this.scope.db;
    const battlefieldid = phpIntval(param.shift());
    const invitename = phpString(param.shift());
    const myname = phpString(param.shift());
    // (the original addslashes'd both names for SQL; parameters make that a no-op)
    const battleinfo = await this.row(
      sql<Row>`select * from sys_user_battle_field where id = ${battlefieldid}`,
    );
    if (!battleinfo) {
      // 你已经不在战场中
      throw GameError.lang('battle.user_not_in_battle');
    }
    if (phpLooseEquals(battleinfo.state, 1)) throw GameError.lang('battle.battle_froze');
    if (!phpLooseEquals(uid, battleinfo.createuid)) {
      throw GameError.lang('battle.invite_not_creator');
    }

    const touser = await this.row(
      sql<Row>`select uid, honour from sys_user where name = ${invitename}`,
    );
    if (!touser) throw GameError.lang('battle.invite_user_not_exist');
    const touserid = phpIntval(touser.uid);

    const honour = touser.honour;
    if (phpNum(honour) < 0) throw GameError.lang('battle.invite_not_enough_honour');

    if (
      await this.check(
        sql<Row>`select id from sys_battle_invite where battlefieldid = ${phpIntval(battleinfo.id)}
          and touid = ${touserid}`,
      )
    ) {
      throw GameError.lang('battle.invite_user_already');
    }

    const count = phpNum(
      await this.cell(sql<Row>`select count(*) as v from sys_user_battle_state
        where state = 0 and battlefieldid = ${phpIntval(battleinfo.id)}`),
    );
    if (count >= phpNum(battleinfo.maxpeople)) {
      throw GameError.lang('battle.invite_max_people');
    }

    const fieldname = phpString(this.battleName(battleinfo.bid));
    const inserted = await sql`insert into sys_battle_invite (fromuid, battlename, battlefieldid,
        level, time, touid, fromname, toname)
      values (${uid}, ${fieldname}, ${phpIntval(battleinfo.id)}, ${phpString(battleinfo.level)},
        unix_timestamp(), ${touserid}, ${myname}, ${invitename})`.execute(db);
    const resultid = Number(inserted.insertId ?? 0);
    const ret: unknown[] = [];
    if (resultid) {
      ret.push(1, this.lang.t('battle.invite_user_suc'), count, {
        fromuid: uid,
        id: resultid,
        touid: touserid,
        name: invitename,
        herocount: 0,
        honour,
        cancel: true,
        state: this.lang.t('battle.state_invite'),
      });
      const id = await this.cell(sql<Row>`select id as v from cfg_task_goal where tid = 283`);
      await sql`insert into sys_user_goal (uid, gid) values (${uid}, ${phpString(id)})
        on duplicate key update gid = ${phpString(id)}`.execute(db);
    } else {
      ret.push(0, this.lang.t('battle.invite_user_fail'), count);
    }
    return ret;
  }

  /** BattleFunc.php::ignoreBattle:3998 — drop an invite (any invite; no uid filter, as原文). */
  @GlobalCommand()
  async ignoreBattle(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const inviteid = phpIntval(param.shift());
    await sql`delete from sys_battle_invite where id = ${inviteid}`.execute(this.scope.db);
    return [
      await this.rows(sql<Row>`select * from sys_battle_invite where touid = ${ctx.uid}
        and state = 0 order by time desc`),
    ];
  }

  /** BattleFunc.php::cancelBattleInvite:4008 — the creator withdraws an invite. */
  @GlobalCommand()
  async cancelBattleInvite(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const inviteid = phpIntval(param.shift());
    const invite = await this.row(
      sql<Row>`select * from sys_battle_invite where id = ${inviteid} and fromuid = ${ctx.uid}`,
    );
    if (!invite) throw GameError.lang('battle.invite_not_exist');

    const result = await sql`delete from sys_battle_invite where id = ${inviteid}`.execute(
      this.scope.db,
    );
    const ret: unknown[] = [];
    if (Number(result.numAffectedRows ?? 0) > 0) {
      ret.push(this.lang.t('battle.cancel_invite_suc'), inviteid);
    } else {
      ret.push(this.lang.t('battle.cancel_invite_suc'), 0);
    }
    return ret;
  }

  /** BattleFunc.php::firstGetUserBattleInfo:18 — the user's joined battlefield (state 0) or throws. */
  private async firstGetUserBattleInfo(uid: number): Promise<Row> {
    const row = await this.row(sql<Row>`select su.honour, u.unionid, u.battlefieldid, b.bid,
      b.createuid, b.level, b.maxpeople, b.starttime, b.endtime, b.type, b.state, b.winner,
      u.in_cross_battle, c.name
      from sys_user_battle_state u
      left join sys_user_battle_field b on u.battlefieldid = b.id
      left join cfg_battle_field c on b.bid = c.id
      left join sys_user su on u.uid = su.uid
      where u.state = 0 and u.uid = ${uid}`);
    if (!row) throw GameError.lang('battle.user_not_in_battle');
    if (phpLooseEquals(row.state, 1)) throw GameError.lang('battle.battle_froze');
    return row;
  }

  /** `sql_check` against a won log_battle_honour row for this battlefield instance. */
  private async checkLogBattleHonourWin(uid: number, battlefieldid: unknown): Promise<boolean> {
    return this.check(sql<Row>`select * from log_battle_honour where uid = ${uid}
      and battlefieldid = ${battlefieldid} and result = 0`);
  }

  /** BattleFunc.php::dropBattleGoods:2603 — the level-5 黄巾/官渡 win drops, 3 per day. */
  private async dropBattleGoods(uid: number, battleid: unknown, level: unknown): Promise<void> {
    if (!phpLooseEquals(battleid, '2001') && !phpLooseEquals(battleid, '1001')) return;
    if (!phpLooseEquals(level, 5)) return;
    const goods = await this.rows(
      sql<Row>`select * from cfg_act_task_good_drop where param = ${phpString(level)}
        and unix_timestamp() > starttime and unix_timestamp() < endtime
        and actiontype = ${phpString(battleid)}`,
    );
    for (const good of goods) {
      const gid = phpNum(good.type);
      const dayCount = phpNum(
        await this.cell(sql<Row>`select sum(\`count\`) as v from log_goods where uid = ${uid}
          and type = ${phpString(battleid)} and curdate() = date(from_unixtime(time))`),
      );
      if (dayCount < 3) {
        const count = phpNum(good.count);
        const type = battleid;
        if (gid > 0 && !phpLooseEquals(count, 0)) {
          await this.goods.addGoods(uid, gid, count, phpNum(type));
          if (phpLooseEquals(type, 1)) {
            await sql`insert into log_battle_drop (uid, \`count\`, time)
              values (${uid}, ${count}, unix_timestamp())
              on duplicate key update count = count + ${count}, time = unix_timestamp()`.execute(
              this.scope.db,
            );
          }
        }
      }
    }
  }

  /** BattleFunc.php::autoTransferCaptain:4235 — a quitting creator hands the field over. */
  private async autoTransferCaptain(uid: number): Promise<void> {
    const battlefield = await this.row(sql<Row>`select * from sys_user_battle_field
      where createuid = ${uid}
        and id = (select battlefieldid from sys_user_battle_state where state = 0 and uid = ${uid})`);
    if (!battlefield) return;
    const battlefieldid = phpIntval(battlefield.id);
    const userinfo = await this.row(sql<Row>`select * from sys_user_battle_state
      where state = 0 and battlefieldid = ${battlefieldid} and uid != ${uid}
      order by jointime limit 1`);
    if (!userinfo) return;
    const touid = phpIntval(userinfo.uid);
    await sql`update sys_user_battle_field set createuid = ${touid}
      where id = ${battlefieldid}`.execute(this.scope.db);
    // 发战报
    await this.report.sendReport(touid, 40, 0, 0, this.lang.t('battle.become_captain'));
  }

  /** BattleFunc.php::punishNotAdult:4253 — the anti-addiction honour multiplier. */
  private async punishNotAdult(uid: number): Promise<number> {
    if (phpLooseEquals(uid, '')) return 1;
    const row = await this.row(sql<Row>`select * from sys_user_fcm where uid = ${uid}`);
    if (!row) return 1;
    // login_time / logout_time / offline_time are read but unused (and not in the table).
    if (phpLooseEquals(row.state, 1) || phpLooseEquals(row.state, 5)) return 1; // 成人 或 审核中
    const onlineTime = phpIntval(phpIntval(row.onlinetime) / 60);
    if (onlineTime > 3 * 30 && onlineTime < 5 * 60) return 0.5;
    if (onlineTime >= 5 * 60) return 0;
    return 1;
  }

  /** `$GLOBALS['battle']['name'][$bid]` — undefined index reads as '' through phpString. */
  private battleName(bid: unknown): string | undefined {
    const names = this.lang.value<Record<string, Record<string, string>>>('battle')?.name;
    return names?.[phpString(bid)];
  }

  private async rows(query: ReturnType<typeof sql<Row>>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }
  private async row(query: ReturnType<typeof sql<Row>>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }
  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : undefined;
  }
  private async check(query: ReturnType<typeof sql<Row>>): Promise<boolean> {
    return (await this.rows(query)).length > 0;
  }
}
