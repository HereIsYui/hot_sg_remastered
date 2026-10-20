import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpIntval, phpNum, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import type { Row } from '../task/task-goals.service';
import { TaskRewards } from '../task/task-rewards.service';

/** cfg_box_details.srctype of an item opened from the goods list. */
const SRC_GOODS = 0;
/** giveReward log reasons of opened boxes. */
const LOG_BOX_GOODS = 6;
const LOG_BOX_MONEY = 20;
/** No limit on a pick. */
const UNLIMITED = 2000000000;
/** 沉睡的匣子 and 整蛊小锤子: during act 252 a lucky opening keeps the hammer. */
const LUCKY_ACT = 252;
const LUCKY_BOXES = new Set([10211, 10212]);
const LUCKY_KEY = 10212;
const LUCKY_ACHIEVEMENT = 100009;
const LUCKY_STREAK = 10;
/** 活动令牌: rewards the player never sees. */
const isHiddenToken = (sort: number, type: number) => sort === 2 && type >= 19990 && type <= 19999;
/** Items always announced when they drop. */
const ANNOUNCED_GIDS = new Set([160042, 160043, 160029, 160049, 160026, 160046]);
/** The gid standing for each resource type in box results. */
const RES_GIDS: Record<number, number> = { 1: 85, 2: 87, 3: 88, 4: 89, 5: 90 };

/**
 * What openDefaultGoodsNow throws after giving rewards with no item to show (soldiers, task
 * groups ...): the changes stand, and the text reaches the player as an error.
 */
export class CommittedMessage {
  constructor(readonly text: string) {}
}

/**
 * GoodsFunc.php::openDefaultBox for the items of the goods list (srctype 0): one weighted pick
 * from cfg_box_details, given through giveReward. Boxes that need a key take both.
 */
