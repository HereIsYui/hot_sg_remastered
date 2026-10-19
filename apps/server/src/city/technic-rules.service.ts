import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { LangService } from '../common/lang.service';
import { Building, CityRules } from '../core/city-rules.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { DbScope } from '../db/database.module';
import { CITY_TYPE_BIG } from './building-rules.service';

type Row = Record<string, unknown>;

/** `Define.GAME_SPEED_RATE`. */
export const GAME_SPEED_RATE = 1;

/** Highest technic level (`Define.TECHNIC_MAX_LEVEL`). */
export const TECHNIC_MAX_LEVEL = 10;

/** Technics outside the main city stop at 研究技巧 (tid 24). */
const LAST_COMMON_TECHNIC = 24;

/** cfg_technic_condition.pre_type */
export const TechnicPreType = { Building: 0, Technic: 1, GlobalState: 2 } as const;

/** interface.php::UpgradeCondition */
export interface TechnicCondition {
  _explicitType: 'UpgradeCondition';
  type: string | null;
  upgradeNeed: string | null;
  currentOwn: string | null;
  canUpgrade: boolean | null;
}

/** interface.php::TechnicState: one technic as the 书院 lists it. */
export interface TechnicState {
  _explicitType: 'TechnicState';
  tid: number;
  tname: unknown;
  description: unknown;
  levelDescription: unknown;
  nextLevelDescription: unknown;
  level: number;
  sharelevel: number;
  cid: unknown;
  state: number;
  state_endtime: number;
  state_timeleft: number;
  can_upgrade: boolean;
  woodNeed: number | null;
  rockNeed: number | null;
  ironNeed: number | null;
  foodNeed: number | null;
  goldNeed: number | null;
  upgrade_time: number | null;
  conditions: TechnicCondition[] | null;
}

/** Research speed and the technic list of TechnicFunc.php. */
@Injectable()
export class TechnicRules {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cityRules: CityRules,
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

  /**
   * TechnicFunc.php::getTechnicSpeedRate: the 智谋 of the 军师, else the 城守, else the 主将
   * (×1.25 with 智多星符), and the 军师's 墨家真传 book.
   */
  async speedRate(cid: number): Promise<number> {
    let speedAdd = 0;
    const city = await this.one(
      sql<Row>`select chiefhid, generalid, counsellorid from sys_city where cid = ${cid}`,
    );
    let hid = 0;
    if (city) {
      if (phpNum(city.counsellorid) > 0) hid = phpIntval(city.counsellorid);
      else if (phpNum(city.generalid) > 0) hid = phpIntval(city.generalid);
      else if (phpNum(city.chiefhid) > 0) hid = phpIntval(city.chiefhid);
    }
    if (hid > 0) {
      const hero = await this.one(sql<Row>`select * from sys_city_hero where hid = ${hid}`);
      if (hero) {
        const buffered = await this.one(
          sql<Row>`select * from mem_hero_buffer where hid = ${hid} and buftype = 4`,
        );
        const bufadd = buffered ? 1.25 : 1.0;
        speedAdd +=
          (phpNum(hero.wisdom_base) + phpNum(hero.wisdom_add)) * bufadd +
          phpNum(hero.wisdom_add_on);
      }
    }
    let skillRate = 0;
    const counsellor = await this.cell(
      sql<Row>`select counsellorid from sys_city where cid = ${cid}`,
    );
    if (!phpEmpty(counsellor)) {
      const attr = await this.cell(sql<Row>`select b.attr from sys_user_book a, cfg_book b
        where a.bid = b.id and a.level = b.level and a.bid = 16 and a.hid = ${counsellor}`);
      skillRate = phpNum(phpEmpty(attr) ? 0 : attr) * 0.01;
    }
    return (1.0 / (1.0 + 0.01 * speedAdd)) * (1 - skillRate);
  }

  /** TechnicFunc.php::getRealTime: research seconds after the speed rate and 研究技巧. */
  async realTime(uid: number, cid: number, time: unknown): Promise<number> {
    return this.realTimeAt(uid, time, await this.speedRate(cid));
  }

