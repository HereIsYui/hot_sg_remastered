import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules, cid2wid } from '../core/city-rules.service';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { ReportService } from '../core/report.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/**
 * WorldFunc.php::governOthers (WorldFunc.php:547-772): 对本州/郡/县内别的玩家城池下达政令
 * （0 收税 1 抽丁 2 征粮 3 收编 4 裁军）。下令城必须是名城（type 1-4，type 5 视为 0 的普通
 * 城）且官府 ≥ 10 级，目标城级别必须低于自己（盟友、当日已被政令的目标除外），按爵位官职
 * 每天限次。征税/征粮拿走目标城 1/10 的黄金/粮食，抽丁拿走 1/5 人口，收编拿走 fromcity
 * 兵种最多一行的 1/50（自己得一半），裁军削掉最多一行兵的 1/20；目标城收到系统战报。
 * 成功文案与原版一样以异常抛出（写库已提交，不能包事务，同 markCity）。
 */
@Injectable()
export class GovernCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cityRules: CityRules,
    private readonly report: ReportService,
  ) {}

  @GlobalCommand()
  async governOthers(ctx: CommandContext, param: unknown[]): Promise<never> {
    const uid = ctx.uid;
    // 政令类型 0 收税 1 抽丁 2 征粮 3 收编 4 裁军；目标城 / 目标用户 / 当前城 / 城名。
    const type = phpIntval(param[0]);
    const tcid = phpIntval(param[1]);
    const tuid = phpIntval(param[2]);
    const cid = phpIntval(param[3]);
    const cityname = phpString(param[4]);

    if (!(await this.check(sql`select 1 from sys_city where uid = ${uid} and cid = ${cid}`))) {
      throw GameError.lang('sendCommand.command_exception');
    }
    if (!(await this.check(sql`select 1 from sys_city where uid = ${tuid} and cid = ${tcid}`))) {
      throw GameError.lang('sendCommand.command_exception');
    }
    // 普通城不能下达政令
    let cityType = phpIntval(await this.cell(sql`select type from sys_city where cid = ${cid}`));
    if (cityType === 5) cityType = 0;
    if (cityType === 0) throw GameError.lang('governOthers.city_cannot_govern');

    // 官府没有达到10级，不能下达（无官府行时 PHP null < 10 同样拒绝）
    const governLevel = await this.cell(
      sql`select level from sys_building where cid = ${cid} and bid = 6`,
    );
    if (phpNum(governLevel) < 10) throw GameError.lang('governOthers.not_enouth_government_level');

    // 目标城池级别大于自己的级别，也不能下达
    let targetcitytype = phpIntval(
      await this.cell(sql`select type from sys_city where cid = ${tcid}`),
    );
    if (targetcitytype === 5) targetcitytype = 0;
    if (cityType <= targetcitytype) throw GameError.lang('governOthers.not_enough_level');

    // 自己盟友的城池不能政令
    const userUnionId = await this.cell(sql`select union_id from sys_user where uid = ${uid}`);
    if (!phpEmpty(userUnionId)) {
      if (
        await this.check(
          sql`select 1 from sys_user where uid = ${tuid} and union_id = ${userUnionId}`,
        )
      ) {
        throw GameError.lang('luoyang.target_can_not_union');
      }
    }

    // 查看封禁、休假状态（原版两个分支都复用 target_not_in_war 文案键，照抄）
    if (targetcitytype === 0) {
      const myuserstate = await this.row(
        sql`select forbiend, vacend, unix_timestamp() as nowtime from sys_user_state
          where uid = ${tuid} and (forbiend > unix_timestamp() or vacend > unix_timestamp())`,
      );
      if (!phpEmpty(myuserstate)) {
        if (phpNum(myuserstate!.forbiend) > phpNum(myuserstate!.nowtime)) {
          // 封禁
          throw GameError.lang('governOthers.target_not_in_war');
        } else if (phpNum(myuserstate!.vacend) > phpNum(myuserstate!.nowtime)) {
          // 休假
          throw GameError.lang('governOthers.target_not_in_war');
        }
      }
    }

    // WorldFunc.php:613 builds the key as "big_city_"+$cityType — PHP + is NUMERIC addition
    // ("big_city_" coerces to 0), so the lookup is really `where name = 4`. No cfg_name row
    // matches and the 城类型名 in the too_many_time text always comes out empty; bug kept
    // faithfully (the difftest caught it).
    const cityTypeName = await this.cell(sql`select value from cfg_name where name = ${cityType}`);
    const officepos = await this.cell(sql`select officepos from sys_user where uid = ${uid}`);
    const officename = await this.cell(
      sql`select name from cfg_office_pos where id = ${officepos}`,
    );

    const world = await this.row(
      sql`select province, jun from mem_world where wid = ${cid2wid(cid)}`,
    );
    const tworld = await this.row(
      sql`select province, jun from mem_world where wid = ${cid2wid(tcid)}`,
    );

    const x = cid % 1000;
    const y = Math.floor(cid / 1000);

    // 每天最大下达次数
    const maxCount = this.getMaxCountByOfficePos(cityType, phpIntval(officepos));
    if (cityType === 1) {
      // 检查是不是在同一个县
      const pos = Math.floor(cid / 10000) * 100 + Math.floor(Math.floor(cid % 1000) / 10);
      const tpos = Math.floor(tcid / 10000) * 100 + Math.floor(Math.floor(tcid % 1000) / 10);
      if (pos !== tpos) throw GameError.lang('governOthers.not_enough_level');
    } else if (cityType === 2) {
      // 检查是不是在同一个郡
      if (world?.jun !== tworld?.jun || world?.province !== tworld?.province) {
        throw GameError.lang('governOthers.not_enough_level');
      }
    } else if (cityType === 3) {
      // 检查是不是在同一个州
      if (world?.province !== tworld?.province) {
        throw GameError.lang('governOthers.not_enough_level');
      }
    }

    const now = phpIntval(await this.cell(sql`select unix_timestamp()`));
    const dayOf = (t: number) => Math.floor((t + 8 * 3600) / 86400);

    const lastBeGovernTime = await this.cell(
      sql`select last_be_govern_time from mem_city_schedule where cid = ${tcid}`,
    );
    if (!phpEmpty(lastBeGovernTime)) {
      // 一天以内被下达过政令 则不能下达
      if (!(dayOf(now) > dayOf(phpNum(lastBeGovernTime)))) {
        throw GameError.lang('governOthers.target_has_been_govern');
      }
    }

    const timeandcount = await this.row(
      sql`select govern_count, last_govern_time from mem_city_schedule where cid = ${cid}`,
    );

    let todayFirst = false;
    let todayCount = 0;
    if (phpEmpty(timeandcount)) {
      todayFirst = true;
    } else {
      if (dayOf(now) > dayOf(phpNum(timeandcount!.last_govern_time))) {
        todayFirst = true;
      } else {
        todayCount = phpNum(timeandcount!.govern_count);
        // 下达次数太多
        if (todayCount >= maxCount) {
          throw GameError.lang(
            'governOthers.too_many_time',
            phpString(officename),
            phpString(cityTypeName),
            maxCount,
            maxCount,
          );
        }
      }
    }

    // 今天又增加一次
    todayCount++;

    let success: GameError | undefined;
    if (type === 0) {
      // 征税
      const totalCount = await this.cell(
        sql`select gold from mem_city_resource where cid = ${tcid}`,
      );
      const addCount = Math.floor(phpNum(totalCount) / 10);
      // 减别人的
      await this.cityRules.addCityResources(tcid, 0, 0, 0, 0, -addCount);
      const report = this.lang.t('governOthers.gold_report', cityname, x, y, addCount);
      await this.report.sendReport(tuid, 26, cid, tcid, report);
      // 加自己的
      await this.cityRules.addCityResources(cid, 0, 0, 0, 0, addCount);
      success = GameError.lang('governOthers.gold_suc', addCount);
    } else if (type === 1) {
      // 抽丁
      const totalCount = await this.cell(
        sql`select people from mem_city_resource where cid = ${tcid}`,
      );
      const addCount = Math.floor(phpNum(totalCount) / 5);
      await this.cityRules.addCityPeople(tcid, -addCount);
      await this.cityRules.addCityPeople(cid, addCount);
      const report = this.lang.t('governOthers.people_report', cityname, x, y, addCount);
      await this.report.sendReport(tuid, 28, cid, tcid, report);
      success = GameError.lang('governOthers.people_suc', addCount);
    } else if (type === 2) {
      // 征粮
      const totalCount = await this.cell(
        sql`select food from mem_city_resource where cid = ${tcid}`,
      );
      const addCount = Math.floor(phpNum(totalCount) / 10);
      await this.cityRules.addCityResources(tcid, 0, 0, 0, -addCount, 0);
      const report = this.lang.t('governOthers.food_report', cityname, x, y, addCount);
      await this.report.sendReport(tuid, 42, cid, tcid, report);
      // 加自己的
      await this.cityRules.addCityResources(cid, 0, 0, 0, addCount, 0);
      success = GameError.lang('governOthers.food_suc', addCount);
    } else if (type === 3) {
      // 收编
      const row = await this.row(sql`select a.sid, a.count from sys_city_soldier a, cfg_soldier b
        where cid = ${tcid} and a.sid = b.sid and b.fromcity = 1 order by count desc limit 1`);
      let sid = 1;
      let totalCount = 0;
      if (!phpEmpty(row)) {
        sid = phpIntval(row!.sid);
        totalCount = phpNum(row!.count);
      }
      const sname = phpString(
        await this.cell(sql`select name from cfg_soldier where sid = ${sid}`),
      );
      const addCount = Math.floor(totalCount / 50);
      await this.cityRules.addCitySoldier(tcid, sid, -addCount);
      const report = this.lang.t(
        'governOthers.incorporation_report',
        cityname,
        x,
        y,
        sname,
        addCount,
      );
      await this.report.sendReport(tuid, 43, cid, tcid, report);
      const meaddcount = Math.floor(addCount / 2);
      // 加自己的
      await this.cityRules.addCitySoldier(cid, sid, meaddcount);
      success = GameError.lang('governOthers.incorporation_suc', sname, meaddcount);
    } else if (type === 4) {
      // 裁军
      const row = await this.row(
        sql`select sid, count from sys_city_soldier where cid = ${tcid} order by count desc limit 1`,
      );
      let sid = 1;
      let totalCount = 0;
      if (!phpEmpty(row)) {
        sid = phpIntval(row!.sid);
        totalCount = phpNum(row!.count);
      }
      const sname = phpString(
        await this.cell(sql`select name from cfg_soldier where sid = ${sid}`),
      );
      const addCount = Math.floor(totalCount / 20);
      await this.cityRules.addCitySoldier(tcid, sid, -addCount);
      const report = this.lang.t(
        'governOthers.disarmament_report',
        cityname,
        x,
        y,
        sname,
        addCount,
      );
      await this.report.sendReport(tuid, 44, cid, tcid, report);
      success = GameError.lang('governOthers.disarmament_suc', sname, addCount);
    }

    await sql`insert into mem_city_schedule (cid, last_be_govern_time)
      values (${tcid}, unix_timestamp())
      on duplicate key update last_be_govern_time = unix_timestamp()`.execute(this.scope.db);

    if (todayFirst) {
      // 重新累计24小时
      await sql`insert into mem_city_schedule (cid, govern_count, last_be_govern_time)
        values (${cid}, ${todayCount}, unix_timestamp())
        on duplicate key update last_govern_time = unix_timestamp(), govern_count = ${todayCount}`.execute(
        this.scope.db,
      );
    } else {
      await sql`insert into mem_city_schedule (cid, govern_count)
        values (${cid}, ${todayCount})
        on duplicate key update govern_count = ${todayCount}`.execute(this.scope.db);
    }

    // WorldFunc.php throws $msg after the writes have committed (an empty string for an unknown
    // 政令类型), so — as with markCity — no transaction wraps this command.
    throw success ?? GameError.raw('');
  }

  /** WorldFunc.php::getMaxCountByOfficePos: daily 政令 cap by city type and office position. */
  private getMaxCountByOfficePos(cityType: number, officepos: number): number {
    let maxCount = 0;
    if (cityType === 1) {
      if (officepos === 6) maxCount = 1;
      else if (officepos === 7) maxCount = 2;
      else if (officepos >= 8) maxCount = 3;
    } else if (cityType === 2) {
      if (officepos === 9) maxCount = 4;
      else if (officepos === 10) maxCount = 5;
      else if (officepos >= 11) maxCount = 6;
    } else if (cityType === 3) {
      if (officepos >= 12) maxCount = 8;
    } else if (cityType === 4) {
      if (officepos >= 13) maxCount = 10;
    }
    return maxCount;
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
