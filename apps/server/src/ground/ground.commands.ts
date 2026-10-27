import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { addslashes, phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { DialogCommand, type CommandContext } from '../gateway/decorators';
import { GroundRules } from './ground-rules.service';

type Row = Record<string, unknown>;

/** cfg_js.php resource worth, used to price 招降 / 治疗 (common.php). */
const FOOD_VALUE = 0.1;
const WOOD_VALUE = 0.1;
const ROCK_VALUE = 0.2;
const IRON_VALUE = 0.25;

/** sys_city.is_special of the 王者之城, which conscripts a random special soldier. */
const KING_CITY = 2;

/** log_city_soldier.type for each 校场 grant (captive accept all / detail, cure all / detail, ...). */
const Log = {
  AcceptCaptiveAll: 0,
  AcceptCaptiveDetail: 1,
  CureWoundedAll: 2,
  CureWoundedDetail: 3,
  SayLamsterAll: 4,
  SayLamsterDetail: 5,
} as const;

/** log_user_action ids used by 校场 (utils.php logUserAction). */
const Action = { Accept: 4, Dismiss: 5 } as const;

/** cfg_task_goal type bases: 2100 释放俘虏, 2200 治疗伤兵, 2300 招降俘虏, all plus sid. */
const GoalBase = { Dismiss: 2100, Cure: 2200, Accept: 2300 } as const;

/** completeTask id shared by 治疗伤兵. */
const TASK_CURE = 372;

/** completeTask id of 防守战术 (getResistTactics). */
const TASK_RESIST = 540;

/**
 * GroundFunc.php: the 校场 commands — 募兵, 出征/防守战术, 伤兵/俘虏/逃兵 handling and 演习.
 *
 * 出征 proper (StartTroop / getTroopScheme / setTroopScheme / getTroopMaxTime) is the world-map
 * dispatch flow and is left to the next wave; the client shows 暂未开放 for the 出征 button.
 * 演习 is now settled by the ported battle engine (BattleTick / cfg_js.php upManeuver).
 */
@Injectable()
export class GroundCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cityRules: CityRules,
    private readonly users: UserRules,
    private readonly goods: GoodsRules,
    private readonly tasks: TaskRules,
    private readonly rules: GroundRules,
  ) {}

  private async rows(query: ReturnType<typeof sql<Row>>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows;
  }

  private async one(query: ReturnType<typeof sql<Row>>): Promise<Row | false> {
    return (await this.rows(query))[0] ?? false;
  }

  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = await this.one(query);
    return row === false ? false : Object.values(row)[0];
  }

  // ───────────────────────────── 募兵 ─────────────────────────────

  /**
   * conscript($uid,$cid): the daily 募兵 of 县/郡/州, the 王者城's special-soldier draw and the
   * 蛮夷之地 item grant. Always ends by throwing a message (success or failure) as the original did.
   */
  @DialogCommand()
  async conscript(ctx: CommandContext): Promise<never> {
    const db = this.scope.db;
    const { uid, cid } = ctx;
    const city = await this.one(sql<Row>`select * from sys_city
      where uid = ${uid} and cid = ${cid} and type in (0, 1, 2, 3)`);
    if (!city) throw GameError.lang('conscript.0');
    const conscriptState = phpNum(city.conscript);
    const type = phpIntval(city.type);
    const province = phpIntval(city.province);

    // 王者城：随机特殊兵种。
    if (phpIntval(city.is_special) === KING_CITY) {
      if (conscriptState > 2) throw GameError.lang('conscript.0');
      const soldierType = this.rules.rand(45, 50);
      const soldierNum = this.rules.rand(2000, 10000);
      await sql`insert into sys_city_soldier (cid, sid, count) values (${cid}, ${soldierType}, ${soldierNum})
        on duplicate key update count = count + ${soldierNum}`.execute(db);
      await sql`update sys_city set conscript = unix_timestamp() where cid = ${cid} limit 1`.execute(
        db,
      );
      const name = await this.cell(
        sql<Row>`select name from cfg_soldier where sid = ${soldierType}`,
      );
      throw GameError.raw(this.lang.t('conscript.1') + String(name) + soldierNum);
    }

    // 蛮夷之地（省 14-18 的 县/郡/州）：游历获得道具，每天一次。
    if (province >= 14 && province <= 18 && type >= 1 && type <= 3) {
      if (conscriptState > 2) throw GameError.lang('conscript.4');
      const level = phpNum(
        await this.cell(sql<Row>`select level from sys_building where bid = 6 and cid = ${cid}`),
      );
      if (level < 10) throw GameError.lang('conscript.5');
      const gid = 19000 + (province - 13) * 10 + type;
      const goodsName = await this.cell(sql<Row>`select name from cfg_goods where gid = ${gid}`);
      await this.goods.addGoods(uid, gid, 1, 4);
      await sql`update sys_city set conscript = unix_timestamp() where cid = ${cid} limit 1`.execute(
        db,
      );
      throw GameError.raw(this.lang.t('conscript.3') + String(goodsName));
    }

    // 普通城池需能招募特殊兵种才可募兵。
    if (type === 0 && phpEmpty(await this.rules.specialSoldierId(cid))) {
      throw GameError.lang('conscript.0');
    }

    if (phpEmpty(conscriptState)) {
      throw GameError.lang('conscript.0');
    } else if (phpNum(city.conscript) === 1) {
      const zhou = await this.one(sql<Row>`select sid, rsid from cfg_soldier_special_city
        where province = ${province} limit 1`);
      if (!zhou) throw GameError.lang('conscript.0');
      let sid = phpIntval(zhou.sid);
      if (phpIntval(zhou.rsid) === 1) sid = this.rules.rand(45, 50);
      let count = 0;
      if (type === 0) count = this.rules.rand(100, 300);
      else if (type === 1) count = this.rules.rand(100, 300);
      else if (type === 2) count = this.rules.rand(300, 600);
      else if (type === 3) count = this.rules.rand(600, 1800);
      await sql`insert into sys_city_soldier (cid, sid, count) values (${cid}, ${sid}, ${count})
        on duplicate key update count = count + ${count}`.execute(db);
      await sql`update sys_city set conscript = unix_timestamp() where cid = ${cid} limit 1`.execute(
        db,
      );
      const name = await this.cell(sql<Row>`select name from cfg_soldier where sid = ${sid}`);
      throw GameError.raw(this.lang.t('conscript.1') + String(name) + count);
    }
    // conscriptState >= 2 (already drafted today) or any other state.
    throw GameError.lang('conscript.2');
  }

  // ───────────────────────────── 战术 ─────────────────────────────

  /** getAttackTactics: the user's 出征 tactics row, `[]` when none set. */
  @DialogCommand()
  async getAttackTactics(ctx: CommandContext): Promise<unknown[]> {
    const tac = await this.one(sql<Row>`select * from sys_user_tactics where uid = ${ctx.uid}`);
    return tac ? [tac] : [];
  }

  /**
   * setAttackTactics: packs the 掠夺 / 侵略 / 野地 lists and the 巡逻 action into
   * sys_user_tactics. Param is `[plunderCount, (stype,action,target)*, invadeCount,
   * (stype,action,target,action2,target2)*, fieldCount, (stype,action,target)*, patrolAction]`.
   */
  @DialogCommand()
  async setAttackTactics(ctx: CommandContext, param: unknown[]): Promise<never> {
    const p = [...param];
    const plunder = this.rules.packGroups(p, phpIntval(p.shift()), 3);
    const invade = this.rules.packGroups(p, phpIntval(p.shift()), 5);
    const field = this.rules.packGroups(p, phpIntval(p.shift()), 3);
    const patrol = `3,${this.rules.str(p.shift())},3`;
    await sql`insert into sys_user_tactics (uid, plunder, invade, field, patrol)
      values (${ctx.uid}, ${plunder}, ${invade}, ${field}, ${patrol})
      on duplicate key update plunder = ${plunder}, invade = ${invade}, field = ${field},
        patrol = ${patrol}`.execute(this.scope.db);
    throw GameError.lang('setAttackTactics.succ');
  }

  /** getResistTactics: the city's 防守 tactics row, `[]` when none set; completes task 540. */
  @DialogCommand()
  async getResistTactics(ctx: CommandContext): Promise<unknown[]> {
    const tac = await this.one(sql<Row>`select * from sys_city_tactics where cid = ${ctx.cid}`);
    await this.tasks.completeTask(ctx.uid, TASK_RESIST);
    return tac ? [tac] : [];
  }

  /**
   * setResistTactics: packs the 反掠夺 / 反侵略 / 城防 lists (with their join flags) and the
   * 反巡逻 into sys_city_tactics. At most 12 soldier types may join the 反掠夺 / 反侵略 melee.
   */
  @DialogCommand()
  async setResistTactics(ctx: CommandContext, param: unknown[]): Promise<never> {
    const p = [...param];

    const deplunderCount = phpIntval(p.shift());
    const deplunderArr: string[] = [];
    const deplunderJoin: string[] = [];
    let join2 = 0;
    for (let i = 0; i < deplunderCount; i++) {
      const stype = this.rules.str(p.shift());
      const join = p.shift();
      const action = this.rules.str(p.shift());
      if (join) join2++;
      const target = this.rules.str(p.shift());
      if (join) deplunderJoin.push(stype);
      deplunderArr.push(`${stype},${action},${target}`);
    }
    if (join2 > 12) throw GameError.raw(join2 + this.lang.t('depluder.too_many_sid'));
    const deplunder = deplunderArr.join(';');
    const deplunderJoinStr = deplunderJoin.join(',');

    const deinvadeCount = phpIntval(p.shift());
    const deinvadeArr: string[] = [];
    const deinvadeJoin: string[] = [];
    join2 = 0;
    for (let i = 0; i < deinvadeCount; i++) {
      const stype = this.rules.str(p.shift());
      const join = p.shift();
      const action = this.rules.str(p.shift());
      const target = this.rules.str(p.shift());
      const action2 = this.rules.str(p.shift());
      const target2 = this.rules.str(p.shift());
      if (join) join2++;
      if (join) deinvadeJoin.push(stype);
      deinvadeArr.push(`${stype},${action},${target},${action2},${target2}`);
    }
    if (join2 > 12) throw GameError.raw(join2 + this.lang.t('depluder.too_many_sid'));

    const defenceCount = phpIntval(p.shift());
    for (let i = 0; i < defenceCount; i++) {
      const stype = this.rules.str(p.shift());
      const action = this.rules.str(p.shift());
      const target = this.rules.str(p.shift());
      deinvadeArr.push(`${stype},${action},${target}`);
    }

    const deinvade = deinvadeArr.join(';');
    const deinvadeJoinStr = deinvadeJoin.join(',');

    const join = p.shift();
    const action = this.rules.str(p.shift());
    const depatrolJoin = join ? '3' : '';
    const depatrol = `3,${action},3`;

    await sql`insert into sys_city_tactics (cid, deplunder_join, deplunder, depatrol_join,
        depatrol, deinvade_join, deinvade)
      values (${ctx.cid}, ${deplunderJoinStr}, ${deplunder}, ${depatrolJoin}, ${depatrol},
        ${deinvadeJoinStr}, ${deinvade})
      on duplicate key update deplunder_join = ${deplunderJoinStr}, deplunder = ${deplunder},
        depatrol_join = ${depatrolJoin}, depatrol = ${depatrol},
        deinvade_join = ${deinvadeJoinStr}, deinvade = ${deinvade}`.execute(this.scope.db);
    throw GameError.lang('setResistTactics.succ');
  }

  // ─────────────────────── 伤兵 / 俘虏 / 逃兵 ───────────────────────

  /** getWoundedSoldier: the city's 伤兵 (sid<13 or 45-50) with the 治疗 gold they cost. */
  @DialogCommand()
  async getWoundedSoldier(ctx: CommandContext): Promise<unknown[]> {
    const list = await this.rows(sql<Row>`select w.sid, s.name, w.count
      from mem_city_wounded w left join cfg_soldier s on w.sid = s.sid
      where w.cid = ${ctx.cid} and (w.sid < 13 or (w.sid >= 45 and w.sid <= 50)) and w.count > 0`);
    return [list, await this.woundedGoldNeed(ctx.cid)];
  }

  /** getCaptiveSoldier: the city's 俘虏 with the 招降 gold they cost. */
  @DialogCommand()
  async getCaptiveSoldier(ctx: CommandContext): Promise<unknown[]> {
    const list = await this.rows(sql<Row>`select w.sid, s.name, w.count
      from mem_city_captive w left join cfg_soldier s on w.sid = s.sid
      where w.cid = ${ctx.cid} and w.count > 0`);
    return [list, await this.captiveGoldNeed(ctx.cid)];
  }

  /** getLamster: the city's 逃兵 (sid<13 or 45-50) with the 劝说 gold they cost. */
  @DialogCommand()
  async getLamster(ctx: CommandContext): Promise<unknown[]> {
    const list = await this.rows(sql<Row>`select w.sid, s.name, w.count
      from mem_city_lamster w left join cfg_soldier s on w.sid = s.sid
      where w.cid = ${ctx.cid} and (w.sid < 13 or (w.sid >= 45 and w.sid <= 50)) and w.count > 0`);
    return [list, await this.lamsterGoldNeed(ctx.cid)];
  }

  /** cureWoundedSoldier: heals every 伤兵 at once, paying gold and granting prestige. */
  @DialogCommand()
  async cureWoundedSoldier(ctx: CommandContext): Promise<never> {
    const { uid, cid } = ctx;
    const goldNeed = await this.woundedGoldNeed(cid);
    if (phpNum(await this.cityGold(cid)) < goldNeed) {
      throw GameError.lang('cureWoundedSoldier.no_enough_gold');
    }
    const soldiers = await this.rows(sql<Row>`select * from mem_city_wounded
      where cid = ${cid} and (sid < 13 or (sid >= 45 and sid <= 50))`);
    if (soldiers.length === 0) throw GameError.lang('cureWoundedSoldier.no_wounded_soldier');
    await this.scope.transaction(async () => {
      let total = 0;
      for (const s of soldiers) {
        const count = phpNum(s.count);
        total += count;
        await this.tasks.finishTaskMaxNum(uid, count, phpIntval(s.sid) + GoalBase.Cure);
        await this.tasks.finishTask(uid, count, phpIntval(s.sid) + GoalBase.Cure);
        await this.addSoldier(cid, phpIntval(s.sid), count, uid, Log.CureWoundedAll);
      }
      await this.tasks.finishTaskMaxNum(uid, total, GoalBase.Cure);
      await this.tasks.finishTask(uid, total, GoalBase.Cure);
      await sql`delete from mem_city_wounded where cid = ${cid}`.execute(this.scope.db);
      await this.users.updateUserPrestige(uid);
      await this.cityRules.addCityResources(cid, 0, 0, 0, 0, -goldNeed);
      await this.tasks.completeTask(uid, TASK_CURE);
    });
    throw GameError.lang('cureWoundedSoldier.succ');
  }

  /** cureWoundedSoldierDetail($sid,$count): heals one 伤兵 type. */
  @DialogCommand()
  async cureWoundedSoldierDetail(ctx: CommandContext, param: unknown[]): Promise<never> {
    const { uid, cid } = ctx;
    const sid = phpIntval(param[0]);
    const count = phpIntval(param[1]);
    const goldNeed = await this.soldierGoldNeedDetail(sid, count);
    if (phpNum(await this.cityGold(cid)) < goldNeed) {
      throw GameError.lang('cureWoundedSoldier.no_enough_gold');
    }
    const soldier = await this.one(sql<Row>`select * from mem_city_wounded
      where cid = ${cid} and sid = ${sid} and count >= ${count}`);
    if (!soldier) throw GameError.lang('cureWoundedSoldier.no_wounded_soldier');
    await this.scope.transaction(async () => {
      await this.tasks.finishTaskMaxNum(uid, count, sid + GoalBase.Cure);
      await this.tasks.finishTask(uid, count, sid + GoalBase.Cure);
      await this.addSoldier(cid, sid, count, uid, Log.CureWoundedDetail);
      await this.tasks.finishTaskMaxNum(uid, count, GoalBase.Cure);
      await this.tasks.finishTask(uid, count, GoalBase.Cure);
      await sql`update mem_city_wounded set count = greatest(0, count - ${count})
        where cid = ${cid} and sid = ${sid}`.execute(this.scope.db);
      await this.users.updateUserPrestige(uid);
      await this.cityRules.addCityResources(cid, 0, 0, 0, 0, -goldNeed);
      await this.tasks.completeTask(uid, TASK_CURE);
    });
    throw GameError.lang('cureWoundedSoldier.succ');
  }

  /** acceptCaptiveSoldier: 招降 every 俘虏 at once; captives join as their soldier's base type. */
  @DialogCommand()
  async acceptCaptiveSoldier(ctx: CommandContext): Promise<never> {
    const { uid, cid } = ctx;
    const goldNeed = await this.captiveGoldNeed(cid);
    if (phpNum(await this.cityGold(cid)) < goldNeed) {
      throw GameError.lang('acceptCaptiveSoldier.no_enough_gold');
    }
    const soldiers = await this.rows(sql<Row>`select * from mem_city_captive where cid = ${cid}`);
    if (soldiers.length === 0) throw GameError.lang('acceptCaptiveSoldier.no_captive_soldier');
    await this.scope.transaction(async () => {
      let total = 0;
      for (const s of soldiers) {
        const count = phpNum(s.count);
        total += count;
        const type = phpIntval(
          await this.cell(sql<Row>`select type from cfg_soldier where sid = ${s.sid}`),
        );
        await this.tasks.finishTaskMaxNum(uid, count, phpIntval(s.sid) + GoalBase.Accept);
        await this.tasks.finishTask(uid, count, phpIntval(s.sid) + GoalBase.Accept);
        await this.addSoldier(cid, type, count, uid, Log.AcceptCaptiveAll);
      }
      await this.tasks.finishTaskMaxNum(uid, total, GoalBase.Accept);
      await this.tasks.finishTask(uid, total, GoalBase.Accept);
      await sql`delete from mem_city_captive where cid = ${cid}`.execute(this.scope.db);
      await this.users.updateUserPrestige(uid);
      await this.cityRules.addCityResources(cid, 0, 0, 0, 0, -goldNeed);
      await this.cityRules.updateCityResourceAdd(cid);
      await this.users.logUserAction(uid, Action.Accept);
    });
    throw GameError.lang('acceptCaptiveSoldier.succ');
  }

  /** acceptCaptiveSoldierDetail($sid,$count): 招降 one 俘虏 type. */
  @DialogCommand()
  async acceptCaptiveSoldierDetail(ctx: CommandContext, param: unknown[]): Promise<never> {
    const { uid, cid } = ctx;
    const sid = phpIntval(param[0]);
    const count = phpIntval(param[1]);
    const goldNeed = await this.soldierGoldNeedDetail(sid, count);
    if (phpNum(await this.cityGold(cid)) < goldNeed) {
      throw GameError.lang('acceptCaptiveSoldier.no_enough_gold');
    }
    const soldier = await this.one(sql<Row>`select * from mem_city_captive
      where cid = ${cid} and sid = ${sid} and count >= ${count}`);
    if (!soldier) throw GameError.lang('acceptCaptiveSoldier.no_captive_soldier');
    await this.scope.transaction(async () => {
      const type = phpIntval(
        await this.cell(sql<Row>`select type from cfg_soldier where sid = ${sid}`),
      );
      await this.tasks.finishTaskMaxNum(uid, count, sid + GoalBase.Accept);
      await this.tasks.finishTask(uid, count, sid + GoalBase.Accept);
      await this.addSoldier(cid, type, count, uid, Log.AcceptCaptiveDetail);
      await this.tasks.finishTaskMaxNum(uid, count, GoalBase.Accept);
      await this.tasks.finishTask(uid, count, GoalBase.Accept);
      await sql`update mem_city_captive set count = greatest(0, count - ${count})
        where cid = ${cid} and sid = ${sid}`.execute(this.scope.db);
      await this.users.updateUserPrestige(uid);
      await this.cityRules.addCityResources(cid, 0, 0, 0, 0, -goldNeed);
      await this.cityRules.updateCityResourceAdd(cid);
      await this.users.logUserAction(uid, Action.Accept);
    });
    throw GameError.lang('acceptCaptiveSoldier.succ');
  }

  /** sayToLamster: 劝说 every 逃兵 at once back into the city's army. */
  @DialogCommand()
  async sayToLamster(ctx: CommandContext): Promise<never> {
    const { uid, cid } = ctx;
    const goldNeed = await this.lamsterGoldNeed(cid);
    if (phpNum(await this.cityGold(cid)) < goldNeed) {
      throw GameError.lang('sayToLamster.no_enough_gold');
    }
    const soldiers = await this.rows(sql<Row>`select * from mem_city_lamster
      where cid = ${cid} and (sid < 13 or (sid >= 45 and sid <= 50))`);
    if (soldiers.length === 0) throw GameError.lang('sayToLamster.no_wounded_soldier');
    await this.scope.transaction(async () => {
      for (const s of soldiers) {
        await this.addSoldier(cid, phpIntval(s.sid), phpNum(s.count), uid, Log.SayLamsterAll);
      }
      await sql`delete from mem_city_lamster where cid = ${cid}`.execute(this.scope.db);
      await this.users.updateUserPrestige(uid);
      await this.cityRules.updateCityResourceAdd(cid);
      await this.cityRules.addCityResources(cid, 0, 0, 0, 0, -goldNeed);
    });
    throw GameError.lang('sayToLamster.succ');
  }

  /** sayToLamsterDetail($sid,$count): 劝说 one 逃兵 type. */
  @DialogCommand()
  async sayToLamsterDetail(ctx: CommandContext, param: unknown[]): Promise<never> {
    const { uid, cid } = ctx;
    const sid = phpIntval(param[0]);
    const count = phpIntval(param[1]);
    const goldNeed = await this.soldierGoldNeedDetail(sid, count);
    if (phpNum(await this.cityGold(cid)) < goldNeed) {
      throw GameError.lang('sayToLamster.no_enough_gold');
    }
    const soldier = await this.one(sql<Row>`select * from mem_city_lamster
      where cid = ${cid} and sid = ${sid} and count >= ${count}`);
    if (!soldier) throw GameError.lang('sayToLamster.no_wounded_soldier');
    await this.scope.transaction(async () => {
      await this.addSoldier(cid, sid, count, uid, Log.SayLamsterDetail);
      await sql`update mem_city_lamster set count = greatest(0, count - ${count})
        where cid = ${cid} and sid = ${sid}`.execute(this.scope.db);
      await this.users.updateUserPrestige(uid);
      await this.cityRules.updateCityResourceAdd(cid);
      await this.cityRules.addCityResources(cid, 0, 0, 0, 0, -goldNeed);
    });
    throw GameError.lang('sayToLamster.succ');
  }

  /** dismissCaptiveSoldier: 释放 every 俘虏 at once. */
  @DialogCommand()
  async dismissCaptiveSoldier(ctx: CommandContext): Promise<never> {
    const { uid, cid } = ctx;
    await this.scope.transaction(async () => {
      let total = 0;
      for (const s of await this.rows(
        sql<Row>`select * from mem_city_captive where cid = ${cid}`,
      )) {
        const count = phpNum(s.count);
        total += count;
        await this.tasks.finishTaskMaxNum(uid, count, phpIntval(s.sid) + GoalBase.Dismiss);
        await this.tasks.finishTask(uid, count, phpIntval(s.sid) + GoalBase.Dismiss);
      }
      await this.tasks.finishTaskMaxNum(uid, total, GoalBase.Dismiss);
      await this.tasks.finishTask(uid, total, GoalBase.Dismiss);
      await sql`delete from mem_city_captive where cid = ${cid}`.execute(this.scope.db);
      await this.cityRules.updateCityResourceAdd(cid);
      await this.users.logUserAction(uid, Action.Dismiss);
    });
    throw GameError.lang('dismissCaptiveSoldier.succ');
  }

  /** dismissCaptiveSoldierDetail($sid,$count): 释放 one 俘虏 type. */
  @DialogCommand()
  async dismissCaptiveSoldierDetail(ctx: CommandContext, param: unknown[]): Promise<never> {
    const { uid, cid } = ctx;
    const sid = phpIntval(param[0]);
    const count = phpIntval(param[1]);
    const soldier = await this.one(sql<Row>`select * from mem_city_captive
      where cid = ${cid} and sid = ${sid} and count >= ${count}`);
    if (!soldier) throw GameError.lang('acceptCaptiveSoldier.no_captive_soldier');
    await this.scope.transaction(async () => {
      await this.tasks.finishTaskMaxNum(uid, count, sid + GoalBase.Dismiss);
      await this.tasks.finishTask(uid, count, sid + GoalBase.Dismiss);
      await this.tasks.finishTaskMaxNum(uid, count, GoalBase.Dismiss);
      await this.tasks.finishTask(uid, count, GoalBase.Dismiss);
      await sql`update mem_city_captive set count = greatest(0, count - ${count})
        where cid = ${cid} and sid = ${sid}`.execute(this.scope.db);
      await this.cityRules.updateCityResourceAdd(cid);
      await this.users.logUserAction(uid, Action.Dismiss);
    });
    throw GameError.lang('dismissCaptiveSoldier.succ');
  }

  /** dismissWoundedSoldier: 遣散 every 伤兵, returning their people to the city. */
  @DialogCommand()
  async dismissWoundedSoldier(ctx: CommandContext): Promise<never> {
    const { cid } = ctx;
    await this.scope.transaction(async () => {
      const people = await this.woundedPeople(cid);
      await this.cityRules.addCityPeople(cid, people);
      await sql`delete from mem_city_wounded where cid = ${cid}`.execute(this.scope.db);
      await this.cityRules.updateCityResourceAdd(cid);
    });
    throw GameError.lang('dismissWoundedSoldier.succ');
  }

  /** dismissWoundedSoldierDetail($sid,$count): 遣散 one 伤兵 type. */
  @DialogCommand()
  async dismissWoundedSoldierDetail(ctx: CommandContext, param: unknown[]): Promise<never> {
    const { cid } = ctx;
    const sid = phpIntval(param[0]);
    const count = phpIntval(param[1]);
    const current = phpNum(
      await this.cell(
        sql<Row>`select count from mem_city_wounded where cid = ${cid} and sid = ${sid}`,
      ),
    );
    if (current < count) throw GameError.lang('waigua.forbidden');
    await this.scope.transaction(async () => {
      const people = await this.soldierPeopleDetail(sid, count);
      await this.cityRules.addCityPeople(cid, people);
      await sql`update mem_city_wounded set count = greatest(0, count - ${count})
        where cid = ${cid} and sid = ${sid}`.execute(this.scope.db);
      await this.cityRules.updateCityResourceAdd(cid);
    });
    throw GameError.lang('dismissWoundedSoldier.succ');
  }

  /** dismissLamster: 遣散 every 逃兵, returning their people to the city. */
  @DialogCommand()
  async dismissLamster(ctx: CommandContext): Promise<never> {
    const { cid } = ctx;
    await this.scope.transaction(async () => {
      const people = await this.lamsterPeople(cid);
      await this.cityRules.addCityPeople(cid, people);
      await sql`delete from mem_city_lamster where cid = ${cid}`.execute(this.scope.db);
      await this.cityRules.updateCityResourceAdd(cid);
    });
    throw GameError.lang('dismissLamster.succ');
  }

  /** dismissLamsterDetail($sid,$count): 遣散 one 逃兵 type. */
  @DialogCommand()
  async dismissLamsterDetail(ctx: CommandContext, param: unknown[]): Promise<never> {
    const { cid } = ctx;
    const sid = phpIntval(param[0]);
    const count = phpIntval(param[1]);
    const current = phpNum(
      await this.cell(
        sql<Row>`select count from mem_city_lamster where cid = ${cid} and sid = ${sid}`,
      ),
    );
    if (current < count) throw GameError.lang('waigua.forbidden');
    await this.scope.transaction(async () => {
      const people = await this.soldierPeopleDetail(sid, count);
      await this.cityRules.addCityPeople(cid, people);
      await sql`update mem_city_lamster set count = greatest(0, count - ${count})
        where cid = ${cid} and sid = ${sid}`.execute(this.scope.db);
      await this.cityRules.updateCityResourceAdd(cid);
    });
    throw GameError.lang('dismissLamster.succ');
  }

  // ───────────────────────────── 演习 ─────────────────────────────

  /**
   * GroundFunc.php::startManeuver($attack,$resist): queue a 演习 by inserting a `mem_maneuver` row
   * in `state=0`. Settlement now happens in `BattleTick.handleBattle` (TickOrder.Battle) via the
   * ported `cfg_js.php::upManeuver` loop, which fills in `attackadd`/`resistadd` from `cfg_soldier`,
   * runs the battle and writes `state=1,result,round,attackdie,resistdie`. The client then polls
   * `getManeuverResult`. Returns `[mid]` exactly as the original did.
   */
  @DialogCommand()
  async startManeuver(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const attack = addslashes(phpString(param[0]));
    const resist = addslashes(phpString(param[1]));
    const res = await sql`insert into mem_maneuver (state, attacksoldiers, resistsoldiers)
      values (0, ${attack}, ${resist})`.execute(this.scope.db);
    const mid = Number(res.insertId ?? 0);
    return [mid];
  }

  /**
   * getManeuverResult($mid): `[0]` while the 演习 is still running, else `[1, maneuver]` with the
   * settled row (which is then deleted), including its generated combat stats and loss strings.
   */
  @DialogCommand()
  async getManeuverResult(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const mid = phpIntval(param[0]);
    const maneuver = await this.one(sql<Row>`select * from mem_maneuver
      where id = ${mid} and state = 1`);
    if (!maneuver) return [0];
    await sql`delete from mem_maneuver where id = ${maneuver.id}`.execute(this.scope.db);
    return [1, maneuver];
  }

  // ─────────────────────────── helpers ───────────────────────────

  private async cityGold(cid: number): Promise<unknown> {
    return this.cell(sql<Row>`select gold from mem_city_resource where cid = ${cid}`);
  }

  /** Adds the granted soldiers to the city and logs them under the matching 校场 log type. */
  private async addSoldier(
    cid: number,
    sid: number,
    count: number,
    uid: number,
    logType: number,
  ): Promise<void> {
    const db = this.scope.db;
    await sql`insert into sys_city_soldier (cid, sid, count) values (${cid}, ${sid}, ${count})
      on duplicate key update count = count + ${count}`.execute(db);
    await sql`insert into log_city_soldier (cid, sid, uid, count, type)
      values (${cid}, ${sid}, ${uid}, ${count}, ${logType})
      on duplicate key update count = count + ${count}`.execute(db);
  }

  /** getCaptiveSoldierGoldNeed: 10% of the captives' resource worth. */
  private async captiveGoldNeed(cid: number): Promise<number> {
    return phpIntval(
      await this.cell(sql<Row>`select 0.1 * sum(s.count * (f.wood_need * ${WOOD_VALUE}
          + f.food_need * ${FOOD_VALUE} + f.rock_need * ${ROCK_VALUE} + f.iron_need * ${IRON_VALUE}))
        from mem_city_captive s left join cfg_soldier f on f.sid = s.sid
        where s.cid = ${cid} and s.count > 0`),
    );
  }

  /** getWoundedSoldierGoldNeed: 10% of the curable wounded's (sid<13 or 45-50) resource worth. */
  private async woundedGoldNeed(cid: number): Promise<number> {
    return phpIntval(
      await this.cell(sql<Row>`select 0.1 * sum(s.count * (f.wood_need * ${WOOD_VALUE}
          + f.food_need * ${FOOD_VALUE} + f.rock_need * ${ROCK_VALUE} + f.iron_need * ${IRON_VALUE}))
        from mem_city_wounded s left join cfg_soldier f on f.sid = s.sid
        where s.cid = ${cid} and (s.sid < 13 or (s.sid >= 45 and s.sid <= 50)) and s.count > 0`),
    );
  }

  /** getLamsterGoldNeed: 10% of the persuadable 逃兵's resource worth. */
  private async lamsterGoldNeed(cid: number): Promise<number> {
    return phpIntval(
      await this.cell(sql<Row>`select 0.1 * sum(s.count * (f.wood_need * ${WOOD_VALUE}
          + f.food_need * ${FOOD_VALUE} + f.rock_need * ${ROCK_VALUE} + f.iron_need * ${IRON_VALUE}))
        from mem_city_lamster s left join cfg_soldier f on f.sid = s.sid
        where s.cid = ${cid} and (s.sid < 13 or (s.sid >= 45 and s.sid <= 50)) and s.count > 0`),
    );
  }

  /** getSoldierGoldNeedDetail: 10% of one soldier type's resource worth. */
  private async soldierGoldNeedDetail(sid: number, count: number): Promise<number> {
    return phpIntval(
      await this.cell(sql<Row>`select 0.1 * sum(${count} * (wood_need * ${WOOD_VALUE}
          + food_need * ${FOOD_VALUE} + rock_need * ${ROCK_VALUE} + iron_need * ${IRON_VALUE}))
        from cfg_soldier where sid = ${sid}`),
    );
  }

  /** getWoundedSoldierPeople: people freed by 遣散 every curable 伤兵. */
  private async woundedPeople(cid: number): Promise<number> {
    return phpIntval(
      await this.cell(sql<Row>`select sum(c.people_need * w.count)
        from mem_city_wounded w left join cfg_soldier c on c.sid = w.sid
        where w.cid = ${cid} and (w.sid < 13 or (w.sid >= 45 and w.sid <= 50)) and w.count > 0`),
    );
  }

  /** getLamsterPeople: people freed by 遣散 every 逃兵. */
  private async lamsterPeople(cid: number): Promise<number> {
    return phpIntval(
      await this.cell(sql<Row>`select sum(c.people_need * w.count)
        from mem_city_lamster w left join cfg_soldier c on c.sid = w.sid
        where w.cid = ${cid} and (w.sid < 13 or (w.sid >= 45 and w.sid <= 50)) and w.count > 0`),
    );
  }

  /** getSoldierPeopleDetail: people freed by 遣散 one soldier type. */
  private async soldierPeopleDetail(sid: number, count: number): Promise<number> {
    return phpIntval(
      await this.cell(sql<Row>`select people_need * ${count} from cfg_soldier where sid = ${sid}`),
    );
  }
}
