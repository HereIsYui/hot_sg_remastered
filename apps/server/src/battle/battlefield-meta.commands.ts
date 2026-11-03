/**
 * BattleFunc.php battlefield meta commands (stage 9 / S5): the battlefield TASK / CHAT / SHOP /
 * HONOUR periphery —
 *
 *   - `refreshBattleTaskState` / `getLastMainTask` — the mview/TaskStatusPanel drivers (the local
 *     battlefields use them too; nothing cross-server here). Task completion goes through the
 *     shared `TaskGoals.markComplete` (TaskFunc.php::checkTaskComplete).
 *   - `chatWithHero` (+ internal `getChatMsg`) — the NPC story talk: cfg_battle_event
 *     triggertype=8 rows keyed by the target troop's hid; targettype2=6 passes only when the
 *     referenced task goal is recorded (sys_user_goal). hid=8056 is the 凤仪亭 (bid 8001) 工场监官:
 *     the player's carried wood (sys_troop_things tid 83) is transferred to the supervisor troop,
 *     `level*5000` wood fires the event_type=10000 trigger, and the reply reports the mark_id=101
 *     phase clock. hid=5050 keeps its literal branch (the same pass loop without the
 *     `targettype=0` filter); hid=7001 keeps its 300s talk cooldown (bid 7001 三让徐州 is not
 *     reachable locally, the branch stays for parity).
 *   - `getUserBattleShopInfo` / `getUserBattleShopInfoForChiBi` — the battle-shop inventory, and
 *     `buyBattleGoods` (+ `isChibiArmor`, `addBattleArmor`, `addBattleHero`,
 *     `addCreditAndMedal`, `addGongunAndMedal`, `updateBattleOpenState`→`openBattleField`) — the
 *     medal-currency purchase (cfg_shop group 6/7, honour + medal), reusing GoodsRules.
 *   - `getBattleHonourStat` / `getBattleFieldUsers` — the honour-contribution stat and the member
 *     list with the invite rows merged in.
 *   - `getBattleDescription` / `getBattleName` / `getBattleCondition` / `getBattleState` /
 *     `getTaskState` — internal readers, none of them in openfunc and none called anywhere in
 *     the original file; ported for parity per the slice checklist.
 *
 * Cross-server verdict (same as stage 8 / the troop-support slice): `sendRemoteRequest` /
 * `sendRemote9001Request` / `sendChibiRemoteRequest` (BattleNetFunc.php / ChibiNetFunc.php)
 * cannot be made — BATTLE_NET_ENABLE / CHIBI_NET_ENABLE are false in the standalone package and
 * both throw an empty Exception when reached. The affected reads reproduce exactly the disabled
 * result: 跨服功勋/爵位/PVE勋绩 are -1 (so group-7 and 9001 goods are always refused), 赤壁功勋
 * reads 0, and `addGongunAndMedal` throws the empty message AFTER its medal write, like PHP.
 *
 * `sendBattleEvent` / `sendBattleMsg` live in battlefield-troop-support.ts (S4 ported them);
 * imported here instead of reimplemented. lockUser/unlockUser is the gateway's per-user mutex.
 */

import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpCompare, phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { TaskGoals } from '../task/task-goals.service';
import {
  addTroopThings,
  enoughIntervalFromLastMark,
  firstGetUserBattleInfo,
  removeTroopThings,
  sendBattleEvent,
  type BattlefieldDeps,
} from './battlefield-troop-support';

type Row = Record<string, unknown>;

/**
 * BattleFunc.php:109 — the battlefield task tids refreshBattleTaskState watches. The per-bid
 * special case above it is commented out in the original; the list is a constant.
 */
const ALARM_TIDS = [
  60901, 60902, 60903, 60904, 60905, 60906, 60907, 60908, 60909, 60910, 60911, 60912, 60913, 60914,
  60915, 60916, 60917, 60918, 60919,
];

/** common.php:57 — the 招贤馆/官府 building bid cityHasHeroPosition checks. */
const ID_BUILDING_OFFICE = 11;

/**
 * BattleFunc.php:725 isChibiArmor — the two 赤壁 armor medal types buy with 赤壁功勋 instead of
 * the player's honour.
 */
export function isChibiArmor(good: Row | false | undefined): boolean {
  if (good) {
    if (phpLooseEquals(good.medalTypeId, 60015) || phpLooseEquals(good.medalTypeId, 60016)) {
      return true;
    }
  }
  return false;
}

/** lib/database.php fetch_map: `{key: row}` — a later row with the same key overwrites. */
function mapOf(rows: Row[], key: string): Record<string, Row> {
  const map: Record<string, Row> = {};
  for (const row of rows) map[phpString(row[key])] = row;
  return map;
}

/** lib/database.php fetch_complex_map: `{key: [rows…]}` in row order. */
function complexMapOf(rows: Row[], key: string): Record<string, Row[]> {
  const map: Record<string, Row[]> = {};
  for (const row of rows) {
    const k = phpString(row[key]);
    (map[k] ??= []).push(row);
  }
  return map;
}

/**
 * BattleFunc.php battlefield meta: task panel, NPC chat, battle shop and honour stat.
 * No scope.transaction() wraps buyBattleGoods's writes: the original runs bare and its failure
 * paths (remote deduct) leave the earlier writes standing, as in PHP.
 */
