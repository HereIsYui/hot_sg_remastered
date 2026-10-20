import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { OwnershipService } from '../core/ownership.service';
import {
  phpEmpty,
  phpFloatString,
  phpIntval,
  phpLooseEquals,
  phpNum,
  phpString,
} from '../core/php';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { DialogCommand, type CommandContext } from '../gateway/decorators';
import { BuildingInfoService } from './building-info.service';
import { TECHNIC_MAX_LEVEL, TechnicPreType, TechnicRules } from './technic-rules.service';

type Row = Record<string, unknown>;

/** log_user_action id of a technic upgrade. */
const ACTION_TECHNIC = 22;

/** The 书院 commands of TechnicFunc.php. */
@Injectable()
export class TechnicCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly technics: TechnicRules,
    private readonly info: BuildingInfoService,
    private readonly ownership: OwnershipService,
    private readonly cityRules: CityRules,
    private readonly users: UserRules,
  ) {}

  private async rows(query: ReturnType<typeof sql<Row>>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows;
  }

  private async one(query: ReturnType<typeof sql<Row>>): Promise<Row | false> {
    return (await this.rows(query))[0] ?? false;
  }

  /** `[tid]`: researches the next level; one technic per city at a time. */
  @DialogCommand()
  async startUpgradeTechnic(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const db = this.scope.db;
    const { uid, cid } = ctx;
    const tid = phpIntval(param[0]);
    await this.ownership.checkCityExist(cid, uid);
    if (!(await this.one(sql<Row>`select * from cfg_technic where tid = ${tid}`))) {
      throw GameError.lang('startUpgradeTechnic.no_technic_info');
    }
    if (await this.one(sql<Row>`select * from sys_technic where cid = ${cid} and state = 1`)) {
      throw GameError.lang('startUpgradeTechnic.only_analysis_1_tech');
    }
    const existing = await this.one(
      sql<Row>`select * from sys_technic where uid = ${uid} and tid = ${tid}`,
    );
    const dstlevel = existing ? phpNum(existing.level) + 1 : 1;
    if (dstlevel > TECHNIC_MAX_LEVEL) throw GameError.lang('startUpgradeTechnic.technic_full');

    const need = await this.one(sql<Row>`select * from cfg_technic_level
      where tid = ${tid} and level = ${dstlevel}`);
    if (need && !phpEmpty(need.upgrade_time)) {
      const enough = await this.cityRules.checkCityResource(
        cid,
        need.upgrade_wood,
        need.upgrade_rock,
        need.upgrade_iron,
        need.upgrade_food,
        need.upgrade_gold,
      );
      if (!enough) throw GameError.lang('startUpgradeTechnic.no_enough_resource');
      for (const condition of await this.technics.conditionRows(tid, dstlevel)) {
        const current = await this.technics.conditionCurrent(uid, cid, condition);
        if (phpLooseEquals(condition.pre_type, TechnicPreType.Building)) {
          if (phpEmpty(current) || phpNum(current) < phpNum(condition.pre_level)) {
            throw GameError.lang('startUpgradeTechnic.no_pre_building');
          }
        } else if (phpLooseEquals(condition.pre_type, TechnicPreType.Technic)) {
          if (phpEmpty(current) || phpNum(current) < phpNum(condition.pre_level)) {
            throw GameError.lang('startUpgradeTechnic.no_pre_technic');
          }
        } else if (phpLooseEquals(condition.pre_type, TechnicPreType.GlobalState)) {
          if (phpEmpty(current) || !phpLooseEquals(current, condition.pre_level)) {
            throw GameError.lang(
              `startUpgradeTechnic.no_pre_global_task_${phpString(condition.pre_id)}`,
            );
          }
        }
      }

      const timeNeed = phpFloatString(await this.technics.realTime(uid, cid, need.upgrade_time));
      await this.cityRules.addCityResources(
        cid,
        -phpNum(need.upgrade_wood),
        -phpNum(need.upgrade_rock),
        -phpNum(need.upgrade_iron),
        -phpNum(need.upgrade_food),
        -phpNum(need.upgrade_gold),
      );
      await this.users.logUserAction(uid, ACTION_TECHNIC);
      let lastid: unknown;
      if (existing) {
        await sql`update sys_technic set cid = ${cid}, state = '1',
            state_starttime = unix_timestamp(), state_endtime = unix_timestamp() + ${timeNeed}
          where tid = ${tid} and uid = ${uid}`.execute(db);
        lastid = existing.id;
      } else {
        const inserted = await sql`insert into sys_technic
            (cid, tid, uid, level, state, state_starttime, state_endtime)
          values (${cid}, ${tid}, ${uid}, 0, 1, unix_timestamp(), unix_timestamp() + ${timeNeed})`.execute(
          db,
        );
        lastid = Number(inserted.insertId);
      }
      await sql`insert into mem_technic_upgrading (id, cid, tid, level, state_endtime)
        values (${lastid}, ${cid}, ${tid}, ${dstlevel}, unix_timestamp() + ${timeNeed})
        on duplicate key update cid = ${cid}, level = ${dstlevel},
          state_endtime = unix_timestamp() + ${timeNeed}`.execute(db);
    }
    return this.info.collegeInfo(uid, cid);
  }

  /** `[tid]`: cancels the city's research and refunds 66% of its cost. */
  @DialogCommand()
  async stopUpgradeTechnic(ctx: CommandContext, param: unknown[]): Promise<unknown> {
    const db = this.scope.db;
    const { uid, cid } = ctx;
    const tid = phpIntval(param[0]);
    const technic = await this.one(sql<Row>`select * from sys_technic
      where cid = ${cid} and tid = ${tid} and state = 1`);
    if (!technic) return this.lang.t('stopUpgradeTechnic.no_upgrading_tech_info');
    const dstlevel = phpNum(technic.level) + 1;
    const need = await this.one(sql<Row>`select * from cfg_technic_level
      where tid = ${technic.tid} and level = ${dstlevel}`);
    if (need) {
      if (phpLooseEquals(technic.level, 0)) {
        await sql`delete from sys_technic where uid = ${uid} and cid = ${cid} and tid = ${tid}`.execute(
          db,
        );
      } else {
        await sql`update sys_technic set state = '0' where cid = ${cid} and tid = ${tid}`.execute(
          db,
        );
      }
      await sql`delete from mem_technic_upgrading where id = ${technic.id}`.execute(db);
      await this.cityRules.addCityResources(
        cid,
        phpNum(need.upgrade_wood) * 0.66,
        phpNum(need.upgrade_rock) * 0.66,
        phpNum(need.upgrade_iron) * 0.66,
        phpNum(need.upgrade_food) * 0.66,
        phpNum(need.upgrade_gold) * 0.66,
      );
      await this.users.logActionCountback(uid, ACTION_TECHNIC);
    }
    return this.info.collegeInfo(uid, cid);
  }
}
