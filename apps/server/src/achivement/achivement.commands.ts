import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { sprintf } from '../common/sprintf';
import { phpEmpty, phpIntval } from '../core/php';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** AchivementFunc.php:6 — the achievement list shows 5 rows per page. */
const ACHIVE_PAGE_CPP = 5;

/**
 * The cfg templates were written for MySQL 5.x, where `rank` is a plain column name; MySQL 8
 * reserves RANK for window functions and rejects `WHERE rank=1` verbatim. Quote it (and any
 * already-quoted text stays untouched) before executing a template, so the run matches the
 * original's result on the modern server too.
 */
function executableTemplate(template: string): string {
  return template.replace(/\brank\b/gi, '`rank`');
}

/**
 * AchivementFunc.php: the three read-only achievement queries (the write path
 * finishAchivement/checkUserAchivement lives in TaskRewards). All three take the uid the
 * client sent as their first argument and overwrite the session uid with it, like the original.
 */
@Injectable()
export class AchivementCommands {
  constructor(private readonly scope: DbScope) {}

  /**
   * AchivementFunc.php:7-27 — [成就点数, 最近两项成就, 每组 {group, group_name, total_count,
   * finish_count}]. The original orders the recent two by `time desc` only; ties follow the
   * storage engine, which is InnoDB on both the legacy and the dev database.
   */
  @GlobalCommand()
  async getOverviewStat(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = phpIntval(param[0]);
    const point = await this.cell(
      sql<Row>`select achivement_point from sys_user where uid = ${uid}`,
    );
    const recent = await this.rows(sql<Row>`select b.id, b.name, b.content, b.point,
        case when time is null then '--' else time end as achieveGetTime, image
      from sys_user_achivement a, cfg_achivement b
      where a.achivement_id = b.id and uid = ${uid} order by time desc limit 2`);
    const totalCnt = await this.rows(sql<Row>`select \`group\`, b.name as group_name,
        count(0) as total_count, 0 as finish_count
      from cfg_achivement a, cfg_achivement_group b
      where a.group = b.id and state = 1 group by \`group\``);
    const finishRows = await this.rows(sql<Row>`select b.group, count(0) as finish_count
      from sys_user_achivement a, cfg_achivement b
      where b.state = 1 and a.achivement_id = b.id and uid = ${uid} group by b.group`);
    const finishCnt = new Map<number, unknown>();
    for (const row of finishRows) finishCnt.set(phpIntval(row.group), row.finish_count);
    for (const item of totalCnt) {
      const finished = finishCnt.get(phpIntval(item.group));
      item.finish_count = phpEmpty(finished) ? 0 : finished;
    }
    return [point, recent, totalCnt];
  }

  /**
   * AchivementFunc.php:29-54 — [count, page rows] of one group, filtered by 完成状态 type
   * (0 全部, 1 已完成, 2 未完成), 5 rows per page. Only achievements whose open_time is
   * unlocked show up: 0 always, 1 once the user left 新手保护 (sys_user.state in (0,2)),
   * 2 once 黄巾之乱 finished (mem_state state=5 value=1).
   */
  @GlobalCommand()
  async getAchivementsByGroup(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = phpIntval(param[0]);
    const group = phpIntval(param[1]);
    const subgroup = phpIntval(param[2]);
    const type = phpIntval(param[3]);
    const page = phpIntval(param[4]);
    const start = page * ACHIVE_PAGE_CPP;

    const open = [0];
    if (await this.check(sql`select state from sys_user where uid = ${uid} and state in (0, 2)`)) {
      open.push(1);
    }
    if (phpIntval(await this.cell(sql`select value from mem_state where state = 5`)) === 1) {
      open.push(2);
    }
    const openTime = sql` and b.open_time in (${sql.join(
      open.map((v) => sql`${v}`),
      sql`, `,
    )})`;

    const ret: unknown[] = [];
    if (type === 1) {
      ret.push(
        await this.cell(sql<Row>`select count(*) from sys_user_achivement a, cfg_achivement b
          where b.state = 1 and a.achivement_id = b.id and uid = ${uid}
            and \`group\` = ${group} and sub_group = ${subgroup} ${openTime}`),
      );
      ret.push(
        await this.rows(sql<Row>`select b.id, b.name, b.content, b.point, image,
            time as achieveGetTime
          from sys_user_achivement a, cfg_achivement b
          where b.state = 1 and a.achivement_id = b.id and uid = ${uid}
            and \`group\` = ${group} and sub_group = ${subgroup} ${openTime}
          order by time desc limit ${start}, ${ACHIVE_PAGE_CPP}`),
      );
    } else if (type === 2) {
      ret.push(
        await this.cell(sql<Row>`select count(*) from cfg_achivement b
          left join sys_user_achivement a on a.achivement_id = b.id and uid = ${uid}
          where state = 1 and \`group\` = ${group} and uid is null ${openTime}`),
      );
      ret.push(
        await this.rows(sql<Row>`select id, name, content, point, image, '--' as achieveGetTime
          from cfg_achivement b
          left join sys_user_achivement a on a.achivement_id = b.id and uid = ${uid}
          where state = 1 and \`group\` = ${group} and uid is null ${openTime}
          order by b.id limit ${start}, ${ACHIVE_PAGE_CPP}`),
      );
    } else if (type === 0) {
      ret.push(
        await this.cell(sql<Row>`select count(*) from cfg_achivement b
          where state = 1 and \`group\` = ${group} ${openTime}`),
      );
      ret.push(
        await this.rows(sql<Row>`select id, name, content, point, image,
            case when time is null then '--' else time end as achieveGetTime
          from cfg_achivement b
          left join sys_user_achivement a on a.achivement_id = b.id and uid = ${uid}
          where state = 1 and \`group\` = ${group} ${openTime}
          order by time desc, b.id asc limit ${start}, ${ACHIVE_PAGE_CPP}`),
      );
    }
    return ret;
  }

