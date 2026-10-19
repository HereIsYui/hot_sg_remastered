import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { phpCompare, phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';

export type Row = Record<string, unknown>;

/** cfg_task_goal.sort values with special handling. */
export const GoalSort = {
  Resource: 1,
  Accumulated: 50,
  SingleRun: 80,
  Battle: 100,
  CrossBattle: 110,
  CrossPveBattle: 120,
} as const;

/** Sort-1 goals 31-43: the day's battlefield wins (log_battle_honour filter, wins needed). */
const DAILY_BATTLE_GOALS: Record<number, [RawBuilder<unknown>, number]> = {
  31: [sql`battleid in (1001, 2001, 3001, 4001)`, 50],
  32: [sql`level = 10 and battleid = 1001`, 1],
  33: [sql`battleid = 1001`, 10],
  34: [sql`unionid = 3 and level = 10 and battleid = 2001`, 1],
  35: [sql`unionid = 3 and battleid = 2001`, 10],
  36: [sql`unionid = 4 and level = 10 and battleid = 2001`, 1],
  37: [sql`unionid = 4 and battleid = 2001`, 10],
  40: [sql`level = 10 and battleid = 3001`, 1],
  41: [sql`battleid = 3001`, 10],
  42: [sql`level = 10 and battleid = 4001`, 1],
  43: [sql`battleid = 4001`, 10],
};

/** Sort-1 goals 53-56: being in the top 1000 of a ranking. */
const RANK_TABLES: Record<number, string> = {
  53: 'rank_user',
  54: 'rank_military',
  55: 'rank_military_attack',
  56: 'rank_military_defence',
};

/** Sort-1 goals 12-15: the base production of the capital's farms, mills, quarries or mines. */
const PRODUCTION_BUILDINGS: Record<number, number> = { 12: 1, 13: 2, 14: 3, 15: 4 };

/** Sort-1 goals on the current city's mem_city_resource column. */
const CITY_RESOURCE_COLUMNS: Record<number, string> = {
  1: 'gold',
  2: 'food',
  3: 'wood',
  4: 'rock',
  5: 'iron',
  6: 'people',
  7: 'morale',
  8: 'complaint',
  10: 'people_max',
};

/** TaskFunc.php::checkGoalComplete and the task-level checks built on it. */
@Injectable()
export class TaskGoals {
  constructor(
    private readonly scope: DbScope,
    private readonly users: UserRules,
  ) {}

  /**
   * The task's goals with the player's progress (`uid` is null until the goal was recorded).
   * `count` stays a string as PHP read it, which decides how it compares with a missing value.
   */
  async goalsOf(uid: number, tid: unknown, ordered = false): Promise<Row[]> {
    const goals = await this.rows(sql`select g.*, u.uid, u.currentcount from cfg_task_goal g
      left join sys_user_goal u on u.gid = g.id and u.uid = ${uid}
      where g.tid = ${tid} ${ordered ? sql`order by g.id` : sql``}`);
    for (const goal of goals) goal.count = phpString(goal.count);
    return goals;
  }

  /**
   * checkTaskCount / checkTaskComplete for each task: whether all goals are reached, battle
   * tasks (a sort-100 goal) instead by whether the last goal looked at was recorded. Like the
   * original, a task without goals judges by the previous task's last goal.
   */
  async completion(uid: number, tasks: Row[]): Promise<boolean[]> {
    const result: boolean[] = [];
    let goal: Row | undefined;
    for (const task of tasks) {
      let complete = true;
      for (goal of await this.goalsOf(uid, task.id)) {
        if (!(await this.isGoalComplete(uid, goal))) {
          complete = false;
          break;
        }
      }
      if (
        await this.check(sql`select 1 from cfg_task_goal
          where tid = ${goal?.tid ?? ''} and sort = ${GoalSort.Battle}`)
      ) {
        complete = !phpEmpty(goal?.uid);
      }
      result.push(complete);
    }
    return result;
  }

  /** checkTaskCount */
  async countComplete(uid: number, tasks: Row[]): Promise<number> {
    return (await this.completion(uid, tasks)).filter(Boolean).length;
  }

  /** checkTaskComplete: sets each task's `state` and raises the task alarm on the first done. */
  async markComplete(uid: number, tasks: Row[]): Promise<void> {
    const states = await this.completion(uid, tasks);
    tasks.forEach((task, i) => (task.state = states[i]));
    if (states.includes(true)) {
      await sql`insert into sys_alarm (uid, task) values (${uid}, 1)
        on duplicate key update task = 1`.execute(this.scope.db);
    }
  }

  /** checkGoalComplete. Mostly a boolean; two battlefield goals answer with the matching uid. */
  async isGoalComplete(uid: number, goal: Row): Promise<unknown> {
    const sort = phpIntval(goal.sort);
    const type = phpIntval(goal.type);
    const need = goal.count;
    const reached = (value: unknown) => phpCompare(value, need) >= 0;
    if (!phpEmpty(goal.uid) && sort !== GoalSort.Accumulated && sort !== GoalSort.SingleRun) {
      return true;
    }
    if (
      sort === GoalSort.Battle ||
      sort === GoalSort.CrossBattle ||
      sort === GoalSort.CrossPveBattle
    ) {
      return false;
    }
    switch (sort) {
      case GoalSort.Resource:
        return this.resourceGoal(uid, goal);
      case 2:
        return reached(
          await this.cell(sql`select count from sys_goods where uid = ${uid} and gid = ${type}`),
        );
      case 3:
        return reached(
          await this.cell(sql`select count from sys_city_soldier s, sys_user u
            where u.uid = ${uid} and u.lastcid = s.cid and s.sid = ${type}`),
        );
      case 4:
        return reached(
          await this.cell(sql`select count from sys_city_defence d, sys_user u
            where u.uid = ${uid} and u.lastcid = d.cid and d.did = ${type}`),
        );
      case 5:
        return reached(
          await this.cell(sql`select count from sys_things where uid = ${uid} and tid = ${type}`),
        );
      case 6: {
        const strong = phpIntval(goal.strong_level);
        return reached(
          await this.cell(sql`select count(1) from sys_user_armor
            where uid = ${uid} and hid = 0 ${type > 0 ? sql`and armorid = ${type}` : sql``}
            and strong_level >= ${strong}`),
        );
      }
      case 8:
        return reached(
          await this.cell(sql`select count(*) from sys_city where uid = ${uid} and type = ${type}`),
        );
      case 9:
        return reached(
          await this.cell(sql`select count(*) from sys_city_hero
            where uid = ${uid} and npcid = ${type}`),
        );
      case 101:
        return reached(
          await this.cell(sql`select count from temp_act_event
            where uid = ${uid} and eid = ${type}`),
        );
      case 102: {
        const level = phpIntval(goal.strong_level);
        return reached(
          await this.cell(sql`select count(*) from log_battle_honour
            where uid = ${uid} and result = 0 and battleid = ${type}
            ${level === 0 ? sql`` : sql`and level = ${level}`}
            and quittime >= unix_timestamp(curdate())`),
        );
      }
      case 103:
        return reached(
          await this.cell(sql`select count(*) from sys_city_hero
            where uid = ${uid} and herotype = ${type}`),
        );
      case 104: {
        const act = await this.row(sql`select starttime, endtime, type from cfg_act
          where actid = ${type}`);
        if (!act) return false;
        return reached(
          await this.cell(sql`select count(count) from log_act where uid = ${uid}
            and actid in (select actid from cfg_act where starttime = ${act.starttime}
              and endtime = ${act.endtime} and type = ${act.type})
            and time >= unix_timestamp(curdate())`),
        );
      }
      case 105:
        return false;
      case GoalSort.Accumulated:
      case GoalSort.SingleRun:
        return reached(goal.currentcount);
      case 10:
      case 11:
      case 12:
        return phpLooseEquals(
          1,
          await this.cell(sql`select state from sys_attack_position
            where uid = ${uid} and tid = ${goal.tid}`),
        );
      case 13:
        return reached(
          await this.cell(sql`select max(level) from sys_building
            where cid = ${await this.lastcid(uid)} and bid = ${type}`),
        );
      case 14:
        return (
          phpCompare(
            await this.cell(sql`select count(*) from log_soldier_convert where uid = ${uid}`),
            0,
          ) > 0
        );
      case 202:
        return reached(
          await this.cell(sql`select sum(count) from mem_city_captive
            where cid = ${await this.lastcid(uid)} ${type === 0 ? sql`` : sql`and sid = ${type}`}`),
        );
      case 201:
        return this.heroLevelGoal(uid, goal);
      default:
        return this.otherGoal(uid, goal);
    }
  }

  private async resourceGoal(uid: number, goal: Row): Promise<unknown> {
    const type = phpIntval(goal.type);
    const need = goal.count;
    const reached = (value: unknown) => phpCompare(value, need) >= 0;
    const userCell = (column: string) =>
      this.cell(sql`select ${sql.ref(column)} from sys_user where uid = ${uid}`);

    const rankTable = RANK_TABLES[type];
    if (rankTable) {
      const name = await userCell('name');
      const rank = await this.cell(sql`select \`rank\` from ${sql.table(rankTable)}
        where name = ${name}`);
      return phpCompare(rank, 1) >= 0 && phpCompare(rank, 1000) <= 0;
    }
    const building = PRODUCTION_BUILDINGS[type];
    if (building) {
      const lastcid = await this.lastcid(uid);
      return reached(
        await this.cell(sql`select sum(b.level * (b.level + 1) * 50) from sys_city c, sys_building b
          where c.cid = ${lastcid} and b.cid = ${lastcid} and b.bid = ${building}`),
      );
    }
    const dailyBattle = DAILY_BATTLE_GOALS[type];
    if (dailyBattle) return this.dailyBattleGoal(uid, goal, ...dailyBattle);

    switch (type) {
      case 9:
        return reached(await userCell('prestige'));
      case 11: {
        const unionId = await userCell('union_id');
        if (phpLooseEquals(unionId, 0)) return false;
        return reached(await this.cell(sql`select member from sys_union where id = ${unionId}`));
      }
      case 17:
        return reached(await userCell('officepos'));
      case 18:
        return reached(await this.users.bufferNobility(uid, await userCell('nobility')));
      case 19:
      case 22:
      case 122:
        return reached(await userCell('money'));
      case 20:
        return reached(
          await this.cell(sql`select count(*) from sys_city
            where uid = ${uid} and type > 0 and type < 5`),
        );
      case 21: {
        const unionId = await userCell('union_id');
        if (phpLooseEquals(unionId, 0)) return false;
        return reached(
          await this.cell(sql`select count(*) from sys_city a, sys_user b
            where a.type > 0 and a.type < 5 and a.uid = b.uid and b.union_id = ${unionId}`),
        );
      }
      case 38:
        return this.cell(sql`select uid from log_battle_honour
          where uid = ${uid} and battleid = 1001 and result = 0 limit 1`);
      case 39:
        return this.cell(sql`select uid from log_battle_honour
          where uid = ${uid} and battleid = 2001 and result = 0 limit 1`);
      case 44:
        return reached(
          await this.cell(sql`select count(1) from bak_sys_user_battle_state
            where uid = ${uid} and bid = 6001 and sent_troop_count > 0
            and unix_timestamp(jointime) >= unix_timestamp(curdate())`),
        );
      case 45:
      case 46:
        return reached(
          await this.cell(sql`select count(1) from bak_sys_user_battle_state
            where uid = ${uid} and bid = 6001 and iswinner = 1
            and quittime >= unix_timestamp(curdate())`),
        );
      case 50:
        return (
          phpCompare(
            await this.cell(sql`select count(1) from sys_city_hero where state = 0 and uid = ${uid}
              and level >= ${need} and herotype != '1000'`),
            1,
          ) >= 0
        );
      case 51:
      case 52:
        return (
          phpCompare(
            await this.cell(sql`select count(1) from sys_user_armor a, cfg_armor b
              where a.hid = 0 and a.uid = ${uid} and a.armorid = b.id
              and ${type === 51 ? sql`b.type` : sql`b.part`} = ${need}`),
            1,
          ) >= 0
        );
      case 60:
        return reached(
          await this.cell(sql`select count(1) from bak_sys_user_battle_state
            where uid = ${uid} and bid = 9001`),
        );
      case 61:
      case 62:
      case 63:
      case 64:
        return reached(
          await this.cell(sql`select count(1) from bak_sys_user_battle_state
            where uid = ${uid} and bid = 9001 and state = 2`),
        );
    }

    const column = CITY_RESOURCE_COLUMNS[type];
    if (column === undefined && type !== 16) return false;
    const res = await this.row(sql`select c.* from mem_city_resource c, sys_user u
      where c.cid = u.lastcid and u.uid = ${uid}`);
    if (type === 16) return reached(phpNum(res?.people) * phpNum(res?.tax) * 0.01);
    return reached(res?.[column!] ?? null);
  }

  /**
   * Wins logged since the reward was last taken; never on the day it was taken. The original
   * starts "today" at `now - now % 86400 + 1`, i.e. 08:00:01 Beijing time.
   */
  private async dailyBattleGoal(
    uid: number,
    goal: Row,
    filter: RawBuilder<unknown>,
    wins: number,
  ): Promise<boolean> {
    const now = phpNum(await this.cell(sql`select unix_timestamp()`));
    const dayStart = now - (now % 86400) + 1;
    if (
      !phpEmpty(
        await this.cell(sql`select uid from log_everyday_task where uid = ${uid}
          and tid = ${goal.tid} and gettime >= ${dayStart} and gettime <= ${dayStart + 86400}`),
      )
    ) {
      return false;
    }
    const lastTaken = await this.cell(sql`select gettime from log_everyday_task
      where uid = ${uid} and tid = ${goal.tid}`);
    const since = phpEmpty(lastTaken) ? 0 : lastTaken;
    const count = await this.cell(sql`select count(*) from log_battle_honour
      where uid = ${uid} and result = 0 and ${filter}
      and quittime >= ${since} and quittime <= ${now}`);
    return phpCompare(count, wins) >= 0;
  }

  private async heroLevelGoal(uid: number, goal: Row): Promise<boolean> {
    const herotype = phpIntval(goal.type);
    if (herotype === 155) {
      return (
        phpCompare(
          await this.cell(sql`select count(*) from sys_city_hero
            where herotype = ${herotype} and state = 0 and uid = ${uid}`),
          goal.count,
        ) >= 0
      );
    }
    const level = await this.cell(sql`select max(level) from sys_city_hero
      where herotype = ${herotype} and state = 0 and uid = ${uid}`);
    if (phpEmpty(level)) return false;
    return phpCompare(level, phpIntval(goal.strong_level)) >= 0;
  }

  /** The goals keyed by task id, then the remaining sorts. */
  private async otherGoal(uid: number, goal: Row): Promise<boolean> {
    const tid = phpIntval(goal.tid);
    const sort = phpIntval(goal.sort);
    const reached = (value: unknown) => phpCompare(value, goal.count) >= 0;
    if (tid === 101763) {
      const openTime = phpNum(await this.cell(sql`select value from mem_state where state = 6`));
      return (
        phpCompare(
          await this.cell(sql`select -sum(count) from log_goods where uid = ${uid} and gid = 82
            and count < 0 and type = 0 and time between ${openTime} and ${openTime + 14 * 86400}`),
          3,
        ) >= 0
      );
    }
    if (tid === 101764 || tid === 101765) {
      const unionId = await this.cell(sql`select union_id from sys_user
        where uid = ${uid} and union_id > 0 limit 1`);
      if (phpCompare(unionId, 0) <= 0) return false;
      const count = await this.cell(sql`select count(1) from sys_city
        where type = ${tid === 101764 ? 1 : 3}
        and uid in (select uid from sys_user where union_id = ${unionId})`);
      return phpCompare(count, tid === 101764 ? 10 : 1) >= 0;
    }
    if (tid === 102012) {
      return (
        (await this.check(
          sql`select 1 from sys_city_hero where uid = ${uid} and herotype = 147`,
        )) &&
        (await this.check(sql`select 1 from sys_goods where uid = ${uid} and gid = 19999
          and count > 0`))
      );
    }
    switch (sort) {
      case 204:
        return (
          phpCompare(
            await this.cell(sql`select unix_timestamp() - time from log_login
              where uid = ${uid} order by time desc limit 1`),
            phpNum(goal.count) * 60,
          ) >= 0
        );
      case 205:
        return reached(
          await this.cell(sql`select count(id) from sys_building
            where cid = ${await this.lastcid(uid)} and bid = ${goal.type} and state = 0`),
        );
      case 206:
        return reached(
          await this.cell(sql`select count from sys_city_soldier
            where cid = ${await this.lastcid(uid)} and sid = ${goal.type}`),
        );
      default:
        return false;
    }
  }

  private async lastcid(uid: number): Promise<unknown> {
    return this.cell(sql`select lastcid from sys_user where uid = ${uid}`);
  }

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async row(query: RawBuilder<unknown>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  /** `sql_fetch_one_cell`: false without rows. */
  private async cell(query: RawBuilder<unknown>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : false;
  }

  private async check(query: RawBuilder<unknown>): Promise<boolean> {
    return (await this.rows(query)).length > 0;
  }
}
