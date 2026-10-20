import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { BuildingInfoService } from '../city/building-info.service';
import { encodeXy } from '../city/building-rules.service';
import { CityBuildingsService } from '../city/city-buildings.service';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { OwnershipService } from '../core/ownership.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum } from '../core/php';
import { RandomService } from '../core/random.service';
import { TaskRules } from '../core/task-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import type { Row } from '../task/task-goals.service';
import { TaskRewards } from '../task/task-rewards.service';
import { GoodsCommands } from './goods.commands';

/** UseGoodsDialog types: 0 speeds a building up, 1 a research; the others pick item lists. */
const Type = { LuBan: 0, MoJia: 1 } as const;
/** The item lists of the other types (getUserTypeGoods); unlisted types list the gid itself. */
const TYPE_GIDS: Record<number, string> = {
  2: '74,75,76,77',
  3: '78,79,80,81',
  4: '58',
  5: '54,55',
  6: '57',
  7: '2,44',
  8: '3,45',
  9: '4,46',
  10: '5,47',
  11: '113,114,115',
  12: '6,48',
  13: '7,49',
  14: '25',
  15: '51',
  16: '56',
  17: '60',
  18: '61',
  19: '62',
  20: '117',
  21: '120',
  22: '124',
  23: '133',
  24: '206,207',
  25: '207',
  26: '201,12156',
  27: '125,63',
  28: '10840',
  30: '145, 146',
  142: '142',
  143: '12',
  145: '10957,10958,10959',
  166: '166',
  [-16656]: '166,56',
  42: '124,117',
  43: '26,10152,160040,160041,160042,19204',
  44: '27,10153,160043,160044,160045,19203',
  45: '28,10155,160049,160050,160051,19202',
  46: '29,10154,160046,160047,160048,19205',
  47: '15',
  48: '134',
  49: '151',
  50: '154',
  51: '158',
  52: '160029,160030,160031',
  53: '160026,160027,160028',
  54: '160019,160022',
};
/** Types whose item is simply used (useGoods). */
const PLAIN_USE_TYPES = new Set([
  4, 5, 6, 7, 8, 9, 10, 142, 143, 12, 13, 14, 15, 16, 17, 18, 19, 10333, 161501, 165, 20, 21, 22,
  23, 10083, 10084, 10085, 42, 48, 47, 51, 50, 166, -16656,
]);
/** Types with their own use that is not ported yet: 体力/精力药, 经验书, 打孔器, 武器架, 护命金丹. */
const UNPORTED_TYPES = new Set([2, 3, 11, 145, 24, 25, 26, 28, 30, 49]);

/** 鲁班 items (building speed-ups) and 墨家 items (research speed-ups). */
const LUBAN_GIDS = '67,68,69,70,71,72,73';
const MOJIA_GIDS = '8,9,10,52,53,65,66';
/** 鲁班传人 / 墨家弟子: finish at once for 元宝 or 礼金 by the time left. */
const LUBAN_MASTER = 73;
const MOJIA_MASTER = 53;
/** Fixed cuts in seconds; 鲁班秘录 (71) and 墨家秘笈 (52) cut a random number of hours. */
const LUBAN_CUTS: Record<number, number> = { 67: 900, 68: 3600, 69: 9000, 70: 28800 };
const MOJIA_CUTS: Record<number, number> = { 8: 900, 9: 10800, 65: 3600, 66: 36000 };
/** 鲁班全集 / 墨家宝典: cut a share of the time left. */
const LUBAN_COMPLETE = 72;
const MOJIA_COMPLETE = 10;
/** Growth goals: speed a building up with 鲁班便笺, a research with 墨家残卷. */
const GOAL_LUBAN = 364;
const GOAL_MOJIA = 365;
/** log_money / log_gift reasons. */
const LOG_MOJIA = 70;
const LOG_LUBAN = 71;
/** `now + share * time left`; state_endtime is unsigned, so on a due one the original failed. */
const shareOfTimeLeft = (share: string) =>
  sql`unix_timestamp() + floor(${sql.raw(share)} * (cast(state_endtime as signed) - unix_timestamp()))`;
/** sys_building.state */
const BuildingState = { Upgrading: 1, Destroying: 2 } as const;

/**
 * GoodsFunc.php::getUserTypeGoods / useTypeGoods: the item picker (UseGoodsDialog) of the
 * speed-up buttons and buffs. Using 鲁班 and 墨家 items is ported, the types that just use an
 * item go through useGoods, and the remaining types answer 此功能尚未开放.
 */
