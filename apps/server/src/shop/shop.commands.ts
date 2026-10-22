import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { DefaultBoxService } from '../goods/default-box.service';
import type { Row } from '../task/task-goals.service';
import { TaskRewards } from '../task/task-rewards.service';

/** 五铢钱 and 积分 counters shown atop the shop. */
const WUZHU_GID = 10960;
const CREDIT_GID = 888888;
/** 聚贤包: needs a nobility (爵位) of at least 1. */
const JUXIAN_PACK_ID = 121;
/** cfg_shop.totalCount below this means a limited stock; at or above it, unlimited. */
const UNLIMITED = 2000000000;
/** 赤壁道具 gid range kept out of the shop. */
const CHIBI_MIN = 160001;
const CHIBI_MAX = 160051;
/** 孟获物品 gid range. */
const MENGHUO_MIN = 41001;
const MENGHUO_MAX = 41009;
/** log_money / log_gift reason for a shop payment. */
const LOG_PAY = 10;
/** log_goods reasons: 元宝 / 礼金 purchases, and the buy-before-use variants. */
const LOG_BUY_YUANBAO = 61;
const LOG_BUY_GIFT = 62;
const LOG_BEFOREUSE_YUANBAO = 63;
const LOG_BEFOREUSE_GIFT = 64;
/** Task goals finished by buying from the shop (completeTask) and 294 / 541 (completeTaskWithTaskid). */
const GOAL_BUY_366 = 366;
const GOAL_BUY_531 = 531;
const TASK_BUY_294 = 294;
const TASK_SHOP_OPEN_541 = 541;
/** parseAndAddReward log reasons used by exchangeLiquan. */
const LIQUAN_LOG = { goods: 8, armor: 3, things: 8, money: 3 };
/** 商城活动 opened through openDefaultBox use srctype 5000. */
const SRC_SHOP_ACT = 5000;
const ACT_SHOP_BOX = 5001;

/** The 五铢钱 copper shop sublist of getShopInfo: cfg_goods / cfg_things joined to cfg_goods_copper. */
type CopperType = 0 | 1;

/**
 * ShopFunc.php: the shop list, buying for 元宝 / 礼金, buy-and-use (the `not_enough_goods`
 * popup), and 礼券 redemption. The 五铢钱 copper shop (buyGoodsUsingCopper) and 赤壁 / 孟获
 * remote item grants belong to other modules and are not ported here.
 */
