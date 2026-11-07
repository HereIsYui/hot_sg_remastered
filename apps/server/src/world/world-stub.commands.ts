import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { cid2wid } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { ReportService } from '../core/report.service';
import { TaskRules } from '../core/task-rules.service';
import { makeTimeLeft } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { TaskRewards } from '../task/task-rewards.service';
import { UnionRules } from '../union/union-rules.service';
import { WorldCommands } from './world.commands';

/** WorldFunc.php actions and GoodsFunc.php::useTaoNiShengZhi. */
@Injectable()
export class WorldStubCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly reports: ReportService,
    private readonly unions: UnionRules,
    private readonly rewards: TaskRewards,
    private readonly tasks: TaskRules,
    private readonly goods: GoodsRules,
    private readonly world: WorldCommands,
  ) {}
  private async rows(q: RawBuilder<unknown>): Promise<Record<string, unknown>[]> {
    return (await q.execute(this.scope.db)).rows as Record<string, unknown>[];
  }
  private async row(q: RawBuilder<unknown>) {
    return (await this.rows(q))[0];
  }
  private async cell(q: RawBuilder<unknown>): Promise<unknown> {
    const row = await this.row(q);
    return row ? Object.values(row)[0] : false;
  }
  private async run(q: RawBuilder<unknown>): Promise<void> {
    await q.execute(this.scope.db);
  }
  private async endTime(time: number): Promise<unknown> {
    const format = `%Y${this.lang.t('MakeEndTime.year')}%m${this.lang.t('MakeEndTime.month')}%d${this.lang.t('MakeEndTime.day')} %H:%i:%s`;
    return this.cell(sql`select from_unixtime(${time},${format})`);
  }
  private async checkWar(uid: number, target: number): Promise<void> {
    if (
      await this.row(
        sql`select * from mem_user_inwar where (uid=${uid} and targetuid=${target}) or (targetuid=${uid} and uid=${target})`,
      )
    )
      throw GameError.lang('startWar.war_is_declared');
  }
  @GlobalCommand()
  async startWar(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid,
      target = phpIntval(param[0]),
      cid = phpIntval(param[1]);
    await this.checkWar(uid, target);
    const user = await this.row(sql`select name,state,lastcid from sys_user where uid=${uid}`);
    if (phpLooseEquals(user?.state, 1)) throw GameError.lang('startWar.new_protect');
    const other = await this.row(
      sql`select name,state,lastcid,union_id from sys_user where uid=${target}`,
    );
    if (phpLooseEquals(other?.state, 1)) throw GameError.lang('startWar.target_new_protect');
    const now = phpNum(await this.cell(sql`select unix_timestamp()`));
    await this.run(
      sql`insert into mem_user_inwar(uid,targetuid,state,endtime) values(${uid},${target},0,unix_timestamp()+8*3600)`,
    );
    const start = await this.endTime(now + 8 * 3600),
      end = await this.endTime(now + 56 * 3600);
    await this.reports.sendReport(
      target,
      22,
      phpIntval(user?.lastcid),
      cid,
      this.lang.t('startWar.succ_caution', user?.name, start, end),
    );
    await this.reports.sendReport(
      uid,
      22,
      phpIntval(user?.lastcid),
      cid,
      this.lang.t('startWar.succ_report', other?.name, start, end),
    );
    if (phpNum(other?.union_id) > 0)
      await this.unions.addUnionEvent(
        phpIntval(other?.union_id),
        11,
        this.lang.t('start_war.union_msg', other?.name, user?.name),
      );
    const cids = phpString(
      await this.cell(sql`select group_concat(cid) from sys_city where uid=${target}`),
    ).split(',');
    return this.world.getWorldCityInfo(ctx, [cids.length, ...cids]);
  }
  @GlobalCommand()
  async useTaoNiShengZhi(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid,
      initial = phpIntval(param[0]),
      cid = phpIntval(param[1]);
    if (!(await this.goods.checkGoods(uid, 157))) throw GameError.raw('not_enough_goods157#1');
    await this.checkWar(uid, initial);
    let user = await this.row(sql`select name,state,lastcid from sys_user where uid=${uid}`);
    if (phpLooseEquals(user?.state, 1)) throw GameError.lang('startWar.new_protect');
    let other = await this.row(
      sql`select name,state,lastcid,union_id from sys_user where uid=${initial}`,
    );
    if (phpLooseEquals(other?.state, 1)) throw GameError.lang('startWar.target_new_protect');
    user = await this.row(sql`select name,prestige,lastcid from sys_user where uid=${uid}`);
    // getCityNamePosition's result is discarded by PHP.
    await this.cell(sql`select name from sys_city where cid=${cid}`);
    const target = phpIntval(await this.cell(sql`select uid from sys_city where cid=${cid}`));
    other = await this.row(sql`select name,prestige from sys_user where uid=${target}`);
    const delay = 8 * 3600;
    await this.run(
      sql`insert into mem_user_trickwar(uid,targetuid,endtime) values(${uid},${target},unix_timestamp()+${delay}) on duplicate key update endtime=unix_timestamp()+${delay}`,
    );
    let rate = phpEmpty(other?.prestige) ? 1 : phpNum(user?.prestige) / phpNum(other?.prestige);
    rate = Math.max(1, Math.min(5, rate));
    const reduction = phpNum(user?.prestige) * rate * 0.01;
    const now = phpNum(await this.cell(sql`select unix_timestamp()`));
    const start = await this.endTime(now),
      end = await this.endTime(now + delay);
    await this.reports.sendReport(
      uid,
      49,
      phpIntval(user?.lastcid),
      cid,
      this.lang.t('trickBuXuanErZhan.succ_report', other?.name, start, end, reduction),
    );
    await this.reports.sendReport(
      target,
      49,
      phpIntval(user?.lastcid),
      cid,
      this.lang.t('trickBuXuanErZhan.succ_caution', user?.name, start, end),
    );
    await this.tasks.completeTaskGoalBySortandType(uid, 53, 9);
    await this.goods.reduceGoods(uid, 157, 1);
    return [this.lang.t('trickBuXuanErZhan.succ', other?.name, makeTimeLeft(this.lang, delay))];
  }
  @GlobalCommand()
  async unionAssit(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid,
      cid = phpIntval(param[0]);
    const city = await this.row(sql`select * from sys_city where cid=${cid} limit 1`);
    if (!city) throw GameError.lang('useGoods.city_not_exists');
    const target = phpIntval(city.uid);
    const self = await this.row(sql`select union_id,union_pos from sys_user where uid=${uid}`);
    const union = await this.cell(
      sql`select u.union_id from sys_user u,sys_city c where u.uid=c.uid and c.cid=${cid}`,
    );
    if (![4, 5].includes(phpIntval(self?.union_pos))) throw GameError.lang('world.union_pos_lower');
    if (phpIntval(self?.union_id) !== phpIntval(union))
      throw GameError.lang('world.not_in_one_union');
    const state = await this.row(
      sql`select 1 from sys_user_state where uid=${target} and (forbiend>unix_timestamp() or vacend>unix_timestamp())`,
    );
    const cooling = await this.row(
      sql`select 1 from mem_user_buffer where uid=${target} and buftype=8 and endtime>unix_timestamp()`,
    );
    if (state || cooling) throw GameError.lang('world.can_not_assit');
    const cities = await this.rows(sql`select cid from sys_city where uid=${target} and type=0`);
    for (const c of cities)
      if (
        await this.row(
          sql`select * from mem_world where wid=${cid2wid(phpIntval(c.cid))} and state=1`,
        )
      )
        throw GameError.raw(
          this.lang.t('changeUserState.some_city_in_war') + this.lang.t('changeUserState.mianzhan'),
        );
    if (phpIntval(await this.cell(sql`select money from sys_user where uid=${uid}`)) < 200)
      throw GameError.lang('buyGoods.no_enough_YuanBao');
    await this.rewards.addMoney(uid, -200, 913);
    const now = phpNum(await this.cell(sql`select unix_timestamp()`));
    await this.run(
      sql`insert into mem_user_buffer(uid,buftype,endtime) values(${target},7,${now + 7200}) on duplicate key update endtime=endtime+7200`,
    );
    await this.run(sql`update sys_user set state=2 where uid=${target}`);
    return [this.lang.t('world.assit_succ')];
  }
}