  /**
   * AchivementFunc.php:56-98 — [成就行, 进度数组, 完成人数]. The progress rows depend on the
   * achievement type: 1 实时成就 has none, 2 累积成就 has {targetValue, userValue} where
   * userValue comes from the cfg_achivement.sql_current_value template (sprintf'd with the uid
   * and executed as-is), 3 分类成就 has {content, isDone} per cfg_achivement_goal whose
   * sql_check_goal template is likewise executed. sql_current_value is blanked before the reply.
   */
  @GlobalCommand()
  async getAchivementDetail(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = phpIntval(param[0]);
    const aid = phpIntval(param[1]);
    const archiveInfo = await this.row(sql<Row>`select id, name, content, todo, image, type,
      sql_current_value, target_value from cfg_achivement where id = ${aid}`);
    const ret: unknown[] = [archiveInfo ?? false];
    const progress: unknown[] = [];
    if (
      await this.check(
        sql`select 1 from sys_user_achivement where uid = ${uid} and achivement_id = ${aid}`,
      )
    ) {
      if (phpIntval(archiveInfo?.type) === 2) {
        progress.push({
          targetValue: archiveInfo?.target_value,
          userValue: archiveInfo?.target_value,
        });
      } else if (phpIntval(archiveInfo?.type) === 3) {
        progress.push(
          ...(await this.rows(sql<Row>`select content, 1 as isDone
            from cfg_achivement_goal a, cfg_achivement_goal_mapping b
            where a.id = b.achivement_goal_id and achivement_id = ${aid}`)),
        );
      }
      ret.push(progress);
    } else {
      if (phpIntval(archiveInfo?.type) === 2) {
        // The template is data from cfg_achivement; only the uid is substituted, like sprintf.
        const template = executableTemplate(
          sprintf(String(archiveInfo?.sql_current_value ?? ''), uid),
        );
        progress.push({
          targetValue: archiveInfo?.target_value,
          userValue: await this.cell(sql.raw<Row>(template)),
        });
      } else if (phpIntval(archiveInfo?.type) === 3) {
        const goals = await this.rows(sql<Row>`select content, a.sql_check_goal
          from cfg_achivement_goal a, cfg_achivement_goal_mapping b
          where a.id = b.achivement_goal_id and achivement_id = ${aid}`);
        for (const goal of goals) {
          progress.push({
            content: goal.content,
            isDone: (await this.check(
              sql.raw<Row>(executableTemplate(sprintf(String(goal.sql_check_goal ?? ''), uid))),
            ))
              ? 1
              : 0,
          });
        }
      }
      ret.push(progress);
    }
    ret.push(
      await this.cell(
        sql<Row>`select count(0) from sys_user_achivement where achivement_id = ${aid}`,
      ),
    );
    const first = ret[0];
    if (typeof first === 'object' && first !== null) {
      (first as Row).sql_current_value = '';
    } else {
      // A missing row auto-vivifies like PHP's `$ret[0]["sql_current_value"] = ""` on false.
      ret[0] = { sql_current_value: '' };
    }
    return ret;
  }

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async row(query: RawBuilder<Row>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : false;
  }

  private async check(query: RawBuilder<Row>): Promise<boolean> {
    return (await this.rows(query)).length > 0;
  }
}