@Injectable()
export class ShopCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly rewards: TaskRewards,
    private readonly users: UserRules,
    private readonly tasks: TaskRules,
    private readonly defaultBox: DefaultBoxService,
  ) {}

  /**
   * `[]`: 五铢钱, 积分, the 元宝/礼金 goods (recommended then normal) and the 五铢钱 copper
   * lists. Opening the shop finishes task 541.
   */
  @GlobalCommand()
  async getShopInfo(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const ret: unknown[] = [];
    ret.push(
      await this.cell(sql`select count from sys_goods where uid = ${uid} and gid = ${WUZHU_GID}`),
    );
    ret.push(
      await this.cell(sql`select count from sys_goods where uid = ${uid} and gid = ${CREDIT_GID}`),
    );
    // commend 0/2 (normal), 1/2 (recommended). 赤壁 group 6/7 and gid 160001-160051 stay out.
    const onsale = sql`onsale = 1 and starttime <= unix_timestamp() and endtime > unix_timestamp()
      and \`group\` not in (6, 7) and (gid < ${CHIBI_MIN} or gid > ${CHIBI_MAX})`;
    ret.push(
      await this.rows(sql`select * from cfg_shop where ${onsale}
        and (commend = '0' or commend = '2') order by position, id`),
    );
    ret.push(
      await this.rows(sql`select * from cfg_shop where ${onsale}
        and (commend = '1' or commend = '2') order by position, id`),
    );
    ret.push([...(await this.copperList(1)), ...(await this.copperThings(1))]);
    ret.push([...(await this.copperList(0)), ...(await this.copperThings(0))]);
    await this.tasks.completeTaskWithTaskid(uid, TASK_SHOP_OPEN_541);
    return ret;
  }

  private copperList(recommendedOnly: CopperType): Promise<Row[]> {
    const commend = recommendedOnly
      ? sql`(c.commend = '1' or c.commend = 2)`
      : sql`(c.commend = '0' or c.commend = 2)`;
    return this.rows(sql`select g.*, c.price, c.type from cfg_goods_copper c
      left join cfg_goods g on c.gid = g.gid where c.type = '0' and c.onsale = '1' and ${commend}`);
  }

  private copperThings(recommendedOnly: CopperType): Promise<Row[]> {
    const commend = recommendedOnly
      ? sql`(c.commend = '1' or c.commend = 2)`
      : sql`(c.commend = '0' or c.commend = 2)`;
    return this.rows(sql`select t.*, c.price, c.type from cfg_goods_copper c
      left join cfg_things t on c.gid = t.tid where c.type = '1' and c.onsale = '1' and ${commend}`);
  }

  /** `[hid]`: the cfg_hero row for a shop hero's attribute tooltip. */
  @GlobalCommand()
  async getGoodsHeroAttr(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const hid = phpIntval(param[0]);
    const info = await this.row(sql`select * from cfg_hero where id = ${hid}`);
    if (!info) throw GameError.lang('buyGoods.no_tip');
    return [info];
  }

  /** `[aid]`: the cfg_armor row for a shop gear's attribute tooltip. */
  @GlobalCommand()
  async getGoodsArmorAttr(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const aid = phpIntval(param[0]);
    const info = await this.row(sql`select * from cfg_armor where id = ${aid}`);
    if (!info) throw GameError.lang('buyGoods.no_tip');
    return [info];
  }

  /**
   * `[id, count, paytype, gid?]`: buys a shop item for 元宝 (paytype 0) or 礼金 (1). A trailing
   * gid overrides id. Enforces nobility, stock and the per-player / per-day / total limits, then
   * grants the goods and takes the money. Answers `[paytype, balance, actMsg?]`.
   */
  @GlobalCommand()
  async buyGoods(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    let id = phpIntval(param[0]);
    const cnt = phpIntval(param[1]);
    const paytype = phpIntval(param[2]);
    //  is unset in the legacy lang, so the original
    // throws an empty message; GameError.raw('') matches that rather than echoing the key.
    if (paytype !== 0 && paytype !== 1) throw GameError.raw('');
    if (cnt < 1) throw GameError.lang('buyGoods.invalid_amount');

    // The PHP checks `!empty($gid)`: 0 / absent keeps id, otherwise gid wins.
    const gid = phpIntval(param[3]);
    return this.scope.transaction(async () => {
      let goods: Row | undefined;
      if (gid !== 0) {
        id = phpIntval(
          await this.cell(sql`select * from cfg_shop where gid = ${gid} and onsale = 1`),
        );
        goods = await this.row(sql`select * from cfg_shop where gid = ${gid} and onsale = 1
          and starttime <= unix_timestamp() and endtime > unix_timestamp()`);
      } else {
        goods = await this.row(sql`select * from cfg_shop where id = ${id} and onsale = 1
          and starttime <= unix_timestamp() and endtime > unix_timestamp()`);
      }
      if (!goods) throw GameError.lang('buyGoods.stop_sale');
      if (phpNum(goods.rebate) === 1 && paytype === 1)
        throw GameError.lang('buyGoods.invalid_rebate');

      const moneyNeed = cnt * phpNum(goods.price);
      const user = await this.row(
        sql`select nobility, money, gift from sys_user where uid = ${uid}`,
      );
      const nobility = await this.users.bufferNobility(uid, user?.nobility);
      const userMoney = phpNum(user?.money);
      const userGift = phpNum(user?.gift);
      if (paytype === 0 && userMoney < moneyNeed)
        throw GameError.lang('buyGoods.no_enough_YuanBao');
      if (paytype === 1 && userGift < moneyNeed) throw GameError.lang('buyGoods.no_enough_Gift');
      if (id === JUXIAN_PACK_ID && nobility < 1) throw GameError.lang('buyGoods.nobility_limit');

      await this.checkPurchaseLimits(uid, id, cnt, goods);

      // One hand delivers the goods; the 赤壁 / 孟获 remote grants are not ported.
      const logGoodType = paytype === 0 ? LOG_BUY_YUANBAO : LOG_BUY_GIFT;
      if (await this.isChiBiGoods(id)) {
        throw new Error(`buyGoods(${id}): 赤壁 remote grant not ported`);
      } else if (id >= MENGHUO_MIN && id <= MENGHUO_MAX) {
        throw new Error(`buyGoods(${id}): 孟获 remote grant not ported`);
      }
      await this.goods.addGoods(
        uid,
        phpIntval(goods.gid),
        phpIntval(goods.pack) * cnt,
        logGoodType,
      );
      // The other hand takes the money.
      if (paytype === 0) await this.rewards.addMoney(uid, -moneyNeed, LOG_PAY);
      else await this.rewards.addGift(uid, -moneyNeed, LOG_PAY);

      await this.logPurchase(uid, id, cnt, goods, paytype);
      await this.tasks.completeTask(uid, GOAL_BUY_366);
      await this.tasks.completeTask(uid, GOAL_BUY_531);
      await this.tasks.completeTaskWithTaskid(uid, TASK_BUY_294);

      const ret: unknown[] = [paytype];
      let actMsg: string | false = false;
      if (paytype === 0) {
        ret.push(userMoney - moneyNeed);
        actMsg = await this.checkAndDoShopAct(uid, moneyNeed);
      } else {
        ret.push(userGift - moneyNeed);
      }
      if (actMsg) ret.push(actMsg);
      return ret;
    });
  }

  /**
   * `[id, count, paytype]`: buys a single item then leaves it to the client to use at once
   * (the `not_enough_goods` popup). Unlike buyGoods there is no nobility or 赤壁 branch, and
   * the recommend flag must match the pay type. Answers `[gid, paytype, balance]`.
   */
  @GlobalCommand()
  async buyGoodsBeforeUse(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const id = phpIntval(param[0]);
    const cnt = phpIntval(param[1]);
    const paytype = phpIntval(param[2]);
    //  is unset in the legacy lang, so the original
    // throws an empty message; GameError.raw('') matches that rather than echoing the key.
    if (paytype !== 0 && paytype !== 1) throw GameError.raw('');
    if (cnt < 1) throw GameError.lang('buyGoods.invalid_amount');

    return this.scope.transaction(async () => {
      const commend =
        paytype === 0 ? sql`(commend = '0' or commend = 2)` : sql`(commend = '1' or commend = 2)`;
      const goods = await this.row(sql`select * from cfg_shop where id = ${id} and onsale = 1
        and starttime <= unix_timestamp() and endtime > unix_timestamp() and ${commend}`);
      if (!goods) throw GameError.lang('buyGoods.stop_sale');

      const moneyNeed = cnt * phpNum(goods.price);
      const user = await this.row(sql`select money, gift from sys_user where uid = ${uid}`);
      const userMoney = phpNum(user?.money);
      const userGift = phpNum(user?.gift);
      if (paytype === 0 && userMoney < moneyNeed)
        throw GameError.lang('buyGoods.no_enough_YuanBao');
      if (paytype === 1 && userGift < moneyNeed) throw GameError.lang('buyGoods.no_enough_Gift');

      if (phpNum(goods.totalCount) < UNLIMITED && phpNum(goods.totalCount) === 0) {
        throw GameError.lang('buyGoods.sold_out');
      }
      // buyGoodsBeforeUse only enforces the per-player and per-day caps, not the total stock.
      if (phpNum(goods.userbuycnt) > 0 || phpNum(goods.daybuycnt) > 0) {
        await this.checkUserAndDayLimit(uid, id, cnt, goods);
      }

      if (paytype === 0) await this.rewards.addMoney(uid, -moneyNeed, LOG_PAY);
      else await this.rewards.addGift(uid, -moneyNeed, LOG_PAY);
      const logGoodType = paytype === 0 ? LOG_BEFOREUSE_YUANBAO : LOG_BEFOREUSE_GIFT;
      await this.goods.addGoods(
        uid,
        phpIntval(goods.gid),
        phpIntval(goods.pack) * cnt,
        logGoodType,
      );

      await this.logPurchase(uid, id, cnt, goods, paytype);
      await this.tasks.completeTask(uid, GOAL_BUY_366);
      await this.tasks.completeTask(uid, GOAL_BUY_531);

      const ret: unknown[] = [goods.gid, paytype];
      if (paytype === 0) {
        ret.push(userMoney - moneyNeed);
        await this.checkAndDoShopAct(uid, moneyNeed);
      } else {
        ret.push(userGift - moneyNeed);
      }
      return ret;
    });
  }

  /**
   * GoodsFunc.php::showDlg `[gid]`: the dearest pack=1 cfg_shop row for a gid, so the
   * client's buy-and-use popup can show it. Answers `[row]` (or `[false]` when unsold).
   */
  @GlobalCommand()
  async showDlg(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const gid = phpIntval(param[0]);
    const row = await this.row(sql`select c.* from cfg_shop c where c.gid = ${gid} and c.pack = 1
      order by price desc limit 1`);
    return [row ?? false];
  }

  /**
   * `[code]`: redeems a 10-character 礼券 code, applying its reward content. LQA codes are
   * once per account; LQ2..LQ9 allow that many. Answers `[rewardItems]`.
   */
  @GlobalCommand()
  async exchangeLiquan(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const code = phpString(param[0]).trim();
    if (phpEmpty(code)) throw GameError.lang('exchangeLiquan.code_notNull');
    if (!/[a-zA-Z0-9]{10}/.test(code)) throw GameError.lang('exchangeLiquan.invalid_code');

    return this.scope.transaction(async () => {
      const item = await this.row(sql`select * from sys_ticket where code = ${code} limit 1`);
      if (!item) throw GameError.lang('exchangeLiquan.invalid_code');
      if (phpNum(item.uid) > 0) throw GameError.lang('exchangeLiquan.used_code');
      if (phpNum(item.binduid) > 0 && phpNum(item.binduid) !== uid) {
        throw GameError.lang('exchangeLiquan.code_bind');
      }

      // pcy's typed codes: LQA = one per account, LQ2..LQ9 = up to that many.
      const pattern = code.slice(0, 3);
      let limit = 0;
      if (pattern === 'LQA') limit = 1;
      else {
        for (let i = 2; i < 10; i++) {
          if (pattern === `LQ${i}`) {
            limit = i;
            break;
          }
        }
      }
      if (limit > 0) {
        const used = phpNum(
          await this.cell(sql`select count(1) from sys_ticket where uid = ${uid}
            and contentid = ${item.contentid} and code like ${pattern + '%'}`),
        );
        if (used >= limit) throw GameError.lang('exchangeLiquan.reach_limit', limit, used);
      }

      const content = await this.row(
        sql`select * from sys_ticket_content where id = ${item.contentid}`,
      );
      await sql`update sys_ticket set uid = ${uid}, time = unix_timestamp()
        where id = ${item.id}`.execute(this.scope.db);
      const reward = await this.parseAndAddReward(uid, phpString(content?.content));
      return [reward];
    });
  }

  /** buyGoods's full limit checks: total stock, per-player and per-day caps. */
  private async checkPurchaseLimits(
    uid: number,
    id: number,
    cnt: number,
    goods: Row,
  ): Promise<void> {
    if (phpNum(goods.totalCount) < UNLIMITED && phpNum(goods.totalCount) === 0) {
      throw GameError.lang('buyGoods.sold_out');
    }
    const limited =
      phpNum(goods.userbuycnt) > 0 ||
      phpNum(goods.daybuycnt) > 0 ||
      phpNum(goods.totalCount) < UNLIMITED;
    if (!limited) return;

    // Promotional items count their limit only within the current 促销 window.
    const rebate = phpNum(goods.rebate) > 0;
    const rebateStart = phpNum(goods.starttime);

    if (phpNum(goods.totalCount) < UNLIMITED) {
      const totalBuycnt = rebate
        ? phpNum(
            await this.cell(sql`select sum(count) from log_shop where shopid = ${id}
            and time >= ${rebateStart}`),
          )
        : phpNum(await this.cell(sql`select sum(count) from log_shop_buy_cnt where sid = ${id}`));
      if (totalBuycnt + cnt > phpNum(goods.totalCount)) {
        const validnum = phpNum(goods.totalCount) - totalBuycnt;
        if (validnum > 0) {
          throw GameError.lang(
            'buyGoods.reach_remain_amount_TotalLimit',
            goods.totalCount,
            totalBuycnt,
            validnum,
          );
        }
        throw GameError.lang('buyGoods.sold_out');
      }
    }

    const buycnt = rebate
      ? phpNum(
          await this.cell(sql`select sum(count) from log_shop where uid = ${uid}
          and shopid = ${id} and time >= ${rebateStart}`),
        )
      : phpNum(
          await this.cell(
            sql`select count from log_shop_buy_cnt where uid = ${uid} and sid = ${id}`,
          ),
        );
    if (phpNum(goods.userbuycnt) > 0 && buycnt + cnt > phpNum(goods.userbuycnt)) {
      if (phpNum(goods.userbuycnt) > buycnt) {
        throw GameError.lang(
          'buyGoods.reach_remain_amountLimit',
          goods.userbuycnt,
          buycnt,
          phpNum(goods.userbuycnt) - buycnt,
        );
      }
      throw GameError.lang('buyGoods.reach_buy_limit', goods.userbuycnt);
    }

    const todaybuycnt = phpNum(
      await this.cell(sql`select sum(count) from log_shop where uid = ${uid} and shopid = ${id}
        and date(now()) = date(from_unixtime(time))`),
    );
    if (phpNum(goods.daybuycnt) > 0 && todaybuycnt + cnt > phpNum(goods.daybuycnt)) {
      if (phpNum(goods.daybuycnt) > todaybuycnt) {
        throw GameError.lang(
          'buyGoods.reach_remain_amount_todayLimit',
          goods.daybuycnt,
          buycnt,
          phpNum(goods.daybuycnt) - todaybuycnt,
        );
      }
      throw GameError.lang('buyGoods.reach_buy_todayLimit', goods.daybuycnt);
    }
    await sql`insert into log_shop_buy_cnt (uid, sid, count) values (${uid}, ${id}, ${cnt})
      on duplicate key update count = count + ${cnt}`.execute(this.scope.db);
  }

  /** buyGoodsBeforeUse's limit check: per-player and per-day caps only (no 促销 window). */
  private async checkUserAndDayLimit(
    uid: number,
    id: number,
    cnt: number,
    goods: Row,
  ): Promise<void> {
    const buycnt = phpNum(
      await this.cell(sql`select count from log_shop_buy_cnt where uid = ${uid} and sid = ${id}`),
    );
    const todaybuycnt = phpNum(
      await this.cell(sql`select sum(count) from log_shop where uid = ${uid} and shopid = ${id}
        and date(now()) = date(from_unixtime(time))`),
    );
    if (phpNum(goods.userbuycnt) > 0 && buycnt + cnt > phpNum(goods.userbuycnt)) {
      if (phpNum(goods.userbuycnt) > buycnt) {
        throw GameError.lang(
          'buyGoods.reach_remain_amountLimit',
          goods.userbuycnt,
          buycnt,
          phpNum(goods.userbuycnt) - buycnt,
        );
      }
      throw GameError.lang('buyGoods.reach_buy_limit', goods.userbuycnt);
    }
    if (phpNum(goods.daybuycnt) > 0 && todaybuycnt + cnt > phpNum(goods.daybuycnt)) {
      if (phpNum(goods.daybuycnt) > todaybuycnt) {
        throw GameError.lang(
          'buyGoods.reach_remain_amount_todayLimit',
          goods.daybuycnt,
          buycnt,
          phpNum(goods.daybuycnt) - todaybuycnt,
        );
      }
      throw GameError.lang('buyGoods.reach_buy_todayLimit', goods.daybuycnt);
    }
    await sql`insert into log_shop_buy_cnt (uid, sid, count) values (${uid}, ${id}, ${cnt})
      on duplicate key update count = count + ${cnt}`.execute(this.scope.db);
  }

  private async logPurchase(
    uid: number,
    id: number,
    cnt: number,
    goods: Row,
    paytype: number,
  ): Promise<void> {
    await sql`update sys_user set last_pay = ${paytype} where uid = ${uid}`.execute(this.scope.db);
    await sql`insert into log_shop (uid, shopid, count, price, time, paytype)
      values (${uid}, ${id}, ${cnt}, ${goods.price}, unix_timestamp(), ${paytype})`.execute(
      this.scope.db,
    );
  }

  /** ShopFunc.php::isChiBiGoods: the item belongs to a 赤壁 shop group. */
  private async isChiBiGoods(id: number): Promise<boolean> {
    const CHIBI_BATTLE = 2;
    const row = await this.row(sql`select a.id from cfg_shop a, cfg_things b
      where a.onsale = 1 and (a.\`group\` = 6 or a.\`group\` = 7 or a.battleshop = 1)
        and a.medalTypeId = b.tid and b.battleBelong = ${CHIBI_BATTLE} and a.id = ${id}`);
    return row !== undefined;
  }

  /**
   * ActFunc.php::checkAndDoShopAct: 商城活动 gifts for a 元宝 purchase (a random-chance box,
   * the per-purchase / first-of-day / cumulative pay events). Returns the joined gift text, or
   * false when no event is running. The remote 赤壁 grants openDefaultBox may produce are not
   * reachable from here, so a gift that needs one surfaces as a not-ported error.
   */
  private async checkAndDoShopAct(uid: number, money: number): Promise<string | false> {
    const cid = phpIntval(await this.cell(sql`select lastcid from sys_user where uid = ${uid}`));
    let msg = '';

    const randAct = await this.availableActByType(ACT_SHOP_BOX);
    if (randAct) {
      let rate = phpNum(randAct.rate) * money;
      if (rate > 3000) rate = 3000; // 概率上限 30%
      if (this.isLucky(rate, 10000)) {
        const gift = await this.defaultBox.openEvent(
          uid,
          cid,
          phpIntval(randAct.actid),
          SRC_SHOP_ACT,
        );
        if (gift) msg += `${gift} `;
      }
    }

    // 5002 多充多得 / 分段, 5101 当天首充, 5201 当天累计, 5010 累计充值.
    msg += await this.payActs(uid, cid, money, 5002, (payAct, m) =>
      phpNum(payAct.max_money_limit) === 0
        ? Math.floor(m / phpNum(payAct.money_limit))
        : m <= phpNum(payAct.max_money_limit)
          ? 1
          : 0,
    );
    msg += await this.payActsFirstOfDay(uid, cid, money);
    msg += await this.payActsCumulative(uid, cid, 5201, true);
    msg += await this.payActsCumulative(uid, cid, 5010, false);

    // ShopFunc.php returns $msg as built (with each gift's trailing space); buyGoods treats any
    // non-empty string as truthy. Keep the trailing space, only map "" to false.
    return msg === '' ? false : msg;
  }

  private async payActs(
    uid: number,
    cid: number,
    money: number,
    type: number,
    giveCount: (payAct: Row, money: number) => number,
  ): Promise<string> {
    let msg = '';
    for (const payAct of await this.shopGiftActs(type)) {
      if (money < phpNum(payAct.money_limit)) continue;
      const count = giveCount(payAct, money);
      if (count <= 0) continue;
      const gift = await this.defaultBox.openEvent(
        uid,
        cid,
        phpIntval(payAct.actid),
        SRC_SHOP_ACT,
        count,
      );
      if (gift) msg += `${gift} `;
    }
    return msg;
  }

  private async payActsFirstOfDay(uid: number, cid: number, money: number): Promise<string> {
    let msg = '';
    for (const payAct of await this.shopGiftActs(5101)) {
      const start = phpNum(payAct.starttime);
      const payCount = phpNum(
        await this.cell(sql`select count(1) from log_shop where uid = ${uid}
          and time >= greatest(unix_timestamp(curdate()), ${start}) and paytype = 0`),
      );
      if (payCount <= 1 && money >= phpNum(payAct.money_limit)) {
        const gift = await this.defaultBox.openEvent(
          uid,
          cid,
          phpIntval(payAct.actid),
          SRC_SHOP_ACT,
        );
        if (gift) msg += `${gift} `;
      }
    }
    return msg;
  }

  private async payActsCumulative(
    uid: number,
    cid: number,
    type: number,
    daily: boolean,
  ): Promise<string> {
    let msg = '';
    for (const payAct of await this.shopGiftActs(type)) {
      const start = phpNum(payAct.starttime);
      const since = daily ? sql`greatest(unix_timestamp(curdate()), ${start})` : sql`${start}`;
      const total = await this
        .row(sql`select sum(price * count) as totalMoney, max(time) as lastTime
        from log_shop where time >= ${since} and uid = ${uid} and paytype = 0`);
      const totalMoney = phpNum(total?.totalMoney);
      const lastTime = phpNum(total?.lastTime);
      if (totalMoney < phpNum(payAct.money_limit)) continue;
      const beforeTotal = phpNum(
        await this.cell(sql`select sum(price * count) from log_shop where uid = ${uid}
          and time between ${since} and ${lastTime - 1} and paytype = 0`),
      );
      const giveCount =
        Math.floor(totalMoney / phpNum(payAct.money_limit)) -
        Math.floor(beforeTotal / phpNum(payAct.money_limit));
      if (giveCount <= 0) continue;
      const gift = await this.defaultBox.openEvent(
        uid,
        cid,
        phpIntval(payAct.actid),
        SRC_SHOP_ACT,
        giveCount,
      );
      if (gift) msg += `${gift} `;
    }
    return msg;
  }

  private shopGiftActs(type: number): Promise<Row[]> {
    return this.rows(sql`select g.*, a.starttime, a.endtime from cfg_act_shopgift g
      inner join cfg_act a on g.actid = a.actid
      where a.starttime <= unix_timestamp() and a.endtime >= unix_timestamp() and a.type = ${type}`);
  }

  /** ActFunc.php::getAvailableActByType: the running event of a type, if any. */
  private async availableActByType(type: number): Promise<Row | undefined> {
    return this.row(sql`select * from cfg_act where type = ${type}
      and starttime <= unix_timestamp() and endtime >= unix_timestamp() limit 1`);
  }

  /** utils.php::isLucky: a hit with chance `rate` out of `total`. */
  private isLucky(rate: number, total: number): boolean {
    if (rate <= 0) return false;
    // RandomService is mt_rand-based; checkAndDoShopAct is only reached when an event runs,
    // which never happens in difftest, so a plain mt_rand match is faithful enough here.
    return Math.floor(Math.random() * total) < rate;
  }

  /**
   * utils.php::parseAndAddReward: a `n,type,gid,cnt,...` reward string. type 0 is goods (gid 0
   * 礼金, -100 元宝), 1 gear, 2 things. Returns the rows to show, granting each.
   */
  private async parseAndAddReward(uid: number, reward: string): Promise<unknown[]> {
    const parts = reward.split(',');
    const n = phpIntval(parts[0]);
    const ret: unknown[] = [];
    let money = 0;
    let isYuanBao = false;
    for (let i = 1; i < n * 3; i += 3) {
      const type = phpIntval(parts[i]);
      const gid = phpIntval(parts[i + 1]);
      const cnt = phpIntval(parts[i + 2]);
      if (type === 0) {
        if (gid === 0) money += cnt;
        else if (gid === -100) {
          money += cnt;
          isYuanBao = true;
        } else {
          await this.goods.addGoods(uid, gid, cnt, LIQUAN_LOG.goods);
        }
        const good = (await this.row(sql`select * from cfg_goods where gid = ${gid}`)) ?? {};
        // The original selects `'0' as gype` (a typo for gtype) alongside gtype on the goods row.
        ret.push({ ...good, count: cnt, gype: '0', gtype: 0 });
      } else if (type === 1) {
        const armor = (await this.row(sql`select * from cfg_armor where id = ${gid}`)) ?? {};
        ret.push({
          ...armor,
          count: cnt,
          gtype: 1,
          hp: armor.ori_hp_max,
          hp_max: armor.ori_hp_max,
        });
        await this.rewards.addArmor(uid, gid, cnt, LIQUAN_LOG.armor);
      } else if (type === 2) {
        const thing = (await this.row(sql`select * from cfg_things where tid = ${gid}`)) ?? {};
        ret.push({ ...thing, count: cnt, gtype: 2 });
        await this.goods.addThings(uid, gid, cnt, LIQUAN_LOG.things);
      }
    }
    if (money > 0) {
      if (isYuanBao) await this.rewards.addMoney(uid, money, LIQUAN_LOG.money);
      else await this.rewards.addGift(uid, money, LIQUAN_LOG.money);
    }
    return ret;
  }

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async row(query: RawBuilder<unknown>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  private async cell(query: RawBuilder<unknown>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : false;
  }
}
