/**
 * BattleFunc.php battlefield troop-support commands (stage 9 / S4 second half): the army detail
 * readers, the two recall paths, both reinforcement intake commands, the march speedup and the
 * city 探索 — questInCity / getCityBattleTroopDetail / getBattleTroopDetail / callBackArmy /
 * callBackToField / addArmyFromReinforce / callArmy / fasterArmy / getFasterGoodInfo /
 * fasterChibiArmy / fasterMenghuoArmy. All are openfunc global commands (lang.php:2643-2650).
 *
 * Not ported (cross-server, same verdict as stage 8): the 赤壁 (11000) / 七擒孟获 (9001) remote
 * fast paths. fasterChibiArmy / fasterMenghuoArmy keep their literal `if (battlefieldid == …)`
 * gate; the body is the remote request, which the standalone package cannot make (CHIBI_NET /
 * BATTLE_NET both disabled → `sendChibiRemoteRequest` / `sendRemote9001Request` throw an empty
 * Exception). fastChiBiArmy / fastMenghuoArmy / fastRemoteArmy are unreferenced by any local
 * path once the remote request throws, so they stay out (BattleFunc.php:2870-2987).
 *
 * callBackArmy's bid=5001 (千里走单骑) auto-fail branch calls quitBattle — that command belongs
 * to the join/quit slice; until it is ported the hook stays unset and the branch is skipped
 * (logged), like battle-result's stub seams.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { sprintf } from '../common/sprintf';
import { GoodsRules } from '../core/goods-rules.service';
import { ReportService } from '../core/report.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import {
  enoughIntervalFromLastMark,
  enhanceArmy,
  firstGetUserBattleInfo,
  getSoldierMap,
  getSoldierPeople,
  getSoldierString,
  ifFrozeExit,
  resetBattleFieldUid,
  sendBattleEvent,
  sendBattleMsg,
  type BattlefieldDeps,
} from './battlefield-troop-support';

type Row = Record<string, unknown>;

/** Injection token for the join/quit slice's quitBattle (wired in battlefield-troop-support.module). */
export const BATTLEFIELD_QUIT = Symbol('BATTLEFIELD_QUIT');

export interface BattlefieldQuit {
  /** BattleFunc.php::quitBattle — called by callBackArmy's bid=5001 auto-fail branch. */
  quitBattle(uid: number, param: unknown[]): Promise<unknown>;
}

/** BattleFunc.php:1763/1885 `$SOLDIER_PEOPLE` — people cost per soldier sid (index 0 unused). */
const SOLDIER_PEOPLE: number[] = [0, 1, 1, 1, 1, 1, 2, 3, 6, 4, 5, 10, 8];
/** BattleFunc.php:2657 `$SOLDIER_VALUE` — the 援军令 tier value per soldier sid. */
const SOLDIER_VALUE: number[] = [
  0, 22.5, 30.5, 69.5, 90, 135, 140, 285, 875, 297.5, 1000, 1375, 2900,
];

