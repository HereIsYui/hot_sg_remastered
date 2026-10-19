import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { Building, CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { OwnershipService } from '../core/ownership.service';
import {
  phpEmpty,
  phpFloat,
  phpFloatString,
  phpIntval,
  phpLooseEquals,
  phpNum,
  phpString,
} from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { DialogCommand, GlobalCommand, type CommandContext } from '../gateway/decorators';
import { BuildingInfoService } from './building-info.service';
import { encodeXy } from './building-rules.service';
import {
  isSpecialSoldier,
  SoldierPreType,
  SoldierRules,
  type ArmySoldierState,
} from './soldier-rules.service';
import { GAME_SPEED_RATE } from './technic-rules.service';

type Row = Record<string, unknown>;

/** log_user_action ids. */
const Action = { DoubleDraft: 3, Dissolve: 29 } as const;

/** 加急征兵: twice the resources for a 1.5 speed bonus. */
const DOUBLE_RESOURCE_FACTOR = 2;
const DOUBLE_SPEED_FACTOR = 1.5;

/** mem_user_buffer type cutting draft time by 20%. */
const BUFFER_DRAFT_TIME = 10321;

/** 韩信三篇上部: cuts one queue entry by two hours. */
const GOODS_HANXIN_UPPER = 125;
const HANXIN_UPPER_REDUCE = 7200;

/** 韩信三篇下部: cuts 30% (at least an hour) off one entry per 兵营. */
const GOODS_HANXIN_LOWER = 63;
const HANXIN_LOWER_MIN_REDUCE = 3600;
const TASK_HANXIN_LOWER = 325;

/** sys_city.is_special of the 王者之城, which drafts the type 4 special soldier. */
const KING_CITY = 2;

/** Largest batch soldierConvert accepts. */
const CONVERT_MAX_COUNT = 200000;

/** The 兵营 commands of SoldierFunc.php: draft, cancel, dissolve and convert soldiers. */
@Injectable()
export class SoldierCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly soldiers: SoldierRules,
    private readonly info: BuildingInfoService,
    private readonly ownership: OwnershipService,
    private readonly cityRules: CityRules,
    private readonly users: UserRules,
    private readonly goods: GoodsRules,
    private readonly tasks: TaskRules,
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

  private async hasArmyAt(cid: number, xy: number): Promise<boolean> {
    return !!(await this.one(sql<Row>`select * from sys_building
      where cid = ${cid} and xy = ${xy} and bid = ${Building.Army}`));
  }

  private async hasArmy(cid: number): Promise<boolean> {
    return !!(await this.one(sql<Row>`select * from sys_building
      where cid = ${cid} and bid = ${Building.Army} limit 1`));
  }

  /** Starts the earliest waiting entry of a 兵营. */
  private async startNextQueue(cid: unknown, xy: unknown): Promise<void> {
    const db = this.scope.db;
    const id = await this.cell(sql<Row>`select id from sys_city_draftqueue
      where cid = ${cid} and xy = ${xy} order by queuetime, id limit 1`);
    if (phpEmpty(id)) return;
    await sql`update sys_city_draftqueue set state = 1, state_starttime = unix_timestamp()
      where id = ${id}`.execute(db);
    await sql`insert into mem_city_draft (select id, cid, xy, sid, count,
        state_starttime + needtime from sys_city_draftqueue where id = ${id})`.execute(db);
  }

  /** `[inner, x, y, sid, count, double]`: queues soldiers, paying resources and people up front. */
  @DialogCommand()
  async startDraftQueue(ctx: CommandContext, param: unknown[]): Promise<unknown> {
    const db = this.scope.db;
    const { uid, cid } = ctx;
    const xy = encodeXy(phpIntval(param[0]), phpIntval(param[1]), phpIntval(param[2]));
    const sid = phpIntval(param[3]);
    const soldierCount = phpIntval(param[4]);
    const double = phpLooseEquals(param[5], 1);
    const resourcefactor = double ? DOUBLE_RESOURCE_FACTOR : 1;
    const speedfactor = double ? DOUBLE_SPEED_FACTOR : 0;

    if (soldierCount <= 0) throw GameError.lang('startDraftQueue.cant_recruit_zero');
    await this.ownership.checkCityExist(cid, uid);
    if (!(await this.hasArmyAt(cid, xy))) return this.lang.t('startDraftQueue.no_barracks_info');
    const soldier = await this.one(
      sql<Row>`select * from cfg_soldier where sid = ${sid} and fromcity = 1`,
    );
    if (!soldier) throw GameError.lang('startDraftQueue.no_army_branch_info');
    const cost = (v: unknown) => phpNum(v) * soldierCount * resourcefactor;
    const [wood, rock, iron, food, gold] = [
      cost(soldier.wood_need),
      cost(soldier.rock_need),
      cost(soldier.iron_need),
      cost(soldier.food_need),
      cost(soldier.gold_need),
    ] as const;
    if (!(await this.cityRules.checkCityResource(cid, wood, rock, iron, food, gold))) {
      throw GameError.lang('startDraftQueue.no_enough_resource');
    }
    const peopleNeed = phpNum(soldier.people_need) * soldierCount;
    if (phpNum(await this.cityRules.cityPeopleFree(cid)) < peopleNeed) {
      throw GameError.lang('startDraftQueue.lack_free_people', soldierCount);
    }
    for (const condition of await this.soldiers.conditionRows(sid)) {
      const current = await this.soldiers.conditionCurrent(uid, cid, xy, condition);
      const met = !(phpEmpty(current) || phpNum(current) < phpNum(condition.pre_level));
      if (phpLooseEquals(condition.pre_type, SoldierPreType.Building) && !met) {
        throw GameError.lang('startDraftQueue.no_pre_building');
      }
      if (phpLooseEquals(condition.pre_type, SoldierPreType.Technic) && !met) {
        throw GameError.lang('startDraftQueue.no_pre_technic');
      }
    }
    if (isSpecialSoldier(sid)) {
      const isSpecial = await this.cell(
        sql<Row>`select is_special from sys_city where cid = ${cid} limit 1`,
      );
      const specialSid =
        phpIntval(isSpecial) === KING_CITY
          ? await this.cell(sql<Row>`select sid from cfg_soldier_special_city
              where cid = ${cid} and type = '4' limit 1`)
          : await this.soldiers.specialSoldierId(cid);
      if (phpEmpty(specialSid)) throw GameError.lang('conscript.0');
      if (!phpLooseEquals(specialSid, sid)) throw GameError.raw("hello ,baby,i'm yingke");
    }
    const drafting = await this.cell(sql<Row>`select count(*) from sys_city_draftqueue
      where cid = ${cid} and xy = ${xy}`);
    const level = await this.cell(
      sql<Row>`select level from sys_building where cid = ${cid} and xy = ${xy}`,
    );
    if (phpNum(drafting) >= phpNum(level) + 1) {
      throw GameError.lang('startDraftQueue.reach_queue_limit');
    }

    let interval = phpNum(soldier.time_need);
    interval *= await this.soldiers.speedRate(cid, sid, speedfactor);
    interval = Math.max(1, Math.floor(interval / GAME_SPEED_RATE));
    let needtime = interval * soldierCount;
    const buffered = await this.cell(sql<Row>`select endtime from mem_user_buffer
      where uid = ${uid} and buftype = ${BUFFER_DRAFT_TIME} and endtime > unix_timestamp()`);
    if (!phpEmpty(buffered)) needtime = Math.floor(needtime * 0.8);
    const draftInterval = phpFloatString(interval);
    const need = phpFloatString(needtime);

    await this.scope.transaction(async () => {
      await this.cityRules.addCityResources(cid, -wood, -rock, -iron, -food, -gold);
      await this.cityRules.addCityPeople(cid, -peopleNeed);
      const queued = await this.one(sql<Row>`select * from sys_city_draftqueue
        where cid = ${cid} and xy = ${xy}`);
      if (queued) {
        await sql`insert into sys_city_draftqueue
            (cid, xy, sid, count, queuetime, state, draft_interval, state_starttime, needtime)
          values (${cid}, ${xy}, ${sid}, ${soldierCount}, unix_timestamp(), 0, ${draftInterval},
            0, ${need})`.execute(db);
        const training = await this.one(sql<Row>`select * from sys_city_draftqueue
          where cid = ${cid} and xy = ${xy} and state = 1`);
        if (!training) await this.startNextQueue(cid, xy);
      } else {
        const inserted = await sql`insert into sys_city_draftqueue
            (cid, xy, sid, count, queuetime, state, draft_interval, state_starttime, needtime)
          values (${cid}, ${xy}, ${sid}, ${soldierCount}, unix_timestamp(), 1, ${draftInterval},
            unix_timestamp(), ${need})`.execute(db);
        await sql`insert into mem_city_draft (select id, cid, xy, sid, count,
            state_starttime + needtime from sys_city_draftqueue
          where id = ${Number(inserted.insertId)})`.execute(db);
      }
      if (double) await this.users.logUserAction(uid, Action.DoubleDraft);
    });
    return this.info.armyInfo(uid, cid, xy);
  }

  /** `[inner, x, y, qid]`: cancels a queue entry, returning its people and 66% of its cost. */
  @DialogCommand()
  async stopDraftQueue(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const db = this.scope.db;
    const { uid, cid } = ctx;
    const xy = encodeXy(phpIntval(param[0]), phpIntval(param[1]), phpIntval(param[2]));
    const qid = phpIntval(param[3]);
    await this.ownership.checkCityExist(cid, uid);
    if (!(await this.hasArmyAt(cid, xy))) throw GameError.lang('stopDraftQueue.no_barracks_info');
    // Only this city's entries: the original refunded any city's queue to the caller.
    const queue = await this.one(sql<Row>`select * from sys_city_draftqueue
      where id = ${qid} and cid = ${cid}`);
    if (queue) {
      const soldier = await this.one(
        sql<Row>`select * from cfg_soldier where sid = ${queue.sid} and fromcity = 1`,
      );
      if (!soldier) throw GameError.lang('stopDraftQueue.no_army_branch_info');
      const count = phpNum(queue.count);
      await this.scope.transaction(async () => {
        await sql`delete from sys_city_draftqueue where id = ${qid}`.execute(db);
        await this.cityRules.addCityPeople(cid, count * phpNum(soldier.people_need));
        const refund = (v: unknown) => phpNum(v) * count * 0.66;
        await this.cityRules.addCityResources(
          cid,
          refund(soldier.wood_need),
          refund(soldier.rock_need),
          refund(soldier.iron_need),
          refund(soldier.food_need),
          refund(soldier.gold_need),
        );
        if (phpLooseEquals(queue.state, 1)) {
          await sql`delete from mem_city_draft where id = ${qid}`.execute(db);
          await this.startNextQueue(queue.cid, queue.xy);
        }
      });
    }
    return this.info.armyInfo(uid, cid, xy);
  }

  /** `[inner, x, y, sid, count]`: disbands soldiers, returning their people and 33% of the cost. */
  @DialogCommand()
  async dissolveSoldier(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid, cid } = ctx;
    const xy = encodeXy(phpIntval(param[0]), phpIntval(param[1]), phpIntval(param[2]));
    const sid = phpIntval(param[3]);
    const soldierCount = phpIntval(param[4]);
    if (soldierCount <= 0) throw GameError.lang('dissolveSoldier.cant_dismiss_zero');
    await this.ownership.checkCityExist(cid, uid);
    if (!(await this.hasArmyAt(cid, xy))) throw GameError.lang('dissolveSoldier.no_barracks_info');
    const soldier = await this.one(
      sql<Row>`select * from cfg_soldier where sid = ${sid} and fromcity = 1`,
    );
    if (!soldier) throw GameError.lang('dissolveSoldier.no_army_branch_info');
    const current = await this.cell(sql<Row>`select count from sys_city_soldier
      where cid = ${cid} and sid = ${sid}`);
    if (phpNum(current) < soldierCount) throw GameError.lang('dissolveSoldier.cant_dismiss_exceed');
    await this.scope.transaction(async () => {
      await this.cityRules.addCityPeople(cid, soldierCount * phpNum(soldier.people_need));
      await this.cityRules.addCitySoldier(cid, sid, -soldierCount);
      const refund = (v: unknown) => soldierCount * phpNum(v) * 0.33;
      await this.cityRules.addCityResources(
        cid,
        refund(soldier.wood_need),
        refund(soldier.rock_need),
        refund(soldier.iron_need),
        refund(soldier.food_need),
        refund(soldier.gold_need),
      );
      await this.users.logUserAction(uid, Action.Dissolve);
    });
    return [await this.info.armyInfo(uid, cid, xy), this.lang.t('dissolveSoldier.dissolve_succ')];
  }

  /** `[inner, x, y, qid]`: 韩信三篇上部 takes two hours off a queue entry. */
  @DialogCommand()
  async useHanXinShangBu(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const db = this.scope.db;
    const { uid, cid } = ctx;
    const xy = encodeXy(phpIntval(param[0]), phpIntval(param[1]), phpIntval(param[2]));
    const qid = phpIntval(param[3]);
    await this.ownership.checkCityExist(cid, uid);
    if (!(await this.hasArmy(cid))) throw GameError.lang('dissolveSoldier.no_barracks_info');
    if (!(await this.goods.checkGoods(uid, GOODS_HANXIN_UPPER))) {
      throw GameError.raw('not_enough_goods125');
    }
    // Only this city's entries: the original sped up any city's queue.
    const queue = await this.one(sql<Row>`select * from sys_city_draftqueue
      where id = ${qid} and cid = ${cid}`);
    if (!queue) throw GameError.lang('dissolveSoldier.no_army_branch_info');
    const needtime = phpIntval(queue.needtime) - HANXIN_UPPER_REDUCE;
    await this.scope.transaction(async () => {
      await sql`update sys_city_draftqueue set needtime = ${needtime}
        where id = ${queue.id}`.execute(db);
      if (phpLooseEquals(queue.state, 1)) await this.syncDraftEnd(queue.id);
      await this.goods.reduceGoods(uid, GOODS_HANXIN_UPPER, 1);
    });
    return this.info.armyInfo(uid, cid, xy);
  }

  /**
   * `[inner, x, y, qid]`: 韩信三篇下部 takes 30% (at least an hour) off the entry and off the
   * first not yet sped up entry of each other 兵营, once per entry.
   */
  @DialogCommand()
  async useHanXinXiaBu(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const db = this.scope.db;
    const { uid, cid } = ctx;
    const xy = encodeXy(phpIntval(param[0]), phpIntval(param[1]), phpIntval(param[2]));
    const qid = phpIntval(param[3]);
    await this.ownership.checkCityExist(cid, uid);
    if (!(await this.hasArmy(cid))) throw GameError.lang('dissolveSoldier.no_barracks_info');
    if (!(await this.goods.checkGoods(uid, GOODS_HANXIN_LOWER))) {
      throw GameError.raw('ask_for_copperShop');
    }
    // Only this city's entries: the original sped up any city's queue.
    const queue = await this.one(sql<Row>`select * from sys_city_draftqueue
      where id = ${qid} and cid = ${cid}`);
    if (!queue) throw GameError.lang('dissolveSoldier.no_army_branch_info');
    if (!phpLooseEquals(queue.accmark, 0)) throw GameError.lang('accSoldier.only_once');
    const ids = (
      await this.rows(sql<Row>`select min(id) as id from sys_city_draftqueue
        where accmark = 0 and cid = ${cid} and xy != ${queue.xy} group by xy`)
    ).map((row) => row.id);
    ids.push(queue.id);
    const now = Math.floor(Date.now() / 1000);
    await this.scope.transaction(async () => {
      for (const id of ids) {
        const entry = await this.one(sql<Row>`select * from sys_city_draftqueue where id = ${id}`);
        if (!entry) continue;
        const old = phpIntval(entry.needtime);
        if (phpLooseEquals(entry.state, 1)) {
          const start = phpIntval(entry.state_starttime);
          const reduce = Math.max(
            HANXIN_LOWER_MIN_REDUCE,
            Math.trunc(Math.ceil(old + start - now) * 0.3),
          );
          await sql`update sys_city_draftqueue set needtime = ${old - reduce}, accmark = 1
            where id = ${entry.id}`.execute(db);
          await this.syncDraftEnd(entry.id);
        } else {
          const reduce = Math.max(HANXIN_LOWER_MIN_REDUCE, Math.trunc(Math.ceil(old * 0.3)));
          await sql`update sys_city_draftqueue set needtime = ${old - reduce}, accmark = 1
            where id = ${entry.id}`.execute(db);
        }
      }
      await this.goods.reduceGoods(uid, GOODS_HANXIN_LOWER, 1);
      await this.tasks.completeTaskWithTaskid(uid, TASK_HANXIN_LOWER);
    });
    return this.info.armyInfo(uid, cid, xy);
  }

  /** Moves the training entry's finish time after its needtime changed. */
  private async syncDraftEnd(id: unknown): Promise<void> {
    const end = await this.cell(sql<Row>`select state_starttime + needtime
      from sys_city_draftqueue where id = ${id}`);
    await sql`update mem_city_draft set state_endtime = ${end} where id = ${id}`.execute(
      this.scope.db,
    );
  }

  /** `[double, cid, sid]`: the draft dialog's soldier with or without the 加急 costs. */
  @GlobalCommand()
  async changeSoldierInfo(ctx: CommandContext, param: unknown[]): Promise<ArmySoldierState[]> {
    const double = phpLooseEquals(param[0], 1);
    const resourcefactor = double ? DOUBLE_RESOURCE_FACTOR : 1;
    const speedfactor = double ? DOUBLE_SPEED_FACTOR : 0;
    const cid = phpIntval(param[1]);
    await this.ownership.checkCityExist(cid, ctx.uid);
    const sid = phpIntval(param[2]);
    const soldier = await this.one(sql<Row>`select s.*, c.count from cfg_soldier s
      left join sys_city_soldier c on c.cid = ${cid} and c.sid = s.sid
      where s.sid = ${sid} and s.fromcity = 1`);
    if (!soldier) throw GameError.lang('startDraftQueue.no_army_branch_info');
    const speedRate = await this.soldiers.speedRate(cid, sid, speedfactor);
    const state = this.soldiers.soldierState(soldier, resourcefactor);
    state.sid = sid;
    state.draft_time = phpFloat(Math.max(1, phpNum(soldier.time_need) * speedRate));
    return [state];
  }

  /**
   * `[inner, x, y, fromSid, fromCount, toSid, toCount]`: 洗点 soldiers into another type at the
   * cfg_soldier_convert ratio, spending the city's sys_soldier_convert allowance.
   */
  @DialogCommand()
  async soldierConvert(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const db = this.scope.db;
    const { uid, cid } = ctx;
    const fromSid = phpIntval(param[3]);
    let fromCount = phpIntval(param[4]);
    const toSid = phpIntval(param[5]);
    const toCount = phpIntval(param[6]);
    if (isSpecialSoldier(fromSid) || isSpecialSoldier(toSid)) {
      throw GameError.lang('conert.not_support_sid');
    }
    if (fromCount <= 0 || toCount <= 0 || toCount >= CONVERT_MAX_COUNT) {
      throw GameError.lang('stopDraftQueue.choose_soldier_not_enough');
    }
    const xy = encodeXy(phpNum(param[0]), phpNum(param[1]), phpNum(param[2]));
    const value = phpNum(
      await this.cell(sql<Row>`select ${toCount} * people_need from cfg_soldier
        where sid = ${toSid}`),
    );
    const ratio = (await this.soldiers.convertTable())[fromSid - 1]?.[toSid - 1];
    const [fromNum, toNum] = phpString(ratio).split(':');
    const divisor = phpNum(toNum);
    const tmpCount = divisor === 0 ? 0 : Math.trunc((phpNum(fromNum) * toCount) / divisor);
    if (tmpCount < fromCount) fromCount = tmpCount;
    if (tmpCount > fromCount + 1) throw GameError.lang('sendCommand.command_exception');
    const owned = await this.cell(sql<Row>`select count from sys_city_soldier
      where cid = ${cid} and sid = ${fromSid}`);
    if (fromCount > phpNum(owned)) {
      throw GameError.lang('stopDraftQueue.choose_soldier_not_enough');
    }
    const convert = await this.one(
      sql<Row>`select * from sys_soldier_convert where cid = ${cid} limit 1`,
    );
    if (!convert) throw GameError.lang('useMojiaGoods.invalid_param');
    if (phpNum(convert.convert) >= phpNum(convert.value)) {
      throw GameError.lang('hero.xidian_unvalid');
    }
    if (phpNum(convert.value) - phpNum(convert.convert) < value) {
      throw GameError.lang('hero.xidian_unvalid');
    }
    await this.scope.transaction(async () => {
      await sql`update sys_soldier_convert set \`convert\` = \`convert\` + ${value}
        where cid = ${cid}`.execute(db);
      await sql`update sys_city_soldier set count = greatest(0, count - ${fromCount})
        where cid = ${cid} and sid = ${fromSid}`.execute(db);
      await sql`insert into sys_city_soldier (cid, sid, count) values (${cid}, ${toSid}, ${toCount})
        on duplicate key update count = count + ${toCount}`.execute(db);
      await sql`insert into log_soldier_convert
          (uid, cid, fromSid, fromCount, toSid, toCount, time)
        values (${uid}, ${cid}, ${fromSid}, ${fromCount}, ${toSid}, ${toCount},
          unix_timestamp())`.execute(db);
    });
    return this.info.armyInfo(uid, cid, xy);
  }
}