@Injectable()
export class DefaultBoxService {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly rewards: TaskRewards,
    private readonly users: UserRules,
    private readonly random: RandomService,
  ) {}

  /** The opened items (TreasureGetDialog), or false when nothing is given. */
  async open(uid: number, cid: number, gid: number): Promise<unknown[] | false | CommittedMessage> {
    if (!(await this.goods.checkGoods(uid, gid))) {
      const name = await this.cell(sql`select name from cfg_goods where gid = ${gid}`);
      throw GameError.lang('useHuodongGoods.no_HuoDongGoods', name);
    }
    let srcid = gid;
    const boxCon = await this.row(sql`select * from cfg_box_open_condition
      where boxid = ${gid} or keyid = ${gid}`);
    if (boxCon) {
      if (gid === phpIntval(boxCon.boxid)) {
        if (!(await this.goods.checkGoods(uid, phpIntval(boxCon.keyid)))) {
          throw GameError.raw(phpString(boxCon.nokeydesc));
        }
      } else {
        if (!(await this.goods.checkGoods(uid, phpIntval(boxCon.boxid)))) {
          throw GameError.raw(phpString(boxCon.noboxdesc));
        }
        srcid = phpIntval(boxCon.boxid);
      }
    }
    const details = await this.rows(sql`select * from cfg_box_details
      where srctype = ${SRC_GOODS} and srcid = ${srcid}`);
    if (details.length === 0) throw GameError.lang('useGoods.func_not_in_use');
    const lucky = await this.luckyOpening(uid, gid);
    if (boxCon) {
      await this.goods.reduceGoods(uid, phpIntval(boxCon.boxid), 1);
      if (!lucky) await this.goods.reduceGoods(uid, phpIntval(boxCon.keyid), 1);
    } else {
      await this.goods.reduceGoods(uid, srcid, 1);
    }

    const pick = await this.pickWithLimit(uid, srcid, details);
    if (!pick) return false;
    if (phpIntval(pick.sort) === 7) throw new Error(`openDefaultHeroBox(${srcid}) not ported`);
    return this.give(uid, cid, srcid, pick);
  }

  /** The act 252 roll for 沉睡的匣子; ten lucky ones in a row earn an achievement. */
  private async luckyOpening(uid: number, gid: number): Promise<boolean> {
    const rate = await this.cell(sql`select rate from cfg_act where actid = ${LUCKY_ACT}
      and unix_timestamp() between starttime and endtime`);
    if (!(phpNum(rate) > 0 && LUCKY_BOXES.has(gid))) return false;
    const db = this.scope.db;
    const where = sql`uid = ${uid} and actid = ${LUCKY_ACT} and sort = 2 and type = ${LUCKY_KEY}
      and log_type = 0`;
    if (this.random.mtRand(1, 100) > phpNum(rate)) {
      await sql`delete from log_act where ${where}`.execute(db);
      return false;
    }
    const info = await this.row(sql`select * from log_act where ${where}`);
    if (!info) {
      await sql`insert into log_act (uid, actid, sort, type, count, log_type, time)
        values (${uid}, ${LUCKY_ACT}, 2, ${LUCKY_KEY}, 1, 0, unix_timestamp())`.execute(db);
    } else {
      await sql`update log_act set count = count + 1 where ${where}`.execute(db);
    }
    if (phpNum(info?.count) >= LUCKY_STREAK - 1) {
      await this.rewards.finishAchievement(uid, LUCKY_ACHIEVEMENT);
    }
    return true;
  }

  /**
   * getOpenDefaultGoodsResult: pickOne by rate, then the daily, per-player and server-wide
   * limits; `limit` caps the count when one applies.
   */
  private async pickWithLimit(uid: number, srcid: number, details: Row[]): Promise<Row | null> {
    const gift = this.pickOne(details);
    if (!gift) return null;
    const sort = phpIntval(gift.sort);
    const type = phpIntval(gift.type);
    const logged = (extra: RawBuilder<unknown>) =>
      this.cell(sql`select sum(count) from log_act where actid = ${srcid} and sort = ${sort}
        and type = ${type} and log_type = ${SRC_GOODS} ${extra}`);
    let left = UNLIMITED;
    let limited = false;
    if (phpNum(gift.dayopencount) > 0) {
      limited = true;
      const used = await logged(sql`and uid = ${uid} and time >= unix_timestamp(curdate())`);
      left = Math.min(left, phpNum(gift.dayopencount) - phpNum(used));
    }
    if (phpNum(gift.totalopencount) > 0) {
      limited = true;
      left = Math.min(
        left,
        phpNum(gift.totalopencount) - phpNum(await logged(sql`and uid = ${uid}`)),
      );
    }
    if (phpNum(gift.owncount) > 0) {
      limited = true;
      left = Math.min(left, phpNum(gift.owncount) - phpNum(await logged(sql``)));
    }
    if (!limited) return gift;
    return left > 0 ? { ...gift, limit: left } : null;
  }

  /** ActFunc.php::pickOne; with no weight at all, mt_rand(1, 0) fails and the first row wins. */
  private pickOne(rows: Row[]): Row | null {
    const sum = rows.reduce((s, r) => s + phpNum(r.rate), 0);
    const rate = sum >= 1 ? this.random.mtRand(1, sum) : 0;
    let cur = 0;
    for (const row of rows) {
      cur += phpNum(row.rate);
      if (cur >= rate) return row;
    }
    return null;
  }

  /** openDefaultGoodsNow: gives the first detail row matching the pick. */
  private async give(
    uid: number,
    cid: number,
    srcid: number,
    pick: Row,
  ): Promise<unknown[] | false | CommittedMessage> {
    const sort = phpIntval(pick.sort);
    const type = phpIntval(pick.type);
    const row = await this.row(sql`select * from cfg_box_details
      where srcid = ${srcid} and srctype = ${SRC_GOODS} and sort = ${sort} and type = ${type}
        and count = ${phpIntval(pick.count)}`);
    if (!row) return false;
    const limit = phpNum(pick.limit);
    const count = limit > 0 ? Math.min(phpNum(row.count), limit) : phpNum(row.count);
    const reward = { ...row, count };
    let gotten = await this.rewards.giveReward(
      uid,
      cid,
      reward,
      true,
      LOG_BOX_GOODS,
      LOG_BOX_MONEY,
      phpIntval(row.temp),
    );
    if (
      phpNum(row.dayopencount) > 0 ||
      phpNum(row.totalopencount) > 0 ||
      phpNum(row.owncount) > 0
    ) {
      await sql`insert into log_act (uid, actid, sort, type, count, log_type, time)
        values (${uid}, ${srcid}, ${sort}, ${type}, ${count}, ${SRC_GOODS}, unix_timestamp())`.execute(
        this.scope.db,
      );
    }
    if (isHiddenToken(sort, type)) return false;
    if (phpNum(row.inform) || (sort === 2 && ANNOUNCED_GIDS.has(type))) {
      const uname = await this.cell(sql`select name from sys_user where uid = ${uid}`);
      const boxName = phpString(
        await this.cell(sql`select name from cfg_goods where gid = ${srcid}`),
      );
      await this.users.sendSysInform({
        type: 0,
        inuse: 1,
        starttime: 0,
        endtime: 300,
        interval: 1800,
        scrollcount: 1,
        color: 49151,
        msg: this.lang.t('goodsopen.inform', uname, boxName + gotten),
      });
    }

    const ret: unknown[] = [];
    if (sort === 2) {
      ret.push(
        (await this.row(sql`select *, ${count} as count from cfg_goods where gid = ${type}`)) ??
          false,
      );
    } else if (sort === 5) {
      const thing = await this.row(sql`select *, ${count} as count from cfg_things
        where tid = ${type}`);
      ret.push({ ...thing, gtype: 2 });
    } else if (sort === 6) {
      const armor = (await this.row(sql`select * from cfg_armor where id = ${type}`)) ?? {};
      ret.push({ ...armor, cnt: 1, gtype: 1, hp: armor.ori_hp_max, hp_max: armor.ori_hp_max });
    } else if (sort === 1) {
      const gid = RES_GIDS[type];
      if (gid !== undefined) {
        const name = this.lang.t(`resPackage.res_${type}`);
        ret.push({ name, count, gid, description: name, imagetype: 0, image: 0 });
      }
    } else if (sort === 10 || sort === 11) {
      gotten = `开启任务组【${gotten}】`;
    }
    if (ret.length === 0) return new CommittedMessage(gotten);
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
