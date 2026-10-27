import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { phpDate, phpTime } from '../core/php-time';
import { phpIntval, phpNum } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { DialogCommand, type CommandContext } from '../gateway/decorators';
import { TaskRewards } from '../task/task-rewards.service';
import { MarketRules, RESOURCE_PRICES } from './market-rules.service';

type Row = Record<string, unknown>;

const MERCHANT_INIT = { food: 100, wood: 100, rock: 100, iron: 100, gold: 10000 };

/** MarketFunc.php's immediate merchant trades (103-265, 594-597). */
@Injectable()
export class MerchantCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly market: MarketRules,
    private readonly tasks: TaskRules,
    private readonly rewards: TaskRewards,
    private readonly users: UserRules,
  ) {}

  /** `[]`: today's merchant stock and the original price fields. */
  @DialogCommand()
  async getMerchantInfo(ctx: CommandContext): Promise<Row> {
    const today = phpIntval(phpDate('Ymd', phpTime()));
    let merchant = await this.row(sql<Row>`select * from sys_city_merchant
      where cid = ${ctx.cid} and trade_day = ${today}`);
    if (!merchant) {
      await sql`insert into sys_city_merchant (cid, food, wood, rock, iron, gold, trade_day)
        values (${ctx.cid}, ${MERCHANT_INIT.food}, ${MERCHANT_INIT.wood}, ${MERCHANT_INIT.rock},
          ${MERCHANT_INIT.iron}, ${MERCHANT_INIT.gold}, ${today})
        on duplicate key update food = ${MERCHANT_INIT.food}, wood = ${MERCHANT_INIT.wood},
          rock = ${MERCHANT_INIT.rock}, iron = ${MERCHANT_INIT.iron}, gold = ${MERCHANT_INIT.gold},
          trade_day = ${today}`.execute(this.scope.db);
      merchant = { cid: ctx.cid, ...MERCHANT_INIT, trade_day: today };
    }
    // The original assigns the buy fields twice; the sell-price assignment wins.
    for (const [index, key] of ['food', 'wood', 'rock', 'iron'].entries()) {
      merchant[`${key}_buy_price`] = RESOURCE_PRICES[index]!;
    }
    return merchant;
  }

  /** `[food, wood, rock, iron, times, paytype]`: buys resources immediately. */
  @DialogCommand()
  async buyFromMerchant(ctx: CommandContext, param: unknown[]): Promise<never> {
    const p = intParams(param);
    const [food, wood, rock, iron, times, paytype] = p;
    if (paytype !== 0 && paytype !== 1) throw GameError.raw('');
    if (
      food < 0 ||
      wood < 0 ||
      rock < 0 ||
      iron < 0 ||
      times < 1 ||
      (food === 0 && wood === 0 && rock === 0 && iron === 0)
    ) {
      throw GameError.lang('buyFromMerchant.input_amount');
    }
    const amounts = [food * times, wood * times, rock * times, iron * times];
    const singleGold = this.gold([food, wood, rock, iron]);
    const totalGold = this.gold(amounts);
    const res = await this.row(sql<Row>`select * from mem_city_resource where cid = ${ctx.cid}`);
    if (totalGold > phpNum(res?.gold)) throw GameError.lang('buyFromMerchant.no_enough_gold');
    const level = phpNum(await this.market.marketLevel(ctx.cid));
    if (singleGold > level * 100000) {
      throw GameError.lang('buyFromMerchant.buy_limit', level, level);
    }
    const user = await this.row(sql<Row>`select money, gift from sys_user where uid = ${ctx.uid}`);
    const cost = 5 * times;
    if (paytype === 0 && phpNum(user?.money) < cost) {
      throw GameError.lang('buyFromMerchant.no_enough_YuanBao');
    }
    if (paytype === 1 && phpNum(user?.gift) < cost) {
      throw GameError.lang('buyFromMerchant.no_enough_Gift');
    }

    await this.scope.transaction(async () => {
      if (paytype === 0) await this.rewards.addMoney(ctx.uid, -cost, 50);
      else await this.rewards.addGift(ctx.uid, -cost, 50);
      await this.users.logUserAction(ctx.uid, 19);
      await sql`update mem_city_resource set gold = gold - ${totalGold},
        food = food + ${amounts[0]!}, wood = wood + ${amounts[1]!},
        rock = rock + ${amounts[2]!}, iron = iron + ${amounts[3]!} where cid = ${ctx.cid}`.execute(
        this.scope.db,
      );
      await this.logMerchantAction(ctx.uid, amounts, totalGold);
      await this.tasks.completeTask(ctx.uid, 24);
    });
    throw GameError.lang('buyFromMerchant.succ');
  }

  /** `[food, wood, rock, iron, times, paytype]`: sells resources immediately. */
  @DialogCommand()
  async sellToMerchant(ctx: CommandContext, param: unknown[]): Promise<never> {
    const [food, wood, rock, iron, times, paytype] = intParams(param);
    if (paytype !== 0 && paytype !== 1) throw GameError.raw('');
    if (
      food < 0 ||
      wood < 0 ||
      rock < 0 ||
      iron < 0 ||
      times < 1 ||
      (food === 0 && wood === 0 && rock === 0 && iron === 0)
    ) {
      throw GameError.lang('sellToMerchant.input_amount');
    }
    const user = await this.row(sql<Row>`select money, gift from sys_user where uid = ${ctx.uid}`);
    const cost = 5 * times;
    if (paytype === 0 && phpNum(user?.money) < cost) {
      throw GameError.lang('sellToMerchant.no_enough_YuanBao');
    }
    if (paytype === 1 && phpNum(user?.gift) < cost) {
      throw GameError.lang('sellToMerchant.no_enough_Gift');
    }
    const amounts = [food * times, wood * times, rock * times, iron * times];
    const res = await this.row(sql<Row>`select * from mem_city_resource where cid = ${ctx.cid}`);
    for (const [index, key] of ['food', 'wood', 'rock', 'iron'].entries()) {
      if (amounts[index]! > phpNum(res?.[key])) {
        throw GameError.lang(`sellToMerchant.no_enough_${key}`);
      }
    }
    const singleGold = this.gold([food, wood, rock, iron]);
    const level = phpNum(await this.market.marketLevel(ctx.cid));
    if (singleGold > level * 100000) {
      throw GameError.lang('buyFromMerchant.buy_limit', level, level);
    }
    const totalGold = this.gold(amounts);

    await this.scope.transaction(async () => {
      if (paytype === 0) await this.rewards.addMoney(ctx.uid, -cost, 51);
      else await this.rewards.addGift(ctx.uid, -cost, 51);
      await this.users.logUserAction(ctx.uid, 19);
      await sql`update mem_city_resource set gold = gold + ${totalGold},
        food = food - ${amounts[0]!}, wood = wood - ${amounts[1]!},
        rock = rock - ${amounts[2]!}, iron = iron - ${amounts[3]!} where cid = ${ctx.cid}`.execute(
        this.scope.db,
      );
      await this.logMerchantAction(
        ctx.uid,
        [amounts[0]!, amounts[1]!, amounts[3]!, amounts[2]!],
        totalGold,
      );
      await this.tasks.completeTask(ctx.uid, 23);
    });
    throw GameError.lang('sellToMerchant.succ');
  }

  private gold(amounts: number[]): number {
    return amounts.reduce((sum, count, index) => sum + count * RESOURCE_PRICES[index]!, 0);
  }

  private async logMerchantAction(uid: number, amounts: number[], gold: number): Promise<void> {
    await sql`insert into log_merchant (uid, time, wood, food, iron, rock, gold)
      values (${uid}, unix_timestamp(), ${amounts[1]!}, ${amounts[0]!}, ${amounts[2]!},
        ${amounts[3]!}, ${gold})`.execute(this.scope.db);
  }

  private async row(query: RawBuilder<Row>): Promise<Row | undefined> {
    return (await query.execute(this.scope.db)).rows[0];
  }
}

function intParams(param: unknown[]): [number, number, number, number, number, number] {
  return [
    phpIntval(param[0]),
    phpIntval(param[1]),
    phpIntval(param[2]),
    phpIntval(param[3]),
    phpIntval(param[4]),
    phpIntval(param[5]),
  ];
}
