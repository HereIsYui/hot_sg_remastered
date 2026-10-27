import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DbScope } from '../db/database.module';
import { TaskRewards } from '../task/task-rewards.service';
import { GoodsRules } from './goods-rules.service';
import { phpIntval } from './php';

type Row = Record<string, unknown>;

export interface RewardLogReasons {
  goods: number;
  armor: number;
  things: number;
  money: number;
}

/** utils.php::parseAndAddReward, shared by ticket, activity and ranking rewards. */
@Injectable()
export class RewardRules {
  constructor(
    private readonly scope: DbScope,
    private readonly goods: GoodsRules,
    private readonly rewards: TaskRewards,
  ) {}

  async parseAndAddReward(uid: number, reward: string, log: RewardLogReasons): Promise<unknown[]> {
    const parts = reward.split(',');
    const n = phpIntval(parts[0]);
    const ret: unknown[] = [];
    let money = 0;
    let isYuanBao = false;
    for (let i = 1; i < n * 3; i += 3) {
      const type = phpIntval(parts[i]);
      const gid = phpIntval(parts[i + 1]);
      const cnt = phpIntval(parts[i + 2]);
      if (type === 0) {
        if (gid === 0) money += cnt;
        else if (gid === -100) {
          money += cnt;
          isYuanBao = true;
        } else {
          await this.goods.addGoods(uid, gid, cnt, log.goods);
        }
        const good = (await this.row(sql<Row>`select * from cfg_goods where gid = ${gid}`)) ?? {};
        ret.push({ ...good, count: cnt, gype: '0', gtype: 0 });
      } else if (type === 1) {
        const armor = (await this.row(sql<Row>`select * from cfg_armor where id = ${gid}`)) ?? {};
        ret.push({
          ...armor,
          count: cnt,
          gtype: 1,
          hp: armor.ori_hp_max,
          hp_max: armor.ori_hp_max,
        });
        await this.rewards.addArmor(uid, gid, cnt, log.armor);
      } else if (type === 2) {
        const thing = (await this.row(sql<Row>`select * from cfg_things where tid = ${gid}`)) ?? {};
        ret.push({ ...thing, count: cnt, gtype: 2 });
        await this.goods.addThings(uid, gid, cnt, log.things);
      }
    }
    if (money > 0) {
      if (isYuanBao) await this.rewards.addMoney(uid, money, log.money);
      else await this.rewards.addGift(uid, money, log.money);
    }
    return ret;
  }

  private async row(query: ReturnType<typeof sql<Row>>): Promise<Row | undefined> {
    return (await query.execute(this.scope.db)).rows[0];
  }
}