@Injectable()
export class BattlefieldMetaCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly goals: TaskGoals,
    private readonly users: UserRules,
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

  // ─────────────────── refreshBattleTaskState / getLastMainTask ───────────────────

  /**
   * BattleFunc.php:102 refreshBattleTaskState — the battlefield task panel's per-据点 state:
   * check the open 60901-60919 tasks, then `min(3 when finished else type)` per cfg_task_cid
   * city. `order by cid` added for a deterministic reply (the original relied on MyISAM order).
   */
  @GlobalCommand()
  async refreshBattleTaskState(ctx: CommandContext): Promise<Row[]> {
    const uid = ctx.uid;
    const tids = await this.rows(sql<Row>`select tid as id from sys_user_task
      where uid = ${uid} and state = 0 and tid in (${sql.join(
        ALARM_TIDS.map((t) => sql`${t}`),
        sql`, `,
      )})`);
    // TaskFunc.php::checkTaskComplete — mutates each row's `state` and raises sys_alarm once.
    await this.goals.markComplete(uid, tids as Row[]);
    const finishedTids = [0];
    const allTids = [0];
    for (const taskState of tids) {
      if (taskState.state) finishedTids.push(phpIntval(taskState.id));
      allTids.push(phpIntval(taskState.id));
    }
    return this.rows(sql<Row>`select cid, min(state) as state from (
        select cid, case when tid in (${sql.join(
          finishedTids.map((t) => sql`${t}`),
          sql`, `,
        )}) then 3 else type end as state
        from cfg_task_cid where tid in (${sql.join(
          allTids.map((t) => sql`${t}`),
          sql`, `,
        )})
      ) a group by cid order by cid`);
  }

  /**
   * BattleFunc.php:128 getLastMainTask — the 8001 (孟获) main-task chain for the task panel;
   * every other bid answers an empty list.
   */
  @GlobalCommand()
  async getLastMainTask(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const bid = param.shift();
    if (!phpLooseEquals(bid, 9001)) return [];
    return this.rows(sql<Row>`select cfg.name, cfg.todo, cfg.id, goal.count, goal.type, goal.sort
      from sys_user_task sys
      left join cfg_task cfg on sys.tid = cfg.id
      left join cfg_task_goal goal on goal.tid = cfg.id
      where sys.uid = ${uid} and sys.tid between 60901 and 60914`);
  }

  // ─────────────────────────── chatWithHero / getChatMsg ───────────────────────────

  /**
   * BattleFunc.php:4336 chatWithHero — talk to the NPC hero standing in the same 据点 as one of
   * the player's garrisoned (state 3/4) troops. The reply is `[faceRow, msg, faceRow, msg…]`
   * pairs, always followed by the event_type=8 trigger row.
   */
  @GlobalCommand()
  async chatWithHero(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const deps = this.deps();
    const uid = ctx.uid;
    const p = [...param];
    const troopid = phpIntval(p.shift());
    const myTroopinfo = await deps.one(
      sql<Row>`select id, cid, battleunionid, hid from sys_troops
        where id = ${troopid} and (state = 3 or state = 4)`,
    );
    // PHP reads `$myTroopinfo["cid"]` even when the fetch failed (notice + null).
    const cid = myTroopinfo ? phpIntval(myTroopinfo.cid) : null;
    const targettroopid = phpIntval(p.shift());
    const troopinfo = await deps.one(
      sql<Row>`select cid, id, uid, hid, state, bid, battlefieldid, battleunionid from sys_troops
        where id = ${targettroopid}`,
    );
    if (phpEmpty(troopinfo)) throw GameError.lang('battle.troop_not_exist');
    if (phpEmpty(cid) || !phpLooseEquals(cid, (troopinfo as Row).cid)) {
      throw GameError.lang('battle.only_talk_in_same_city');
    }
    const t = troopinfo as Row;
    // The original interpolates $bid raw — a bid-less troop would die in PearDB; 0 matches no
    // cfg_battle_event row instead.
    const bid = phpIntval(t.bid);
    const hid = phpIntval(t.hid);
    const battleinfo = (await firstGetUserBattleInfo(deps, uid)) as Row;

    if (phpLooseEquals(t.bid, 7001)) {
      // 三让徐州副本不能一直不断交谈
      if (!(await enoughIntervalFromLastMark(deps, phpIntval(t.battlefieldid), 2, hid, true))) {
        throw GameError.lang('battle.too_frequent_talk');
      }
    }

    const battlefieldid = phpIntval(t.battlefieldid);
    // Reaching here means the cid guard passed, so $myTroopinfo is a row (as in PHP).
    const my = myTroopinfo as Row;
    const unionid = phpIntval(my.battleunionid);
    const myHid = phpIntval(my.hid);
    let ret: unknown[];
    if (hid === 8056) {
      // 凤仪亭，跟监管说话，先转移木头 (bid 8001)
      ret = await this.chatWithWoodSupervisor(
        deps,
        uid,
        troopid,
        my,
        targettroopid,
        bid,
        battlefieldid,
        unionid,
        hid,
        battleinfo,
      );
    } else if (hid === 5050) {
      ret = [];
      // NOTE: no `targettype = 0` filter here, unlike getChatMsg — as in the original.
      const events = await deps.query(
        sql<Row>`select * from cfg_battle_event
          where bid = ${bid} and triggertype = 8 and triggerid = ${hid} order by id`,
      );
      // 查找第一个符合条件的 (the loop appends every passing event, like the original)
      for (const event of events) {
        if (await this.chatEventPasses(deps, uid, event)) {
          ret.push(await this.chatFaceRow(deps, event, hid, myHid));
          ret.push(event.msg);
        }
      }
      if (ret.length === 0) {
        ret.push(
          await deps.one(sql<Row>`select sex, face from cfg_battle_hero where hid = ${hid}`),
        );
        ret.push(this.lang.t('battle.defaut_chat_msg'));
      }
    } else {
      ret = await this.getChatMsg(deps, uid, bid, hid, myHid);
    }

    await sendBattleEvent(deps, troopid, uid, bid, battlefieldid, unionid, phpIntval(t.hid), 8);
    return ret;
  }

  /**
   * BattleFunc.php:4360-4378 — the 凤仪亭 supervisor: move the player's wood (tid 83) onto the
   * supervisor troop, fire event 10000 once the troop holds `level*5000`, and answer with the
   * wood tally plus the phase clock kept in mem_battle_event_mark mark_id=101.
   */
  private async chatWithWoodSupervisor(
    deps: BattlefieldDeps,
    uid: number,
    troopid: number,
    myTroopinfo: Row,
    targettroopid: number,
    bid: number,
    battlefieldid: number,
    unionid: number,
    hid: number,
    battleinfo: Row,
  ): Promise<unknown[]> {
    const myId = phpIntval(myTroopinfo.id);
    // NOTE: neither query filters thing_id — the first sys_troop_things row of the troop, as-is.
    const userCnt = phpNum(
      await deps.cell(
        sql<Row>`select \`count\` as v from sys_troop_things where troop_id = ${myId}`,
      ),
    );
    let totalCnt = phpIntval(
      await deps.cell(
        sql<Row>`select \`count\` as v from sys_troop_things where troop_id = ${targettroopid}`,
      ),
    );
    if (userCnt > 0) {
      await addTroopThings(deps, 0, targettroopid, 83, userCnt);
      await removeTroopThings(deps, myId, 83);
    }
    const reqCnt = phpNum(battleinfo.level) * 5000;
    totalCnt = totalCnt + userCnt;
    if (totalCnt >= reqCnt) {
      totalCnt = reqCnt;
      await sendBattleEvent(deps, troopid, uid, bid, battlefieldid, unionid, hid, 10000);
    }
    // 取得第2阶段开始的时间
    const timeleft = await deps.cell(
      sql<Row>`SELECT GREATEST(15 - FLOOR((UNIX_TIMESTAMP() - TIME) / 60), 0) as v
        FROM mem_battle_event_mark WHERE battlefieldid = ${battlefieldid} AND mark_id = 101`,
    );
    // PHP sprintf turns a missing mark row (false) into ""; phpString does the same.
    const msg = this.lang.t(
      'battle.8001_wood_state',
      totalCnt,
      reqCnt - totalCnt,
      phpString(timeleft),
    );
    return [
      await deps.one(sql<Row>`select sex, face from cfg_battle_hero where hid = ${hid}`),
      msg,
    ];
  }

  /**
   * BattleFunc.php:4302 getChatMsg — the generic talk: cfg_battle_event triggertype=8 events of
   * the target hero, first passing row's text (with the default line when none). The original
   * signature also takes unused `$myTroopId` / `$targetTroopId`; kept for parity.
   */
  async getChatMsg(
    deps: BattlefieldDeps,
    uid: number,
    bid: number,
    hid: number,
    userHid: number,
    _myTroopId = 0,
    _targetTroopId = 0,
  ): Promise<unknown[]> {
    void _myTroopId;
    void _targetTroopId;
    const ret: unknown[] = [];
    const events = await deps.query(
      sql<Row>`select * from cfg_battle_event
        where bid = ${bid} and triggertype = 8 and targettype = 0 and triggerid = ${hid} order by id`,
    );
    for (const event of events) {
      if (await this.chatEventPasses(deps, uid, event)) {
        ret.push(await this.chatFaceRow(deps, event, hid, userHid));
        ret.push(event.msg);
      }
    }
    if (ret.length === 0) {
      ret.push(await deps.one(sql<Row>`select sex, face from cfg_battle_hero where hid = ${hid}`));
      ret.push(this.lang.t('battle.defaut_chat_msg'));
    }
    return ret;
  }

  /** BattleFunc.php:4307-4316 — targettype2 gate: 0 always passes, 6 needs the goal recorded. */
  private async chatEventPasses(deps: BattlefieldDeps, uid: number, event: Row): Promise<boolean> {
    const targettype2 = phpIntval(event.targettype2);
    if (targettype2 === 0) return true;
    if (targettype2 === 6) {
      // 判定任务完成 — the original interpolates a missing goal id raw (PearDB die); gid 0
      // matches no sys_user_goal row instead.
      const gid = phpIntval(
        await deps.cell(
          sql<Row>`select id as v from cfg_task_goal where tid = ${phpIntval(event.targetid2)}`,
        ),
      );
      return (
        (
          await deps.query(
            sql<Row>`select 1 from sys_user_goal where uid = ${uid} and gid = ${gid}`,
          )
        ).length > 0
      );
    }
    return false;
  }

  /** BattleFunc.php:4318-4326 — whose face renders: the option hero, or the talker's own hero. */
  private async chatFaceRow(
    deps: BattlefieldDeps,
    event: Row,
    hid: number,
    userHid: number,
  ): Promise<Row | false> {
    let ahid = hid;
    if (phpNum(event.targetid1_option) > 0) {
      ahid = phpIntval(event.targetid1_option);
    }
    if (phpNum(event.targetid1_option) >= 0) {
      return deps.one(sql<Row>`select sex, face from cfg_battle_hero where hid = ${ahid}`);
    }
    return deps.one(sql<Row>`select sex, face from sys_city_hero where hid = ${userHid}`);
  }

  // ──────────────────── getUserBattleShopInfo(ForChiBi) / buyBattleGoods ────────────────────

  /** BattleFunc.php:532 — the 赤壁 client calls the same shop reader. */
  @GlobalCommand()
  async getUserBattleShopInfoForChiBi(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.getUserBattleShopInfo(ctx, param);
  }

  /**
   * BattleFunc.php:536 getUserBattleShopInfo — the battle-shop page: whether the player may open
   * a battlefield at all (nobility), the open battlefields (canCreate for type 0), the honour /
   * exploit tallies and the medal-currency goods, armors and heroes.
   */
  @GlobalCommand()
  async getUserBattleShopInfo(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    void param;
    const uid = ctx.uid;
    const ret: unknown[] = [];
    const currentbattle = await firstGetUserBattleInfo(this.deps(), uid, 0);
    if (phpEmpty(currentbattle)) {
      let nobility = phpIntval(
        await this.cell(sql<Row>`select nobility as v from sys_user where uid = ${uid}`),
      );
      nobility = await this.users.bufferNobility(uid, nobility);
      if (nobility < 1) {
        ret[0] = 1;
      } else {
        ret[0] = 0;
      }
    } else {
      ret[0] = 1;
    }
    // BATTLE_NET_ENABLE / CHIBI_NET_ENABLE are both false (config/db.php:27/34) → the plainest
    // battle filter. `order by id` added; the original relied on MyISAM order.
    const cfgbattles = await this.rows(
      sql<Row>`select * from cfg_battle_field
        where state != 0 and (type = 0 or type = 1 or type = 5) order by id`,
    );
    const battleList: Row[] = [];
    for (const cfgbattle of cfgbattles) {
      if (phpIntval(cfgbattle.type) === 0) {
        // 判断战场是否已满，满了就灰掉
        const battlecount = await this.cell(
          sql<Row>`select count(*) as v from sys_user_battle_field
            where bid = ${phpIntval(cfgbattle.id)} and state = 0`,
        );
        cfgbattle.canCreate = !(phpNum(battlecount) >= phpNum(cfgbattle.maxcount));
      }
      battleList.push(cfgbattle);
    }
    ret[1] = battleList;

    const todayWarCountCell = await this.cell(
      sql<Row>`select today_war_count as v from mem_user_schedule where uid = ${uid}`,
    );
    const todayWarCount = phpEmpty(todayWarCountCell) ? 0 : todayWarCountCell;
    let gongxun = await this.getBattleNetExploit(uid);
    if (gongxun === -1) gongxun = 0;
    ret.push(gongxun);
    ret.push(await this.getUserBattleNetArea(uid));
    ret.push(todayWarCount);
    ret.push(5);

    const battleIdAry = await this.rows(
      sql<Row>`select id from cfg_battle_field
        where state != 0 and (type = 0 or type = 1 or type = 5) order by id`,
    );
    const battleIds: number[] = [1];
    let isinmenghuo = false;
    for (const battleId of battleIdAry) {
      if (phpIntval(battleId.id) === 11000) {
        // 如果赤壁上了的话就加上赤壁商城
        battleIds.push(2);
      }
      if (phpIntval(battleId.id) === 9001) {
        // 如果在孟获
        isinmenghuo = true;
      }
      battleIds.push(phpIntval(battleId.id));
    }
    const inList = sql.join(
      battleIds.map((b) => sql`${b}`),
      sql`, `,
    );
    // 孟获商品 (41001-41009) have no cfg_things medal row, so they are fetched separately.
    const menghuoshopgoods = isinmenghuo
      ? await this.rows(
          sql<Row>`SELECT a.*, '3' as battleBelong, '元宝' as medalName FROM cfg_shop a
            WHERE a.onsale = 1 AND (a.\`group\` = 6 or a.\`group\` = 7 or a.\`battleshop\` = 1)
            and (a.id >= 41001 and a.id <= 41009) ORDER BY a.position, a.gid`,
        )
      : [];
    const localShop = await this.rows(
      sql<Row>`SELECT a.*, b.battleBelong, b.name as medalName FROM cfg_shop a, cfg_things b
        WHERE a.onsale = 1 AND (a.\`group\` = 6 or a.\`group\` = 7 or a.\`battleshop\` = 1)
        AND a.medalTypeId = b.tid and (b.battleBelong in (${inList}))
        and (a.id < 41001 or a.id > 41009) ORDER BY a.position, a.gid`,
    );
    ret.push(menghuoshopgoods.length >= 1 ? [...menghuoshopgoods, ...localShop] : localShop);

    ret.push(
      await this.rows(
        sql<Row>`SELECT a.* FROM cfg_armor a, cfg_shop b WHERE b.\`onsale\` = 1
          AND (b.\`group\` = 6 or b.\`group\` = 7) AND a.id = b.gid AND b.battlegoodstype = 1
          and a.bid != 1 and a.bid in (${inList})`,
      ),
    );
    ret.push(
      await this.rows(
        sql<Row>`select a.* from cfg_hero a, cfg_shop b where b.\`onsale\` = 1
          AND (b.\`group\` = 6 or b.\`group\` = 7) AND a.id = b.gid AND b.battlegoodstype = 2`,
      ),
    );
    ret.push(
      phpIntval(await this.cell(sql<Row>`select honour as v from sys_user where uid = ${uid}`)),
    );
    ret.push(await this.getUserPVENetLevel(uid));
    let shachangscore = await this.cell(
      sql<Row>`select \`count\` as v from sys_things where tid = 104001 and uid = ${uid}`,
    );
    if (phpEmpty(shachangscore)) shachangscore = 0;
    ret.push(shachangscore);
    return ret;
  }

  /**
   * BattleFunc.php:734 buyBattleGoods — `[id, cnt, battleGoodsType, cityId]`, paying honour +
   * medals (cfg_things battleBelong medal). `battleGoodsType` 0 goods / 1 armor / 2 hero. The
   * group-7 (跨服) and battleBelong-9001 (孟获) branches read their remote tallies, which the
   * standalone cannot reach (-1): both are refused with their own message, as in PHP.
   */
  @GlobalCommand()
  async buyBattleGoods(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const p = [...param];
    const id = phpIntval(p.shift());
    const cnt = phpIntval(p.shift());
    const battleGoodsType = p.shift();
    const cityId = p.shift();
    if (cnt < 1) throw GameError.lang('buyGoods.invalid_amount');
    if (cnt < 1) throw GameError.lang('buyGoods.invalid_amount'); // duplicated in the original

    const goods = await this.one(
      sql<Row>`select * from cfg_shop
        where id = ${id} and onsale = 1 and starttime <= unix_timestamp() and endtime > unix_timestamp()`,
    );
    if (phpEmpty(goods)) throw GameError.lang('buyGoods.stop_sale');
    const g = goods as Row;
    const isCBArmor = isChibiArmor(g);
    const creditNeed = cnt * phpNum(g.creditPrice);
    const medalNeed = cnt * phpNum(g.medalPrice);
    const medalTypeId = phpIntval(g.medalTypeId);
    const battleBelong = await this.cell(
      sql<Row>`select battleBelong as v from cfg_things where tid = ${medalTypeId}`,
    );
    // lockUser (utils.php:1099) — the gateway's per-user mutex replaces the file lock; the
    // pacifyPeople.server_busy branch is unreachable there as here.

    // PHP $userInfo is only assigned inside the honour branch — undefined elsewhere, so the
    // id-121 check below reads null (< 1) outside it.
    let userInfo: Row | false = false;
    if (phpLooseEquals(g.group, 7) && !phpLooseEquals(battleBelong, 9001)) {
      // fix bug 1606: the exploit/level check order
      const userAreaLevel = await this.getUserBattleNetArea(uid);
      if (userAreaLevel < phpNum(g.creditPrice)) {
        throw GameError.lang('buyGoods.no_enough_Level');
      }
      const userExploitTotal = await this.getBattleNetExploit(uid);
      if (userExploitTotal < medalNeed) {
        throw GameError.lang('buyGoods.no_enough_Exploit');
      }
    } else if (phpLooseEquals(battleBelong, 9001)) {
      const userPVELevel = await this.getUserPVENetLevel(uid);
      if (userPVELevel < phpNum(g.creditPrice)) {
        throw GameError.lang('buyGoods.no_enough_achievement_Level');
      }
      const userGongxun = await this.getBattleNetPVEGongxun(uid);
      if (userGongxun < medalNeed) {
        throw GameError.lang('buyGoods.no_enough_gongxun');
      }
    } else {
      if (isCBArmor) {
        const chibigongxun = (await this.getChibiGongXun(uid)).shift();
        if (phpNum(chibigongxun) < creditNeed) {
          throw GameError.lang('buyGoods.no_enough_chibi_gongxun');
        }
      } else {
        // 用户有的荣誉
        userInfo = await this.one(
          sql<Row>`select honour, nobility from sys_user where uid = ${uid}`,
        );
        const userCredit = userInfo ? userInfo.honour : null;
        if (phpNum(userCredit) < creditNeed) {
          throw GameError.lang('buyGoods.no_enough_Credit');
        }
      }
      const medalinfo = await this.one(
        sql<Row>`select \`count\` as v from sys_things where uid = ${uid} and tid = ${medalTypeId}`,
      );
      let userMedal = 0;
      if (!phpEmpty(medalinfo)) {
        userMedal = phpNum((medalinfo as Row).v);
      }
      if (userMedal < medalNeed) {
        const mName = await this.cell(
          sql<Row>`select name as v from cfg_things where tid = ${medalTypeId}`,
        );
        throw GameError.lang('buyGoods.no_enough_Medal', mName);
      }
    }

    // 限制商品
    if (id === 121 && phpNum(userInfo ? userInfo.nobility : null) < 1) {
      throw GameError.lang('buyGoods.nobility_limit');
    }
    if (phpNum(g.totalCount) < 2000000000) {
      if (phpLooseEquals(g.totalCount, 0)) {
        throw GameError.lang('buyGoods.sold_out');
      }
    }
    if (phpNum(g.userbuycnt) > 0) {
      // 属于限制商品,取消战场物品每日限制
      const buycnt = phpIntval(
        await this.cell(
          sql<Row>`select \`count\` as v from log_shop_buy_cnt where uid = ${uid} and \`sid\` = ${id}`,
        ),
      );
      if (buycnt + cnt > phpNum(g.userbuycnt)) {
        if (phpNum(g.userbuycnt) > buycnt) {
          const remain = phpNum(g.userbuycnt) - buycnt;
          throw GameError.lang(
            'buyGoods.reach_remain_amountLimit',
            phpNum(g.userbuycnt),
            buycnt,
            remain,
          );
        } else {
          throw GameError.lang('buyGoods.reach_buy_limit', phpNum(g.userbuycnt));
        }
      }
    }
    // 一手交货 普通物品, 战场装备, 战场将领
    if (phpLooseEquals(battleGoodsType, 0)) {
      // 普通物品
      await this.goods.addGoods(uid, phpIntval(g.gid), phpNum(g.pack) * cnt, 2);
    } else if (phpLooseEquals(battleGoodsType, 1)) {
      // 属于战场装备 — gid here is the cfg_armor id
      if (cnt > 1) throw GameError.lang('buyGoods.only_one_goods');
      await this.addBattleArmor(uid, phpIntval(g.gid), cnt);
    } else if (phpLooseEquals(battleGoodsType, 2)) {
      // 属于战场将领 — gid here is the cfg_hero id
      if (cnt > 1) throw GameError.lang('buyGoods.only_one_goods');
      await this.addBattleHero(uid, phpIntval(g.gid), cnt, cityId);
    }
    await sql`insert into log_shop_buy_cnt (\`uid\`, \`sid\`, \`count\`)
      values (${uid}, ${id}, ${cnt})
      on duplicate key update \`count\` = \`count\` + ${cnt}`.execute(this.db);

    if (phpLooseEquals(battleBelong, 9001)) {
      if ((await this.deductUserPVEGongxun(uid, [9001, medalNeed])) < 0) {
        throw GameError.lang('buyGoods.unsuccessful');
      }
    } else if (!phpLooseEquals(g.group, 7)) {
      // 一手交勋章
      if (isCBArmor) {
        await this.addGongunAndMedal(uid, -creditNeed, -medalNeed, medalTypeId);
      } else {
        await this.addCreditAndMedal(uid, -creditNeed, -medalNeed, medalTypeId);
      }
    } else {
      // fix bug 1621 — the remote exploit deduct throws → -1 → 购买失败, as in PHP.
      if ((await this.subtractBattleNetExpoit(uid, medalNeed)) < 0) {
        throw GameError.lang('buyGoods.unsuccessful');
      }
    }
    // unlockUser — the gateway mutex (see lockUser above).
    return [creditNeed];
  }

  // ─────────────────────────── getBattleHonourStat / getBattleFieldUsers ───────────────────────────

  /**
   * BattleFunc.php:3742 getBattleHonourStat — per-camp average honour and the per-player
   * contribution floor(10·honour/avg). Only field battlefields (type 1): anything else falls off
   * the end (null). The 6001 逐鹿中原 branch folds all camps into one "所有" union — it only
   * happens on the cross server, the branch stays for parity.
   */
  @GlobalCommand()
  async getBattleHonourStat(ctx: CommandContext): Promise<unknown> {
    const uid = ctx.uid;
    const battleinfo = (await firstGetUserBattleInfo(this.deps(), uid)) as Row;
    if (phpIntval(battleinfo.type) !== 1) {
      // 暂时不支持剧情战场的贡献统计
      return undefined;
    }
    const battlefieldid = phpIntval(battleinfo.battlefieldid);
    let avgHonourData: Record<string, Row>;
    let datas: Record<string, Row[]>;
    if (phpIntval(battleinfo.bid) !== 6001) {
      // 目前的官渡，董卓，徐州最多两个阵营 — the union join is not bid-filtered (as in the
      // original), so a unionid reused across battlefields lets the last row win the map.
      avgHonourData = mapOf(
        await this.rows(
          sql<Row>`SELECT a.unionid, FLOOR(AVG(honour)) AS avgHonour, b.name
            FROM sys_user_battle_state a LEFT JOIN cfg_battle_union b ON a.unionid = b.unionid
            where battlefieldid = ${battlefieldid} GROUP BY unionid order by unionid`,
        ),
        'unionid',
      );
      datas = complexMapOf(
        await this.rows(
          sql<Row>`SELECT b.uid AS uid, a.unionid, b.name AS name, a.honour
            FROM sys_user_battle_state a, sys_user b
            WHERE a.uid = b.uid AND battlefieldid = ${battlefieldid}
            ORDER BY a.honour DESC, a.jointime ASC`,
        ),
        'unionid',
      );
    } else {
      // 逐鹿中原可能有N个阵营，就糅在一起算，阵营名字就叫“所有”，每个玩家的贡献度都是10
      avgHonourData = mapOf(
        await this.rows(
          sql<Row>`SELECT 0 as unionid, FLOOR(AVG(honour)) AS avgHonour
            FROM sys_user_battle_state WHERE battlefieldid = ${battlefieldid}`,
        ),
        'unionid',
      );
      (avgHonourData['0'] ??= {}).name = this.lang.t('battle.all_unions');
      datas = complexMapOf(
        await this.rows(
          sql<Row>`SELECT b.uid AS uid, 0 AS unionid, b.name AS name, a.honour
            FROM sys_user_battle_state a, sys_user b
            WHERE a.uid = b.uid AND battlefieldid = ${battlefieldid}
            ORDER BY a.honour DESC, a.jointime ASC`,
        ),
        'unionid',
      );
    }
    for (const uniondata of Object.values(datas)) {
      // PHP notice-reads a missing camp as null, and null == 0 → contribute 0.
      const unionAvgHonour = avgHonourData[phpString(uniondata[0]?.unionid)]?.avgHonour;
      for (const userdata of uniondata) {
        userdata.contribute = phpLooseEquals(unionAvgHonour, 0)
          ? 0
          : Math.floor((10 * phpNum(userdata.honour)) / phpNum(unionAvgHonour));
      }
    }
    return [avgHonourData, datas];
  }

  /**
   * BattleFunc.php:3780 getBattleFieldUsers — the member list: participants (state_in) with
   * their troop counts, then the pending invites (state_invite, cancellable by the creator),
   * plus the joined count. `order by` added for deterministic row order.
   */
  @GlobalCommand()
  async getBattleFieldUsers(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    void param.shift(); // $battlefiledid — read but never used by the original
    const uid = ctx.uid;
    const battleinfo = (await firstGetUserBattleInfo(this.deps(), uid)) as Row;
    const battlefieldid = phpIntval(battleinfo.battlefieldid);

    const iscreator = phpLooseEquals(uid, battleinfo.createuid);

    // 战场中的用户
    const userin = await this.rows(
      sql<Row>`select s.uid, u.honour, u.name, c.name as camp from sys_user_battle_state s
        left join sys_user u on s.uid = u.uid
        left join cfg_battle_union c on c.bid = s.bid and c.unionid = s.unionid
        where s.state = 0 and s.battlefieldid = ${battlefieldid} order by s.uid`,
    );
    const userininfo: Row[] = [];
    for (const oneuser of userin) {
      const herocount = await this.cell(
        sql<Row>`select count(*) as v from sys_troops
          where uid = ${phpIntval(oneuser.uid)} and battlefieldid = ${battlefieldid}`,
      );
      oneuser.herocount = herocount;
      oneuser.state = this.lang.t('battle.state_in');
      oneuser.cancel = false;
      if (phpEmpty(oneuser.honour)) {
        oneuser.honour = 0;
      }
      userininfo.push(oneuser);
    }
    const incount = userininfo.length;

    // 如果是创建者 — the invite rows
    const userinvite = await this.rows(
      sql<Row>`select i.id, i.toname as name, t.honour from sys_battle_invite i
        left join sys_user t on i.touid = t.uid
        where battlefieldid = ${battlefieldid} order by i.id`,
    );
    const userinviteinfo: Row[] = [];
    for (const oneuser of userinvite) {
      oneuser.herocount = 0;
      oneuser.state = this.lang.t('battle.state_invite');
      oneuser.cancel = iscreator;
      if (phpEmpty(oneuser.honour)) {
        oneuser.honour = 0;
      }
      userinviteinfo.push(oneuser);
    }

    return [[...userininfo, ...userinviteinfo], incount, iscreator];
  }

  // ─────────────── internal description readers (not in openfunc; parity) ───────────────

  /** BattleFunc.php:4429 getBattleDescription. */
  async getBattleDescription(bid: number): Promise<unknown> {
    return this.cell(sql<Row>`select content as v from cfg_battle_field where id = ${bid}`);
  }

  /** BattleFunc.php:4433 getBattleName — "unknown" when the battlefield does not exist. */
  async getBattleName(bid: number): Promise<unknown> {
    const battle = await this.cell(
      sql<Row>`select count(*) as v from cfg_battle_field where id = ${bid}`,
    );
    if (phpLooseEquals(battle, 0)) {
      return 'unknown';
    }
    return this.cell(sql<Row>`select name as v from cfg_battle_field where id = ${bid}`);
  }

  /**
   * BattleFunc.php:4446 getBattleCondition — reads `$GLOBALS['battleState']`, which the
   * standalone package never defines (no such group in lang.php): notice + null, always.
   */
  getBattleCondition(bid: number): unknown {
    return (
      this.lang.value<Record<string, Record<string, unknown>>>('battleState')?.[phpString(bid)]
        ?.condition ?? null
    );
  }

  /** BattleFunc.php:4454 getBattleState — cfg_battle_field.state; the $batteState map is dead code. */
  async getBattleState(bid: number): Promise<unknown> {
    return this.cell(sql<Row>`select state as v from cfg_battle_field where id = ${bid}`);
  }

  /** BattleFunc.php:4471 getTaskState — 1/2 → TASK_OPEN(1); anything else notice-reads null. */
  getTaskState(t: unknown): unknown {
    const taskState: Record<number, number> = { 1: 1, 2: 1 };
    return taskState[phpIntval(t)] ?? null;
  }

  // ─────────────────────────── shop purchase helpers ───────────────────────────

  /** ShopFunc.php:1093 addCreditAndMedal — the honour write plus the medal stack. */
  private async addCreditAndMedal(
    uid: number,
    credit: number,
    medal: number,
    medalTypeId: number,
  ): Promise<void> {
    await sql`update sys_user set honour = honour + ${credit} where uid = ${uid}`.execute(this.db);
    await this.goods.addThings(uid, medalTypeId, medal, 2);
  }

  /**
   * ShopFunc.php:116 addGongunAndMedal — the medal write, then the 赤壁功勋 deduct. With
   * CHIBI_NET_ENABLE=false `sendChibiRemoteRequest` throws an empty Exception AFTER the write
   * (ChibiNetFunc.php:10), which GameError.raw('') reproduces message for message.
   */
  private async addGongunAndMedal(
    uid: number,
    credit: number,
    medal: number,
    medalTypeId: number,
  ): Promise<void> {
    await this.goods.addThings(uid, medalTypeId, medal, 2);
    void credit;
    throw GameError.raw('');
  }

  /** ShopFunc.php:93 addBattleArmor — one armor into the bag (cfg_armor id), hp at 10× base. */
  private async addBattleArmor(uid: number, aid: number, cnt: number): Promise<void> {
    const armorColumn = await this.cell(
      sql<Row>`select \`armor_column\` as v from sys_user where uid = ${uid}`,
    );
    const curCount = await this.cell(
      sql<Row>`select count(*) as v from sys_user_armor where uid = ${uid} and hid = 0`,
    );
    if (phpNum(curCount) + cnt >= phpNum(armorColumn)) {
      throw GameError.lang('buyGoods.armor_box_full');
    }
    const arminfo = await this.one(sql<Row>`select * from cfg_armor where id = ${aid}`);
    if (phpEmpty(arminfo)) {
      throw GameError.lang('buyGoods.can_not_exchange');
    }
    const hp = phpNum((arminfo as Row).ori_hp_max);
    await sql`insert into sys_user_armor (uid, armorid, hp, hp_max, hid)
      values (${uid}, ${aid}, ${hp * 10}, ${hp}, 0)`.execute(this.db);
    await this.updateBattleOpenState(uid, aid);
    // 属于商场购买,但是属于勋章换来的装备
    await sql`insert into log_goods (uid, gid, count, time, type)
      values (${uid}, ${aid}, ${cnt}, unix_timestamp(), 11)`.execute(this.db);
  }

  /**
   * ShopFunc.php:48 addBattleHero — one battlefield hero into the 招贤馆 of `cityId` (herotype
   * 20000), attributes split level/3 across 内政/勇武 and the rest left for 智谋.
   */
  private async addBattleHero(
    uid: number,
    hid: number,
    cnt: number,
    cityId: unknown,
  ): Promise<void> {
    const cid = phpIntval(cityId);
    const chid = hid;
    const hero = await this.one(sql<Row>`select * from cfg_hero where id = ${hid}`);
    if (phpEmpty(hero)) {
      throw GameError.lang('buyGoods.can_not_exchange');
    }
    const h = hero as Row;
    if (!(await this.cityHasHeroPosition(uid, cid))) {
      // 招贤馆等级是否够
      throw GameError.lang('recruitHero.hotel_level_low');
    }
    const add = phpIntval(phpIntval(h.level) / 3);
    const affairs = phpIntval(h.affairs_base);
    const bravery = phpIntval(h.bravery_base);
    const levelLeft = phpIntval(h.level) - add - add;
    const wisdom = phpIntval(h.wisdom_base);
    const totalExp = await this.cell(
      sql<Row>`select total_exp as v from cfg_hero_level where level = ${phpIntval(h.level)}`,
    );
    const command = phpIntval(h.command_base);
    const inserted = await sql`insert into sys_city_hero
        (\`uid\`, \`name\`, \`npcid\`, \`sex\`, \`face\`, \`cid\`, \`state\`, \`level\`, \`exp\`,
         \`affairs_base\`, \`bravery_base\`, \`wisdom_base\`, \`affairs_add\`, \`bravery_add\`,
         \`wisdom_add\`, \`loyalty\`, \`command_base\`, \`herotype\`)
      values (${uid}, ${phpString(h.name)}, ${phpString(h.npcid)}, ${phpString(h.sex)},
        ${phpString(h.face)}, ${cid}, 0, ${phpString(h.level)}, ${phpString(totalExp)},
        ${affairs}, ${bravery}, ${wisdom}, ${add}, ${add}, ${levelLeft}, ${phpString(h.loyalty)},
        ${command}, '20000')`.execute(this.db);
    const newHid = Number(inserted.insertId ?? 0);
    // `force` is a MySQL 8 reserved word — the original already quoted it.
    const forcemax = Math.trunc(
      100 + phpNum(h.level) / 5 + (phpNum(h.bravery_base) + phpNum(h.bravery_add)) / 3,
    );
    const energymax = Math.trunc(
      100 + phpNum(h.level) / 5 + (phpNum(h.wisdom_base) + phpNum(h.wisdom_add)) / 3,
    );
    await sql`insert into mem_hero_blood (\`hid\`, \`force\`, \`force_max\`, \`energy\`, \`energy_max\`)
      values (${newHid}, ${forcemax}, ${forcemax}, ${energymax}, ${energymax})
      on duplicate key update \`force\` = ${forcemax}, \`energy\` = ${energymax},
        \`force_max\` = ${forcemax}, \`energy_max\` = ${energymax}`.execute(this.db);
    // 属于商场购买,但是属于勋章换来的Hero
    await sql`insert into log_goods (uid, gid, count, time, type)
      values (${uid}, ${chid}, ${cnt}, unix_timestamp(), 12)`.execute(this.db);
  }

  /** utils.php:652 cityHasHeroPosition — the 招贤馆 has a free slot (office level > heroes). */
  private async cityHasHeroPosition(uid: number, cid: number): Promise<boolean> {
    const officeLevel = await this.cell(
      sql<Row>`select level as v from sys_building where cid = ${cid} and bid = ${ID_BUILDING_OFFICE}`,
    );
    if (phpEmpty(officeLevel)) return false;
    const heroCount = await this.cell(
      sql<Row>`select count(*) as v from sys_city_hero where cid = ${cid} and uid = ${uid}`,
    );
    return phpCompare(officeLevel, heroCount) > 0;
  }

  /**
   * utils.php:1596 updateBattleOpenState — buying a 战场装备 (armorid 20000-31000) may complete
   * its battlefield's open condition: when no shop piece of the same medal type is still missing
   * from the player's collection, the dependent battlefields open.
   */
  private async updateBattleOpenState(uid: number, armorId: number): Promise<void> {
    if (armorId < 20000 || armorId > 31000) return; // 战场装备 only
    const battleInfos = await this.rows(
      sql<Row>`select a.bid, b.battleId from cfg_armor a, sys_battle_open_condition b
        where a.id = ${armorId} and b.dependBattleId = a.bid`,
    );
    if (phpEmpty(battleInfos)) return;
    const info = battleInfos[0]!;
    // The original interpolates $armorInfo[medalTypeId] raw — a missing shop row would have been
    // a PearDB die; a shop-bought armor always has it, phpNum keeps the port sane with 0.
    const armorInfo = await this.one(
      sql<Row>`select a.medalTypeId as v from cfg_shop a, cfg_things b
        where a.gid = ${armorId} and a.\`group\` = 6 and a.battleGoodsType = 1
        and a.medalTypeId = b.tid`,
    );
    const owned = await this.cell(
      sql<Row>`select group_concat(distinct armorid) as v from sys_user_armor
        where armorid >= 20000 and armorid <= 31000 and uid = ${uid}`,
    );
    const ownedIds = phpEmpty(owned)
      ? []
      : phpString(owned)
          .split(',')
          .map((v) => phpIntval(v));
    const armor = await this.one(
      sql<Row>`select * from cfg_shop where medalTypeId = ${phpNum(armorInfo ? (armorInfo as Row).v : null)}
        and battleGoodsType = 1
        ${
          ownedIds.length
            ? sql`and gid not in (${sql.join(
                ownedIds.map((v) => sql`${v}`),
                sql`, `,
              )})`
            : sql``
        }
        limit 1`,
    );
    if (phpEmpty(armor)) {
      await sql`delete from sys_battle_open_condition where dependBattleId = ${phpIntval(info.bid)}`.execute(
        this.db,
      );
      for (const battleInfo of battleInfos) {
        const count = await this.cell(
          sql<Row>`select count(*) as v from sys_battle_open_condition
            where battleId = ${phpIntval(battleInfo.battleId)}`,
        );
        if (phpLooseEquals(count, 0)) {
          await this.openBattleField(phpIntval(battleInfo.battleId));
        }
      }
    }
  }

  /** utils.php:1644 openBattleField — flip the battlefield on and arm its dependents' timers. */
  private async openBattleField(battleId: number): Promise<void> {
    await sql`update cfg_battle_field set state = 1 where id = ${battleId}`.execute(this.db);
    await sql`update sys_battle_open_condition set isConditionDoing = 1
      where dependBattleId = ${battleId}`.execute(this.db);
    const battles = await this.rows(
      sql<Row>`select battleId as v from sys_battle_open_condition where dependBattleId = ${battleId}`,
    );
    for (const battle of battles) {
      // 设置定时器，如果系统里都是狗熊，无法在n天内完成战场开启条件，则系统在n天后强制开启战场
      await this.updateBattleOpenTime(phpIntval(battle.v));
    }
  }

  /** utils.php:1629 updateBattleOpenTime — the n-day force-open timer for a closed battlefield. */
  private async updateBattleOpenTime(id: number): Promise<void> {
    const timeSpan = await this.cell(sql<Row>`select value as v from mem_state where state = 311`);
    const count = await this.cell(
      sql<Row>`select count(*) as v from sys_battle_open_condition
        where battleId = ${id} and isConditionDoing = 0`,
    );
    if (phpLooseEquals(count, 0)) {
      if (
        phpLooseEquals(
          await this.cell(sql<Row>`select openTime as v from cfg_battle_field where id = ${id}`),
          0,
        )
      ) {
        await sql`update cfg_battle_field set openTime = unix_timestamp() + ${phpNum(timeSpan)}
          where id = ${id}`.execute(this.db);
      }
    }
  }

  /** BattleFunc.php:889 getUserPVENetLevel — the 七擒孟获 achievement ladder (70022-70024). */
  private async getUserPVENetLevel(uid: number): Promise<number> {
    const achievementId = await this.cell(
      sql<Row>`select max(achivement_id) as v from sys_user_achivement
        where uid = ${uid} and achivement_id between 70022 and 70024`,
    );
    if (phpLooseEquals(achievementId, 70024)) return 4;
    if (phpLooseEquals(achievementId, 70023)) return 3;
    if (phpLooseEquals(achievementId, 70022)) return 2;
    return 1;
  }

  // ────────────────── cross-server reads (BATTLE_NET / CHIBI_NET disabled) ──────────────────
  //
  // config/db.php:27/34 define both flags false, and BattleNetFunc.php:82 / ChibiNetFunc.php
  // then throw an empty Exception the moment they are called. These helpers reproduce exactly
  // what each wrapper's try/catch produced in the standalone package.

  /** BattleFunc.php:677 getBattleNetExploit — the catch path returns -1. */
  private async getBattleNetExploit(_uid: number): Promise<number> {
    return -1;
  }

  /** BattleFunc.php:715 getUserBattleNetArea — the catch path returns -1. */
  private async getUserBattleNetArea(_uid: number): Promise<number> {
    return -1;
  }

  /** BattleFunc.php:686 getBattleNetPVEGongxun — the catch path returns -1. */
  private async getBattleNetPVEGongxun(_uid: number): Promise<number> {
    return -1;
  }

  /** BattleFunc.php:696 deductUserPVEGongxun — the catch path returns -1 (购买失败 for callers). */
  private async deductUserPVEGongxun(_uid: number, _param: unknown[]): Promise<number> {
    return -1;
  }

  /** BattleFunc.php:705 subtractBattleNetExpoit — the catch path returns -1 (购买失败). */
  private async subtractBattleNetExpoit(_uid: number, _count: number): Promise<number> {
    return -1;
  }

  /** BattleFunc.php:657 getChibiGongXun — the catch path leaves 0 in the one-entry array. */
  private async getChibiGongXun(_uid: number): Promise<unknown[]> {
    return [0];
  }

  // ─────────────────────────── fetch helpers ───────────────────────────

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.db)).rows as Row[];
  }

  private async one(query: RawBuilder<Row>): Promise<Row | false> {
    return (await this.rows(query))[0] ?? false;
  }

  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const row = await this.one(query);
    return row === false ? undefined : Object.values(row)[0];
  }
}