  /** TechnicFunc.php::doGetTechnicInfo: `[technics, colleges the player owns]`. */
  async technicInfo(uid: number, cid: number): Promise<[TechnicState[], unknown]> {
    const cityType = await this.cell(sql<Row>`select type from sys_city where cid = ${cid}`);
    const columns = sql`c.*, s.uid, s.cid, s.level, s.state, s.state_starttime, s.state_endtime,
      t.level as sharelevel, unix_timestamp() as nowtime
      from cfg_technic c
        left join sys_technic s on s.tid = c.tid and s.uid = ${uid}
        left join sys_city_technic t on t.cid = ${cid} and t.tid = c.tid`;
    const technics = phpLooseEquals(cityType, CITY_TYPE_BIG)
      ? await this.rows(sql<Row>`select ${columns} order by c.tid`)
      : await this.rows(
          sql<Row>`select ${columns} where c.tid <= ${LAST_COMMON_TECHNIC} order by c.tid`,
        );
    const speedRate = await this.speedRate(cid);
    const hasOneUpgrading = await this.one(
      sql<Row>`select * from sys_technic where cid = ${cid} and state = 1`,
    );
    const levelText = this.lang.t('doGetTechnicInfo.level');
    const list: TechnicState[] = [];
    for (const technic of technics) {
      const tid = phpIntval(technic.tid);
      const intOr0 = (v: unknown) => (phpEmpty(v) ? 0 : phpIntval(v));
      const state: TechnicState = {
        _explicitType: 'TechnicState',
        tid,
        tname: technic.name,
        description: technic.description,
        levelDescription: null,
        nextLevelDescription: null,
        level: intOr0(technic.level),
        sharelevel: intOr0(technic.sharelevel),
        cid: technic.cid,
        state: intOr0(technic.state),
        state_endtime: intOr0(technic.state_endtime),
        state_timeleft: 0,
        can_upgrade: true,
        woodNeed: null,
        rockNeed: null,
        ironNeed: null,
        foodNeed: null,
        goldNeed: null,
        upgrade_time: null,
        conditions: null,
      };
      state.state_timeleft = state.state_endtime - phpNum(technic.nowtime);
      if (state.level > 0) {
        state.levelDescription = await this.cell(sql<Row>`select description
          from cfg_technic_level where tid = ${tid} and level = ${state.level}`);
      }
      const dstlevel = state.level + 1;
      if (dstlevel > TECHNIC_MAX_LEVEL) state.can_upgrade = false;
      const need = await this.one(sql<Row>`select * from cfg_technic_level
        where tid = ${tid} and level = ${dstlevel}`);
      if (need) {
        state.woodNeed = phpNum(need.upgrade_wood);
        state.rockNeed = phpNum(need.upgrade_rock);
        state.ironNeed = phpNum(need.upgrade_iron);
        state.foodNeed = phpNum(need.upgrade_food);
        state.goldNeed = phpNum(need.upgrade_gold);
        state.upgrade_time = await this.realTimeAt(uid, need.upgrade_time, speedRate);
        state.nextLevelDescription = need.description;
        state.can_upgrade = await this.cityRules.checkCityResource(
          cid,
          state.woodNeed,
          state.rockNeed,
          state.ironNeed,
          state.foodNeed,
          state.goldNeed,
        );
        state.conditions = [];
        if (dstlevel <= TECHNIC_MAX_LEVEL) {
          for (const condition of await this.conditionRows(tid, dstlevel)) {
            const cond = await this.describeCondition(uid, cid, condition, levelText);
            if (!cond.canUpgrade) state.can_upgrade = false;
            state.conditions.push(cond);
          }
        }
      }
      if (hasOneUpgrading) state.can_upgrade = false;
      list.push(state);
    }
    const colleges = await this.cell(sql<Row>`select count(*) from sys_building b, sys_city c
      where b.cid = c.cid and c.uid = ${uid} and b.bid = ${Building.College}`);
    return [list, colleges];
  }

  /** getRealTime with the city's speed rate already looked up. */
  private async realTimeAt(uid: number, time: unknown, speedRate: number): Promise<number> {
    let t = phpNum(time) * speedRate;
    t /= GAME_SPEED_RATE;
    const techLevel = await this.cell(
      sql<Row>`select max(level) from sys_technic where uid = ${uid} and tid = 24`,
    );
    if (!phpEmpty(techLevel)) t = (t / 100) * (100 - phpNum(techLevel) * 3);
    return Math.floor(t);
  }

  async conditionRows(tid: number, level: number): Promise<Row[]> {
    return this.rows(sql<Row>`select * from cfg_technic_condition
      where tid = ${tid} and level = ${level} order by pre_type`);
  }

  /** The current level of a building / technic, or the value of a mem_state, a condition needs. */
  async conditionCurrent(uid: number, cid: number, condition: Row): Promise<unknown> {
    if (phpLooseEquals(condition.pre_type, TechnicPreType.Building)) {
      return this.cell(sql<Row>`select max(level) from sys_building
        where cid = ${cid} and bid = ${condition.pre_id}`);
    }
    if (phpLooseEquals(condition.pre_type, TechnicPreType.Technic)) {
      return this.cell(sql<Row>`select max(level) from sys_technic
        where uid = ${uid} and tid = ${condition.pre_id}`);
    }
    return this.cell(sql<Row>`select value from mem_state where state = ${condition.pre_id}`);
  }

  private async describeCondition(
    uid: number,
    cid: number,
    condition: Row,
    levelText: string,
  ): Promise<TechnicCondition> {
    const cond: TechnicCondition = {
      _explicitType: 'UpgradeCondition',
      type: null,
      upgradeNeed: null,
      currentOwn: null,
      canUpgrade: null,
    };
    const current = await this.conditionCurrent(uid, cid, condition);
    const preType = condition.pre_type;
    if (
      phpLooseEquals(preType, TechnicPreType.Building) ||
      phpLooseEquals(preType, TechnicPreType.Technic)
    ) {
      const isBuilding = phpLooseEquals(preType, TechnicPreType.Building);
      cond.type = this.lang.t(`doGetTechnicInfo.${isBuilding ? 'pre_building' : 'pre_technic'}`);
      cond.canUpgrade = !(phpEmpty(current) || phpNum(current) < phpNum(condition.pre_level));
      const name = isBuilding
        ? await this.cell(sql<Row>`select name from cfg_building where bid = ${condition.pre_id}`)
        : await this.cell(sql<Row>`select name from cfg_technic where tid = ${condition.pre_id}`);
      cond.upgradeNeed = `${phpString(name)}(${levelText}${phpString(condition.pre_level)})`;
      cond.currentOwn = `${levelText}${phpEmpty(current) ? 0 : phpString(current)}`;
    } else if (phpLooseEquals(preType, TechnicPreType.GlobalState)) {
      cond.type = this.lang.t('doGetTechnicInfo.pre_global_task');
      cond.canUpgrade = true;
      cond.upgradeNeed = this.lang.t(
        `doGetTechnicInfo.pre_global_task_${phpString(condition.pre_id)}`,
      );
      cond.currentOwn = this.lang.t('doGetTechnicInfo.finished');
      if (!phpLooseEquals(current, condition.pre_level)) {
        cond.canUpgrade = false;
        cond.currentOwn = this.lang.t('doGetTechnicInfo.not_finished');
      }
    }
    return cond;
  }
}
