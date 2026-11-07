import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { DbScope } from '../db/database.module';
import { TaskRewards } from '../task/task-rewards.service';
import { GoodsRules } from './goods-rules.service';
import { phpEmpty, phpIntval, phpNum } from './php';
import { makeTimeLeft } from './user-rules.service';

/** GoodsFunc.php::UseMianZhanPai, shared by changeUserState and useGoods. */
@Injectable()
export class UserProtection {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly rewards: TaskRewards,
  ) {}
  private async row(q: RawBuilder<unknown>): Promise<Record<string, unknown> | undefined> {
    return (await q.execute(this.scope.db)).rows[0] as Record<string, unknown> | undefined;
  }
  private async cell(q: RawBuilder<unknown>): Promise<unknown> {
    const row = await this.row(q);
    return row ? Object.values(row)[0] : false;
  }
  async use(uid: number, fromIndex: number): Promise<unknown> {
    const server = phpIntval(await this.cell(sql`select value from mem_state where state=197`));
    const run = async (q: RawBuilder<unknown>) => {
      await q.execute(this.scope.db);
    };
    if (fromIndex === 3) {
      if (await this.row(sql`select 1 from sys_user where uid=${uid} and money<300`))
        throw GameError.lang('lottery.no_money');
      await run(sql`delete from mem_user_buffer where uid=${uid} and buftype=8`);
      await run(sql`delete from mem_user_buffer where uid=${uid} and buftype=913`);
    }
    const cooling = await this.row(
      sql`select endtime,endtime-unix_timestamp() as lefttime from mem_user_buffer where uid=${uid} and buftype=8`,
    );
    const left = await this.cell(
      sql`select endtime-unix_timestamp() from mem_user_buffer where uid=${uid} and buftype=7`,
    );
    const vacation = await this.cell(
      sql`select endtime from mem_user_buffer where uid=${uid} and buftype=913`,
    );
    if (!phpEmpty(vacation)) {
      const now = phpNum(await this.cell(sql`select unix_timestamp()`));
      throw GameError.lang(
        'changeUserState.vacation_wait_to_use_MianZhanPai',
        makeTimeLeft(this.lang, phpNum(vacation) - now),
      );
    }
    if (cooling)
      throw GameError.lang(
        'changeUserState.wait_to_use_MianZhanPai',
        makeTimeLeft(this.lang, phpNum(cooling.lefttime)),
      );
    let usecount = 0;
    let action: Record<string, unknown> | undefined;
    if (phpNum(left) > 0) {
      action =
        server === 1
          ? await this.row(sql`select count from log_user_mianzhan where uid=${uid} limit 1`)
          : await this.row(
              sql`select count,id from sys_user_action_log where action='usemianzhan' and uid=${uid} limit 1`,
            );
      usecount = phpIntval(action?.count);
      if (usecount >= 5 && server === 1) throw GameError.lang('useMianZhan.not_use');
    } else if (server === 1) await run(sql`update log_user_mianzhan set count=0 where uid=${uid}`);
    else
      await run(
        sql`update sys_user_action_log set count=0 where uid=${uid} and action='usemianzhan'`,
      );
    await this.cell(sql`select value from mem_state where state=197`);
    if (fromIndex === 3) await this.rewards.addMoney(uid, -300, 731);
    else {
      if (usecount > 1) usecount = 1;
      const count = usecount + 1;
      if (!(await this.goods.checkGoodsCount(uid, 12, count)))
        throw GameError.lang('sellGoods.not_enough_goods_mianzhan', count);
      await this.goods.reduceGoods(uid, 12, count);
    }
    await run(sql`update sys_user set state=2 where uid=${uid}`);
    await run(
      sql`insert into mem_user_buffer(uid,buftype,endtime) values(${uid},7,unix_timestamp()+43200) on duplicate key update endtime=endtime+43200`,
    );
    usecount++;
    if (!action) {
      if (server === 1)
        await run(
          sql`insert into log_user_mianzhan(uid,count) values(${uid},${usecount}) on duplicate key update count='count'+1`,
        );
      else
        await run(
          sql`insert into sys_user_action_log(uid,action,count,time,mark) values(${uid},'usemianzhan',${usecount},unix_timestamp(),${this.lang.t('useGoods.MianZhanPai_2')}) on duplicate key update count='count'+1`,
        );
    } else if (server === 1)
      await run(sql`update log_user_mianzhan set count=count+1 where uid=${uid}`);
    else
      await run(
        sql`update sys_user_action_log set count=count+1,time=unix_timestamp() where id=${action.id}`,
      );
    return this.cell(sql`select endtime from mem_user_buffer where uid=${uid} and buftype=7`);
  }
}