@Injectable()
export class BattlefieldTroopSupportCommands {
  private readonly logger = new Logger('BattlefieldTroopSupport');

  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly report: ReportService,
    @Optional() @Inject(BATTLEFIELD_QUIT) private readonly quit?: BattlefieldQuit,
  ) {}

  private get db() {
    return this.scope.db;
  }

  private deps(): BattlefieldDeps {
    return {
      db: this.db,
      query: async (q) => (await q.execute(this.db)).rows,
      one: async (q) => (await q.execute(this.db)).rows[0] ?? false,
      cell: async (q) => {
        const row = (await q.execute(this.db)).rows[0];
        return row ? Object.values(row)[0] : false;
      },
      lang: (key) => this.lang.t(key),
    };
  }

  /** utils.php::checkGoodsCount (lockUser is the gateway's per-user mutual exclusion). */
  private async checkGoodsCount(uid: number, gid: number, need: number): Promise<boolean> {
    const count = await this.deps().cell(
      sql<Row>`select \`count\` as v from sys_goods where uid = ${uid} and gid = ${gid}`,
    );
    return (phpEmpty(count) ? 0 : phpNum(count)) >= need;
  }

  // ─────────────────────────── questInCity ───────────────────────────

  /**
   * BattleFunc.php:36 questInCity — explore a battlefield 据点 with an own army standing in it
   * (sys_battle_city.can_quest=1). 60s per (battlefield, city) cooldown through
   * mem_battle_event_mark (mark_id 1, update=true), then the event_type=11 trigger row and the
   * cfg_battle_event message for triggerid = cid%1000.
   */
  @GlobalCommand()
  async questInCity(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const deps = this.deps();
    const uid = ctx.uid;
    const hid = phpIntval(param.shift());
    const cid = phpIntval(param.shift());
    const battleinfo = (await firstGetUserBattleInfo(deps, uid)) as Row;
    const ret: unknown[] = [];
    // 检查是否有军队在该城池，否则不能探索
    const cityinfo = await deps.one(
      sql<Row>`select can_quest as v from sys_battle_city where cid = ${cid}`,
    );
    const ahid = await deps.cell(sql<Row>`select b.hid as v from sys_battle_city a, sys_troops b
      where a.battlefieldid = ${phpIntval(battleinfo.battlefieldid)} and a.cid = ${cid}
      and a.cid = b.cid and b.uid = ${uid} limit 1`);
    if (phpIntval(cityinfo ? cityinfo.v : null) === 1 && !phpEmpty(ahid)) {
      let questHid = hid;
      if (questHid === 0) questHid = phpIntval(ahid);
      // 检查上次探索的时间
      if (
        await enoughIntervalFromLastMark(
          deps,
          phpIntval(battleinfo.battlefieldid),
          1,
          cid,
          true,
          60,
        )
      ) {
        await sendBattleEvent(
          deps,
          0,
          uid,
          phpIntval(battleinfo.bid),
          phpIntval(battleinfo.battlefieldid),
          phpIntval(battleinfo.unionid),
          cid % 1000,
          11,
        );
        ret.push(await deps.one(sql<Row>`select * from sys_city_hero where hid = ${questHid}`));
        const acid = cid % 1000;
        ret.push(
          await deps.cell(sql<Row>`select msg as v from cfg_battle_event
            where bid = ${phpIntval(battleinfo.bid)} and triggertype = 11 and targettype = 0
            and triggerid = ${acid} limit 1`),
        );
      } else {
        throw GameError.lang('battle.too_frequent_quest');
      }
    } else {
      throw GameError.lang('battle.can_not_quest');
    }
    return ret;
  }

  // ──────────────────── getCityBattleTroopDetail ────────────────────

  /**
   * BattleFunc.php:1618 getCityBattleTroopDetail — the short army card (no march fields). NPC
   * troops (uid <= 897) take their name/heroinfo from the union/cfg_battle_hero tables; player
   * troops from sys_user/sys_city_hero. A battleunionid > 1000 is another player's uid.
   */
  @GlobalCommand()
  async getCityBattleTroopDetail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    void ctx;
    return this.troopDetail(param, false);
  }

  /** BattleFunc.php:1662 getBattleTroopDetail — the full card with march/target/thing fields. */
  @GlobalCommand()
  async getBattleTroopDetail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    void ctx;
    return this.troopDetail(param, true);
  }

  /** The two detail readers share this body; `$full` selects the extra columns and blocks. */
  private async troopDetail(param: unknown[], full: boolean): Promise<unknown[]> {
    const deps = this.deps();
    const troopid = phpIntval(param.shift());
    const troop = await deps.one(sql<Row>`select id, cid, uid, soldiers, hid, targetcid,
        ${full ? sql`pathtime, endtime, state,` : sql``} battleunionid from sys_troops
      where id = ${troopid}`);
    if (phpEmpty(troop)) throw GameError.lang('callBackTroop.invalid_army');
    const t = troop as Row;
    const info: Row = {};
    info.id = t.id;
    info.uid = t.uid;
    info.soldiers = t.soldiers;
    if (full) {
      info.pathtime = t.pathtime;
      info.endtime = t.endtime;
      info.state = t.state;
    }
    info.unionname = await deps.cell(
      sql<Row>`select name as v from cfg_battle_union where unionid = ${phpIntval(t.battleunionid)}`,
    );
    if (phpNum(t.uid) <= 897) {
      // 君主的（NPC 阵营部队）
      info.name = info.unionname;
      if (phpNum(t.battleunionid) > 1000) {
        info.name = await deps.cell(
          sql<Row>`select name as v from sys_user where uid = ${phpNum(t.battleunionid)}`,
        );
        info.unionname = info.name;
      }
      info.heroinfo = await deps.one(
        sql<Row>`select name, level from cfg_battle_hero where hid = ${phpIntval(t.hid)}`,
      );
    } else {
      info.name = await deps.cell(
        sql<Row>`select name as v from sys_user where uid = ${phpNum(t.uid)}`,
      );
      if (phpNum(t.battleunionid) > 1000) {
        info.unionname = info.name;
      }
      info.heroinfo = await deps.one(
        sql<Row>`select name, level from sys_city_hero where hid = ${phpIntval(t.hid)}`,
      );
    }

    if (full) {
      // 前往派遣或者前往攻击
      const state = phpIntval(t.state);
      if (state === 0 || state === 1 || state === 2 || state === 3) {
        info.targetcityname = await deps.cell(
          sql<Row>`select name as v from sys_battle_city where cid = ${phpIntval(t.targetcid)}`,
        );
      } else if (state === 4) {
        info.targetcityname = await deps.cell(
          sql<Row>`select name as v from sys_battle_city where cid = ${phpIntval(t.cid)}`,
        );
      } else {
        info.targetcityname = '--';
      }
      this.applyBattleStateText(info);
    }

    const buffers = await deps.query(
      sql<Row>`select buftype, bufparam from mem_troops_buffer where troopid = ${troopid}`,
    );
    if (!phpEmpty(buffers)) {
      info.buffers = buffers;
    }

    if (full) {
      // 检查军队的道具
      const troopthing = await deps.one(sql<Row>`select b.name as name, a.count as count
        from sys_troop_things a, cfg_things b where a.thing_id = b.tid and troop_id = ${troopid}
        limit 1`);
      if (!phpEmpty(troopthing)) {
        info.thingname = (troopthing as Row).name;
        info.thingcount = (troopthing as Row).count;
      } else {
        info.thingname = '--';
        info.thingcount = '--';
      }
    }
    return [info];
  }

  /**
   * The battle.state_0..4 text the detail reader and fasterArmy write over the numeric state,
   * with pathtime/endtime blanked for the non-marching states (2 等待 / 3 战斗 / 4 驻军).
   */
  private applyBattleStateText(info: Row): void {
    const state = phpIntval(info.state);
    if (state === 0) {
      info.state = this.battleStr('state_0');
    } else if (state === 1) {
      info.state = this.battleStr('state_1');
    } else if (state === 2) {
      info.state = this.battleStr('state_2');
      info.pathtime = '--';
      info.endtime = '--';
    } else if (state === 3) {
      info.state = this.battleStr('state_3');
      info.pathtime = '--';
      info.endtime = '--';
    } else if (state === 4) {
      info.state = this.battleStr('state_4');
      info.pathtime = '--';
      info.endtime = '--';
    }
  }

  private battleStr(key: string): string {
    const v = this.lang.value<Record<string, unknown>>('battle')?.[key];
    return typeof v === 'string' ? v : '';
  }

  // ─────────────────────────── callBackArmy ───────────────────────────

  /**
   * BattleFunc.php:1751 callBackArmy — a stationed (state 4) army leaves the battlefield for its
   * start city: task 7 / state 1 / endtime now+30 / battlefieldid 0 / cid=startcid. Called-back
   * reinforcements (sys_battle_reinforce) are deducted from the army and refunded into 战场荣誉
   * (floor(backcount * SOLDIER_PEOPLE[sid] / 100)); an emptied army throws its hero home instead.
   * The bid 4001 玉玺 wipe and bid 5001 auto-fail (quitBattle) branches ported as written.
   */
  @GlobalCommand()
  async callBackArmy(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const deps = this.deps();
    const uid = ctx.uid;
    const troopid = phpIntval(param.shift());
    const troop = await deps.one(
      sql<Row>`select * from sys_troops where id = ${troopid} and uid = ${uid}`,
    );
    if (phpEmpty(troop)) throw GameError.lang('battle.troop_not_exist');
    const t = troop as Row;
    if (phpIntval(t.state) !== 4) throw GameError.lang('battle.troop_not_stay');

    const { newsoldiers, backhonour } = await returnReinforceSoldiers(deps, t);

    // `sql_query` resolves on success, so `$result` is always truthy — the fail branch below is
    // the original's shape, kept for the diff.
    const result = true;
    if (newsoldiers !== '') {
      // 所有军队设置为返回状态
      await sql`update sys_troops set starttime = unix_timestamp(), task = 7, state = 1,
        soldiers = ${newsoldiers}, endtime = unix_timestamp() + 30, battlefieldid = 0,
        cid = startcid where id = ${phpIntval(t.id)}`.execute(this.db);
      if (backhonour > 0) {
        await sql`update sys_user set honour = honour + ${backhonour} where uid = ${uid}`.execute(
          this.db,
        );
        const msg = sprintf(this.battleStr('callback_army_honour'), backhonour);
        // 发战报
        await this.report.sendReport(uid, 40, 0, 0, msg);
      }
    } else {
      // 返还援军后军队为0，则直接把将领扔回城。
      await sql`update sys_city_hero set state = 0 where hid = ${phpIntval(t.hid)}`.execute(
        this.db,
      );
      await sql`delete from sys_troops where id = ${phpIntval(t.id)}`.execute(this.db);
      if (backhonour > 0) {
        await sql`update sys_user set honour = honour + ${backhonour} where uid = ${uid}`.execute(
          this.db,
        );
        const msg = sprintf(this.battleStr('callback_army_honour'), backhonour);
        await this.report.sendReport(uid, 40, 0, 0, msg);
      }
    }

    const ret: unknown[] = [];
    if (result) {
      ret.push(this.battleStr('callback_succ'));
      await resetBattleFieldUid(deps, phpIntval(t.cid));
      if (phpIntval(t.bid) === 4001) {
        // 如果从董卓战场撤军，且这只军队身上有玉玺的话，刷掉玉玺，其他玩家可以继续打玉玺
        const has = await this.deps().cell(sql<Row>`select count as v from sys_troop_things
          where troop_id = ${troopid} and thing_id = 45`);
        if (!phpEmpty(has)) {
          await sql`delete from sys_troop_things where troop_id = ${troopid} and thing_id = 45`.execute(
            this.db,
          );
          await sql`delete from sys_things where uid = ${uid} and tid = 45`.execute(this.db);
          await sql`delete from sys_user_battle_event where eventid = (
            select id from cfg_battle_event where bid = 4001 and targettype = 21
            and targetid1 = 45)`.execute(this.db);
          await sql`update sys_user_battle_state set unionid = 7
            where state = 0 and uid = ${uid}`.execute(this.db);
          const heroname = phpString(
            await this.deps().cell(
              sql<Row>`select name as v from sys_city_hero where hid = ${phpIntval(t.hid)}`,
            ),
          );
          const msg = sprintf(this.battleStr('callback_yuxi_army'), heroname);
          await sendBattleMsg(deps, phpIntval(t.battlefieldid), phpIntval(t.battleunionid), msg);
        }
      }
      if (phpIntval(t.bid) === 5001) {
        // 从千里走单骑副本撤军就意味着副本直接失败
        if (this.quit) {
          const newparam: unknown[] = [
            await this.deps().cell(sql<Row>`select name as v from sys_user where uid = ${uid}`),
          ];
          await this.quit.quitBattle(uid, newparam);
        } else {
          this.logger.debug(
            'callBackArmy: bid 5001 → quitBattle not ported yet (join/quit slice) — skipped',
          );
        }
      }
    } else {
      ret.push(this.battleStr('callback_fail'));
    }
    return ret;
  }

  // ─────────────────────────── callBackToField ───────────────────────────

  /**
   * BattleFunc.php:1865 callBackToField — recall an army that is still MARCHING (state 0) in the
   * field: state 1 with endtime = now - starttime + now. Only when it has not left its start city
   * yet (cid == startcid) are the called reinforcements deducted and honoured (without a report).
   * The original reads $troop['state'] BEFORE the empty check and has an empty
   * `if ($newsoldiers != "") {}` block — both kept. The battlefieldid=11000 branch is the chibi
   * remote call (not ported, see the file header).
   */
  @GlobalCommand()
  async callBackToField(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const deps = this.deps();
    const uid = ctx.uid;
    const troopid = phpIntval(param.shift());
    const battlefieldId = phpIntval(param.shift());
    if (battlefieldId) {
      // 如果是赤壁里面的军队就调用赤壁里面的调回方法
      if (battlefieldId === 11000) {
        // sendChibiRemoteRequest — CHIBI_NET_ENABLE=false → `throw new Exception("")`.
        throw GameError.raw('');
      }
    }
    const troop = await deps.one(
      sql<Row>`select * from sys_troops where id = ${troopid} and uid = ${uid}`,
    );
    const troopstate = troop ? troop.state : null;
    if (phpEmpty(troop)) throw GameError.lang('battle.troop_not_exist');
    const t = troop as Row;

    if (phpIntval(troopstate) !== 0) throw GameError.lang('battle.troop_not_ahead');

    let result = true;
    if (phpIntval(t.cid) === phpIntval(t.startcid)) {
      const { newsoldiers, backhonour } = await returnReinforceSoldiers(deps, t);
      if (newsoldiers !== '') {
        // the original's block here is EMPTY — nothing happens
      }
      // 返还荣誉
      if (backhonour > 0) {
        await sql`update sys_user set honour = honour + ${backhonour} where uid = ${uid}`.execute(
          this.db,
        );
      }
      await sql`update sys_troops set state = 1, soldiers = ${newsoldiers},
        endtime = unix_timestamp() - starttime + unix_timestamp(), starttime = unix_timestamp()
        where id = ${troopid}`.execute(this.db);
    } else {
      result = true;
      await sql`update sys_troops set state = 1,
        endtime = unix_timestamp() - starttime + unix_timestamp(), starttime = unix_timestamp()
        where id = ${troopid}`.execute(this.db);
    }

    const ret: unknown[] = [];
    if (result) ret.push(this.battleStr('callback_succ'));
    else ret.push(this.battleStr('callback_fail'));
    return ret;
  }

  // ─────────────────────────── addArmyFromReinforce ───────────────────────────

  /**
   * BattleFunc.php:2090 addArmyFromReinforce — take `sid` soldiers from a 据点's shared
   * reinforcement pool (sys_battle_city.reinforce_soldiers, filled by other players' 援军) into
   * the troop, capped by its ulimit. The original selects only soldiers/ulimit, so enhanceArmy's
   * cid/hid arguments are undefined in PHP (→ 0 / skipped hero fetch) — kept as such.
   */
  @GlobalCommand()
  async addArmyFromReinforce(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const deps = this.deps();
    const cid = phpIntval(param.shift());
    const troopid = phpIntval(param.shift());
    const sid = phpIntval(param.shift());
    void ctx;
    // 检查此城池中现有的补充兵员数量
    const reinforceSoldiers = await deps.cell(
      sql<Row>`select reinforce_soldiers as v from sys_battle_city where cid = ${cid}`,
    );
    const troopinfo = await deps.one(
      sql<Row>`select soldiers, ulimit from sys_troops where id = ${troopid}`,
    );
    const oriSoldiers = phpString(troopinfo ? troopinfo.soldiers : null);
    // NOTE: the original selects neither ulimit (read here with a notice → 0) nor startcid/hid
    // (read again below with a notice → 0/undefined) — reproduced from the row that came back.
    const upLimit = phpIntval(troopinfo ? troopinfo.ulimit : null);
    if (phpEmpty(oriSoldiers)) throw GameError.lang('battle.troop_not_exist');
    const soldiersMap = getSoldierMap(reinforceSoldiers);
    const oriSoldiersMap = getSoldierMap(oriSoldiers);
    let curTotalCount = 0;
    for (const tcount of oriSoldiersMap.values()) curTotalCount += tcount;

    const poolCount = soldiersMap.get(sid);
    if (poolCount !== undefined && !phpEmpty(poolCount)) {
      let availCnt: number;
      if (phpEmpty(upLimit) || upLimit === 0) {
        availCnt = poolCount;
      } else {
        availCnt = Math.max(0, Math.min(poolCount, upLimit - curTotalCount));
      }
      if (availCnt > 0) {
        await enhanceArmy(
          deps,
          troopid,
          oriSoldiers,
          sid,
          availCnt,
          phpIntval(troopinfo ? troopinfo.startcid : null),
          phpIntval(troopinfo ? troopinfo.hid : null),
        );
        soldiersMap.set(sid, poolCount - availCnt);
        const newSoldierString = getSoldierString(soldiersMap);
        await sql`update sys_battle_city set reinforce_soldiers = ${newSoldierString}
          where cid = ${cid}`.execute(this.db);
      } else {
        throw GameError.lang('battle.soldier_uplimit');
      }
    } else {
      throw GameError.lang('battle.no_reinforce');
    }
    const ret: unknown[] = [];
    ret.push(this.battleStr('add_army_succ'));
    return ret;
  }

  // ─────────────────────────── callArmy ───────────────────────────

  /**
   * BattleFunc.php:2635 callArmy — summon own reinforcements into the army with 援军令 (135) and
   * 战场荣誉: capped by honour (count1) and by the battlefield level's soldier_limit minus the
   * army's current size (count2); the honour cost is ceil(count*people/100); the item cost tiers
   * by the soldiers' value. The commented-out 300s enoughIntervalFromLastMark gate stays gone.
   */
  @GlobalCommand()
  async callArmy(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const deps = this.deps();
    const uid = ctx.uid;
    const troopid = phpIntval(param.shift());
    const sid = phpIntval(param.shift());
    const count = phpIntval(param.shift());
    const battlefieldinfo = await ifFrozeExit(deps, uid);
    const troop = await deps.one(sql<Row>`select * from sys_troops where id = ${troopid}
      and uid = ${uid} and battlefieldid = ${phpIntval(battlefieldinfo.battlefieldid)}`);
    if (phpEmpty(troop)) throw GameError.lang('battle.troop_not_exist');
    const t = troop as Row;
    if (phpIntval(t.state) === 3) throw GameError.lang('battle.troop_in_fight');
    if (phpIntval(t.state) === 1) throw GameError.lang('battle.troop_in_back_no_call');
    if (phpIntval(t.task) === 7 && (phpIntval(t.state) === 0 || phpIntval(t.state) === 1)) {
      throw GameError.lang('battle.troop_in_forward_no_call');
    }

    const people = SOLDIER_PEOPLE[sid] ?? 0;
    const honour = phpNum(battlefieldinfo.honour);
    // sid 0 would divide by zero in PHP (count1 = false → maxCall 0); no real soldier uses it.
    const count1 = people === 0 ? 0 : (honour * 100) / people;
    const allpeople = getSoldierPeople(t.soldiers);
    const limitRow = this.soldierLimit()[phpIntval(battlefieldinfo.level)];
    // an out-of-range level reads null in PHP → 0 - allpeople
    const count2 = phpNum(limitRow ?? null) - allpeople;
    const maxCall = Math.min(count1, count2);

    if (count > maxCall) throw GameError.lang('battle.call_army_max');

    const callPeople = count * people;
    const needHonour = Math.ceil(callPeople / 100);
    if (needHonour > honour) throw GameError.lang('battle.call_army_not_enough_honour');

    let yuanjun: number;
    const value = count * (SOLDIER_VALUE[sid] ?? 0);
    if (value === 0) yuanjun = 0;
    else if (value <= 100000) yuanjun = 1;
    else if (value <= 1000000) yuanjun = 2;
    else if (value <= 10000000) yuanjun = 3;
    else if (value <= 100000000) yuanjun = 4;
    else yuanjun = 5;

    if (!(await this.checkGoodsCount(uid, 135, yuanjun))) {
      // 原样字符串错误：客户端弹出 not_enough_goods135#N 的买即用弹窗。
      throw GameError.raw(`not_enough_goods135#${yuanjun}`);
    }

    const ret: unknown[] = [];
    const newsoldiers = await enhanceArmy(
      deps,
      phpIntval(t.id),
      t.soldiers,
      sid,
      count,
      phpIntval(t.startcid),
      t.hid,
      phpIntval(battlefieldinfo.bid),
    );
    if (newsoldiers) {
      await this.goods.reduceGoods(uid, 135, yuanjun);
      // 减去战场荣誉
      await sql`update sys_user set honour = honour - ${needHonour} where uid = ${uid}`.execute(
        this.db,
      );
      ret.push(1);
      ret.push(troopid);
      ret.push(newsoldiers);
      ret.push(honour - needHonour);
      ret.push(this.battleStr('call_army_suc'));
    } else {
      ret.push(0);
      ret.push(this.battleStr('call_army_fail'));
      // unlockUser — 网关互斥锁（见 marry.commands.ts 的 lockUser 注释）。
    }
    return ret;
  }

  /** `$GLOBALS['battle']['soldier_limit']` — army size cap per battlefield level. */
  private soldierLimit(): unknown[] {
    const v = this.lang.value<Record<string, unknown>>('battle')?.soldier_limit;
    return Array.isArray(v) ? v : [];
  }

  // ─────────────────────────── fasterArmy ───────────────────────────

  /**
   * BattleFunc.php:2816 fasterArmy — one 急行军令 (136) cuts a marching army's remaining time to
   * 10s (endtime=unix_timestamp()+10); refused when less than 10s remain. Replies with the fresh
   * pathtime/endtime/state block whose state text follows the detail readers.
   */
  @GlobalCommand()
  async fasterArmy(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const deps = this.deps();
    const uid = ctx.uid;
    const troopid = phpIntval(param.shift());
    const battlefieldid = phpIntval(param.shift());
    void battlefieldid; // read by the original but never used afterwards
    const battlefieldinfo = await ifFrozeExit(deps, uid);

    const troop = await deps.one(sql<Row>`select *, unix_timestamp() as \`now\` from sys_troops
      where id = ${troopid} and uid = ${uid}
      and battlefieldid = ${phpIntval(battlefieldinfo.battlefieldid)}`);
    if (phpEmpty(troop)) throw GameError.lang('battle.troop_not_exist');
    const t = troop as Row;
    if (phpIntval(t.state) !== 0 && phpIntval(t.state) !== 1) {
      throw GameError.lang('battle.troop_not_in_move');
    }

    if (phpNum(t.endtime) - phpNum(t.now) < 10) {
      throw GameError.lang('battle.troop_not_need_faster');
    }

    if (!(await this.goods.checkGoods(uid, 136))) {
      throw GameError.raw('not_enough_goods136');
    }

    await sql`update sys_troops set endtime = unix_timestamp() + 10 where id = ${troopid}`.execute(
      this.db,
    );
    const ret: unknown[] = [];
    const troopinfo = (await deps.one(sql<Row>`select pathtime, endtime, state from sys_troops
      where id = ${troopid}`)) as Row;
    this.applyBattleStateText(troopinfo);
    ret.push(troopinfo);
    // `sql_query` resolves on success, so `$result` is always truthy — the fail branch is the
    // original's shape, kept for the diff.
    const result = true;
    if (result) {
      await this.goods.reduceGoods(uid, 136, 1);
      ret.push(this.battleStr('faster_army_suc'));
    } else {
      ret.push(this.battleStr('faster_army_fail'));
    }
    return ret;
  }

  // ─────────────────────────── getFasterGoodInfo ───────────────────────────

  /** BattleFunc.php:2803 getFasterGoodInfo — the shop row for the speedup item dialog. */
  @GlobalCommand()
  async getFasterGoodInfo(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    void ctx;
    const gid = phpIntval(param.shift());
    const ret: unknown[] = [];
    ret.push(
      await this.deps().one(sql<Row>`select * from cfg_shop where onsale = 1 and gid = ${gid}`),
    );
    return ret;
  }

  // ──────────────── fasterChibiArmy / fasterMenghuoArmy ────────────────

  /**
   * BattleFunc.php:2783 fasterChibiArmy — only a bid-11000 (赤壁) army has a body: it forwards to
   * fastChiBiArmy → sendChibiRemoteRequest, which the standalone package cannot satisfy
   * (CHIBI_NET_ENABLE=false → `throw new Exception("")`). Any other battlefieldid: no-op.
   */
  @GlobalCommand()
  async fasterChibiArmy(ctx: CommandContext, param: unknown[]): Promise<unknown> {
    void ctx;
    const troopid = phpIntval(param.shift());
    const battlefieldid = param.shift(); // NOTE: no intval in the original
    if (phpLooseEquals(battlefieldid, 11000)) {
      void troopid;
      throw GameError.raw('');
    }
    return undefined; // 恒无操作（本地战场无 11000）
  }

  /** BattleFunc.php:2793 fasterMenghuoArmy — same shape for bid 9001 (七擒孟获, cross-server). */
  @GlobalCommand()
  async fasterMenghuoArmy(ctx: CommandContext, param: unknown[]): Promise<unknown> {
    void ctx;
    const troopid = phpIntval(param.shift());
    const battlefieldid = param.shift(); // NOTE: no intval in the original
    if (phpLooseEquals(battlefieldid, 9001)) {
      void troopid;
      throw GameError.raw('');
    }
    return undefined; // 恒无操作（本地战场无 9001）
  }
}

