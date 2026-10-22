import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { Building, CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { OwnershipService } from '../core/ownership.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum } from '../core/php';
import { RandomService } from '../core/random.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import type { Row } from '../task/task-goals.service';
import { TaskRewards } from '../task/task-rewards.service';
import { BufferGoods } from './buffer-goods.service';
import { CommittedMessage, DefaultBoxService } from './default-box.service';

/** The useGoods reply kinds (`[gid, kind, ...]`) MyGoodsDialog.onCommand tells apart. */
const UseReply = { Message: 0, Items: 1 } as const;
/** Things the goods list leaves out. */
const HIDDEN_THING = 104001;
/** log_goods / log_gift / log_armor / log_things reasons. */
const LOG_BOX = 3;
const LOG_PACK_GOODS = 6;
const LOG_PACK_THINGS = 8;
const LOG_SELL = 9;
const LOG_BOX_GIFT = 20;
/** Gids that only report the "not enough" code the client turns into a buy prompt. */
const BUY_PROMPT_GIDS = new Set([
  2, 44, 3, 45, 4, 46, 5, 47, 54, 55, 57, 25, 6, 48, 7, 49, 60, 61, 62, 58, 140, 56, 142, 124, 117,
  120, 15, 133, 134, 154, 164, 166, 165,
]);
/** Gids that may be used several at a time besides the skill books (40000-50000). */
const MULTI_USE_GIDS = new Set([
  2, 3, 4, 5, 6, 7, 25, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 112, 118, 1001, 1002, 1003, 10333,
  165, 166, 10957, 10958, 10959,
]);
/** Items used elsewhere: using them from the list only says where. */
const USED_ELSEWHERE: Record<number, string> = {
  1: 'useGoods.acoustic_used_in_world_channel',
  8: 'useGoods.MoJiaCanJuan',
  9: 'useGoods.MojiaTuZhi',
  10: 'useGoods.MoJiaDianJi',
  13: 'useGoods.JinNang',
  22: 'useGoods.XiSuiDan_used_for_reset_hero',
  23: 'useGoods.ZhaoXianBang_used_for_hire_hero',
  52: 'useGoods.MoJiaMiJi',
  59: 'useGoods.JunQi_used_for_army',
  63: 'useGoods.HanXinSanPian_used_for_army',
  64: 'useGoods.BeiChengMen_used_for_army',
};
const EXPIRED_GIDS = new Set([10014, 10015, 10083, 10270, 10279, 10282, 10254]);
/** 青铜/白银/黄金礼匣 and their keys. */
const Box = { Copper: 16, Silver: 17, Gold: 18, CopperKey: 19, SilverKey: 20, GoldKey: 21 };
/** 珠宝匣: gems and their weights, and the value to fill. */
const GEM_BOXES: Record<number, { gems: [number, number][]; value: number }> = {
  41: {
    gems: [
      [30, 9],
      [31, 8],
      [32, 7],
    ],
    value: 80,
  },
  42: {
    gems: [
      [33, 12],
      [34, 10],
      [35, 8],
    ],
    value: 140,
  },
  43: {
    gems: [
      [36, 15],
      [37, 10],
      [38, 5],
    ],
    value: 240,
  },
};
/** 金条 / 金砖: gold per bar; at most 50 bars a time, and all of them are opened. */
const GOLD_BARS: Record<number, number> = { 85: 100000, 86: 1000000 };
const GOLD_BAR_LIMIT = 50;
/** 辎重包 / 辎重匣: resource type (2 food .. 5 iron) and amount per pack. */
const RES_BOXES: Record<number, [number, number]> = {
  87: [2, 100000],
  88: [3, 100000],
  89: [4, 100000],
  90: [5, 100000],
  91: [2, 1000000],
  92: [3, 1000000],
  93: [4, 1000000],
  94: [5, 1000000],
};
const RES_GAIN = ['', 'gain_gold', 'gain_food', 'gain_wood', 'gain_rock', 'gain_iron'];
/** The gid standing for each resource type in box results (none for type 0). */
const RES_GIDS = [0, 85, 87, 88, 89, 90];
/** 新手礼包 that complete a growth task when opened. */
const PACK_TASKS: Record<number, number> = {
  50104: 420526,
  50106: 420527,
  50108: 420528,
  50110: 420529,
};
/** 盟主令 (useMenzhulin): raises the union member cap. */
const MENGZHULING_GID = 15;
/** 武器架 (addArmorShelf): +5 / +50 equipment slots, capped at 500 (achievement 36). */
const ARMOR_SHELF_GID = 145;
const ARMOR_SHELF_ADV_GID = 146;
const ARMOR_COLUMN_MAX = 500;
const ARMOR_COLUMN_ACHIEVEMENT = 36;

/** utils.php::isSentGood: items whose drop from a 礼匣 is announced. */
const ANNOUNCED_GIDS = new Set([
  10, 12, 17, 18, 20, 21, 25, 26, 40, 52, 56, 71, 72, 82, 97, 100, 115, 117, 120, 202, 203, 204,
  205, 207, 212, 213, 214,
]);

/** A drop candidate: `gid`, weight `rate` and `value`. */
type DropRate = Row;

/**
 * Items useGoods handles in a branch of their own that is not ported yet (迁城令, 免战牌, 盟主令,
 * gear and hero boxes, 武魂, skill books, event items ...); everything else opens as a default
 * box.
 */
const OWN_USE_GIDS = new Set([
  -100, 12, 14, 15, 50, 119, 121, 122, 145, 146, 147, 150, 153, 156, 158, 161501, 164, 200, 250,
  1015, 1016, 10013, 10016, 10017, 10072, 10215, 10303, 10304, 10308, 10314, 10417, 10428, 10487,
  10816, 10931, 10996, 11078, 11227, 11228, 12051, 95, 96, 97, 8893, 8894,
]);
const OWN_USE_RANGES: [number, number][] = [
  [40001, 49999],
  [19061, 19063],
  [10932, 10937],
  [11021, 11022],
  [10957, 10959],
  [101, 112],
  [110001, 159999],
  [251, 254],
  [10001, 10012],
  [10018, 10024],
  [210001, 249999],
  [200000, 210000],
  [8887, 8892],
];
const hasOwnUse = (gid: number) =>
  OWN_USE_GIDS.has(gid) || OWN_USE_RANGES.some(([min, max]) => gid >= min && gid <= max);

const isNewbiePack = (gid: number) =>
  (gid >= 50101 && gid <= 50110) || (gid >= 1000001 && gid <= 1000010);
const isGiftPack = (gid: number) => gid >= 50000 && gid <= 60000;

/**
 * GoodsFunc.php: the 宝物 list, selling, and using items. Of useGoods the packs, 礼匣, 珠宝匣,
 * 金条, 辎重, the BufferGoods items and default boxes are ported; the items with a use of their
 * own still answer 此功能尚未开放.
 */
@Injectable()
export class GoodsCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly rewards: TaskRewards,
    private readonly cityRules: CityRules,
    private readonly taskRules: TaskRules,
    private readonly users: UserRules,
    private readonly ownership: OwnershipService,
    private readonly random: RandomService,
    private readonly buffers: BufferGoods,
    private readonly defaultBox: DefaultBoxService,
  ) {}

  /** `[goods, things]` the player owns, in cfg order. */
  @GlobalCommand()
  async loadUserGoods(ctx: CommandContext): Promise<Row[][]> {
    const uid = ctx.uid;
    return [
      await this.rows(sql`select * from sys_goods g join cfg_goods f on f.gid = g.gid
        where g.uid = ${uid} and g.count > 0 order by f.group, f.gid`),
      await this.rows(sql`select * from sys_things t join cfg_things f
          on f.tid = t.tid and t.tid not in (${HIDDEN_THING})
        where t.uid = ${uid} and t.count > 0 order by f.position`),
    ];
  }

  /**
   * `[cid, gid, count]`: sells items for 500 gold per point of value into a city with a market
   * of level 5. The original took the gold to any city; only the player's own are accepted.
   */
  @GlobalCommand()
  async sellGoods(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const cid = phpIntval(param[0]);
    const gid = phpIntval(param[1]);
    const count = phpIntval(param[2]);
    if (gid === 160052) throw GameError.lang('sellGoods.not_for_sell');
    await this.ownership.checkCityExist(cid, uid);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const level = await this.cell(sql`select level from sys_building
        where cid = ${cid} and bid = ${Building.Market}`);
      if (phpNum(level) < 5) throw GameError.lang('sellGoods.building_level');
      const nobility = await this.cell(sql`select nobility from sys_user where uid = ${uid}`);
      if ((await this.users.bufferNobility(uid, nobility)) < 1) {
        throw GameError.lang('sellGoods.nobility_low');
      }
      const value = phpIntval(await this.cell(sql`select value from cfg_goods where gid = ${gid}`));
      const mine = phpIntval(
        await this.cell(sql`select count from sys_goods
        where uid = ${uid} and gid = ${gid}`),
      );
      if (count <= 0 || mine < count) throw GameError.lang('sellGoods.not_enough_goods');
      await sql`update mem_city_resource set gold = gold + ${value * 500 * count}
        where cid = ${cid}`.execute(db);
      await this.goods.reduceGoods(uid, gid, count, LOG_SELL);
      return [
        (await this.row(sql`select * from sys_goods g left join cfg_goods f on f.gid = g.gid
          where g.uid = ${uid} and g.gid = ${gid}`)) ?? false,
        cid,
        await this.cell(sql`select gold from mem_city_resource where cid = ${cid}`),
      ];
    });
  }

  /** `[gid, count]`: uses items; answers `[gid, kind, ...]`. */
  @GlobalCommand()
  async useGoods(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const gid = phpIntval(param[0]);
    const useCount = Math.max(1, phpIntval(param[1]));
    if (useCount >= 100) throw GameError.raw('最高次数为99次！');
    const reply = await this.scope.transaction(async () => {
      const owned = await this.cell(sql`select count from sys_goods
        where uid = ${uid} and gid = ${gid}`);
      const cid = phpIntval(await this.cell(sql`select lastcid from sys_user where uid = ${uid}`));
      if (phpEmpty(owned)) {
        if (gid > 110000 && gid < 160000) throw GameError.lang('useGoods.no_this_wuhun');
        if (BUY_PROMPT_GIDS.has(gid)) throw GameError.raw(`not_enough_goods${gid}`);
        throw GameError.lang('useGoods.no_this_good');
      }
      if (useCount > 1 && (gid < 40000 || gid > 50000) && !MULTI_USE_GIDS.has(gid)) {
        throw GameError.raw('当前道具没有开启多开功能！');
      }
      const used = await this.use(uid, cid, gid, useCount);
      return used instanceof CommittedMessage ? used : [gid, ...used];
    });
    if (reply instanceof CommittedMessage) throw GameError.raw(reply.text);
    return reply;
  }

  private async use(
    uid: number,
    cid: number,
    gid: number,
    useCount: number,
  ): Promise<unknown[] | CommittedMessage> {
    const usedElsewhere = USED_ELSEWHERE[gid];
    if (usedElsewhere) throw GameError.lang(usedElsewhere);
    if (gid === Box.Copper || gid === Box.CopperKey) {
      return [UseReply.Items, await this.openLockedBox(uid, Box.Copper, Box.CopperKey)];
    }
    if (gid === Box.Silver || gid === Box.SilverKey) {
      return [UseReply.Items, await this.openLockedBox(uid, Box.Silver, Box.SilverKey)];
    }
    if (gid === Box.Gold || gid === Box.GoldKey) {
      return [UseReply.Items, await this.openLockedBox(uid, Box.Gold, Box.GoldKey)];
    }
    if (GEM_BOXES[gid]) return [UseReply.Items, await this.openGemBox(uid, gid)];
    if (GOLD_BARS[gid]) return [UseReply.Message, await this.openGoldBar(uid, cid, gid, useCount)];
    if (RES_BOXES[gid]) return [UseReply.Message, await this.openResBox(uid, cid, gid, useCount)];
    if (this.buffers.handles(gid)) return this.buffers.use(uid, cid, gid, useCount);
    if (isNewbiePack(gid)) {
      const needLevel = gid >= 1000001 ? gid - 1000000 : gid - 50100;
      const government = await this.cell(sql`select max(b.level) as level
        from sys_building b, sys_city c where b.cid = c.cid and c.uid = ${uid} and b.bid = ${Building.Government}`);
      if (phpNum(government) < needLevel) {
        const name = await this.cell(sql`select name from cfg_goods where gid = ${gid} limit 1`);
        throw GameError.lang('useGiftGoods.govenment_lessThen_needlevel', needLevel, name);
      }
      const items = await this.openDynamicBox(uid, gid);
      const task = PACK_TASKS[gid];
      if (task) await this.taskRules.completeTaskWithTaskid(uid, task);
      return [UseReply.Items, items];
    }
    if (EXPIRED_GIDS.has(gid) || (gid >= 10035 && gid <= 10056)) {
      throw GameError.raw('这个道具已过期');
    }
    if (isGiftPack(gid)) return [UseReply.Items, await this.openDynamicBox(uid, gid)];
    if (gid === MENGZHULING_GID) {
      await this.useMenzhulin(uid);
      return [UseReply.Message, this.lang.t('useGoods.use_MengZhuLing_succ')];
    }
    if (gid === ARMOR_SHELF_GID || gid === ARMOR_SHELF_ADV_GID) {
      const count = await this.addArmorShelf(uid, gid);
      return [UseReply.Message, this.lang.t('goods.armor_column_add', count)];
    }
    if (hasOwnUse(gid)) throw GameError.lang('useGoods.func_not_in_use');
    const opened = await this.defaultBox.open(uid, cid, gid);
    return opened instanceof CommittedMessage ? opened : [UseReply.Items, opened];
  }

  /** openDynamicBox: a cfg_pack_goods pack of resources, items, 礼金, things and gear. */
  private async openDynamicBox(uid: number, gid: number): Promise<unknown[]> {
    const pack = await this.row(sql`select * from cfg_pack_goods where gid = ${gid}`);
    if (!pack) throw GameError.lang('useGoods.no_pack_good');
    const owned = await this.cell(sql`select count from sys_goods
      where uid = ${uid} and gid = ${gid}`);
    if (phpEmpty(owned) || phpIntval(owned) < 1) throw GameError.lang('duihuan.not_enogh');
    await this.goods.reduceGoods(uid, gid, 1);

    const ret: unknown[] = [];
    const res = String(pack.res ?? '');
    if (res !== '') {
      const list = res.split(',');
      const cid = await this.cell(sql`select lastcid from sys_user where uid = ${uid}`);
      for (let type = 1; type <= 5; type++) {
        const count = list[type - 1];
        if (phpNum(count) === 0) continue;
        await this.rewards.giveResource(uid, cid, type, phpNum(count));
        ret.push(this.resourceItem(type, count));
      }
    }

    let gift = 0;
    for (const [id, count] of pairs(pack.goods)) {
      if (phpNum(id) === 0) {
        gift += phpNum(count);
        ret.push({
          name: this.lang.t('sys.LiJin'),
          count,
          gid: 0,
          description: this.lang.t('sys.description_of_LiJin'),
          imagetype: 0,
          image: 0,
        });
      } else {
        await this.goods.addGoods(uid, phpIntval(id), phpIntval(count), LOG_PACK_GOODS);
        ret.push(await this.row(sql`select *, ${count} as count from cfg_goods where gid = ${id}`));
      }
    }
    for (const [tid, count] of pairs(pack.things)) {
      await this.goods.addThings(uid, phpIntval(tid), phpIntval(count), LOG_PACK_THINGS);
      ret.push(
        await this.row(sql`select *, 2 as gtype, ${count} as count from cfg_things
          where tid = ${tid}`),
      );
    }
    for (const [aid, count] of pairs(pack.armor)) {
      const armor = (await this.row(sql`select * from cfg_armor where id = ${aid}`)) ?? {};
      ret.push({ ...armor, cnt: count, gtype: 1, hp: armor.ori_hp_max, hp_max: armor.ori_hp_max });
      await this.rewards.addArmor(uid, phpIntval(aid), phpIntval(count), LOG_BOX);
    }
    if (gift > 0) await this.rewards.addGift(uid, gift, LOG_BOX);
    return ret;
  }

  private resourceItem(type: number, count: unknown): Row {
    const name = this.lang.t(`resPackage.res_${type}`);
    return { name, count, gid: RES_GIDS[type], description: name, imagetype: 0, image: 0 };
  }

  /** useCopperBox / useSilverBox / useGoldBox: a 礼匣 needs its key; 1 in 100 opens a better one. */
  private async openLockedBox(uid: number, box: number, key: number): Promise<unknown[]> {
    const errors = {
      [Box.Copper]: ['useCopperBox.no_CopperBox', 'useCopperBox.no_CopperKey'],
      [Box.Silver]: ['useSilverBox.no_SiverBox', 'useSilverBox.no_SiverKey'],
      [Box.Gold]: ['useGoldBox.no_GoldBox', 'useGoldBox.no_GoldKey'],
    }[box]!;
    if (!(await this.goods.checkGoods(uid, box))) throw GameError.lang(errors[0]!);
    if (!(await this.goods.checkGoods(uid, key))) throw GameError.lang(errors[1]!);
    let ret: unknown[];
    if (box === Box.Copper) {
      ret =
        this.random.rand() % 100 === 0
          ? await this.openSilverBox(uid, 0)
          : await this.openCopperBox(uid);
    } else if (box === Box.Silver) {
      ret =
        this.random.rand() % 100 === 0
          ? await this.openGoldBox(uid)
          : await this.openSilverBox(uid, 1);
    } else {
      ret = await this.openGoldBox(uid);
    }
    await this.goods.reduceGoods(uid, box, 1);
    await this.goods.reduceGoods(uid, key, 1);
    return ret;
  }

  private async openCopperBox(uid: number): Promise<unknown[]> {
    const value = this.valueRand(21, 30, 31, 35, 15, 20, 36, 60);
    return this.openTreasureBox(uid, value, await this.dropRates('copperbox', value), 0);
  }

  private async openSilverBox(uid: number, type: number): Promise<unknown[]> {
    const value = this.valueRand(121, 180, 181, 210, 90, 120, 211, 360);
    return this.openTreasureBox(uid, value, await this.dropRates('silverbox', value), type);
  }

  private async openGoldBox(uid: number): Promise<unknown[]> {
    const value = this.valueRand(321, 480, 481, 560, 240, 320, 561, 960);
    return this.openTreasureBox(uid, value, await this.dropRates('goldbox', value), 2);
  }

  private dropRates(column: string, value: number): Promise<DropRate[]> {
    return this.rows(sql`select gid, ${sql.ref(column)} as rate, value from cfg_goods
      where inuse = 1 and ${sql.ref(column)} > 0 and value > 0 and value <= ${value}
      order by rand()`);
  }

  /** getValueRand: one of four ranges, picked 65 / 15 / 15 / 5 percent of the time. */
  private valueRand(...ranges: number[]): number {
    const rnd = this.random.rand() % 100;
    const i = rnd < 65 ? 0 : rnd < 80 ? 1 : rnd < 95 ? 2 : 3;
    return this.random.mtRand(ranges[i * 2]!, ranges[i * 2 + 1]!);
  }

  /**
   * openTreasureBox: draws up to nine items worth `totalValue` in all; the silver and gold
   * boxes pay part of what is left as 礼金, and rare drops are announced.
   */
  private async openTreasureBox(
    uid: number,
    totalValue: number,
    rates: DropRate[],
    type: number,
  ): Promise<unknown[]> {
    const got = await this.drawGoods(totalValue, rates, 9, 50, (max) =>
      this.randomUpTo(Math.ceil(max / 2)),
    );
    let left = got.left;
    if (left > 0 && type > 0) {
      if (type === 1 && left > 10) left = this.random.mtRand(1, 10);
      else if (type === 2 && left > 25) left = this.random.mtRand(1, 25);
      await this.rewards.addGift(uid, left, LOG_BOX_GIFT);
      got.goods.push([0, left]);
    }
    const ret: unknown[] = [];
    const announced: string[] = [];
    let announcedValue = 0;
    for (const [gid, count] of got.goods) {
      if (gid > 0) await this.goods.addGoods(uid, gid, count, LOG_BOX);
      const item = await this.row(sql`select *, ${count} as count, value from cfg_goods
        where gid = ${gid}`);
      if (item && ANNOUNCED_GIDS.has(phpIntval(item.gid))) {
        announced.push(`“${String(item.name)}”${count}`);
        announcedValue += phpNum(item.value) * count;
      }
      ret.push(item ?? false);
    }
    if (announced.length > 0) {
      await this.announceBox(uid, type + Box.Copper, announced, announcedValue);
    }
    return ret;
  }

  /** utils.php::sendOpenBoxInform */
  private async announceBox(
    uid: number,
    box: number,
    names: string[],
    value: number,
  ): Promise<void> {
    const name = await this.cell(sql`select name from sys_user where uid = ${uid}`);
    const boxName = await this.cell(sql`select name from cfg_goods where gid = ${box}`);
    const all = names.map((n) => `${n} `).join('');
    await this.users.sendSysInform({
      type: 0,
      inuse: 1,
      starttime: 0,
      endtime: 600,
      interval: 50000,
      scrollcount: 1,
      color: 49151,
      msg: this.lang.t('open_box.msg', name, boxName, all, value),
    });
  }

  /** openGemBox: up to three gems worth the box's value. */
  private async openGemBox(uid: number, gid: number): Promise<unknown[]> {
    const box = GEM_BOXES[gid]!;
    const rates: DropRate[] = [];
    for (const [gem, rate] of box.gems) {
      const value = await this.cell(sql`select value from cfg_goods where gid = ${gem}`);
      rates.push({ gid: gem, value, rate });
    }
    const got = await this.drawGoods(box.value, rates, 3, 20, (max) => this.randomUpTo(max));
    const ret: unknown[] = [];
    for (const [gem, count] of got.goods) {
      await this.goods.addGoods(uid, gem, count, LOG_BOX);
      ret.push(await this.row(sql`select *, ${count} as count from cfg_goods where gid = ${gem}`));
    }
    await this.goods.reduceGoods(uid, gid, 1);
    return ret;
  }

  /**
   * The weighted draw of openTreasureBox / openGemBox: each pick takes an item off the list,
   * once, with a count from `countOf(max affordable)` (1 for items of weight 5 or less).
   */
  private async drawGoods(
    totalValue: number,
    rates: DropRate[],
    drops: number,
    tries: number,
    countOf: (max: number) => number,
  ): Promise<{ goods: [number, number][]; left: number }> {
    const list = [...rates];
    const goods = new Map<number, number>();
    let left = totalValue;
    while (left > 0 && drops > 0 && list.length > 0 && tries > 0) {
      const all = list.reduce((sum, r) => sum + phpNum(r.rate), 0);
      const rnd = this.random.rand() % all;
      let sum = 0;
      tries--;
      for (let i = 0; i < list.length; i++) {
        const item = list[i]!;
        sum += phpNum(item.rate);
        if (rnd < sum) {
          const max = Math.floor(left / phpNum(item.value));
          const count = phpNum(item.rate) <= 5 ? 1 : countOf(max);
          if (count > 0 && max > 0) {
            goods.set(phpIntval(item.gid), count);
            left -= phpNum(item.value) * count;
            drops--;
            list.splice(i, 1);
            break;
          }
        }
      }
    }
    return { goods: [...goods], left };
  }

  /** `mt_rand(1, max)`; PHP 5 answers 1 when max is below 1. */
  private randomUpTo(max: number): number {
    return max >= 1 ? this.random.mtRand(1, max) : 1;
  }

  /** openGoldBar: opens every bar owned, up to 50, whatever count was asked for. */
  private async openGoldBar(
    uid: number,
    cid: number,
    gid: number,
    useCount: number,
  ): Promise<string> {
    const owned = await this.cell(sql`select count from sys_goods
      where uid = ${uid} and gid = ${gid}`);
    if (phpEmpty(owned) || phpIntval(owned) < useCount) throw GameError.lang('duihuan.not_enogh');
    const count = Math.min(phpIntval(owned), GOLD_BAR_LIMIT);
    const gold = GOLD_BARS[gid]! * count;
    await this.cityRules.addCityResources(cid, 0, 0, 0, 0, gold);
    await this.goods.reduceGoods(uid, gid, count);
    return this.lang.t('resPackage.gain_gold', gold);
  }

  /** openResBox */
  private async openResBox(
    uid: number,
    cid: number,
    gid: number,
    useCount: number,
  ): Promise<string> {
    const owned = await this.cell(sql`select count from sys_goods
      where uid = ${uid} and gid = ${gid}`);
    if (phpEmpty(owned) || phpIntval(owned) < useCount) throw GameError.lang('duihuan.not_enogh');
    const [type, each] = RES_BOXES[gid]!;
    const amount = each * useCount;
    const add = [0, 0, 0, 0];
    add[[0, 0, 3, 0, 1, 2][type]!] = amount;
    await this.cityRules.addCityResources(cid, add[0]!, add[1]!, add[2]!, add[3]!, 0);
    await this.goods.reduceGoods(uid, gid, useCount);
    return this.lang.t(`resPackage.${RES_GAIN[type]}`, amount);
  }

  /**
   * GoodsFunc.php::useMenzhulin (盟主令, gid 15): raises the member cap of the player's union
   * (chieforder = 1). Needs a union that exists and has not used one yet.
   */
  private async useMenzhulin(uid: number): Promise<void> {
    const db = this.scope.db;
    if (!(await this.goods.checkGoods(uid, MENGZHULING_GID))) {
      throw GameError.raw(`not_enough_goods${MENGZHULING_GID}`);
    }
    const unionId = phpIntval(
      await this.cell(sql`select union_id from sys_user where uid = ${uid}`),
    );
    if (unionId === 0) throw GameError.lang('useMenzhulin.not_join_union');
    const union = await this.row(sql`select * from sys_union where id = ${unionId}`);
    if (!union) throw GameError.lang('useMenzhulin.union_not_exist');
    if (!phpLooseEquals(union.chieforder, 0)) throw GameError.lang('useMenzhulin.already_used');
    await sql`update sys_union set chieforder = 1 where id = ${unionId}`.execute(db);
    await this.goods.reduceGoods(uid, MENGZHULING_GID, 1);
  }

  /**
   * GoodsFunc.php::addArmorShelf (武器架, gid 145 = +5, 146 = +50): widens the player's equipment
   * bag up to 500 slots; reaching 500 completes achievement 36. Answers the new slot count.
   */
  async addArmorShelf(uid: number, gid: number): Promise<number> {
    const db = this.scope.db;
    const count = phpIntval(
      await this.cell(sql`select armor_column from sys_user where uid = ${uid}`),
    );
    if (count >= ARMOR_COLUMN_MAX) throw GameError.lang('goods.armor_column_full');
    const goods = await this.row(sql`select * from sys_goods where uid = ${uid} and gid = ${gid}`);
    if (!goods || phpNum(goods.count) <= 0) throw GameError.raw(`not_enough_goods${gid}`);
    const add = gid === ARMOR_SHELF_GID ? 5 : gid === ARMOR_SHELF_ADV_GID ? 50 : 0;
    const target = Math.min(count + add, ARMOR_COLUMN_MAX);
    if (target === ARMOR_COLUMN_MAX) {
      await this.rewards.finishAchievement(uid, ARMOR_COLUMN_ACHIEVEMENT);
    }
    await sql`update sys_user set armor_column = ${target} where uid = ${uid}`.execute(db);
    await this.goods.addGoods(uid, gid, -1, 0);
    return target;
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

/** A cfg_pack_goods list `n,id1,count1,...,idn,countn` as its n pairs. */
function pairs(list: unknown): [string, string][] {
  const parts = String(list ?? '').split(',');
  const n = phpIntval(parts[0]);
  const out: [string, string][] = [];
  for (let i = 1; i < n * 2; i += 2) out.push([parts[i] ?? '', parts[i + 1] ?? '']);
  return out;
}
