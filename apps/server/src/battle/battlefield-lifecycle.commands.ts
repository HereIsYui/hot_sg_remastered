/**
 * BattleFunc.php — the 战场 lifecycle command face (review slice S2 前半):
 *
 * - `createBattle` :1046-1227 — open a local battlefield instance (sys_user_battle_field +
 *   sys_battle_city from cfg_battle_city + NPC garrisons in sys_troops via utils.php createSoldier);
 * - `joinToBattle` :3206-3363 — join through a sys_battle_invite (9001 branch dead locally);
 * - `joinToPVPBattle` :3393-3536 — join a PVP battlefield by bid/battlefieldid/unionid;
 * - `getBattleInvite` :3132 — the user's pending invitations;
 * - `checkUserQualityForJoinBattle` :3141-3205 (internal) — nobility + demandGoods/demandThings
 *   tickets, consumed on entry.
 *
 * Single-machine notes kept on purpose:
 * - `BATTLE_NET_ENABLE` is defined `false` (server/config/db.php:27), so every block guarded by it
 *   — the sys_battlenet_waiting_queue probes and the `sendRemote9001Request` room checks — never
 *   runs; where the original called the remote stub it threw `Exception("")` (empty message),
 *   reproduced with `GameError.raw('')`.
 * - 2001 官渡 / 4001 讨伐董卓 stay closed through the `cfg_battle_field.state <> 0` filter of
 *   createBattle and joinToPVPBattle's `$battle["maxpeople"]` read. With battlefieldid=0 the
 *   original interpolates the NULL maxpeople ("" in PHP string context) straight into
 *   `having count(1)<` — a syntax error (verified against the legacy MySQL: ERROR 1064) whose
 *   PearDB die reaches the client as `PearDB returned an error. `; with an explicit
 *   battlefieldid the join proceeds and dies with `no_battle_field` on the missing field row.
 * - 7001 has no cfg_battle_field row at all → createBattle rejects with `no_battle_field`;
 *   joinToPVPBattle resolves battlefieldid to a legacy bid-7001 row or dies the same way.
 * - joinToBattle's `if($bid == 9001)` read an UNDEFINED `$bid` on the original whenever the
 *   battlefield row existed (notice + null == 9001 → false), so the 9001 branch is unreachable and
 *   the join proceeds with the row's own bid.
 * - `lockUser`/`unlockUser` around the writes are the gateway's per-user KeyedMutex here.
 */

import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpCompare, phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { phpTime } from '../core/php-time';
import { RandomService } from '../core/random.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import {
  deleteOldBattleTasks,
  getBattleStartCityInfo,
  playerAttendBattle,
  resetBattleFieldUid,
  sendBattleEvent,
  setFlags,
  type BattlefieldDeps,
  type Row,
} from './battlefield-helpers';
import { battleid2cid, createSoldier } from './battlefield-utils';

/**
 * Splits exactly like PHP's `strtok($s, ",")` used here: consecutive/leading delimiters collapse,
 * empty tokens are skipped, and an empty string yields no token.
 */
function strtokList(value: unknown): string[] {
  return phpString(value)
    .split(',')
    .filter((t) => t !== '');
}

/** `explode(",", $s)` — an empty/NULL subject yields one empty element (PHP 5 coercion). */
function explodeList(value: unknown): string[] {
  return phpString(value).split(',');
}

/**
 * The `gid:count` / `tid:count` ticket entries. The original substr()s around the first ":";
 * a token without one substr()s past position 0/1 (`substr($t, 0, false)` → "", `false + 1` → 1).
 */
function parseTicket(token: string): { id: string; count: string } {
  const p = token.indexOf(':');
  if (p === -1) return { id: '', count: token.slice(1) };
  return { id: token.slice(0, p), count: token.slice(p + 1) };
}