/**
 * The reinforce-refund block shared by callBackArmy (with report) and callBackToField (without):
 * deduct the sys_battle_reinforce rows (group_concat(sid,',',count)) from the army's soldiers map
 * and turn the deducted heads into 战场荣誉 via floor(backcount * SOLDIER_PEOPLE[sid] / 100).
 * `$emptytroop` / `$newsoldierstypecount` are dead in the original (the `if (!$emptytroop)`
 * branch never fires), so they are not carried over.
 */
async function returnReinforceSoldiers(
  deps: BattlefieldDeps,
  troop: Row,
): Promise<{ newsoldiers: string; backhonour: number }> {
  // 返还援军
  const reinforce = await deps.cell(sql<Row>`select group_concat(sid, ',', count) as v
    from sys_battle_reinforce where troopid = ${phpIntval(troop.id)}`);
  // 返还的战场荣誉
  let backhonour = 0;
  // 返还后的士兵
  let newsoldiers: string;
  if (!phpEmpty(reinforce)) {
    // 剩下的兵种map
    const orisoldiersmap = getSoldierMap(troop.soldiers);
    // 援兵的兵种
    const reinforcearray = phpString(reinforce).split(',');
    const reinforcearraycount = reinforcearray.length / 2;
    // 计算每个兵种的返还，如果返还后小于0，则视为0。
    for (let i = 0; i < reinforcearraycount; i++) {
      const sid = phpIntval(reinforcearray.shift());
      // 调遣过的援军数目
      const reinforcemapcount = phpNum(reinforcearray.shift());
      // 现在剩下的数目
      const oricount = orisoldiersmap.get(sid);
      let newcount = 0;
      if (oricount !== undefined && !phpEmpty(oricount)) {
        newcount = oricount - reinforcemapcount;
        if (newcount < 0) newcount = 0;
        // 该兵种返还的数值
        const backcount = oricount - newcount;
        backhonour += Math.floor((backcount * (SOLDIER_PEOPLE[sid] ?? 0)) / 100);
      }
      orisoldiersmap.set(sid, newcount);
    }
    newsoldiers = getSoldierString(orisoldiersmap);
  } else {
    newsoldiers = phpString(troop.soldiers);
  }
  return { newsoldiers, backhonour };
}
