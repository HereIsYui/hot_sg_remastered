import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpNum } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { makeTimeLeft, UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import type { Row } from '../task/task-goals.service';
import { TaskRewards } from '../task/task-rewards.service';

const DAY = 86400;

/** The useGoods reply kinds of these items: a message, an end time, or a raised nobility. */
const Reply = { Message: 0, EndTime: 2, GaojiTuiEn: 4, TuiEn: 5 } as const;

/**
 * 神农锄 / 鲁班斧 / 开山锤 / 玄铁炉 and their 高级 versions: the production column raised by 25%,
 * the buffer, the bonus resource (addCityResources order wood, rock, iron, food, gold), the
 * growth task of the basic one and the end time message.
 */
const PRODUCTION: Record<
  number,
  { column: string; buftype: number; res: number; task: number; msg: string }
> = {
  2: { column: 'goods_food_add', buftype: 1, res: 3, task: 320, msg: 'ShenNongChu_valid_date' },
  3: { column: 'goods_wood_add', buftype: 2, res: 0, task: 321, msg: 'LuBanFu_valid_date' },
  4: { column: 'goods_rock_add', buftype: 3, res: 1, task: 322, msg: 'KaiShanCui_valid_date' },
  5: { column: 'goods_iron_add', buftype: 4, res: 2, task: 323, msg: 'XuanTieLu_valid_date' },
};
/** The 高级 versions: seven days and ten times the bonus. */
const ADVANCED_PRODUCTION: Record<number, number> = { 44: 2, 45: 3, 46: 4, 47: 5 };

const Buf = {
  XianZhen: 5,
  BaGua: 6,
  QingNang: 9,
  QingCang: 10,
  YaoYi: 11,
  KaoGong: 12,
  ShuiLi: 15,
  GaojiTuiEn: 16,
  ShangDui: 17,
  TuiEn: 18,
  JunLing: 19,
  QiuXian: 22,
  XunCha: 100,
  StrongXianZhen: 10084,
  StrongQingNang: 10083,
  StrongBaGua: 10085,
  GaojiYaoYi: 166,
  GaojiQingNang: 165,
  MuBing: 10321,
  ZhaoAn: 10333,
} as const;
const CITY_BUF_CONSTRUCTION_PLAN = 10001;

const Task = {
  XianZhen: 304,
  BaGua: 305,
  TuiEn: 306,
  YaoYi: 307,
  DianMin: 308,
  AnMin: 309,
  ShuiLi: 324,
};
const ACTION_YAOYI = 18;
const ACHIEVEMENT_YAOYI = 8;
const YAOYI_ACHIEVEMENT_COUNT = 20;
const ANMIN_COOLDOWN = 259200;
/** sys_city.type of an ordinary city; 5 counts as one too. */
const isOrdinaryCity = (type: number) => type === 0 || type === 5;

/** Gids handled here. */
const BUFFER_GIDS = new Set([
  2, 3, 4, 5, 44, 45, 46, 47, 6, 48, 7, 49, 10085, 25, 165, 51, 54, 55, 56, 166, 10321, 133, 117,
  124, 120, 57, 139, 142, 58, 60, 61, 62, 134, 138, 154, 10333, 10158,
]);

/**
 * GoodsFunc.php: the items that add a timed effect (mem_user_buffer) or act on the player's
 * last city at once — production, attack and defence buffs, 青囊书, 徭役令, 推恩令, 典民令,
 * 安民告示, 赦免文书, 请战书 and the like.
 */
@Injectable()
export class BufferGoods {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly cityRules: CityRules,
    private readonly taskRules: TaskRules,
    private readonly users: UserRules,
    private readonly rewards: TaskRewards,
  ) {}

  handles(gid: number): boolean {
    return BUFFER_GIDS.has(gid);
  }

  /** The useGoods reply after the gid: `[kind, ...]`. */
  async use(uid: number, cid: number, gid: number, useCount: number): Promise<unknown[]> {
    const production = PRODUCTION[gid] ?? PRODUCTION[ADVANCED_PRODUCTION[gid] ?? 0];
    if (production) {
      const endtime = await this.useProduction(uid, gid, useCount);
      return this.endTime(production.msg, endtime);
    }
    switch (gid) {
      case 6:
      case 48:
        return this.endTime('XianZhenZhaoGu_valid_date', await this.useXianZhenZhaoGu(uid, gid));
      case 7:
      case 49:
      case 10085: {
        const endtime = await this.useBaGuaZhenTu(uid, gid, useCount);
        return this.endTime(
          gid === 10085 ? 'BaGuaZhenTu_qiang_date' : 'BaGuaZhenTu_valid_date',
          endtime,
        );
      }
      case 25:
      case 165: {
        const endtime = await this.useQingNangShu(uid, gid, useCount);
        return this.endTime(
          gid === 25 ? 'QingNangShu_valid_date' : 'QingNangShu_valid_date_2',
          endtime,
        );
      }
      case 51:
        await this.requireGoods(uid, gid, 'useGoods.no_this_good');
        return this.endTime(
          'QingCangLing_valid_date',
          await this.addBuffer(uid, Buf.QingCang, 7 * DAY, gid),
        );
      case 54:
      case 55:
        return this.endTime('ShuiLiBian_valid_date', await this.useShuiLiBian(uid, gid));
      case 56:
      case 166: {
        const endtime = await this.useYaoYiLin(uid, gid, gid === 56 ? 1 : useCount);
        return this.endTime(gid === 56 ? 'YaoYiLin_valid_date' : 'YaoYiLin_valid_date_2', endtime);
      }
      case 10321: {
        await this.requireGoods(uid, gid);
        const endtime = await this.addBuffer(uid, Buf.MuBing, DAY, gid);
        await this.users.logUserAction(uid, Buf.MuBing);
        return [Reply.EndTime, this.lang.tOrNull('useGoods.MuBingLing_valid_date'), endtime];
      }
      case 133:
        await this.requireGoods(uid, gid);
        return this.endTime(
          'Junlingzhuang_valid_date',
          await this.addBuffer(uid, Buf.JunLing, DAY, gid, 3),
        );
      case 117: {
        const [nobility, left] = await this.useTuiEnLing(uid, gid);
        return [Reply.GaojiTuiEn, phpIntval(left), nobility];
      }
      case 124: {
        const [nobility, left] = await this.useTuiEnLing(uid, gid);
        return [Reply.TuiEn, phpIntval(left), nobility];
      }
      case 120:
        await this.requireGoods(uid, gid, 'useGoods.no_this_good');
        return this.endTime(
          'ShangDuiQiYue_valid_date',
          await this.addBuffer(uid, Buf.ShangDui, 3 * DAY, gid, 0),
        );
      case 57:
        return [Reply.Message, await this.addPeople(uid, cid, gid)];
      case 139:
        return [Reply.Message, await this.addPeople(uid, cid, gid)];
      case 142:
        await this.requireGoods(uid, gid);
        return this.endTime('xuncha_valid_date', await this.useXunChaLin(uid));
      case 58:
        return [Reply.Message, await this.useAnMingGaoShi(uid, cid)];
      case 60:
      case 61:
      case 62: {
        await this.requireGoods(uid, gid);
        const endtime = await this.addBuffer(uid, Buf.KaoGong + gid - 60, DAY, gid);
        const name = await this.cell(sql`select name from cfg_goods where gid = ${gid}`);
        return [Reply.EndTime, this.lang.t('useGoods.KaoGongJi_valid_date', name), endtime];
      }
      case 134:
        return [Reply.Message, await this.useSheMianWenShu(uid)];
      case 138:
        return [Reply.Message, await this.useQingZhanShu(uid)];
      case 154:
        await this.requireGoods(uid, gid);
        return this.endTime(
          'QiuXianZhao_valid_date',
          await this.addBuffer(uid, Buf.QiuXian, 7 * DAY, gid),
        );
      case 10333: {
        await this.requireCount(uid, gid, useCount);
        const add = DAY * useCount;
        await sql`insert into mem_user_buffer (uid, buftype, bufparam, endtime)
          values (${uid}, ${Buf.ZhaoAn}, 0, unix_timestamp() + ${add})
          on duplicate key update endtime = endtime + ${DAY}`.execute(this.scope.db);
        await this.goods.reduceGoods(uid, gid, useCount);
        return this.endTime('ZhaoAnLing_valid_date', await this.bufferEnd(uid, Buf.ZhaoAn));
      }
      case 10158:
        return this.endTime(
          'AdvancedConstructionPlan',
          await this.useConstructionPlan(uid, cid, gid),
        );
    }
    throw new Error(`BufferGoods.use(${gid})`);
  }

  private endTime(msg: string, endtime: unknown): unknown[] {
    return [Reply.EndTime, this.lang.t(`useGoods.${msg}`), phpIntval(endtime)];
  }

  /** useShenNongChu / useLuBanFu / useKaiShanCui / useXuanTieLu */
  private async useProduction(uid: number, gid: number, useCount: number): Promise<unknown> {
    const advanced = ADVANCED_PRODUCTION[gid] !== undefined;
    const p = PRODUCTION[advanced ? ADVANCED_PRODUCTION[gid]! : gid]!;
    const delay = (advanced ? 7 * DAY : DAY) * useCount;
    await this.requireCount(uid, gid, useCount);
    const db = this.scope.db;
    await sql`update sys_city_res_add a, sys_city c set a.${sql.ref(p.column)} = 25,
        a.resource_changing = 1
      where c.uid = ${uid} and a.cid = c.cid`.execute(db);
    await this.insertBuffer(uid, p.buftype, delay);
    await this.goods.reduceGoods(uid, gid, useCount);
    const cid = phpIntval(await this.cell(sql`select lastcid from sys_user where uid = ${uid}`));
    if (!advanced) await this.taskRules.completeTaskWithTaskid(uid, p.task);
    const res = [0, 0, 0, 0, 0];
    res[p.res] = advanced ? 5000 : 500;
    await this.cityRules.addCityResources(cid, res[0]!, res[1]!, res[2]!, res[3]!, res[4]!);
    return this.bufferEnd(uid, p.buftype);
  }

  /** useXianZhenZhaoGu: one at a time, whatever the count asked for. */
  private async useXianZhenZhaoGu(uid: number, gid: number): Promise<unknown> {
    const delay = gid === 48 ? 7 * DAY : DAY;
    if (!(await this.goods.checkGoods(uid, gid))) {
      const name = this.lang.t(
        gid === 48
          ? 'useXianZhenZhaoGu.advanced_XianZhenZhaoGu'
          : 'useXianZhenZhaoGu.XianZhenZhaoGu',
      );
      throw GameError.lang('useXianZhenZhaoGu.no_XianZhenZhaoGu', name);
    }
    if (await this.hasBuffer(uid, Buf.StrongXianZhen)) {
      throw GameError.lang('useXianZhenZhaoGu.nouse_XianZhenZhaoGu');
    }
    await this.insertBuffer(uid, Buf.XianZhen, delay);
    await this.goods.reduceGoods(uid, gid, 1);
    if (gid === 6) await this.taskRules.completeTaskWithTaskid(uid, Task.XianZhen);
    return this.bufferEnd(uid, Buf.XianZhen);
  }

  /** useBaGuaZhenTu: 八卦阵图 and the hour-long 强八卦阵图 exclude each other. */
  private async useBaGuaZhenTu(uid: number, gid: number, useCount: number): Promise<unknown> {
    const strong = gid === 10085;
    const buftype = strong ? Buf.StrongBaGua : Buf.BaGua;
    const delay = (gid === 49 ? 7 * DAY : strong ? DAY / 24 : DAY) * useCount;
    await this.requireCount(uid, gid, useCount);
    if (await this.hasBuffer(uid, strong ? Buf.BaGua : Buf.StrongBaGua)) {
      throw GameError.lang('useBaGuaZhenTu.nouse_BaGuaZhenTu');
    }
    await this.insertBuffer(uid, buftype, delay);
    await this.goods.reduceGoods(uid, gid, useCount);
    if (gid === 7) await this.taskRules.completeTaskWithTaskid(uid, Task.BaGua);
    return this.bufferEnd(uid, buftype);
  }

  /** useQingNangShu */
  private async useQingNangShu(uid: number, gid: number, useCount: number): Promise<unknown> {
    await this.requireCount(uid, gid, useCount);
    const buftype = gid === 25 ? Buf.QingNang : Buf.GaojiQingNang;
    if (await this.hasBuffer(uid, Buf.StrongQingNang)) {
      throw GameError.lang('useQingNangShu.nouse_QingNangShu');
    }
    await this.insertBuffer(uid, buftype, DAY * useCount);
    await this.goods.reduceGoods(uid, gid, useCount);
    return this.bufferEnd(uid, buftype);
  }

  /** useShuiLiBian: every city's gold rate goes to 125%. */
  private async useShuiLiBian(uid: number, gid: number): Promise<unknown> {
    const delay = gid === 55 ? 7 * DAY : DAY;
    await this.requireGoods(uid, gid);
    await sql`update mem_city_resource m, sys_city c set m.gold_rate = 125
      where c.uid = ${uid} and m.cid = c.cid`.execute(this.scope.db);
    await this.insertBuffer(uid, Buf.ShuiLi, delay);
    await this.goods.reduceGoods(uid, gid, 1);
    const cid = phpIntval(await this.cell(sql`select lastcid from sys_user where uid = ${uid}`));
    if (gid === 54) await this.taskRules.completeTaskWithTaskid(uid, Task.ShuiLi);
    await this.cityRules.addCityResources(cid, 0, 0, 0, 0, gid === 54 ? 500 : 5000);
    return this.bufferEnd(uid, Buf.ShuiLi);
  }

  /** useYaoYiLinAll: a running one is extended by three days only, however many are used. */
  private async useYaoYiLin(uid: number, gid: number, useCount: number): Promise<unknown> {
    const buftype = gid === 56 ? Buf.YaoYi : Buf.GaojiYaoYi;
    await this.requireCount(uid, gid, useCount);
    await sql`insert into mem_user_buffer (uid, buftype, endtime)
      values (${uid}, ${buftype}, unix_timestamp() + ${3 * DAY * useCount})
      on duplicate key update endtime = endtime + ${3 * DAY}`.execute(this.scope.db);
    await this.goods.reduceGoods(uid, gid, useCount);
    await this.taskRules.completeTaskWithTaskid(uid, Task.YaoYi);
    await this.users.logUserAction(uid, ACTION_YAOYI);
    const count = await this.cell(sql`select count from log_action_count
      where uid = ${uid} and aid = ${ACTION_YAOYI}`);
    if (phpNum(count) >= YAOYI_ACHIEVEMENT_COUNT) {
      await this.rewards.finishAchievement(uid, ACHIEVEMENT_YAOYI);
    }
    return this.bufferEnd(uid, buftype);
  }

  /**
   * useGaojiTuiEnLing / useTuiEnLing: `[nobility shown, seconds left]`. A running one is
   * extended whatever the nobility.
   */
  private async useTuiEnLing(uid: number, gid: number): Promise<[number, unknown]> {
    const gaoji = gid === 117;
    const buftype = gaoji ? Buf.GaojiTuiEn : Buf.TuiEn;
    const delay = gaoji ? 10 * DAY : 3 * DAY;
    await this.requireGoods(uid, gid, 'useGoods.no_this_good');
    const nobility = await this.cell(sql`select nobility from sys_user where uid = ${uid}`);
    if (gaoji && phpNum(nobility) < 5) throw GameError.lang('gaojituienling.dafuyishang');
    const left = () =>
      this.cell(sql`select endtime - unix_timestamp() from mem_user_buffer
        where uid = ${uid} and buftype = ${buftype}`);
    const db = this.scope.db;
    if (!phpEmpty(await left())) {
      await sql`update mem_user_buffer set endtime = endtime + ${delay}
        where uid = ${uid} and buftype = ${buftype}`.execute(db);
    } else {
      if (phpNum(nobility) >= (gaoji ? 19 : 18)) {
        throw GameError.lang(gaoji ? 'userTuiEnling.guanneihou' : 'userTuiEnling.dashuzhang');
      }
      await sql`insert into mem_user_buffer (uid, buftype, bufparam, endtime)
        values (${uid}, ${buftype}, ${gaoji ? 5 : 2}, unix_timestamp() + ${delay})
        on duplicate key update endtime = endtime + ${delay}`.execute(db);
    }
    await this.goods.reduceGoods(uid, gid, 1);
    if (!gaoji) await this.taskRules.completeTaskWithTaskid(uid, Task.TuiEn);
    return [await this.users.bufferNobility(uid, nobility), await left()];
  }

  /** useDianMinLin (20% of the cap) / useTaiPingYaoShu (10%): at least 100 people. */
  private async addPeople(uid: number, cid: number, gid: number): Promise<string> {
    if (!(await this.goods.checkGoods(uid, gid))) {
      throw gid === 57
        ? GameError.raw(`not_enough_goods${gid}`)
        : GameError.lang('addPeople.no_taiping');
    }
    const owner = await this.cell(sql`select uid from sys_city where cid = ${cid}`);
    if (phpEmpty(owner) || phpNum(owner) !== uid) throw GameError.lang('addPeople.not_your_city');
    const city = await this.row(sql`select people, people_max from mem_city_resource
      where cid = ${cid}`);
    const peopleMax = phpNum(city?.people_max);
    if (phpNum(city?.people) >= peopleMax) throw GameError.lang('addPeople.city_full');
    const add = Math.max(100, Math.ceil(peopleMax * (gid === 57 ? 0.2 : 0.1)));
    await sql`update mem_city_resource set people = people + ${add}
      where cid = ${cid}`.execute(this.scope.db);
    await this.goods.reduceGoods(uid, gid, 1);
    if (gid === 57) await this.taskRules.completeTaskWithTaskid(uid, Task.DianMin);
    await this.cityRules.updateCityResourceAdd(cid);
    return this.lang.t('addPeople.succ', add);
  }

  /** useXunChaLin */
  private async useXunChaLin(uid: number): Promise<unknown> {
    const delay = 3 * DAY;
    await sql`insert into mem_user_buffer (uid, buftype, bufparam, endtime)
      values (${uid}, ${Buf.XunCha}, 0, unix_timestamp() + ${delay})
      on duplicate key update endtime = endtime + ${delay}, bufparam = 0`.execute(this.scope.db);
    await this.goods.reduceGoods(uid, 142, 1);
    return this.bufferEnd(uid, Buf.XunCha);
  }

  /** useAnMingGaoShi: once in 72 hours per city. */
  private async useAnMingGaoShi(uid: number, cid: number): Promise<string> {
    await this.requireGoods(uid, 58);
    const info = await this.row(sql`select last_anming, unix_timestamp() as nowtime
      from mem_city_schedule where cid = ${cid}`);
    const since = phpNum(info?.nowtime) - phpNum(info?.last_anming);
    if (!phpEmpty(info?.last_anming) && since < ANMIN_COOLDOWN) {
      throw GameError.lang(
        'useGoods.AnMingGaoShi_cool_down',
        makeTimeLeft(this.lang, ANMIN_COOLDOWN - since),
      );
    }
    const db = this.scope.db;
    await sql`update mem_city_resource set morale = 100, complaint = 0,
        morale_stable = 100 - tax, people_stable = people_max
      where cid = ${cid}`.execute(db);
    await sql`insert into mem_city_schedule (cid, last_anming) values (${cid}, unix_timestamp())
      on duplicate key update last_anming = unix_timestamp()`.execute(db);
    await this.goods.reduceGoods(uid, 58, 1);
    await this.taskRules.completeTaskWithTaskid(uid, Task.AnMin);
    return this.lang.t('useGoods.AnMingGaoShi_succ');
  }

  /** useSheMianWenShu: a negative battlefield honour back to 0. */
  private async useSheMianWenShu(uid: number): Promise<string> {
    await this.requireGoods(uid, 134, 'useGoods.no_this_good');
    const honour = await this.cell(sql`select honour from sys_user where uid = ${uid}`);
    if (phpNum(honour) >= 0) throw GameError.lang('useGoods.no_need_shemian');
    await sql`update sys_user set honour = 0 where honour < 0 and uid = ${uid}`.execute(
      this.scope.db,
    );
    await this.goods.reduceGoods(uid, 134, 1);
    return this.lang.t('useGoods.shemian_suc');
  }

  /** useQingZhanShu: today's story battlefield entries back to 0. */
  private async useQingZhanShu(uid: number): Promise<string> {
    const count = await this.cell(sql`select today_war_count from mem_user_schedule
      where uid = ${uid}`);
    if (phpEmpty(count) || phpNum(count) === 0) {
      throw GameError.lang('useGoods.today_war_count_zero');
    }
    await this.requireGoods(uid, 138);
    await sql`update mem_user_schedule set today_war_count = 0 where uid = ${uid}`.execute(
      this.scope.db,
    );
    await this.goods.reduceGoods(uid, 138, 1);
    return this.lang.t('useGoods.qingzhan_suc');
  }

  /** useAdvancedConstructionPlan: ordinary cities' fields open to level 12 for 12 hours. */
  private async useConstructionPlan(uid: number, cid: number, gid: number): Promise<unknown> {
    const delay = DAY / 2;
    await this.requireGoods(uid, gid);
    const type = phpIntval(await this.cell(sql`select type from sys_city where cid = ${cid}`));
    if (!isOrdinaryCity(type)) {
      throw GameError.lang('AdvancedConstructionPlan.cant_use_in_great_city');
    }
    await sql`insert into mem_city_buffer (cid, buftype, bufparam, endtime)
      values (${cid}, ${CITY_BUF_CONSTRUCTION_PLAN}, 0, unix_timestamp() + ${delay})
      on duplicate key update endtime = endtime + ${delay}`.execute(this.scope.db);
    const endtime = await this.cell(sql`select endtime from mem_city_buffer
      where cid = ${cid} and buftype = ${CITY_BUF_CONSTRUCTION_PLAN}`);
    await this.goods.reduceGoods(uid, gid, 1);
    return endtime;
  }

  /** checkGoods, failing with the buy prompt code unless another message is given. */
  private async requireGoods(uid: number, gid: number, message?: string): Promise<void> {
    if (await this.goods.checkGoods(uid, gid)) return;
    throw message ? GameError.lang(message) : GameError.raw(`not_enough_goods${gid}`);
  }

  private async requireCount(uid: number, gid: number, count: number): Promise<void> {
    const owned = await this.cell(sql`select count from sys_goods
      where uid = ${uid} and gid = ${gid}`);
    if (phpEmpty(owned) || phpIntval(owned) < count) throw GameError.lang('duihuan.not_enogh');
  }

  /** A buffer of `delay` seconds, added to one still running; reduces one item. */
  private async addBuffer(
    uid: number,
    buftype: number,
    delay: number,
    gid: number,
    bufparam?: number,
  ): Promise<unknown> {
    await this.insertBuffer(uid, buftype, delay, bufparam);
    await this.goods.reduceGoods(uid, gid, 1);
    return this.bufferEnd(uid, buftype);
  }

  private async insertBuffer(
    uid: number,
    buftype: number,
    delay: number,
    bufparam?: number,
  ): Promise<void> {
    const db = this.scope.db;
    if (bufparam === undefined) {
      await sql`insert into mem_user_buffer (uid, buftype, endtime)
        values (${uid}, ${buftype}, unix_timestamp() + ${delay})
        on duplicate key update endtime = endtime + ${delay}`.execute(db);
    } else {
      await sql`insert into mem_user_buffer (uid, buftype, bufparam, endtime)
        values (${uid}, ${buftype}, ${bufparam}, unix_timestamp() + ${delay})
        on duplicate key update endtime = endtime + ${delay}`.execute(db);
    }
  }

  private async hasBuffer(uid: number, buftype: number): Promise<boolean> {
    const n = await this.cell(sql`select count(1) from mem_user_buffer
      where uid = ${uid} and buftype = ${buftype}`);
    return phpNum(n) === 1;
  }

  private bufferEnd(uid: number, buftype: number): Promise<unknown> {
    return this.cell(sql`select endtime from mem_user_buffer
      where uid = ${uid} and buftype = ${buftype}`);
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
