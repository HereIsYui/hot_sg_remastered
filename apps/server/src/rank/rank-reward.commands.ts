import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GameState, GameStateService } from '../core/game-state.service';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { RewardRules } from '../core/reward-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

const DAY = 86400;
const KING_ACT_ID = 1000000;
const ACTIVITY_LOG = { goods: 4, armor: 4, things: 4, money: 60 };
const KING_LOG = { goods: 5, armor: 5, things: 5, money: 65 };

/** RankFunc.php activity configuration and the three kinds of rank reward. */
@Injectable()
export class RankRewardCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly state: GameStateService,
    private readonly lang: LangService,
    private readonly rewards: RewardRules,
  ) {}

  @GlobalCommand()
  async getRankConfig(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const type = phpString(param[0]);
    if (type === 'KingRankTotal') return [await this.kingRewardEnabled(ctx.uid)];
    const act = await this.latestActivity();
    if (!act) return [];
    const ret: unknown[] = [act];
    const now = phpNum(act.now);
    if (type === 'activity') {
      let enabled = false;
      if (phpNum(act.endtime) < now && phpNum(act.reward_endtime) > now) {
        const info = await this.row(sql<Row>`select l.rank, l.reward
          from cfg_activity_rank_reward r, log_activity_rank l
          where l.uid = ${ctx.uid} and r.actid = ${act.actid} and r.actid = l.actid
          and l.rank >= r.minrank and l.rank <= r.maxrank`);
        enabled = !!info && phpIntval(info.reward) === 0;
      }
      ret.push(enabled ? 1 : 0);
    } else if (type === 'activity_today') {
      ret.push(0);
    } else if (type === 'activity_yesterday') {
      const day = Math.floor((now - phpNum(act.starttime)) / DAY);
      let enabled = false;
      if (day > 0 && now - phpNum(act.endtime) < DAY) {
        const info = await this.row(sql<Row>`select l.rank, l.reward
          from cfg_activity_rank_reward_day r, log_activity_rank_day l
          where l.uid = ${ctx.uid} and r.actid = ${act.actid} and l.day = ${day}
          and r.day = l.day and r.actid = l.actid and l.rank >= r.minrank and l.rank <= r.maxrank`);
        enabled = !!info && phpIntval(info.reward) === 0;
      }
      ret.push(enabled ? 1 : 0);
    }
    return ret;
  }

  @GlobalCommand()
  async getRankReward(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const type = phpString(param[0]);
    if (type === 'KingRankTotal') return this.kingReward(ctx.uid);
    const act = await this.row(sql<Row>`select *, unix_timestamp() as now from cfg_activity_rank
      where starttime < unix_timestamp() and reward_endtime > unix_timestamp()`);
    if (!act) return [0, this.lang.t('activity.no_rank_activity')];
    const actid = phpIntval(act.actid);
    const now = phpNum(act.now);
    if (type === 'activity') {
      if (phpNum(act.endtime) > now) return [0, this.lang.t('activity.not_in_valid_rank')];
      const reward = await this.row(sql<Row>`select r.*, rw.reward from rank_activity r,
        cfg_activity_rank_reward rw where r.uid = ${ctx.uid} and r.rank >= rw.minrank
        and r.rank <= rw.maxrank and rw.actid = ${actid}`);
      if (!reward) return [0, this.lang.t('activity.not_in_valid_rank')];
      return this.claimActivity(ctx.uid, actid, reward, ACTIVITY_LOG);
    }
    if (type === 'activity_yesterday') {
      const day = Math.floor((now - phpNum(act.starttime)) / DAY);
      const reward = await this.row(sql<Row>`select r.*, rw.reward from rank_activity_yesterday r,
        cfg_activity_rank_reward_day rw where r.uid = ${ctx.uid} and r.rank >= rw.minrank
        and r.rank <= rw.maxrank and rw.actid = ${actid} and rw.day = ${day}`);
      if (!reward) return [0, this.lang.t('activity.not_in_valid_rank')];
      const claimed = await this.row(sql<Row>`select 1 as x from log_activity_rank_day
        where actid = ${actid} and uid = ${ctx.uid} and day = ${day} and reward = 1`);
      if (claimed) return [0, this.lang.t('activity.reward_already_get')];
      let items: unknown[] = [];
      await this.scope.transaction(async () => {
        await sql`insert into log_activity_rank_day (actid, day, \`rank\`, uid, reward, time)
          values (${actid}, ${day}, ${phpIntval(reward.rank)}, ${ctx.uid}, 1, unix_timestamp())
          on duplicate key update reward = 1, time = unix_timestamp()`.execute(this.scope.db);
        items = await this.rewards.parseAndAddReward(
          ctx.uid,
          phpString(reward.reward),
          ACTIVITY_LOG,
        );
      });
      return [1, items];
    }
    return [0, this.lang.t('activity.invalid_param')];
  }

  private async claimActivity(uid: number, actid: number, reward: Row, log: typeof ACTIVITY_LOG) {
    const claimed = await this.row(sql<Row>`select 1 as x from log_activity_rank
      where actid = ${actid} and uid = ${uid} and reward = 1`);
    if (claimed) return [0, this.lang.t('activity.reward_already_get')];
    let items: unknown[] = [];
    await this.scope.transaction(async () => {
      await sql`insert into log_activity_rank (actid, \`rank\`, uid, reward, time)
        values (${actid}, ${phpIntval(reward.rank)}, ${uid}, 1, unix_timestamp())
        on duplicate key update reward = 1, time = unix_timestamp()`.execute(this.scope.db);
      items = await this.rewards.parseAndAddReward(uid, phpString(reward.reward), log);
    });
    return [1, items];
  }

  private async kingRewardEnabled(uid: number): Promise<number> {
    const { start, end, now } = await this.kingWindow();
    if (now < start || now > end) return 0;
    const info = await this.row(sql<Row>`select * from log_user_level where uid = ${uid}`);
    return info && phpIntval(info.reward) !== 1 ? 1 : 0;
  }

  private async kingReward(uid: number): Promise<unknown[]> {
    const { start, end, now } = await this.kingWindow();
    if (now < start || now > end) throw GameError.lang('kingReward.can_not_get');
    const info = await this.row(sql<Row>`select * from log_user_level where uid = ${uid}`);
    if (!info) throw GameError.lang('activity.not_in_valid_rank');
    if (phpIntval(info.reward) === 1) throw GameError.lang('activity.reward_already_get');
    if (phpNum(info.rank) > 100) throw GameError.lang('king.out_rank_range');
    const reward = await this.cell(sql<Row>`select reward from cfg_activity_rank_reward
      where actid = ${KING_ACT_ID} and minrank <= ${info.rank} and maxrank >= ${info.rank}`);
    if (phpEmpty(reward)) throw GameError.lang('kingReward.not_find_data');
    let items: unknown[] = [];
    await this.scope.transaction(async () => {
      await sql`update log_user_level set reward = 1, time = ${now} where uid = ${uid}`.execute(
        this.scope.db,
      );
      items = await this.rewards.parseAndAddReward(uid, phpString(reward), KING_LOG);
    });
    return [1, items];
  }

  private async kingWindow(): Promise<{ start: number; end: number; now: number }> {
    const now = phpNum(await this.cell(sql<Row>`select unix_timestamp()`));
    const open = phpNum(await this.state.value(GameState.OpenTime));
    const oldSign = phpNum(await this.cell(sql<Row>`select unix_timestamp('2014-4-3 15:00:00')`));
    const actStart = open < oldSign ? oldSign : open;
    return { start: actStart + 14 * DAY, end: actStart + 21 * DAY, now };
  }

  private async latestActivity(): Promise<Row | undefined> {
    return this.row(sql<Row>`select *, unix_timestamp() as now from cfg_activity_rank
      order by endtime desc limit 1`);
  }

  private async row(query: ReturnType<typeof sql<Row>>): Promise<Row | undefined> {
    return (await query.execute(this.scope.db)).rows[0];
  }

  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : false;
  }
}
