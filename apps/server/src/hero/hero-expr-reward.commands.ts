import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { TaskRewards } from '../task/task-rewards.service';

type Row = Record<string, unknown>;

/** Claims the deferred sys_hero_expr_reward rows produced by HeroExprTick. */
@Injectable()
export class HeroExprRewardCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly goods: GoodsRules,
    private readonly rewards: TaskRewards,
    private readonly random: RandomService,
  ) {}

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async cell(query: RawBuilder<unknown>): Promise<unknown> {
    const row = (await this.rows(query))[0];
    return row ? Object.values(row)[0] : false;
  }

  @GlobalCommand()
  async finishCommonExpr(ctx: CommandContext, param: unknown[]): Promise<never> {
    const uid = ctx.uid;
    const id = phpIntval(param[0]);
    await this.scope.transaction(async () => {
      const reward = (
        await this.rows(sql`select * from sys_hero_expr_reward where id = ${id} and uid = ${uid}`)
      )[0];
      if (!reward || phpNum(reward.endtime) < Math.floor(Date.now() / 1000))
        throw GameError.lang('heroexpr.reward_timeout');
      const money = await this.cell(sql`select money from sys_user where uid = ${uid}`);
      if (phpNum(reward.money) > phpNum(money) || phpNum(reward.money) < 0)
        throw GameError.lang('buyFromMerchant.no_enough_YuanBao');
      if (phpEmpty(reward.details)) throw GameError.lang('heroexpr.get_reward_error');
      const details = phpString(reward.details);
      switch (phpNum(reward.sort)) {
        case 1:
          for (const gid of details.split(',')) {
            if (!phpEmpty(gid)) await this.goods.addGoods(uid, phpNum(gid), 1, 10);
          }
          break;
        case 2:
          await this.goods.addGoods(uid, phpNum(details), 1, 10);
          break;
        case 3:
          await this.rewards.addArmor(uid, phpNum(details), 1, 10);
          break;
        case 4: {
          const attrs = details.split(',');
          const add = [0, 0, 0, 0, 0, 0];
          for (let i = 0; i < phpNum(attrs[0]); i++) {
            const type = phpNum(attrs[2 * i + 1]);
            if (type >= 1 && type <= 6) add[type - 1]! += phpNum(attrs[2 * i + 2]);
          }
          const [bravery, wisdom, affairs, command, attack, defence] = add;
          await sql`insert into sys_city_hero_base_add (uid, hid, bravery_base_add_on, wisdom_base_add_on, affairs_base_add_on, command_base_add_on, type)
            values (${uid}, ${reward.hid}, ${bravery}, ${wisdom}, ${affairs}, ${command}, 1)`.execute(
            this.scope.db,
          );
          await sql`update sys_city_hero set bravery_base = bravery_base + ${bravery}, wisdom_base = wisdom_base + ${wisdom}, affairs_base = affairs_base + ${affairs}, command_base = command_base + ${command}, attack_add_on = attack_add_on + ${attack}, defence_add_on = defence_add_on + ${defence} where hid = ${reward.hid}`.execute(
            this.scope.db,
          );
          break;
        }
        case 5: {
          const [from, to] = details.split(',').map(phpNum);
          if (
            phpEmpty(
              await this.cell(
                sql`select count from sys_goods where uid = ${uid} and gid = ${from}`,
              ),
            )
          )
            throw GameError.lang('heroexpr.goods_not_enough');
          await this.goods.addGoods(uid, from!, -1, 10);
          await this.goods.addGoods(uid, to!, 1, 10);
          break;
        }
        case 6: {
          const encoded = await this.cell(
            sql`select strong_level + 10 from sys_user_armor where uid = ${uid} and sid = ${details}`,
          );
          if (phpEmpty(encoded)) throw GameError.lang('equipArmor.arm_not_exist');
          const level = Math.max(0, Math.min(9, phpNum(encoded) - 10));
          const info = (
            await this.rows(sql`select * from cfg_strong_probability where level = ${level} + 1`)
          )[0];
          if (info)
            await sql`update sys_user_armor set strong_value = ${info.strong_value}, strong_level = ${info.level} where uid = ${uid} and sid = ${details}`.execute(
              this.scope.db,
            );
          break;
        }
        case 7:
          if (
            phpEmpty(
              await this.cell(
                sql`select 1 from sys_lionize where uid = ${uid} and npcid = ${reward.hid}`,
              ),
            )
          )
            throw GameError.lang('hero.not_your_hero');
          await sql`update sys_lionize set friend = least(friend + 1, 120) where uid = ${uid} and npcid = ${reward.hid}`.execute(
            this.scope.db,
          );
          await sql`insert into sys_city_hero_base_add (hid, uid, affairs_base_add_on, bravery_base_add_on, wisdom_base_add_on, type) values (${reward.hid}, ${uid}, 1, 1, 1, 1)`.execute(
            this.scope.db,
          );
          break;
        case 8: {
          const rows = await this.rows(
            sql`select * from sys_city_draftqueue where cid = ${reward.cid}`,
          );
          if (rows.length === 0) throw GameError.lang('heroexpr.no_draftqueue');
          // Match HeroExprTick's injected Fisher-Yates shuffle before taking the first queue.
          for (let i = rows.length - 1; i > 0; i--) {
            const j = this.random.mtRand(0, i);
            [rows[i], rows[j]] = [rows[j]!, rows[i]!];
          }
          const row = rows[0]!;
          const need = phpIntval(phpNum(row.needtime) * Math.max(0, 1 - phpNum(details) * 0.01));
          await sql`update sys_city_draftqueue set needtime = ${need} where id = ${row.id}`.execute(
            this.scope.db,
          );
          if (phpNum(row.state) === 1)
            await sql`update mem_city_draft set state_endtime = ${row.state_starttime} + ${need} where id = ${row.id}`.execute(
              this.scope.db,
            );
          break;
        }
      }
      await this.rewards.addMoney(uid, -phpNum(reward.money), 121);
      await sql`insert into log_hero_expr_reward (uid, cid, hid, type, sort, money, details, endtime, time)
        values (${reward.uid}, ${reward.cid}, ${reward.hid}, ${reward.type}, ${reward.sort}, ${reward.money}, ${reward.details}, ${reward.endtime}, unix_timestamp())`.execute(
        this.scope.db,
      );
      await sql`delete from sys_hero_expr_reward where id = ${id}`.execute(this.scope.db);
    });
    // Legacy reports success as an exception. Throw after commit so the reward stays claimed.
    throw GameError.lang('heroexpr.get_reward_success');
  }
}
