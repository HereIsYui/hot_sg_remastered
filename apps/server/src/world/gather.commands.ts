import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { FieldCommands } from '../city/field.commands';
import { CityRules, cid2wid, wid2cid } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum } from '../core/php';
import { RandomService } from '../core/random.service';
import { ReportService } from '../core/report.service';
import { TaskRules } from '../core/task-rules.service';
import { makeTimeLeft } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { DefaultBoxService } from '../goods/default-box.service';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { TaskRewards } from '../task/task-rewards.service';

type Row = Record<string, unknown>;

/** Resources gathered per hour and per food eaten, by terrain (mem_world.type). */
const FIELD_RATE = [0, 0.06, 0.045, 0.09, 0.07, 0.035, 0.09, 0.08];
/** Weights of the treasures 30..38 (珍珠 … 夜明珠) found on each terrain 1..7. */
const GOODS_RATE = [
  [6, 7, 5, 5, 3, 4, 2, 2, 1],
  [2, 2, 10, 2, 6, 3, 3, 6, 1],
  [3, 4, 3, 10, 3, 5, 4, 2, 1],
  [3, 3, 8, 7, 3, 5, 2, 3, 1],
  [1, 1, 1, 1, 10, 10, 5, 5, 1],
  [15, 10, 1, 2, 1, 1, 1, 1, 3],
  [5, 6, 3, 4, 4, 2, 8, 1, 2],
];
/** gatherFieldResult.* name keys of what gathering can hand out. */
const GOODS_NAME: Record<number, string> = {
  30: 'ZhenZhu',
  31: 'ShanHu',
  32: 'LiuLi',
  33: 'HuPo',
  34: 'MaNao',
  35: 'ShuiJing',
  36: 'FeiCui',
  37: 'YuShi',
  38: 'YeMingZhu',
  50: 'GuPuMuHe',
  119: 'CangBaoHe',
  10014: 'XiangSiDou',
  10015: 'XiangSiYuDi',
  52: 'ShenBing',
  53: 'ShenJia',
  54: 'BingShu',
  55: 'LiangJu',
  56: 'MeiShi',
  57: 'MeiJiu',
  58: 'ShiSanQinRen',
  60: 'GuDaiQiPu',
  61: 'SiShuXianSheng',
  19062: 'shanyuezhanshu',
};
/** common.php FOOD/WOOD/ROCK/IRON_VALUE, indexed by the gathered resource type. */
const RES_VALUE = [0.1, 0.1, 0.2, 0.25];
const RES_KEY = ['food', 'wood', 'rock', 'iron'] as const;
/** 古朴木匣: the long-gather consolation, at most once per gather. */
const WOOD_BOX = 50;
const TREASURE_BOX = 119;
const SHANYUE_BOOK = 19062;
const NIGHT_PEARL = 38;
/** 采集高手: three 夜明珠 in one gather. */
const GATHER_ACHIEVEMENT = 3;
/** cfg_act types (and cfg_box_details.srctype) of the 寻宝 and 采集 events. */
const ACT_TREASURE_HUNT = { type: 2401, srctype: 2400 };
const ACT_GATHER = { type: 2301, srctype: 2300 };
/** sys_report.title of the 全部收获 report. */
const REPORT_GATHER = 33;
/** 名将好感度 public tasks whose item drops while gathering on a terrain: [task ids, gid]. */
const HERO_TASK_ITEMS: Record<number, [number[], number][]> = {
  5: [
    [[402, 502, 602, 702], 52],
    [[421, 521, 621, 721], 53],
  ],
  3: [[[404, 504, 604, 704], 54]],
  4: [
    [[408, 508, 608, 708], 55],
    [[410, 510, 610, 710], 56],
  ],
  2: [
    [[411, 511, 611, 711], 57],
    [[423, 523, 623, 723], 58],
  ],
  6: [
    [[425, 525, 625, 725], 60],
    [[426, 526, 626, 726], 61],
  ],
};

interface GatherInput {
  uid: number;
  cid: number;
  delta: number;
  fooduse: number;
  fieldtype: number;
  fieldlevel: number;
  heroLevel: number;
  heroid: number;
  wid: number;
  /** gatherEndAll's running field number, which skews its rolls; absent for a single field. */
  para?: number;
}

