import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { GameState, GameStateService } from '../core/game-state.service';
import { phpIntval, phpNum, phpString } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

const PAGE_SIZE = 10;
const RANK_TABLES: Record<string, string> = {
  user: 'rank_user',
  union: 'rank_union',
  union_city: 'rank_union_city',
  hero_level: 'rank_hero',
  hero_command: 'rank_hero_command',
  hero_affairs: 'rank_hero_affairs',
  hero_bravery: 'rank_hero_bravery',
  hero_wisdom: 'rank_hero_wisdom',
  city_people: 'rank_city',
  city_type: 'rank_city_type',
  jungong: 'rank_jungong',
  juanxian: 'rank_juanxian',
  qinwang: 'rank_qinwang',
  gongpin: 'rank_gongpin',
  jungong_union: 'rank_jungong_union',
  juanxian_union: 'rank_juanxian_union',
  qinwang_union: 'rank_qinwang_union',
  gongpin_union: 'rank_gongpin_union',
  military: 'rank_military',
  military_attack: 'rank_military_attack',
  military_defence: 'rank_military_defence',
  rich: 'rank_rich',
  rich_day: 'rank_rich_day',
  rich_month: 'rank_rich_month',
  battle_total: 'rank_battle_total',
  battle_week: 'rank_battle_week',
  battle_day: 'rank_battle_day',
  achivement: 'rank_achivement',
  achivement_point: 'rank_achivement_point',
  activity: 'rank_activity',
  activity_today: 'rank_activity_today',
  activity_yesterday: 'rank_activity_yesterday',
  KingRankTotal: 'rank_user_level',
};

const MY_RANK_TASKS: Record<string, number> = {
  user: 315,
  military: 316,
  military_attack: 317,
  military_defence: 318,
};

/** RankFunc.php's shared paginated rank queries. */
@Injectable()
export class RankCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly state: GameStateService,
    private readonly tasks: TaskRules,
  ) {}

  @GlobalCommand()
  async getPageRank(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.getRank(phpIntval(param[0]) * PAGE_SIZE, phpString(param[1]));
  }

  @GlobalCommand()
  async getRankRank(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const rank = Math.floor((phpNum(param[0]) - 1) / PAGE_SIZE) * PAGE_SIZE;
    return this.getRank(rank, phpString(param[1]));
  }

  @GlobalCommand()
  async getNameRank(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const type = phpString(param[1]);
    const table = this.table(type);
    const rows = await this.rows(sql<Row>`select * from ${table}
      where name like ${`%${phpString(param[0])}%`} order by rand() limit ${PAGE_SIZE}`);
    return [await this.state.value(GameState.RankUpdated), 1, 0, type, rows];
  }

  @GlobalCommand()
  async getMyRank(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const type = phpString(param[1]);
    const table = this.table(type);
    let rank = phpNum(
      await this.cell(sql<Row>`select \`rank\` from ${table} where name = ${phpString(param[0])}`),
    );
    const task = MY_RANK_TASKS[type];
    if (task && rank >= 1 && rank <= 1000) {
      await this.tasks.completeTaskWithTaskid(ctx.uid, task);
    }
    if (rank <= 0) rank = 1;
    return this.getRank(Math.floor((rank - 1) / PAGE_SIZE) * PAGE_SIZE, type);
  }

  private async getRank(start: number, type: string): Promise<unknown[]> {
    const table = this.table(type);
    const rowCount = phpNum(await this.cell(sql<Row>`select count(*) from ${table}`));
    let pageCount = Math.ceil(rowCount / PAGE_SIZE);
    let page = Math.floor((start + PAGE_SIZE - 1) / PAGE_SIZE);
    if (page >= pageCount) page = pageCount - 1;
    if (rowCount <= 0) {
      page = 0;
      pageCount = 0;
    }
    const rows =
      rowCount > 0 && start < rowCount
        ? await this.rows(
            sql<Row>`select * from ${table} where \`rank\` > ${start} limit ${PAGE_SIZE}`,
          )
        : [];
    return [
      await this.state.value(GameState.RankUpdated),
      rowCount > 0 && start < rowCount ? pageCount : 0,
      rowCount > 0 && start < rowCount ? page : 0,
      type,
      rows,
    ];
  }

  private table(type: string) {
    const table = RANK_TABLES[type];
    if (!table) throw GameError.lang('activity.invalid_param');
    return sql.ref(table);
  }

  private async rows(query: ReturnType<typeof sql<Row>>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows;
  }

  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = (await this.rows(query))[0];
    return row ? Object.values(row)[0] : false;
  }
}
