import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { Building, CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { OwnershipService } from '../core/ownership.service';
import { phpEmpty, phpFloatString, phpIntval, phpLooseEquals, phpNum } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { DbScope } from '../db/database.module';
import { DialogCommand, type CommandContext } from '../gateway/decorators';
import { BuildingInfoService } from './building-info.service';
import { DefencePreType, DefenceRules } from './defence-rules.service';
import { GAME_SPEED_RATE } from './technic-rules.service';

type Row = Record<string, unknown>;

/** 备城门: cuts 30% (at least half an hour) off one entry, once per entry. */
const GOODS_ACC_DEFENCE = 64;
const ACC_MIN_REDUCE = 1800;
const TASK_ACC_DEFENCE = 326;

/** The 城墙 commands of DefenceFunc.php: build, cancel, demolish and speed up defences. */
@Injectable()
export class DefenceCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly defences: DefenceRules,
    private readonly info: BuildingInfoService,
    private readonly ownership: OwnershipService,
    private readonly cityRules: CityRules,
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

  private async hasWall(cid: number): Promise<boolean> {
    return !!(await this.one(
      sql<Row>`select * from sys_building where cid = ${cid} and bid = ${Building.Wall}`,
    ));
  }

  /** Starts the earliest entry of the 城墙's queue. */
  private async startNextQueue(cid: unknown): Promise<void> {
    const db = this.scope.db;
    const id = await this.cell(sql<Row>`select id from sys_city_reinforcequeue
      where cid = ${cid} order by queuetime, id limit 1`);
    if (phpEmpty(id)) return;
    await sql`update sys_city_reinforcequeue set state = 1, state_starttime = unix_timestamp()
      where id = ${id}`.execute(db);
    await sql`insert into mem_city_reinforce (select id, cid, did, count,
        state_starttime + needtime from sys_city_reinforcequeue where id = ${id})`.execute(db);
  }

  /** `[did, count]`: queues defences, paying for them up front. */
  @DialogCommand()
  async startReinforceQueue(ctx: CommandContext, param: unknown[]): Promise<unknown> {
    const db = this.scope.db;
    const { uid, cid } = ctx;
    const did = phpIntval(param[0]);
    const defenceCount = phpIntval(param[1]);

    if (defenceCount <= 0) throw GameError.lang('startReinforceQueue.build_zero_defence');
    await this.ownership.checkCityExist(cid, uid);
    if (!(await this.hasWall(cid))) return this.lang.t('startReinforceQueue.no_defence_info');
    const defence = await this.one(sql<Row>`select * from cfg_defence where did = ${did}`);
    if (!defence) throw GameError.lang('startReinforceQueue.no_defence_info');
    const cost = (v: unknown) => phpNum(v) * defenceCount;
    const [wood, rock, iron, food, gold] = [
      cost(defence.wood_need),
      cost(defence.rock_need),
      cost(defence.iron_need),
      cost(defence.food_need),
      cost(defence.gold_need),
    ] as const;
    if (!(await this.cityRules.checkCityResource(cid, wood, rock, iron, food, gold))) {
      throw GameError.lang('startReinforceQueue.no_enough_resource');
    }
    const free =
      phpNum(await this.defences.cityArea(cid)) - (await this.defences.cityAreaOccupied(cid));
    if (free < phpNum(defence.area_need) * defenceCount) {
      throw GameError.lang('startReinforceQueue.no_free_space');
    }
    for (const condition of await this.defences.conditionRows(did)) {
      const current = await this.defences.conditionCurrent(uid, cid, condition);
      const met = !(phpEmpty(current) || phpNum(current) < phpNum(condition.pre_level));
      if (phpLooseEquals(condition.pre_type, DefencePreType.Building) && !met) {
        throw GameError.lang('startReinforceQueue.no_pre_building');
      }
      if (phpLooseEquals(condition.pre_type, DefencePreType.Technic) && !met) {
        throw GameError.lang('startReinforceQueue.no_pre_technic');
      }
    }
    const reinforcing = await this.cell(
      sql<Row>`select count(*) from sys_city_reinforcequeue where cid = ${cid}`,
    );
    const level = await this.cell(
      sql<Row>`select level from sys_building where cid = ${cid} and bid = ${Building.Wall}`,
    );
    if (phpNum(reinforcing) >= phpNum(level) + 1) {
      throw GameError.lang('startReinforceQueue.queue_reach_limit');
    }

    const interval =
      (phpNum(defence.time_need) * (await this.defences.speedRate(cid))) / GAME_SPEED_RATE;
    const reinforceInterval = phpFloatString(interval);
    const needtime = phpFloatString(interval * defenceCount);

    await this.scope.transaction(async () => {
      await this.cityRules.addCityResources(cid, -wood, -rock, -iron, -food, -gold);
      const queued = await this.one(
        sql<Row>`select * from sys_city_reinforcequeue where cid = ${cid}`,
      );
      if (queued) {
        await sql`insert into sys_city_reinforcequeue
            (cid, did, count, queuetime, state, reinforce_interval, state_starttime, needtime)
          values (${cid}, ${did}, ${defenceCount}, unix_timestamp(), 0, ${reinforceInterval}, 0,
            ${needtime})`.execute(db);
        const building = await this.one(sql<Row>`select * from sys_city_reinforcequeue
          where cid = ${cid} and state = 1`);
        if (!building) await this.startNextQueue(cid);
      } else {
        const inserted = await sql`insert into sys_city_reinforcequeue
            (cid, did, count, queuetime, state, reinforce_interval, state_starttime, needtime)
          values (${cid}, ${did}, ${defenceCount}, unix_timestamp(), 1, ${reinforceInterval},
            unix_timestamp(), ${needtime})`.execute(db);
        await sql`insert into mem_city_reinforce (select id, cid, did, count,
            state_starttime + needtime from sys_city_reinforcequeue
          where id = ${Number(inserted.insertId)})`.execute(db);
      }
    });
    return this.info.wallInfo(uid, cid);
  }

  /** `[qid]`: cancels a queue entry, returning 66% of its cost. */
  @DialogCommand()
  async stopReinforceQueue(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const db = this.scope.db;
    const { uid, cid } = ctx;
    const qid = phpIntval(param[0]);
    await this.ownership.checkCityExist(cid, uid);
    if (!(await this.hasWall(cid))) throw GameError.lang('stopReinforceQueue.no_barracks_info');
    // Only this city's entries: the original refunded any city's queue to the caller.
    const queue = await this.one(sql<Row>`select * from sys_city_reinforcequeue
      where id = ${qid} and cid = ${cid}`);
    if (queue) {
      const defence = await this.one(sql<Row>`select * from cfg_defence where did = ${queue.did}`);
      if (!defence) throw GameError.lang('stopReinforceQueue.no_reinforcement_info');
      const refund = (v: unknown) => phpNum(v) * phpNum(queue.count) * 0.66;
      await this.scope.transaction(async () => {
        await sql`delete from sys_city_reinforcequeue where id = ${qid}`.execute(db);
        await this.cityRules.addCityResources(
          cid,
          refund(defence.wood_need),
          refund(defence.rock_need),
          refund(defence.iron_need),
          refund(defence.food_need),
          refund(defence.gold_need),
        );
        if (phpLooseEquals(queue.state, 1)) {
          await sql`delete from mem_city_reinforce where id = ${qid}`.execute(db);
          await this.startNextQueue(queue.cid);
        }
      });
    }
    return this.info.wallInfo(uid, cid);
  }

  /** `[did, count]`: demolishes defences for 33% of their cost. */
  @DialogCommand()
  async dissolveDefence(ctx: CommandContext, param: unknown[]): Promise<unknown> {
    const { uid, cid } = ctx;
    const did = phpIntval(param[0]);
    const defenceCount = phpIntval(param[1]);
    if (defenceCount <= 0) throw GameError.lang('dissolveDefence.cant_dissolve_zero');
    await this.ownership.checkCityExist(cid, uid);
    if (!(await this.hasWall(cid))) return this.lang.t('dissolveDefence.no_wall_info');
    const defence = await this.one(sql<Row>`select * from cfg_defence where did = ${did}`);
    if (!defence) throw GameError.lang('dissolveDefence.no_reinforcement_info');
    const current = await this.cell(sql<Row>`select count from sys_city_defence
      where cid = ${cid} and did = ${did}`);
    if (phpNum(current) < defenceCount) {
      throw GameError.lang('dissolveDefence.cant_dissolve_exceed');
    }
    const refund = (v: unknown) => defenceCount * phpNum(v) * 0.33;
    await this.scope.transaction(async () => {
      await this.defences.addCityDefence(cid, did, -defenceCount);
      await this.cityRules.addCityResources(
        cid,
        refund(defence.wood_need),
        refund(defence.rock_need),
        refund(defence.iron_need),
        refund(defence.food_need),
        refund(defence.gold_need),
      );
    });
    return this.info.wallInfo(uid, cid);
  }

  /** `[qid]`: 备城门 takes 30% (at least half an hour) off a queue entry, once per entry. */
  @DialogCommand()
  async accReinforceQueue(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const db = this.scope.db;
    const { uid, cid } = ctx;
    const qid = phpIntval(param[0]);
    await this.ownership.checkCityExist(cid, uid);
    if (!(await this.hasWall(cid))) throw GameError.lang('stopReinforceQueue.no_barracks_info');
    if (!(await this.goods.checkGoods(uid, GOODS_ACC_DEFENCE))) {
      throw GameError.raw(`not_enough_goods${GOODS_ACC_DEFENCE}`);
    }
    // Only this city's entries: the original sped up any city's queue.
    const queue = await this.one(sql<Row>`select * from sys_city_reinforcequeue
      where id = ${qid} and cid = ${cid}`);
    if (!queue) throw GameError.lang('startReinforceQueue.no_defence_info');
    if (!phpLooseEquals(queue.accmark, 0)) throw GameError.lang('accDefence.only_onece');
    const old = phpIntval(queue.needtime);
    const now = Math.floor(Date.now() / 1000);
    await this.scope.transaction(async () => {
      if (phpLooseEquals(queue.state, 1)) {
        const start = phpIntval(queue.state_starttime);
        const reduce = Math.max(ACC_MIN_REDUCE, Math.trunc(Math.ceil(old + start - now) * 0.3));
        await sql`update sys_city_reinforcequeue set needtime = ${old - reduce}, accmark = 1
          where id = ${queue.id}`.execute(db);
        const end = phpNum(
          await this.cell(
            sql<Row>`select state_endtime from mem_city_reinforce where id = ${queue.id}`,
          ),
        );
        const reduce2 = Math.max(ACC_MIN_REDUCE, Math.trunc(Math.floor(end - now) * 0.3));
        await sql`update mem_city_reinforce set state_endtime = ${end - reduce2}
          where id = ${queue.id}`.execute(db);
      } else {
        const reduce = Math.max(ACC_MIN_REDUCE, Math.trunc(Math.ceil(old * 0.3)));
        await sql`update sys_city_reinforcequeue set needtime = ${old - reduce}, accmark = 1
          where id = ${queue.id}`.execute(db);
      }
      await this.goods.reduceGoods(uid, GOODS_ACC_DEFENCE, 1);
      await this.tasks.completeTaskWithTaskid(uid, TASK_ACC_DEFENCE);
    });
    return this.info.wallInfo(uid, cid);
  }
}
