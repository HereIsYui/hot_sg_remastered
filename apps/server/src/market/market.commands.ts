import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpNum } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { DbScope } from '../db/database.module';
import { DialogCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** ID_BUILDING_MARKET (common.php): the 市场 building. */
const BUILDING_MARKET = 13;
/** The 商队契约 item and its buftype (three days per use). */
const CONTRACT_GID = 120;
const CONTRACT_BUFTYPE = 17;
const CONTRACT_SECONDS = 259200;
/** GRID_DISTANCE / MERCHANT_MOVE_SPEED (common.php): one grid's travel seconds. */
const GRID_DISTANCE = 10000;
const MERCHANT_MOVE_SPEED = 60000;
/** The member cap of concurrent auto-transports (hasAutoTrans). */
const AUTOTRANS_MAX = 10;
/** completeTaskWithTaskid($uid, 314) — the auto-transport task. */
const AUTOTRANS_TASK = 314;

/**
 * MarketFunc.php wave 4 (first slice): the 自动运输 scheduling commands (504-596). The trade-row
 * and merchant families (sellToUser/buyFromUser/merchant) are later slices. The 商队契约 buffer
 * (buftype 17, three days per item 120) gates each schedule; the transport itself runs from the
 * settlement cron, not here.
 */
@Injectable()
export class MarketCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly goods: GoodsRules,
    private readonly tasks: TaskRules,
  ) {}

  /** `[id]`: removes a scheduled transport (removeAutoTrans, 504-510). */
  @DialogCommand()
  async removeAutoTrans(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const id = phpIntval(param[0]);
    await sql`delete from mem_city_autotrans where id = ${id}`.execute(this.scope.db);
    return [id];
  }

  /** `[]`: the caller's scheduled transports with the city names (getAutoTrans, 512-517). */
  @DialogCommand()
  async getAutoTrans(ctx: CommandContext): Promise<unknown[]> {
    return (await this.rows(sql<Row>`select a.id, a.fromcid, c1.name as fromcity,
        a.tocid, c2.name as tocity, a.res_type, a.count, a.start_time
      from mem_city_autotrans a
      left join sys_city c1 on a.fromcid = c1.cid
      left join sys_city c2 on a.tocid = c2.cid where a.uid = ${ctx.uid}`)) as unknown[];
  }

  /** `[fromcid, tocid, resType, count, transType, startTimeMs]`: schedules a transport
   * (addAutoTrans, 518-577). Consumes a 商队契约 when none is active and completes task 314. */
  @DialogCommand()
  async addAutoTrans(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const fromcid = phpIntval(param[0]);
    const tocid = phpIntval(param[1]);
    const resType = phpIntval(param[2]);
    const count = phpIntval(param[3]);
    const transType = phpIntval(param[4]);
    // the client sends epoch milliseconds
    const start_time = phpIntval(phpNum(param[5]) / 1000);
    if (start_time < phpNum(await this.cell(sql<Row>`select unix_timestamp() as v`))) {
      throw GameError.lang('auto_trans.not_my_time_error');
    }
    const tocity = await this.row(
      sql<Row>`select * from sys_city where cid = ${tocid} and uid = ${uid}`,
    );
    if (phpEmpty(tocity)) throw GameError.lang('auto_trans.not_my_city');
    const fromMaxCount = (await this.marketLevel(fromcid)) * 100000;
    if (count > fromMaxCount) throw GameError.lang('auto_trans.max_count');
    // 没有使用商队契约，则消耗一个商队契约
    const contract = await this.row(sql<Row>`select * from mem_user_buffer where uid = ${uid}
      and buftype = ${CONTRACT_BUFTYPE}`);
    if (phpEmpty(contract)) {
      if (!(await this.goods.checkGoods(uid, CONTRACT_GID))) {
        throw GameError.raw('not_enough_goods120');
      }
      await sql`insert into mem_user_buffer (uid, buftype, bufparam, endtime)
        values (${uid}, ${CONTRACT_BUFTYPE}, 0, unix_timestamp() + ${CONTRACT_SECONDS})
        on duplicate key update endtime = endtime + ${CONTRACT_SECONDS}`.execute(this.scope.db);
      await this.goods.reduceGoods(uid, CONTRACT_GID, 1);
    }
    if (
      !(await this.check(sql<Row>`select buftype as v from mem_user_buffer where uid = ${uid}
        and buftype = ${CONTRACT_BUFTYPE} and endtime >= ${start_time}`))
    ) {
      throw GameError.lang('auto_trans.time_too_long');
    }
    // 计算距离
    const currx = fromcid % 1000;
    const curry = Math.floor(fromcid / 1000);
    const targx = tocid % 1000;
    const targy = Math.floor(tocid / 1000);
    const distance = Math.sqrt(
      (currx - targx) * (currx - targx) + (curry - targy) * (curry - targy),
    );
    const gridtime = GRID_DISTANCE / (1.0 * MERCHANT_MOVE_SPEED);
    const cost_time = Math.floor(distance * gridtime);
    const end_time = start_time + cost_time;
    await sql`insert into mem_city_autotrans (uid, fromcid, tocid, state, trans_type,
        start_time, distance, cost_time, res_type, count, end_time)
      values (${uid}, ${fromcid}, ${tocid}, 0, ${transType}, ${start_time}, ${distance},
        ${cost_time}, ${resType}, ${count}, ${end_time})`.execute(this.scope.db);
    await this.tasks.completeTaskWithTaskid(uid, AUTOTRANS_TASK);
    return this.getAutoTrans(ctx);
  }

  /** `[]`: whether a 商队契约 is active (hasAutoTrans, 578-592); 10 transports max. */
  @DialogCommand()
  async hasAutoTrans(ctx: CommandContext): Promise<boolean[]> {
    const uid = ctx.uid;
    const contract = await this.row(sql<Row>`select * from mem_user_buffer where uid = ${uid}
      and buftype = ${CONTRACT_BUFTYPE}`);
    const ret: boolean[] = [!phpEmpty(contract)];
    const mcount = phpNum(
      await this.cell(sql<Row>`select count(*) as v from mem_city_autotrans where uid = ${uid}`),
    );
    if (mcount >= AUTOTRANS_MAX) throw GameError.lang('auto_trans.max_auto_trans');
    return ret;
  }

  /** MarketFunc.php:271 getCityMarketLevel. */
  private async marketLevel(cid: number): Promise<number> {
    return phpIntval(
      await this.cell(sql<Row>`select level as v from sys_building where cid = ${cid}
        and bid = ${BUILDING_MARKET} limit 1`),
    );
  }

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async row(query: RawBuilder<Row>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : undefined;
  }

  private async check(query: RawBuilder<Row>): Promise<boolean> {
    return (await this.rows(query)).length > 0;
  }
}