@Injectable()
export class TypeGoodsCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly goodsCommands: GoodsCommands,
    private readonly rewards: TaskRewards,
    private readonly taskRules: TaskRules,
    private readonly ownership: OwnershipService,
    private readonly random: RandomService,
    private readonly buildings: CityBuildingsService,
    private readonly buildingInfo: BuildingInfoService,
  ) {}

  /** `[type, timeleft?]`: the items of a type with the counts owned; 鲁班/墨家 lead with a cost. */
  @GlobalCommand()
  async getUserTypeGoods(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const type = param[0];
    if (phpLooseEquals(type, Type.LuBan)) {
      return this.speedUpGoods(uid, param[1], LUBAN_GIDS, LUBAN_MASTER, [4.5, 25], [1.6, 12]);
    }
    if (phpLooseEquals(type, Type.MoJia)) {
      return this.speedUpGoods(uid, param[1], MOJIA_GIDS, MOJIA_MASTER, [5, 30], [1.8, 15]);
    }
    const gids = TYPE_GIDS[phpIntval(type)] ?? String(phpIntval(type));
    return [await this.typeGoods(uid, gids)];
  }

  private typeGoods(uid: number, gids: string): Promise<Row[]> {
    const list = gids.split(',').map((g) => phpIntval(g.trim()));
    return this.rows(sql`select c.*, g.count from cfg_goods c
      left join sys_goods g on g.gid = c.gid and g.uid = ${uid}
      where c.gid in (${sql.join(list)}) order by c.value`);
  }

  /** getLuBanGoods / getMojiaGoods: `[cost, items]`, the master first with 立即完成 if not owned. */
  private async speedUpGoods(
    uid: number,
    timeleftParam: unknown,
    gids: string,
    master: number,
    rate: [number, number],
    twRate: [number, number],
  ): Promise<unknown[]> {
    const timeleft = Math.max(0, phpIntval(timeleftParam));
    const cost = await this.speedUpCost(uid, timeleft, rate, twRate);
    const list: Row[] = [];
    for (const goods of await this.typeGoods(uid, gids)) {
      if (phpEmpty(goods.count)) {
        goods.count =
          phpIntval(goods.gid) === master ? this.lang.t('getMoJiaGoods.complete_quickly') : 0;
      }
      if (phpIntval(goods.gid) === master) list.unshift(goods);
      else list.push(goods);
    }
    return [cost, list];
  }

  /** 元宝 to finish now: `timeleft * rate / 3600 + base`, cheaper on 台湾 passports. */
  private async speedUpCost(
    uid: number,
    timeleft: number,
    [rate, base]: [number, number],
    [twRate, twBase]: [number, number],
  ): Promise<number> {
    const passtype = await this.cell(sql`select passtype from sys_user where uid = ${uid}`);
    return passtype === 'tw'
      ? Math.floor((timeleft * twRate) / 3600) + twBase
      : Math.floor((timeleft * rate) / 3600 + base);
  }

  /**
   * `[type, gid, cid, ...]`: 鲁班 / 墨家 items take `[cid, inner, x, y, bid]` of the building
   * (plus the 元宝 (0) or 礼金 (1) choice for the masters) and answer the building list or the
   * 书院; the plain types answer as useGoods does.
   */
  @GlobalCommand()
  async useTypeGoods(ctx: CommandContext, param: unknown[]): Promise<unknown> {
    const uid = ctx.uid;
    const type = phpIntval(param[0]);
    const gid = phpIntval(param[1]);
    const rest = param.slice(3);
    if (type === Type.LuBan) {
      return this.scope.transaction(() => this.useLuBanGoods(uid, gid, rest));
    }
    if (type === Type.MoJia) {
      return this.scope.transaction(() => this.useMojiaGoods(uid, gid, rest));
    }
    if (PLAIN_USE_TYPES.has(type)) return this.goodsCommands.useGoods(ctx, [gid]);
    if (UNPORTED_TYPES.has(type) || (type > 110000 && type < 160000)) {
      throw GameError.lang('useGoods.func_not_in_use');
    }
    return null;
  }

  /** useLuBanGoods: cuts the upgrade or demolition at a slot. */
  private async useLuBanGoods(uid: number, gid: number, param: unknown[]): Promise<Row[]> {
    const db = this.scope.db;
    const cid = phpIntval(param[0]);
    const xy = encodeXy(phpIntval(param[1]), phpIntval(param[2]), phpIntval(param[3]));
    const bid = phpIntval(param[4]);
    if (!(gid >= 67 && gid <= LUBAN_MASTER)) throw GameError.lang('useLuBanGoods.invalid_param');
    await this.ownership.checkCityExist(cid, uid);
    const building = await this.row(sql`select *, unix_timestamp() as nowtime from sys_building
      where cid = ${cid} and bid = ${bid} and xy = ${xy} and state <> 0`);
    if (!building) throw GameError.lang('useLuBanGoods.no_need_to_use');
    const memTable =
      phpIntval(building.state) === BuildingState.Upgrading
        ? sql.raw('mem_building_upgrading')
        : phpIntval(building.state) === BuildingState.Destroying
          ? sql.raw('mem_building_destroying')
          : null;
    const setEnd = async (endtime: RawBuilder<unknown>) => {
      await sql`update sys_building set state_endtime = ${endtime}
        where id = ${building.id}`.execute(db);
      if (memTable) {
        await sql`update ${memTable} set state_endtime = ${endtime}
          where id = ${building.id}`.execute(db);
      }
    };

    if (gid === LUBAN_MASTER) {
      const timeleft = phpNum(building.state_endtime) - phpNum(building.nowtime);
      if (timeleft <= 1) throw GameError.lang('useLuBanGoods.no_need_to_use');
      const cost = await this.speedUpCost(uid, timeleft, [4.5, 25], [1.6, 12]);
      await this.payForMaster(uid, cost, param[5], LOG_LUBAN);
      await setEnd(sql`unix_timestamp() - 1`);
    } else {
      if (!(await this.goods.checkGoods(uid, gid))) throw GameError.raw(`not_enough_goods${gid}`);
      if (gid === LUBAN_COMPLETE) {
        await setEnd(shareOfTimeLeft('0.7'));
      } else {
        const cut = LUBAN_CUTS[gid] ?? this.secretCut([10, 15, 20, 25, 30]);
        await setEnd(sql`greatest(unix_timestamp() - 1, state_endtime - ${cut})`);
        if (gid === 68) await this.taskRules.completeTask(uid, GOAL_LUBAN);
      }
      await this.goods.reduceGoods(uid, gid, 1);
    }
    return this.buildings.buildingInfo(uid, cid);
  }

  /** useMojiaGoods: cuts the city's research. */
  private async useMojiaGoods(uid: number, gid: number, param: unknown[]): Promise<unknown[]> {
    const db = this.scope.db;
    const cid = phpIntval(param[0]);
    if (!(
      (gid >= 8 && gid <= 10) ||
      gid === MOJIA_MASTER ||
      gid === 52 ||
      gid === 65 ||
      gid === 66
    )) {
      throw GameError.lang('useMojiaGoods.invalid_param');
    }
    await this.ownership.checkCityExist(cid, uid);
    const technic = await this.row(sql`select *, unix_timestamp() as nowtime from sys_technic
      where uid = ${uid} and cid = ${cid} and state = 1`);
    const setEnd = async (endtime: RawBuilder<unknown>) => {
      await sql`update sys_technic set state_endtime = ${endtime}
        where id = ${technic?.id}`.execute(db);
      await sql`update mem_technic_upgrading set state_endtime = ${endtime}
        where id = ${technic?.id}`.execute(db);
    };

    if (gid === MOJIA_MASTER) {
      if (!technic) throw GameError.lang('useMojiaGoods.no_need_to_use');
      const timeleft = phpNum(technic.state_endtime) - phpNum(technic.nowtime);
      if (timeleft <= 1) throw GameError.lang('useMojiaGoods.no_need_to_use');
      const cost = await this.speedUpCost(uid, timeleft, [5, 30], [1.8, 15]);
      await this.payForMaster(uid, cost, param[5], LOG_MOJIA);
      await setEnd(sql`unix_timestamp() - 1`);
    } else {
      // The original's message key (technique_no_need) does not exist.
      if (!technic) throw GameError.raw('');
      if (!(await this.goods.checkGoods(uid, gid))) throw GameError.raw(`not_enough_goods${gid}`);
      if (gid === MOJIA_COMPLETE) {
        await setEnd(shareOfTimeLeft('0.65'));
      } else {
        const cut = MOJIA_CUTS[gid] ?? this.secretCut([12, 16, 24, 28, 36]);
        await setEnd(sql`greatest(unix_timestamp() - 1, state_endtime - ${cut})`);
        if (gid === 8) await this.taskRules.completeTask(uid, GOAL_MOJIA);
      }
      await this.goods.reduceGoods(uid, gid, 1);
    }
    return this.buildingInfo.collegeInfo(uid, cid);
  }

  /** 鲁班秘录 / 墨家秘笈: hours from one of four bands (50/30/15/5%) given by their bounds. */
  private secretCut([a, b, c, d, e]: [number, number, number, number, number]): number {
    const band = this.random.mtRand(1000, 2000);
    let hours: number;
    if (band < 1500) hours = this.random.mtRand(a, b);
    else if (band < 1800) hours = this.random.mtRand(b, c);
    else if (band < 1950) hours = this.random.mtRand(c, d);
    else hours = this.random.mtRand(d, e);
    return hours * 3600;
  }

  private async payForMaster(
    uid: number,
    cost: number,
    payType: unknown,
    logType: number,
  ): Promise<void> {
    const byMoney = phpLooseEquals(payType, 0);
    const column = sql.raw(byMoney ? 'money' : 'gift');
    const owned = await this.cell(sql`select ${column} from sys_user where uid = ${uid}`);
    if (cost > phpNum(owned)) {
      throw GameError.lang(byMoney ? 'sys.not_enough_money' : 'sys.not_enough_gift');
    }
    if (cost <= 0) return;
    if (byMoney) await this.rewards.addMoney(uid, -cost, logType);
    else await this.rewards.addGift(uid, -cost, logType);
  }

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async row(query: RawBuilder<unknown>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  private async cell(query: RawBuilder<unknown>): Promise<unknown> {
    const row = await this.row(query);
    return row === undefined ? undefined : Object.values(row)[0];
  }
}