@Injectable()
export class BattlefieldLifecycleCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly users: UserRules,
    private readonly random: RandomService,
  ) {}

  private get db() {
    return this.scope.db;
  }

  /** Deps for the shared battlefield helpers; `db` resolves lazily into any open transaction. */
  private bf(): BattlefieldDeps {
    const scope = this.scope;
    return {
      get db() {
        return scope.db;
      },
      rows: (q) => this.rows(q),
      one: (q) => this.one(q),
      cell: (q) => this.cell(q),
      lang: (key, ...args) => this.lang.t(key, ...args),
    };
  }

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.db)).rows as Row[];
  }

  private async one(query: RawBuilder<Row>): Promise<Row | false> {
    return (await this.rows(query))[0] ?? false;
  }

  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const row = await this.one(query);
    return row === false ? false : Object.values(row)[0];
  }

  private async check(query: RawBuilder<Row>): Promise<boolean> {
    return (await this.one(query)) !== false;
  }

  // ───────────────────────────── getBattleInvite ─────────────────────────────

  /** BattleFunc.php:3132: `[pending invitations, newest first]`. */
  @GlobalCommand()
  async getBattleInvite(ctx: CommandContext): Promise<unknown[]> {
    return [
      await this.rows(
        sql<Row>`select * from sys_battle_invite where touid = ${ctx.uid} and state = 0 order by time desc`,
      ),
    ];
  }

  // ───────────────────────────── createBattle ─────────────────────────────

  /**
   * BattleFunc.php:1046-1227: open a battlefield. Returns `[currentBattleInfo, cityInfo, startCities]`.
   * The whole generation runs in one transaction (an intentional difference: the original's
   * sequence of autocommit statements could leave a half-built battlefield on an error).
   */
  @GlobalCommand()
  async createBattle(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    let nobility = phpIntval(
      await this.cell(sql<Row>`select nobility from sys_user where uid = ${uid}`),
    );
    // 推恩
    nobility = await this.users.bufferNobility(uid, nobility);
    if (nobility < 1) throw GameError.lang('battle.nobility_not_rearch');

    const bid = phpIntval(param[0]);
    let level = phpIntval(param[1]);
    if (
      await this.check(
        sql<Row>`select * from sys_user_battle_state where state = 0 and uid = ${uid}`,
      )
    ) {
      throw GameError.lang('battle.user_already_in_battle');
    }
    const battlecfg = await this.one(
      sql<Row>`select * from cfg_battle_field where id = ${bid} and state <> 0`,
    );
    if (!battlecfg) throw GameError.lang('battle.no_battle_field');

    const battlecount = phpNum(
      await this.cell(
        sql<Row>`select count(*) from sys_user_battle_field where bid = ${bid} and state = 0`,
      ),
    );
    if (battlecount >= phpNum(battlecfg['maxcount']))
      throw GameError.lang('battle.too_many_battle');

    let todayWarCont = await this.cell(
      sql<Row>`select today_war_count from mem_user_schedule where uid = ${uid}`,
    );
    if (phpEmpty(todayWarCont)) todayWarCont = 0;
    if (phpNum(todayWarCont) >= phpNum(battlecfg['maxdaycount'])) {
      throw GameError.lang('battle.today_war_count_reach_limit');
    }
    // BATTLE_NET_ENABLE=false: the sys_battlenet_waiting_queue probe never runs.

    const currentuser = await this.one(
      sql<Row>`select honour, name from sys_user where uid = ${uid}`,
    );
    const currenthonour = currentuser ? currentuser['honour'] : null;
    const username = currentuser ? currentuser['name'] : null;
    if (phpCompare(currenthonour, 0) < 0) throw GameError.lang('battle.honour_invalid');

    // 等级检查: clamp into [1, maxlevel].
    if (phpNum(level) > phpNum(battlecfg['maxlevel'])) level = phpIntval(battlecfg['maxlevel']);
    if (phpNum(level) < 1) level = 1;

    let needTaoFa = 0;
    if (phpNum(level) > 10) {
      // 11 级以上要有足够的讨伐令 (道具 137).
      needTaoFa = phpNum(level) - 10;
      if (!(await this.checkGoodsCount(uid, 137, needTaoFa))) {
        throw GameError.raw(`not_enough_goods137#${needTaoFa}`);
      }
    }
    await this.checkUserQualityForJoinBattle(uid, bid);

    const now = phpTime();
    const endtime = now + phpNum(battlecfg['maxtime']);

    // 生成战场信息. The original runs every write in autocommit (no transaction): a mid-way
    // SQL error leaves the half-built battlefield (sys_user_battle_field state=-1, no cities)
    // behind on the live tables — reproduced here by NOT wrapping the block in a transaction.
    const db = this.db; // `insert into sys_user_battle_field ...` + `select LAST_INSERT_ID()` on the same connection.
    const inserted = await sql`insert into sys_user_battle_field
      (bid, createuid, level, maxpeople, state, starttime, endtime, type)
      values (${bid}, ${uid}, ${level}, ${phpNum(battlecfg['maxpeople'])}, -1, ${now}, ${endtime},
      ${phpNum(battlecfg['type'])})`.execute(db);
    const battlefieldid = Number(inserted.insertId ?? 0);

    const currentbattlecityinfo: Row[] = [];
    // cfg_battle_city has no flag/flagchar columns — the original's `$cfgbattlecity['flag']`
    // reads notice + null into the reply, setFlags fills both afterwards.
    const cfgbattlecitys = await this.rows(
      sql<Row>`select * from cfg_battle_city where bid = ${bid} order by xy`,
    );
    for (const cfgbattlecity of cfgbattlecitys) {
      const cid = battleid2cid(battlefieldid, phpIntval(cfgbattlecity['xy']));
      // 生成城市 (`drop` is a MySQL reserved word, as backticked in the original).
      await sql`insert into sys_battle_city
        (cid, battlefieldid, nextxy, name, uid, unionid, \`drop\`, rate, xy, image, winpoint,
        losepoint, reinforce_soldiers, can_quest)
        values (${cid}, ${battlefieldid}, ${phpString(cfgbattlecity['nextxy'])},
        ${phpString(cfgbattlecity['name'])}, 0, ${phpNum(cfgbattlecity['unionid'])},
        ${phpString(cfgbattlecity['drop'])}, ${phpNum(cfgbattlecity['rate'])},
        ${phpIntval(cfgbattlecity['position'])}, ${phpNum(cfgbattlecity['image'])},
        ${phpNum(cfgbattlecity['winpoint'])}, ${phpNum(cfgbattlecity['losepoint'])},
        ${phpString(cfgbattlecity['reinforce_soldiers'])}, ${phpNum(cfgbattlecity['can_quest'])})`.execute(
        db,
      );
      // 生成驻守的部队: cfg_battle_troop type=0 (初始军; type=1 重生军 is the tick's job).
      const cfgtroops = await this.rows(
        sql<Row>`select * from cfg_battle_troop where bid = ${bid} and xy = ${phpIntval(cfgbattlecity['xy'])}
          and type = 0 order by id`,
      );
      for (const cfgtroop of cfgtroops) {
        const soldiers = createSoldier(
          () => this.random.rand(),
          phpNum(cfgtroop['npcvalue']),
          phpString(cfgtroop['soldiers']),
          level,
        );
        await sql`insert into sys_troops
          (cid, uid, hid, soldiers, state, \`drop\`, rate, battlefieldid, battleunionid, bid)
          values (${cid}, 0, ${phpNum(cfgtroop['hid'])}, ${soldiers}, 4, ${phpString(cfgtroop['drop'])},
          ${phpNum(cfgtroop['rate'])}, ${battlefieldid}, ${phpNum(cfgtroop['unionid'])}, ${bid})`.execute(
          db,
        );
      }
      if (phpLooseEquals(cfgbattlecity['unionid'], '-1')) {
        // 无人据点: re-judge the owner from the just-inserted NPC garrison (S3's helper).
        const unionlog = await resetBattleFieldUid(this.bf(), cid);
        // The mixed-union `return 0` indexes `["unionid"]` on an int → notice + null.
        cfgbattlecity['unionid'] = typeof unionlog === 'number' ? null : unionlog['unionid'];
      }
      currentbattlecityinfo.push({
        image: cfgbattlecity['image'],
        cid,
        battlefieldid,
        nextxy: cfgbattlecity['nextxy'],
        name: cfgbattlecity['name'],
        uid: 0,
        unionid: cfgbattlecity['unionid'],
        drop: cfgbattlecity['drop'],
        rate: cfgbattlecity['rate'],
        flag: null,
        flagchar: null,
        xy: cfgbattlecity['position'],
      });
    }

    const unionid = battlecfg['user_unionid'];
    const unioninfo = await this.one(
      sql<Row>`select * from cfg_battle_union where unionid = ${phpNum(unionid)}`,
    );
    // The original also computes `$startcid = battleid2cid($battlefieldid, $battlecfg['startcid'])`
    // — cfg_battle_field has no startcid column (notice + null) and the value is never used.
    await sql`insert into sys_user_battle_state (uid, bid, battlefieldid, unionid, level)
      values (${uid}, ${bid}, ${battlefieldid}, ${phpNum(unionid)}, ${level})
      on duplicate key update battlefieldid = ${battlefieldid}, bid = ${bid},
      unionid = ${phpNum(unionid)}, level = ${level}`.execute(db);
    if (needTaoFa > 0) await this.goods.reduceGoods(uid, 137, needTaoFa);
    await deleteOldBattleTasks(this.bf(), uid);
    if (bid === 1001) {
      // 黄巾之乱，添加任务.
      const tasks = await this.rows(
        sql<Row>`select id from cfg_task where \`group\` in (60000, 60001, 60002, 60003, 60004)
          and pretid = -1`,
      );
      for (const task of tasks) {
        await sql`insert into sys_user_task (uid, tid, state)
          values (${uid}, ${phpIntval(task['id'])}, 0) on duplicate key update state = 0`.execute(
          db,
        );
      }
    } else {
      // 添加初始任务 (per-union init_tasks; explode over a NULL/'' entry yields one empty
      // element, whose tid 0 row phpIntval reproduces for both engines).
      const tasks = explodeList(unioninfo ? unioninfo['init_tasks'] : null);
      for (const task of tasks) {
        await sql`insert into sys_user_task (uid, tid, state)
          values (${uid}, ${phpIntval(task)}, 0) on duplicate key update state = 0`.execute(db);
      }
    }
    const fieldname = unioninfo ? unioninfo['name'] : null;
    await playerAttendBattle(this.bf(), battlefieldid, unionid, uid, username, fieldname);

    const currentbattleinfo = {
      battlefieldid,
      bid,
      createuid: uid,
      level,
      maxpeople: battlecfg['maxpeople'],
      endtime,
      honour: currenthonour,
      name: battlecfg['name'],
      type: battlecfg['type'],
      // `$battlecfg['startcid']` — no such cfg_battle_field column → notice + null.
      startcid: null,
      state: 0,
      unionid,
    };
    const flagged = await setFlags(this.bf(), unionid, currentbattlecityinfo);
    const ret: unknown[] = [currentbattleinfo, flagged];
    ret.push(await getBattleStartCityInfo(this.bf(), bid, unionid));

    await sql`insert into mem_user_schedule (\`uid\`, \`today_war_count\`) values (${uid}, 1)
      on duplicate key update \`today_war_count\` = today_war_count + 1`.execute(db);

    const id = await this.cell(sql<Row>`select id from cfg_task_goal where tid = 282`);
    if (!phpEmpty(id)) {
      await sql`insert into sys_user_goal (\`uid\`, \`gid\`) values (${uid}, ${phpIntval(id)})
        on duplicate key update gid = ${phpIntval(id)}`.execute(db);
    }
    await sql`update sys_user_battle_field set state = 0 where id = ${battlefieldid}`.execute(db);
    // 触发初始化事件.
    await sendBattleEvent(this.bf(), 0, uid, bid, battlefieldid, phpNum(unionid), 0, 9);
    return ret;
    // The original's trailing `unlockUser($uid); throw create_failed;` sits after the return —
    // dead code kept out.
  }

  // ───────────────────────────── joinToBattle ─────────────────────────────

  /**
   * BattleFunc.php:3206-3363: accept one of the user's own sys_battle_invite rows and step into
   * that battlefield. Returns `[currentBattleInfo, cityInfo, startCities]`.
   */
  @GlobalCommand()
  async joinToBattle(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const inviteid = phpIntval(param[0]);
    const inviteinfo = await this.one(
      sql<Row>`select id, battlefieldid, toname, touid from sys_battle_invite where id = ${inviteid} and touid = ${uid}`,
    );
    if (!inviteinfo) throw GameError.lang('battle.no_such_invite');

    if (
      await this.check(
        sql<Row>`select * from sys_user_battle_state where state = 0 and uid = ${uid}`,
      )
    ) {
      throw GameError.lang('battle.join_user_already_in_battle');
    }
    // BATTLE_NET_ENABLE=false: the waiting-queue probe never runs.
    const battlefieldid = phpNum(inviteinfo['battlefieldid']);
    const battlefieldinfo = await this.one(
      sql<Row>`select * from sys_user_battle_field where id = ${battlefieldid} and state = 0`,
    );
    if (!battlefieldinfo) {
      // Original: `sendRemote9001Request(..., "checkMenghuoRemoteRoom", ...)` — disabled, so it
      // throws `Exception("")` before the 9001 branch can ever be taken.
      throw GameError.raw('');
    }
    // Original quirk: `if($bid == 9001)` read an UNDEFINED `$bid` on this path (null == 9001 →
    // false), so the join always proceeds with the row's own bid; the 9001 room return is dead.
    const bid = phpIntval(battlefieldinfo['bid']);
    if (bid === 8001) {
      // 凤仪亭: only while the creator still has the first main-line task open.
      const gid = phpNum(await this.cell(sql<Row>`select id from cfg_task_goal where tid = 60800`));
      if (
        (await this.check(
          sql<Row>`select 1 from sys_user_goal where uid = ${phpNum(battlefieldinfo['createuid'])} and gid = ${gid}`,
        )) ||
        phpNum(battlefieldinfo['progress']) !== 0
      ) {
        throw GameError.raw('已有玩家完成第一个主线任务，此时已经不能加入到副本中');
      }
    }

    let todayWarCont = await this.cell(
      sql<Row>`select today_war_count from mem_user_schedule where uid = ${uid}`,
    );
    if (phpEmpty(todayWarCont)) todayWarCont = 0;
    if (phpNum(todayWarCont) >= 5) throw GameError.lang('battle.today_war_count_reach_limit');

    const unionid = await this.cell(
      sql<Row>`select user_unionid from cfg_battle_field where id = ${bid}`,
    );
    const unioninfo = await this.one(
      sql<Row>`select * from cfg_battle_union where unionid = ${phpNum(unionid)}`,
    );

    const joincount = phpNum(
      await this.cell(
        sql<Row>`select count(*) from sys_user_battle_state where state = 0 and battlefieldid = ${battlefieldid}`,
      ),
    );
    if (joincount >= 5) throw GameError.lang('battle.user_full');

    let currenthonour = await this.cell(sql<Row>`select honour from sys_user where uid = ${uid}`);
    if (phpEmpty(currenthonour)) currenthonour = 0;
    if (phpCompare(currenthonour, 0) < 0) throw GameError.lang('battle.honour_invalid');

    const fieldname = unioninfo ? unioninfo['name'] : null;
    await this.checkUserQualityForJoinBattle(uid, bid);
    // lockUser: always succeeds — the gateway serialises commands per user.

    return this.scope.transaction(async () => {
      const db = this.db;
      await sql`insert into sys_user_battle_state (uid, bid, battlefieldid, unionid, level)
        values (${uid}, ${bid}, ${battlefieldid}, ${phpNum(unionid)}, ${phpNum(battlefieldinfo['level'])})
        on duplicate key update battlefieldid = ${battlefieldid}, bid = ${bid},
        unionid = ${phpNum(unionid)}, level = ${phpNum(battlefieldinfo['level'])}`.execute(db);
      await deleteOldBattleTasks(this.bf(), uid);
      if (bid === 1001) {
        // 黄巾之乱，添加任务.
        const tasks = await this.rows(
          sql<Row>`select id from cfg_task where \`group\` in (60000, 60001, 60002, 60003, 60004)
            and pretid = -1`,
        );
        for (const task of tasks) {
          await sql`insert into sys_user_task (uid, tid, state)
            values (${uid}, ${phpIntval(task['id'])}, 0) on duplicate key update state = 0`.execute(
            db,
          );
        }
      } else if (bid === 3001) {
        // 十常侍之乱: only the creator's still-open 6xxxx tasks carry over.
        const tasks = await this.rows(
          sql<Row>`SELECT tid FROM sys_user_task WHERE uid = ${phpNum(battlefieldinfo['createuid'])}
            AND tid >= 60000 AND tid <= 70000 AND NOT EXISTS (SELECT * FROM sys_user_goal, cfg_task_goal
            WHERE sys_user_goal.uid = sys_user_task.uid AND sys_user_goal.gid = cfg_task_goal.id
            AND cfg_task_goal.tid = sys_user_task.tid)`,
        );
        for (const task of tasks) {
          await sql`insert into sys_user_task (uid, tid, state)
            values (${uid}, ${phpIntval(task['tid'])}, 0) on duplicate key update state = 0`.execute(
            db,
          );
        }
      } else if (bid === 8001) {
        // 凤仪亭的固定三任务 (the original hardcodes the list here).
        for (const task of explodeList('60800,60815,60816')) {
          await sql`insert into sys_user_task (uid, tid, state)
            values (${uid}, ${phpIntval(task)}, 0) on duplicate key update state = 0`.execute(db);
        }
      }
      await sql`delete from sys_battle_invite where id = ${phpNum(inviteinfo['id'])}`.execute(db);
      await playerAttendBattle(
        this.bf(),
        battlefieldid,
        unionid,
        inviteinfo['touid'],
        inviteinfo['toname'],
        fieldname,
      );
      const currentbattleinfo = await this.firstGetUserBattleInfo(uid, 1);
      let cityinfo = await this.rows(
        sql<Row>`select * from sys_battle_city where battlefieldid = ${battlefieldid}`,
      );
      cityinfo = await setFlags(this.bf(), unionid, cityinfo);

      const ret: unknown[] = [currentbattleinfo, cityinfo];
      ret.push(await getBattleStartCityInfo(this.bf(), bid, unionid));
      await sql`insert into mem_user_schedule (\`uid\`, \`today_war_count\`) values (${uid}, 1)
        on duplicate key update \`today_war_count\` = today_war_count + 1`.execute(db);
      return ret;
      // The original's trailing `unlockUser($uid); throw join_fail;` sits after the return — dead.
    });
  }

  // ───────────────────────────── joinToPVPBattle ─────────────────────────────

  /**
   * BattleFunc.php:3393-3536: join a PVP battlefield (bid, battlefieldid, unionid); a
   * battlefieldid of 0 auto-picks the emptiest battlefield of the bid. 2001/4001 are closed
   * (state=0 filter), 6001/9001 cross-server branches stay but are unreachable locally.
   */
  @GlobalCommand()
  async joinToPVPBattle(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const bid = phpIntval(param[0]);
    let battlefieldid = phpIntval(param[1]);
    const unionidArg = phpIntval(param[2]);
    const unioninfoArg = await this.one(
      sql<Row>`select * from cfg_battle_union where unionid = ${unionidArg}`,
    );
    if (
      await this.check(
        sql<Row>`select * from sys_user_battle_state where state = 0 and uid = ${uid}`,
      )
    ) {
      throw GameError.lang('battle.join_user_already_in_battle');
    }
    // BATTLE_NET_ENABLE=false: the 6001-already-open and waiting-queue probes never run.

    const userinfo = await this.one(sql<Row>`select * from sys_user where uid = ${uid}`);
    const currenthonour = userinfo ? userinfo['honour'] : null;
    if (phpCompare(currenthonour, 0) < 0) throw GameError.lang('battle.honour_invalid');

    const battle = await this.one(
      sql<Row>`select * from cfg_battle_field where id = ${bid} and state <> 0`,
    );
    // `$battle["maxpeople"]` on a closed bid reads null (array offset on false). With
    // battlefieldid=0 that NULL is interpolated into the auto-pick SQL below as "" (PHP string
    // context), producing `having count(1)<` — a syntax error handled by the guard above; the
    // max_people / can_not_join comparisons below therefore only ever see real maxpeople values.
    const maxpeople = battle ? battle['maxpeople'] : null;

    if (battlefieldid === 0) {
      if (!battle) {
        // The original interpolates the NULL `$battle["maxpeople"]` (array offset on false)
        // straight into `having count(1) < ` — an SQL syntax error whose PearDB die answers
        // "PearDB returned an error. " to the client. The auto-pick never runs.
        throw GameError.raw('PearDB returned an error. ');
      }
      battlefieldid = phpIntval(
        await this.cell(
          sql<Row>`select battlefieldid from sys_user_battle_state where unionid = ${unionidArg}
            and bid = ${bid} group by battlefieldid having count(1) < ${phpNum(maxpeople)}
            order by count(1) limit 1`,
        ),
      );
      if (phpEmpty(battlefieldid) || battlefieldid === 0) {
        battlefieldid = phpIntval(
          await this.cell(
            sql<Row>`select id from sys_user_battle_field where bid = ${bid} limit 1`,
          ),
        );
      }
    }
    const battlefieldinfo = await this.one(
      sql<Row>`select * from sys_user_battle_field where id = ${battlefieldid}`,
    );
    if (!battlefieldinfo) throw GameError.lang('battle.no_battle_field');
    if (
      phpLooseEquals(battlefieldinfo['state'], 1) ||
      phpLooseEquals(battlefieldinfo['state'], 3)
    ) {
      throw GameError.lang('battle.no_battle_field_froze');
    }

    const curCount = phpIntval(
      await this.cell(
        sql<Row>`select count(1) from sys_user_battle_state where state = 0
          and battlefieldid = ${battlefieldid} and unionid = ${unionidArg}`,
      ),
    );
    if (curCount >= phpIntval(maxpeople)) throw GameError.lang('battle.max_people');

    if (phpLooseEquals(bid, 4001) && phpNum(battlefieldinfo['progress']) !== 0) {
      // 董卓副本只能在第一阶段才能加入.
      throw GameError.lang('battle.can_not_join');
    }
    await this.checkUserQualityForJoinBattle(uid, bid);
    // lockUser: always succeeds — the gateway serialises commands per user.
    let unionid = unionidArg;
    if (bid === 6001 && unionid === 25) {
      // 逐鹿中原副本，把用户自己的 uid 作为 uid (unreachable locally — cross-server).
      unionid = uid;
    }
    return this.scope.transaction(async () => {
      const db = this.db;
      await sql`insert into sys_user_battle_state (uid, bid, battlefieldid, unionid, level)
        values (${uid}, ${bid}, ${battlefieldid}, ${unionid}, ${phpNum(battlefieldinfo['level'])})
        on duplicate key update battlefieldid = ${battlefieldid}, bid = ${bid},
        unionid = ${unionid}, level = ${phpNum(battlefieldinfo['level'])}`.execute(db);
      await deleteOldBattleTasks(this.bf(), uid);
      if (bid === 2001) {
        if (unionid === 3) {
          // 添加袁绍一方任务 (the original's `600010` sixth group id doesn't exist — kept verbatim).
          const tasks = await this.rows(
            sql<Row>`select id from cfg_task where \`group\` in
              (60005, 60006, 60007, 60008, 60009, 600010) and pretid = -1`,
          );
          for (const task of tasks) {
            await sql`insert into sys_user_task (uid, tid, state)
              values (${uid}, ${phpIntval(task['id'])}, 0) on duplicate key update state = 0`.execute(
              db,
            );
          }
        } else if (unionid === 4) {
          // 添加曹操一方任务.
          const tasks = await this.rows(
            sql<Row>`select id from cfg_task where \`group\` in
              (60011, 60012, 60013, 60014, 60015, 60016, 60017, 60018) and pretid = -1`,
          );
          for (const task of tasks) {
            await sql`insert into sys_user_task (uid, tid, state)
              values (${uid}, ${phpIntval(task['id'])}, 0) on duplicate key update state = 0`.execute(
              db,
            );
          }
        }
      } else if (bid === 4001) {
        // 只能在副本第一阶段的时候加入 (unreachable — cfg_battle_field.state=0).
        for (const task of [60301, 60302, 60303, 60307, 60308, 60309, 60310, 60311, 60312]) {
          await sql`insert into sys_user_task (uid, tid, state)
            values (${uid}, ${task}, 0) on duplicate key update state = 0`.execute(db);
        }
        await sql`insert ignore into mem_battle_attack_lock (battlefieldid, cid, uid, msg)
          values (${battlefieldid}, 375, ${uid}, '没有拿到泗水先锋令之前不能攻击汜水关')`.execute(
          db,
        );
        await sql`insert ignore into mem_battle_attack_lock (battlefieldid, cid, uid, msg)
          values (${battlefieldid}, 343, ${uid}, '没有拿到虎牢先锋令之前不能攻击虎牢关')`.execute(
          db,
        );
      } else {
        // init_tasks of the chosen union (missing union → notice + null → tid 0, as the original).
        const tasks = explodeList(unioninfoArg ? unioninfoArg['init_tasks'] : null);
        for (const task of tasks) {
          await sql`insert into sys_user_task (uid, tid, state)
            values (${uid}, ${phpIntval(task)}, 0) on duplicate key update state = 0`.execute(db);
        }
      }

      const currentbattleinfo = await this.firstGetUserBattleInfo(uid, 1);
      let cityinfo = await this.rows(
        sql<Row>`select * from sys_battle_city where battlefieldid = ${battlefieldid}`,
      );
      cityinfo = await setFlags(this.bf(), unionid, cityinfo);
      const unionNames = this.lang.value<Record<string, unknown>>('battle')?.['union_name'] as
        Record<string, unknown> | undefined;
      const fieldname = unionNames?.[String(unionid)] ?? null;
      await playerAttendBattle(
        this.bf(),
        battlefieldid,
        unionid,
        uid,
        userinfo ? userinfo['name'] : null,
        fieldname,
      );
      const ret: unknown[] = [currentbattleinfo, cityinfo];
      ret.push(await getBattleStartCityInfo(this.bf(), bid, unionid));
      // load 血条 (官渡之战).
      ret.push(
        await this.rows(
          sql<Row>`select * from sys_battle_winpoint where battlefieldid = ${battlefieldid}`,
        ),
      );

      // cfg_task_goal has no tid 285 in the shipped data: `$id` is null and the quoted '' became
      // gid 0 through MySQL's coercion — phpIntval reproduces that row on both engines.
      const gid = phpIntval(
        await this.cell(sql<Row>`select id from cfg_task_goal where tid = 285`),
      );
      await sql`insert into sys_user_goal (\`uid\`, \`gid\`) values (${uid}, ${gid})
        on duplicate key update gid = ${gid}`.execute(db);
      return ret;
      // The original's trailing `unlockUser($uid); throw join_fail;` sits after the return — dead.
    });
  }

  // ───────────────────────────── internal helpers ─────────────────────────────

  /**
   * BattleFunc.php:18-39 firstGetUserBattleInfo — the user's live sys_user_battle_state row joined
   * with its battlefield and cfg row. `$emptythrow` defaults to 1 (throw user_not_in_battle);
   * callers pass 0 to get `false` back. A battlefield already frozen (state 1) throws battle_froze.
   */
  private async firstGetUserBattleInfo(uid: number, emptythrow = 1): Promise<Row | false> {
    const userbattleinfo = await this.one(
      sql<Row>`select su.honour, u.unionid, u.battlefieldid, b.bid, b.createuid, b.level,
        b.maxpeople, b.starttime, b.endtime, b.type, b.state, b.winner, u.in_cross_battle, c.name
      from sys_user_battle_state u left join sys_user_battle_field b on u.battlefieldid = b.id
      left join cfg_battle_field c on b.bid = c.id left join sys_user su on u.uid = su.uid
      where u.state = 0 AND u.uid = ${uid}`,
    );
    if (!userbattleinfo) {
      if (emptythrow) throw GameError.lang('battle.user_not_in_battle');
      return userbattleinfo;
    }
    if (phpLooseEquals(userbattleinfo['state'], 1)) {
      throw GameError.lang('battle.battle_froze');
    }
    return userbattleinfo;
  }

  /**
   * utils.php::checkGoodsCount — owns at least `need` of gid (the lockUser tail is the gateway's
   * per-user mutex).
   */
  private async checkGoodsCount(uid: number, gid: number, need: number): Promise<boolean> {
    const cnt = await this.cell(
      sql<Row>`select \`count\` from sys_goods where uid = ${uid} and gid = ${gid}`,
    );
    return (phpEmpty(cnt) ? 0 : phpNum(cnt)) >= need;
  }

  /** utils.php::reduceThings — the sys_things twin of reduceGoods (type-0 log entry). */
  private async reduceThings(uid: number, tid: number, count: number): Promise<void> {
    if (count > 0) {
      await sql`update sys_things set \`count\` = greatest(0, \`count\` - ${count})
        where uid = ${uid} and tid = ${tid}`.execute(this.db);
      await sql`insert into log_things (uid, tid, count, time, type)
        values (${uid}, ${tid}, -${count}, unix_timestamp(), 0)`.execute(this.db);
    }
  }

  /**
   * BattleFunc.php:3141-3205 checkUserQualityForJoinBattle — the 战场 tickets: nobility (with 推恩
   * buffer) must reach cfg_battle_field.demandNobility, every demandGoods `gid:count` and
   * demandThings `tid:count` must be owned, and on success ALL of them are consumed. The ticket
   * ids are spliced raw (cfg_battle_field is server config, exactly like the original's string
   * building); a malformed config entry reproduces the original's SQL error → PearDB response.
   */
  private async checkUserQualityForJoinBattle(uid: number, bid: number): Promise<void> {
    const battleDemands = await this.one(
      sql<Row>`select demandGoods, demandThings, demandNobility from cfg_battle_field where id = ${bid}`,
    );
    let nobility = phpIntval(
      await this.cell(sql<Row>`select nobility from sys_user where uid = ${uid}`),
    );
    nobility = await this.users.bufferNobility(uid, nobility);
    if (phpNum(nobility) < phpNum(battleDemands ? battleDemands['demandNobility'] : null)) {
      throw GameError.lang('battle.join_nobility_not_qualified');
    }

    const goodsArray = new Map<number, number>();
    let goodsSelect = 'select name,gid from cfg_goods where 1=2 ';
    let goodsWhere = 'where 1=2 ';
    for (const token of strtokList(battleDemands ? battleDemands['demandGoods'] : null)) {
      const ticket = parseTicket(token);
      goodsSelect += `or gid=${ticket.id} `;
      goodsWhere += `or ( T.gid=${ticket.id} and (S.count is null or S.count < ${ticket.count}) ) `;
      goodsArray.set(phpIntval(ticket.id), phpIntval(ticket.count));
    }
    if (goodsArray.size > 0) {
      const goodName = await this.one(
        sql<Row>`select T.name ,S.count from (${sql.raw(goodsSelect)})T
          left join (select gid, \`count\` from sys_goods where uid = ${uid} )S on T.gid = S.gid
          ${sql.raw(goodsWhere)}  limit 0,1`,
      );
      if (goodName) {
        throw GameError.lang('battle.join_resource_not_enough', goodName['name']);
      }
    }

    const thingsArray = new Map<number, number>();
    let thingsSelect = 'select name,tid from cfg_things where 1=2 ';
    let thingsWhere = 'where 1=2 ';
    for (const token of strtokList(battleDemands ? battleDemands['demandThings'] : null)) {
      const ticket = parseTicket(token);
      thingsSelect += `or tid=${ticket.id} `;
      thingsWhere += `or ( T.tid=${ticket.id} and (S.count is null or S.count < ${ticket.count}) ) `;
      thingsArray.set(phpIntval(ticket.id), phpIntval(ticket.count));
    }
    if (thingsArray.size > 0) {
      const thingName = await this.one(
        sql<Row>`select T.name ,S.count from (${sql.raw(thingsSelect)})T
          left join (select tid, \`count\` from sys_things where uid = ${uid} )S on T.tid = S.tid
          ${sql.raw(thingsWhere)}  limit 0,1`,
      );
      if (thingName) {
        throw GameError.lang('battle.join_resource_not_enough', thingName['name']);
      }
    }

    for (const [goodId, goodCount] of goodsArray) {
      await this.goods.reduceGoods(uid, goodId, goodCount);
    }
    for (const [thingId, thingCount] of thingsArray) {
      await this.reduceThings(uid, thingId, thingCount);
    }
  }
}
