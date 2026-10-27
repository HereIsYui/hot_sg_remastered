import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { GoodsRules } from '../core/goods-rules.service';
import { phpIntval, phpNum, phpString } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { DialogCommand, type CommandContext } from '../gateway/decorators';
import {
  cityDistance,
  GRID_DISTANCE,
  MarketRules,
  MERCHANT_MOVE_SPEED,
  RESOURCE_PRICES,
} from './market-rules.service';

type Row = Record<string, unknown>;

const MARKET_LIST_CPP = 10;
const ACCELERATE_GID = 11;

/** MarketFunc.php's player-to-player trade rows (27-101, 275-503). */
@Injectable()
export class PlayerTradeCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly market: MarketRules,
    private readonly goods: GoodsRules,
    private readonly tasks: TaskRules,
    private readonly users: UserRules,
  ) {}

  /** `[tradeid]`: cancels a pending sale and returns its resource. */
  @DialogCommand()
  async cancelSell(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const id = phpIntval(param[0]);
    const trade = await this.row(sql<Row>`select * from sys_city_trade
      where id = ${id} and cid = ${ctx.cid} and state = 0`);
    if (!trade) throw GameError.lang('cancelSell.cant_cancel');
    await this.refund(ctx.cid, trade, false);
    await sql`delete from sys_city_trade where id = ${id}`.execute(this.scope.db);
    return this.market.marketInfo(ctx.uid, ctx.cid);
  }

  /** `[tradeid]`: cancels a state-2 automatic trade and returns its resource, including gold. */
  @DialogCommand()
  async cancelAutoTrans(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const id = phpIntval(param[0]);
    const trade = await this.row(sql<Row>`select * from sys_city_trade
      where id = ${id} and cid = ${ctx.cid} and state = 2`);
    if (!trade) throw GameError.lang('cancelSell.cant_cancel');
    await this.refund(ctx.cid, trade, true);
    await sql`delete from sys_city_trade where id = ${id}`.execute(this.scope.db);
    return this.market.marketInfo(ctx.uid, ctx.cid);
  }

  /** `[tradeid]`: spends one 木牛流马 to shorten a caravan to a tenth of its remaining time. */
  @DialogCommand()
  async accelerateSell(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    if (!(await this.goods.checkGoods(ctx.uid, ACCELERATE_GID))) {
      throw GameError.raw(`not_enough_goods${ACCELERATE_GID}`);
    }
    const id = phpIntval(param[0]);
    const trade = await this.row(sql<Row>`select cid, buycid from sys_city_trade
      where id = ${id} and (state = 1 or state = 2)`);
    if (!trade || (phpIntval(trade.cid) !== ctx.cid && phpIntval(trade.buycid) !== ctx.cid)) {
      throw GameError.lang('accelerateSell.trade_not_exist');
    }
    await this.scope.transaction(async () => {
      for (const table of ['sys_city_trade', 'mem_city_trade']) {
        await sql`update ${sql.table(table)} set
          endtime = (endtime - unix_timestamp()) / 10 + unix_timestamp() where id = ${id}`.execute(
          this.scope.db,
        );
      }
      await this.goods.reduceGoods(ctx.uid, ACCELERATE_GID, 1);
    });
    return this.market.marketInfo(ctx.uid, ctx.cid);
  }

  /** `[resType, count, gold, hours, unionOnly]`: publishes a resource sale. */
  @DialogCommand()
  async sellToUser(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const resType = phpIntval(param[0]);
    const count = phpIntval(param[1]);
    const gold = phpIntval(param[2]);
    let hour = phpIntval(param[3]);
    const unionOnly = phpIntval(param[4]);
    if (count === 0) throw GameError.raw('Division by zero');
    if (count <= 0) throw GameError.lang('sellToUser.invalid_amount');
    if (hour < 1) throw GameError.lang('sellToUser.trade_time_limit');
    if (hour > 10000) hour = 10000;
    const price = Math.round((gold / count) * 100) / 100;
    const used = await this.market.tradeUsing(ctx.cid);
    const level = phpNum(await this.market.marketLevel(ctx.cid));
    if (used >= level) throw GameError.lang('sellToUser.no_free_caravan');
    if (count > level * 100000) {
      throw GameError.lang('sellToUser.single_trade_upperLimit', level, level);
    }
    const res = await this.row(sql<Row>`select * from mem_city_resource where cid = ${ctx.cid}`);
    if (resType >= 0 && resType < 4) {
      const key = ['food', 'wood', 'rock', 'iron'][resType]!;
      if (count > phpNum(res?.[key])) throw GameError.lang(`sellToUser.no_enough_${key}`);
      if (price < RESOURCE_PRICES[resType]! * 0.79 || price > RESOURCE_PRICES[resType]! * 1.21) {
        throw GameError.lang('sellToUser.price_runaway');
      }
      await sql`update mem_city_resource set ${sql.id(key)} = ${sql.id(key)} - ${count}
        where cid = ${ctx.cid}`.execute(this.scope.db);
    }
    let unionid = 0;
    if (unionOnly > 0) {
      unionid = phpIntval(
        await this.cell(sql<Row>`select union_id as v from sys_user where uid = ${ctx.uid}`),
      );
    }
    const seconds = hour * 3600;
    const gridtime = GRID_DISTANCE / MERCHANT_MOVE_SPEED;
    const distance = (seconds / gridtime) ** 2;
    await sql`insert into sys_city_trade (cid, state, restype, count, price, gold, distance,
      unionid, limittime) values (${ctx.cid}, 0, ${resType}, ${count}, ${price}, ${gold},
      ${distance}, ${unionid}, ${seconds})`.execute(this.scope.db);
    return this.market.marketInfo(ctx.uid, ctx.cid);
  }

  /** `[tradeid]`: buys a pending sale and dispatches its caravan. */
  @DialogCommand()
  async buyFromUser(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const id = phpIntval(param[0]);
    const trade = await this.row(sql<Row>`select * from sys_city_trade where id = ${id}`);
    if (!trade) throw GameError.lang('buyFromUser.trade_not_exist');
    if (phpIntval(trade.state) === 1) throw GameError.lang('buyFromUser.bought_by_others');
    const sellerUid = phpIntval(
      await this.cell(sql<Row>`select uid as v from sys_city where cid = ${trade.cid}`),
    );
    if (sellerUid === ctx.uid) throw GameError.lang('buyFromUser.cant_buy_from_yourself');
    const res = await this.row(sql<Row>`select * from mem_city_resource where cid = ${ctx.cid}`);
    if (phpNum(res?.gold) < phpNum(trade.gold)) {
      throw GameError.lang('buyFromUser.no_enough_gold');
    }
    const used = await this.market.tradeUsing(ctx.cid);
    const level = phpNum(await this.market.marketLevel(ctx.cid));
    if (used >= level) throw GameError.lang('buyFromUser.no_free_caravan');
    const dx = (ctx.cid % 1000) - (phpIntval(trade.cid) % 1000);
    const dy = Math.floor(ctx.cid / 1000) - Math.floor(phpIntval(trade.cid) / 1000);
    if (dx * dx + dy * dy > phpNum(trade.distance)) {
      throw GameError.lang('buyFromUser.distance_too_far');
    }
    if (phpNum(trade.unionid) > 0) {
      const unionid = phpIntval(
        await this.cell(sql<Row>`select union_id as v from sys_user where uid = ${ctx.uid}`),
      );
      if (phpNum(trade.unionid) !== unionid) {
        throw GameError.lang('buyFromUser.sell_to_union_only');
      }
    }

    await this.scope.transaction(async () => {
      await sql`update sys_city_trade set state = 1, buycid = ${ctx.cid}
        where id = ${id} and state = 0`.execute(this.scope.db);
      const buycid = phpIntval(
        await this.cell(sql<Row>`select buycid as v from sys_city_trade where id = ${id}`),
      );
      if (buycid !== ctx.cid) throw GameError.lang('buyFromUser.bought_by_others');
      await sql`update mem_city_resource set gold = gold - ${phpNum(trade.gold)}
        where cid = ${ctx.cid}`.execute(this.scope.db);
      const needtime =
        (cityDistance(phpIntval(trade.cid), ctx.cid) * GRID_DISTANCE) / MERCHANT_MOVE_SPEED;
      await sql`update sys_city_trade set endtime = unix_timestamp() + ${needtime}
        where id = ${id}`.execute(this.scope.db);
      await sql`replace into mem_city_trade (id, endtime)
        values (${id}, unix_timestamp() + ${needtime})`.execute(this.scope.db);
      await this.tasks.completeTask(sellerUid, 25);
      await this.tasks.completeTask(ctx.uid, 26);
      await this.users.logUserAction(ctx.uid, 20);
    });
    return this.market.marketInfo(ctx.uid, ctx.cid);
  }

  /** `[page, resourceFilter, unionOnly, sellerName]`: the player-sale list. */
  @DialogCommand()
  async getUserBuyList(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    let page = phpIntval(param[0]);
    const filter = phpIntval(param[1]);
    const unionOnly = phpIntval(param[2]);
    const sellerName = phpString(param[3] ?? '');
    const unionid = phpIntval(
      await this.cell(sql<Row>`select union_id as v from sys_user where uid = ${ctx.uid}`),
    );
    const resource = filter > 0 ? filter - 1 : -1;
    const dx = sql`(cid % 1000 - ${ctx.cid % 1000})`;
    const dy = sql`(floor(cid / 1000) - ${Math.floor(ctx.cid / 1000)})`;
    const distance = sql`(${dx} * ${dx} + ${dy} * ${dy})`;
    const resourceFilter = resource >= 0 ? sql`and restype = ${resource}` : sql``;
    const itemCount = phpNum(
      await this.cell(sql<Row>`select count(*) as v from sys_city_trade
        where state = 0 and (unionid = 0 or unionid = ${unionid}) ${resourceFilter}
        and distance > ${distance}`),
    );
    let pageCount = Math.ceil(itemCount / MARKET_LIST_CPP);
    if (page >= pageCount) page = pageCount - 1;
    if (page < 0) {
      page = 0;
      pageCount = 0;
    }
    const ret: unknown[] = [
      await this.market.tradeUsing(ctx.cid),
      await this.market.marketLevel(ctx.cid),
    ];
    if (itemCount <= 0) return [...ret, 0, 0, []];
    const tdx = sql`(t.cid % 1000 - ${ctx.cid % 1000})`;
    const tdy = sql`(floor(t.cid / 1000) - ${Math.floor(ctx.cid / 1000)})`;
    const tDistance = sql`(${tdx} * ${tdx} + ${tdy} * ${tdy})`;
    const tResource = resource >= 0 ? sql`and t.restype = ${resource}` : sql``;
    const unionFilter = sellerName
      ? sql`and (t.unionid = 0 or t.unionid = ${unionid})`
      : unionOnly === 0
        ? sql`and (t.unionid = 0 or t.unionid = ${unionid})`
        : sql`and t.unionid = ${unionid}`;
    const sellerFilter = sellerName ? sql`and u.name = ${sellerName}` : sql``;
    const rows = await this.rows(sql<Row>`select t.*, u.name as sellername, un.name as unionname
      from sys_city_trade t
      left join sys_city c on c.cid = t.cid
      left join sys_user u on u.uid = c.uid
      left join sys_union un on un.id = t.unionid
      where t.cid <> ${ctx.cid} and t.state = 0 ${unionFilter} ${tResource} ${sellerFilter}
        and t.distance >= ${tDistance}
      order by ${tDistance} limit ${page * MARKET_LIST_CPP}, ${MARKET_LIST_CPP}`);
    return [...ret, pageCount, page, rows];
  }

  /** `[]`: used/total caravans and the four official prices. */
  @DialogCommand()
  async getUserSellData(ctx: CommandContext): Promise<unknown[]> {
    return [
      await this.market.tradeUsing(ctx.cid),
      await this.market.marketLevel(ctx.cid),
      ...RESOURCE_PRICES,
    ];
  }

  private async refund(cid: number, trade: Row, includeGold: boolean): Promise<void> {
    const restype = phpIntval(trade.restype);
    const columns = includeGold
      ? ['food', 'wood', 'rock', 'iron', 'gold']
      : ['food', 'wood', 'rock', 'iron'];
    const column = columns[restype];
    if (!column) return;
    await sql`update mem_city_resource set ${sql.id(column)} = ${sql.id(column)} + ${phpNum(trade.count)}
      where cid = ${cid}`.execute(this.scope.db);
  }

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows;
  }

  private async row(query: RawBuilder<Row>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : undefined;
  }
}