/** The 采集 commands of CityFunc.php (TroopDialog / TroopDetailDialog). */
@Injectable()
export class GatherCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly random: RandomService,
    private readonly cityRules: CityRules,
    private readonly heroRules: HeroRules,
    private readonly goods: GoodsRules,
    private readonly reports: ReportService,
    private readonly taskRules: TaskRules,
    private readonly rewards: TaskRewards,
    private readonly defaultBox: DefaultBoxService,
    private readonly fields: FieldCommands,
  ) {}

  /** `[wid]`: the stationed troop with a hero starts gathering → the field detail. */
  @GlobalCommand()
  async gatherFieldStart(ctx: CommandContext, param: unknown[]): Promise<unknown[] | void> {
    const uid = ctx.uid;
    const wid = phpIntval(param[0]);
    return this.scope.transaction(async () => {
      const world = await this.row(sql`select * from mem_world where wid = ${wid}`);
      const vacend = await this.cell(sql`select vacend from sys_user_state where uid = ${uid}`);
      const now = phpNum(await this.cell(sql`select unix_timestamp()`));
      if (!phpEmpty(vacend) && phpIntval(vacend) > now) return;

      const type = phpNum(world?.type);
      if (type < 1) throw GameError.lang('gatherFieldStart.field_is_city');
      if (type === 1) throw GameError.lang('gatherFieldStart.field_is_pingdi');
      if (!phpLooseEquals(world?.state ?? null, 0)) {
        throw GameError.lang('gatherFieldStart.field_in_battle');
      }
      if (phpLooseEquals(world?.level ?? null, 0)) {
        throw GameError.lang('gatherFieldStart.field_level_0');
      }
      const owner = await this.cell(
        sql`select uid from sys_city where cid = ${phpIntval(world?.ownercid)}`,
      );
      if (!phpLooseEquals(owner ?? false, uid)) {
        throw GameError.lang('gatherFieldStart.not_your_field');
      }
      const troop = await this.row(sql`select * from sys_troops where targetcid = ${wid2cid(wid)}
        and state = 4 and uid = ${uid} limit 1`);
      if (!troop) throw GameError.lang('gatherFieldStart.no_army');
      if (phpLooseEquals(troop.hid, 0)) throw GameError.lang('gatherFieldStart.no_hero');
      if (
        await this.check(sql`select * from sys_gather where wid = ${wid}
          and troopid = ${troop.id}`)
      ) {
        throw GameError.lang('gatherFieldStart.you_are_gathering');
      }
      await sql`replace into sys_gather (wid, troopid, fooduse, level, starttime)
        values (${wid}, ${troop.id}, ${troop.fooduse}, ${world!.level}, unix_timestamp())`.execute(
        this.scope.db,
      );
      return this.fields.fieldDetail(wid);
    });
  }

  /** `[wid]`: collects the field → `[field detail, what was gathered]`. */
  @GlobalCommand()
  async gatherFieldEnd(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const wid = phpIntval(param[0]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const world = await this.row(sql`select * from mem_world where wid = ${wid}`);
      if (!phpLooseEquals(world?.state ?? null, 0)) {
        throw GameError.lang('gatherFieldEnd.field_in_battle');
      }
      const owner = await this.cell(
        sql`select uid from sys_city where cid = ${phpIntval(world?.ownercid)}`,
      );
      if (!phpLooseEquals(owner ?? false, uid)) {
        throw GameError.lang('gatherFieldEnd.not_your_field');
      }
      const gather = await this.row(sql`select * from sys_gather where wid = ${wid}`);
      await sql`delete from sys_gather where wid = ${wid}`.execute(db);
      let msg: string;
      if (gather) {
        const troop = await this.row(sql`select * from sys_troops where id = ${gather.troopid}`);
        let heroLevel = 0;
        if (phpNum(troop?.hid) > 0) {
          heroLevel = phpNum(
            await this.cell(sql`select level from sys_city_hero where hid = ${troop!.hid}`),
          );
        }
        if (!troop || !phpLooseEquals(troop.state, 4)) {
          msg = this.lang.t('gatherFieldEnd.no_people_gather');
        } else if (phpLooseEquals(gather.level, 0)) {
          msg = this.lang.t('gatherFieldEnd.field_level_0');
        } else {
          const now = phpNum(await this.cell(sql`select unix_timestamp()`));
          const delta = now - phpNum(gather.starttime);
          if (delta < 3600) {
            msg = this.lang.t('gatherFieldEnd.gather_time_lessThen_1');
          } else {
            msg = this.lang.t('gatherFieldEnd.through_gathering', makeTimeLeft(this.lang, delta));
            msg += await this.gatherResult({
              uid,
              cid: phpIntval(world!.ownercid),
              delta,
              fooduse: phpNum(gather.fooduse),
              fieldtype: phpIntval(world!.type),
              fieldlevel: phpNum(gather.level),
              heroLevel,
              heroid: phpIntval(troop.hid),
              wid,
            });
          }
        }
      } else {
        msg = this.lang.t('gatherFieldEnd.already_got');
      }
      return [await this.fields.fieldDetail(wid), msg];
    });
  }

  /** Every stationed troop with a hero on a peaceful field above level 0 starts gathering. */
  @GlobalCommand()
  async gatherStartAll(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    return this.scope.transaction(async () => {
      const troops = await this.rows(sql`select id, fooduse, targetcid from sys_troops
        where state = 4 and uid = ${uid} and hid > 0`);
      let hasGather = false;
      for (const troop of troops) {
        const wid = cid2wid(phpIntval(troop.targetcid));
        const world = await this.row(sql`select state, type, level from mem_world
          where wid = ${wid} and type > 1 and state = 0 and level > 0`);
        if (!world) continue;
        if (
          !(await this.check(sql`select * from sys_gather where wid = ${wid}
            and troopid = ${troop.id}`))
        ) {
          hasGather = true;
          await sql`replace into sys_gather (wid, troopid, fooduse, level, starttime)
            values (${wid}, ${troop.id}, ${troop.fooduse}, ${world.level}, unix_timestamp())`.execute(
            this.scope.db,
          );
        }
      }
      return [hasGather];
    });
  }

  /** Collects every gathering field; the details go out as a report. */
  @GlobalCommand()
  async gatherEndAll(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    return this.scope.transaction(async () => {
      const gathers = await this.rows(sql`select g.wid, g.fooduse, g.level, g.starttime, t.hid,
          m.type, m.ownercid
        from sys_gather g left join sys_troops t on g.troopid = t.id
          left join mem_world m on g.wid = m.wid
        where t.state = 4 and t.uid = ${uid} order by t.id`);
      const now = phpNum(await this.cell(sql`select unix_timestamp()`));
      let msg = '';
      let number = 1;
      for (const gather of gathers) {
        let fieldName = '';
        for (let t = 0; t <= 7; t++) {
          if (phpLooseEquals(gather.type, t)) fieldName = this.lang.t(`fileName.${t}`);
        }
        const wid = phpIntval(gather.wid);
        const cid = wid2cid(wid);
        const position = `[${cid % 1000},${Math.floor(cid / 1000)}]`;
        const delta = now - phpNum(gather.starttime);
        if (delta < 3600) {
          msg += `${fieldName}${position} ${this.lang.t('gatherFieldEnd.gather_time_lessThen_1')}<br/>`;
        } else {
          const heroLevel = phpNum(
            await this.cell(sql`select level from sys_city_hero where hid = ${gather.hid}`),
          );
          msg += `${fieldName}${position} ${this.lang.t('gatherFieldEnd.through_gathering', makeTimeLeft(this.lang, delta))}`;
          msg += `${await this.gatherResult({
            uid,
            cid: phpIntval(gather.ownercid),
            delta,
            fooduse: phpNum(gather.fooduse),
            fieldtype: phpIntval(gather.type),
            fieldlevel: phpNum(gather.level),
            heroLevel,
            heroid: phpIntval(gather.hid),
            wid,
            para: number,
          })}<br/>`;
        }
        await sql`delete from sys_gather where wid = ${wid}`.execute(this.scope.db);
        number++;
      }
      if (gathers.length === 0) msg = this.lang.t('gatherFieldEnd.no_people_gather');
      await this.reports.sendReport(uid, REPORT_GATHER, 0, 0, msg);
      return [this.lang.t('gather.end_all')];
    });
  }

  /**
   * CityFunc.php::gatherFieldResult / gatherFieldResultForEndAll: resources by terrain, level,
   * food eaten and hours; then treasures, event gifts and hero-task items. Returns the text of
   * what was gained, ending with "。".
   */
  private async gatherResult(g: GatherInput): Promise<string> {
    const db = this.scope.db;
    const fieldRate = FIELD_RATE[g.fieldtype] ?? 0;
    const fieldlevel = Math.log((g.fieldlevel + 0.6) * 1.25) / Math.log(1.2);
    const resCount = Math.floor((fieldlevel * g.fooduse * fieldRate * g.delta) / 3600);
    let restype = 0;
    if (g.fieldtype === 1) restype = this.random.rand() & 3;
    else if (g.fieldtype === 3) restype = 1;
    else if (g.fieldtype === 2) restype = 2;
    else if (g.fieldtype === 5) restype = 3;
    await this.heroRules.addHeroExp(g.heroid, resCount * RES_VALUE[restype]! * 0.01);
    const res = [0, 0, 0, 0];
    res[restype] = resCount;
    await this.cityRules.addCityResources(g.cid, res[1]!, res[2]!, res[3]!, res[0]!, 0);
    let ret = `${this.lang.t(`gatherFieldResult.${RES_KEY[restype]!}`)}${resCount}`;

    const dropCount = Math.min(Math.floor(g.delta / 3600), 24);
    const goodsGet = new Map<number, number>();
    let allCount = 0;
    let fetchrate =
      0.05 + 0.01 * (fieldlevel + Math.floor(g.heroLevel / 10) + Math.floor(g.fooduse / 10000));
    if (fetchrate > 0.6) fetchrate = 0.6;

    if (g.delta >= 3600) {
      const maps = await this.rows(sql`select id from mem_treasure_map
        where cid = ${wid2cid(g.wid)} and uid = ${g.uid}`);
      if (maps.length > 0) {
        await sql`delete from mem_treasure_map where id = ${maps[0]!.id}`.execute(db);
        goodsGet.set(TREASURE_BOX, 1);
        if (this.random.mtRand(1, 100) <= 40) goodsGet.set(SHANYUE_BOOK, 1);
        const huntMsg = await this.treasureHuntAct(g.uid, g.cid);
        if (huntMsg) ret += `，${huntMsg}`;
      }
      let gatherMsg: string | false = false;
      if (g.delta >= 3600 * 2) gatherMsg = await this.gatherAct(g.uid, g.cid);
      if (gatherMsg) ret += `，${gatherMsg}`;
      await this.taskRules.finishTaskMaxNum(g.uid, resCount, restype + 2000);
    }

    const goodsRate = GOODS_RATE[g.fieldtype - 1];
    for (let i = 0; i < dropCount; i++) {
      let hit: boolean;
      let rnd = 0;
      if (g.para === undefined) {
        hit = this.random.mtRand(0, 1000) < 1000 * fetchrate;
        if (hit && goodsRate) rnd = this.random.rand() % sum(goodsRate);
      } else {
        const randPara = this.random.mtRand(0, g.para * 10);
        hit = this.random.mtRand(0, 1000 * randPara) < 1000 * fetchrate * randPara;
        if (hit && goodsRate) rnd = this.random.mtRand(0, g.para * 100) % sum(goodsRate);
      }
      if (!hit || !goodsRate) continue;
      let sumRate = 0;
      for (let j = 0; j < goodsRate.length; j++) {
        sumRate += goodsRate[j]!;
        if (rnd < sumRate) {
          const gid = j + 30;
          goodsGet.set(gid, (goodsGet.get(gid) ?? 0) + 1);
          allCount++;
          break;
        }
      }
    }

    if (dropCount >= 10) {
      const randPara = g.para === undefined ? 1 : this.random.mtRand(0, g.para * 10);
      const today = await this.todayGatherCount(g.uid, WOOD_BOX);
      const rate =
        allCount <= 2
          ? (50 + g.fooduse / 2000) / (1 + allCount + today)
          : 50 / (1 + allCount + today);
      const roll =
        g.para === undefined
          ? this.random.mtRand(0, 1000) < rate * 10
          : this.random.mtRand(0, 1000 * randPara) < rate * 10 * randPara;
      if (roll) {
        goodsGet.set(WOOD_BOX, 1);
        await sql`insert into log_gather_count (gid, uid, count, time)
          values (${WOOD_BOX}, ${g.uid}, 1, unix_timestamp())
          on duplicate key update count = count + 1`.execute(db);
      }
    }

    for (const [gid, cnt] of goodsGet) {
      await this.goods.addGoods(g.uid, gid, cnt, 1);
      ret += `，${this.goodsName(gid)}${cnt}`;
    }
    if ((goodsGet.get(NIGHT_PEARL) ?? 0) >= 3) {
      await this.rewards.finishAchievement(g.uid, GATHER_ACHIEVEMENT);
    }

    if (this.random.mtRand(0, 1) === 1) {
      for (const [tids, gid] of HERO_TASK_ITEMS[g.fieldtype] ?? []) {
        const count = await this.cell(sql`select count(*) from sys_hero_task
          where uid = ${g.uid} and \`state\` = 1 and tid in (${sql.join(tids)})`);
        if (phpNum(count) !== 0) {
          await this.goods.addThings(g.uid, gid, 1, 1);
          ret += `，${this.goodsName(gid)}1`;
        }
      }
    }
    return `${ret}。`;
  }

  private goodsName(gid: number): string {
    const key = GOODS_NAME[gid];
    return (key && this.lang.tOrNull(`gatherFieldResult.${key}`)) ?? '';
  }

  /** ActFunc.php::checkAndDoTreasureHuntAct: the 寻宝 event gift for a used treasure map. */
  private async treasureHuntAct(uid: number, cid: number): Promise<string | false> {
    const act = await this.row(sql`select actid, rate from cfg_act
      where type = ${ACT_TREASURE_HUNT.type}
        and starttime <= unix_timestamp() and endtime >= unix_timestamp() limit 1`);
    if (!act) return false;
    if (!this.isLucky(phpNum(act.rate), 100)) return false;
    return this.defaultBox.openEvent(uid, cid, phpIntval(act.actid), ACT_TREASURE_HUNT.srctype);
  }

  /** ActFunc.php::checkAndDoGatherAct: a random running 采集 event's gift. */
  private async gatherAct(uid: number, cid: number): Promise<string | false> {
    const acts = await this.rows(sql`select actid, rate from cfg_act
      where type = ${ACT_GATHER.type}
        and starttime <= unix_timestamp() and endtime >= unix_timestamp()`);
    if (acts.length === 0) return false;
    const pick = acts.length > 1 ? this.random.mtRand(0, acts.length - 1) : 0;
    const act = acts[pick]!;
    if (!this.isLucky(phpNum(act.rate), 100)) return false;
    return this.defaultBox.openEvent(uid, cid, phpIntval(act.actid), ACT_GATHER.srctype);
  }

  /** ActFunc.php::isLucky */
  private isLucky(rate: number, max: number): boolean {
    return rate >= this.random.mtRand(1, max);
  }

  /** CityFunc.php::getTodayGatherCount: how many of `gid` gathering gave in the last day. */
  private async todayGatherCount(uid: number, gid: number): Promise<number> {
    const db = this.scope.db;
    const row = await this.row(sql`select *, unix_timestamp() as now from log_gather_count
      where uid = ${uid} and gid = ${gid}`);
    if (!row) {
      await sql`insert into log_gather_count (gid, uid, count)
        values (${gid}, ${uid}, 0)`.execute(db);
      return 0;
    }
    if (phpNum(row.now) - phpNum(row.time) >= 86400) {
      await sql`update log_gather_count set time = unix_timestamp(), count = 0
        where id = ${row.id}`.execute(db);
      return 0;
    }
    return phpNum(row.count);
  }

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async row(query: RawBuilder<unknown>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  private async cell(query: RawBuilder<unknown>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : undefined;
  }

  private async check(query: RawBuilder<unknown>): Promise<boolean> {
    return (await this.rows(query)).length > 0;
  }
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
