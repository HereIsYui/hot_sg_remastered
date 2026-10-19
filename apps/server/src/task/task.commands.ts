import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { GoalSort, TaskGoals, type Row } from './task-goals.service';
import { TaskRewards } from './task-rewards.service';

/** cfg_task_group.type: the TaskDialog tabs. */
const TaskType = {
  Growth: 0,
  Daily: 1,
  Hero: 2,
  Epic: 3,
  Commission: 4,
  Event: 5,
  Lord: 7,
} as const;

/** Commission (委托) tasks are sys_pub_reward_task ids from here up. */
const COMMISSION_BASE = 200000;
/** 君主将 tasks, limited per day by sys_user_task_num. */
const LORD_HERO_TASKS = { min: 86000, max: 86300 };
/** refreshSysTask: tasks dealt, and the price of every refresh after the day's first. */
const SYS_TASK_COUNT = 10;
const SYS_TASK_REFRESH_COST = 20;
/** log_money.type of refreshSysTask. */
const MONEY_LOG_SYS_TASK = 81;
/** 接受随机任务, completed whenever a 君主将 task is dealt. */
const TASK_RECEIVE_SYS_TASK = 332;
/** 强化所需 .. 开孔之钻: the daily tasks every player keeps. */
const DAILY_TASKS = [801, 802, 803, 804, 805];
/** 食君之禄 / 采食封邑 / 共享利益: salaries computed instead of read from cfg_task_reward. */
const TASK_OFFICE_SALARY = 250;
const TASK_NOBILITY_SALARY = 251;
const TASK_UNION_CITY_GOLD = 279;
/** 脱离保护, whose reward also brings the server's ongoing epic tasks. */
const TASK_LEAVE_PROTECTION = 243;
/** The 装备置换 group, whose tasks hand in two pieces of gear of one part. */
const ARMOR_EXCHANGE_GROUP = 104430;
const ARMOR_EXCHANGE_FIRST = 104431;
/** Tasks whose reward day is remembered for the daily battlefield goals. */
const EVERYDAY_TASKS = new Set([6001, 6101, 6102, 6201, 6202, 6211, 6212, 6301, 6302, 6401, 6402]);
/** Rewards also written to log_task. */
const LOGGED_TASKS = new Set([60601, 60602, 60623, 60624, 60625]);
/** Union famous-city gold by city type (getUnionFamousCityGold). */
const FAMOUS_CITY_GOLD: Record<number, number> = { 1: 10000, 2: 30000, 3: 100000, 4: 300000 };
/** mem_state rows. */
const State = { HuangJin: 5, DongZhuo: 7, LuoYang: 8 } as const;
const XIANDI_EDICT_TASK = 112005;

const isHuangJinDonation = (tid: number) => tid > 11000 && tid < 15000;
const isHuangJinExchange = (tid: number) => tid > 10000 && tid < 10500;
const isDongZhuoDonation = (tid: number) =>
  tid > 15000 && tid < 16000 && !(tid >= 15505 && tid <= 15516);
const isLuoYangTask = (tid: number) => tid >= 112001 && tid <= 112004;

/** TaskFunc.php::taskCanRecomplete: tasks whose reward can be taken again and again. */
async function canRecomplete(tid: number, defaultState: () => Promise<unknown>): Promise<boolean> {
  if (tid < 100000) {
    return (
      (tid > 10000 && tid < 10600) || (tid > 11000 && tid < 15000) || (tid > 15000 && tid < 16000)
    );
  }
  if (tid <= 100396) {
    return (
      (tid > 100021 && tid < 100025) ||
      (tid > 100140 && tid < 100144) ||
      tid === 100171 ||
      tid === 100201 ||
      tid === 100261 ||
      tid === 100262 ||
      tid === 100281 ||
      tid === 100291 ||
      tid === 100292 ||
      (tid >= 100311 && tid <= 100314) ||
      (tid >= 100321 && tid <= 100324) ||
      (tid >= 100341 && tid <= 100343) ||
      (tid >= 100361 && tid <= 100364) ||
      (tid >= 100381 && tid <= 100384) ||
      (tid >= 100391 && tid <= 100396)
    );
  }
  return phpLooseEquals(await defaultState(), 100);
}

/**
 * The TaskDialog commands of TaskFunc.php. Not ported: the world-event rewards (黄巾 / 董卓
 * donations, 备战洛阳), the 名将 hero tasks' rewards, and commission tasks' lists and rewards;
 * those answer with an error.
 */
@Injectable()
export class TaskCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly users: UserRules,
    private readonly goals: TaskGoals,
    private readonly rewards: TaskRewards,
    private readonly tasks: TaskRules,
  ) {}

  /**
   * `[type]` → `[groups, ...]`, each group with the number of finished tasks as `count`. Lord
   * tasks add the day's refresh count; the other kinds the 董卓 / 洛阳 states and whether the
   * nobility reaches 5. The original's lord-task query did not parse; it is fixed here.
   */
  @GlobalCommand()
  async getTaskTypeGroupList(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const db = this.scope.db;
    let type = phpIntval(param[0]);
    if (type < 0 || type > 7) type = TaskType.Growth;

    if (type === TaskType.Lord) {
      const lastUpdate = await this
        .cell(sql`select substr(from_unixtime(last_reset_sys_task), 1, 10)
        from mem_user_schedule where uid = ${uid}`);
      const today = await this.cell(sql`select substr(now(), 1, 10)`);
      if (!phpLooseEquals(lastUpdate, today)) {
        await sql`update mem_user_schedule set last_reset_sys_task = unix_timestamp()
          where uid = ${uid}`.execute(db);
        await sql`insert into mem_user_systask_num (uid, count) values (${uid}, 0)
          on duplicate key update count = 0`.execute(db);
      }
      await sql`update sys_user_task a, sys_user_taskstate b set a.state = 1
        where a.uid = ${uid} and a.uid = b.uid and a.tid = b.tid
        and b.endtime < unix_timestamp()`.execute(db);
      const groups = await this.rows(sql`select distinct g.* from sys_user_task u, cfg_task t,
          cfg_task_group g
        where u.tid = t.id and u.uid = ${uid} and u.state = 0 and g.id = t.\`group\`
        and g.type = ${type} order by g.id`);
      await this.countGroups(uid, groups, false);
      return [groups, await this.lordRefreshCount(uid)];
    }

    if (type === TaskType.Commission) return [await this.commissionGroups(uid)];

    if (type === TaskType.Daily) await this.checkDailyTask(uid);
    const groups = [
      ...(await this.rows(sql`select * from cfg_task_group
        where id in (select t.\`group\` from sys_user_task u, cfg_task t
          where u.tid = t.id and u.uid = ${uid} and u.state = 0)
        and type = ${type} order by priority, id`)),
      ...(await this.rows(sql`select * from cfg_task_group
        where type = ${type}
        and id in (select \`group\` from sys_hero_task where uid = ${uid} and state = 1)
        order by priority, id`)),
    ];
    await this.countGroups(uid, groups, true);
    const nobility = await this.users.bufferNobility(
      uid,
      await this.cell(sql`select nobility from sys_user where uid = ${uid}`),
    );
    return [
      groups,
      await this.cell(sql`select value from mem_state where state = ${State.DongZhuo}`),
      await this.cell(sql`select value from mem_state where state = ${State.LuoYang}`),
      nobility >= 5,
    ];
  }

  /** `[groupid]` → `[tasks with state = finished, finished count]`. */
  @GlobalCommand()
  async getTaskList(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.taskList(ctx.uid, phpIntval(param[0]));
  }

  /** `[tid]` → `[task, goals with state, rewards]`. */
  @GlobalCommand()
  async getTaskDetail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const tid = phpIntval(param[0]);
    if (tid >= COMMISSION_BASE && tid < 400000) {
      throw new Error('getTaskDetail: commission tasks not ported');
    }
    const goalSort = await this.cell(
      sql`select sort from cfg_task_goal where tid = ${tid} limit 1`,
    );
    const task = (await this.row(sql`select * from cfg_task where id = ${tid}`)) ?? false;
    const goals = await this.goals.goalsOf(uid, tid, true);
    for (const goal of goals) goal.state = await this.goals.isGoalComplete(uid, goal);
    if (tid === TASK_OFFICE_SALARY || tid === TASK_NOBILITY_SALARY) {
      const title =
        tid === TASK_OFFICE_SALARY
          ? sql`select p.name from sys_user u left join cfg_office_pos p on p.id = u.officepos
              where u.uid = ${uid}`
          : sql`select n.name from sys_user u left join cfg_nobility n on n.id = u.nobility
              where u.uid = ${uid}`;
      for (const goal of goals) goal.content = await this.cell(title);
    }

    let rewards: Row[];
    if (tid === TASK_OFFICE_SALARY) {
      rewards = [{ sort: 1, type: 1, count: await this.officeSalary(uid) }];
    } else if (tid === TASK_NOBILITY_SALARY) {
      const salary = await this.nobilitySalary(uid);
      rewards = [2, 3, 4, 5].map((type) => ({ sort: 1, type, count: salary }));
    } else if (tid === TASK_UNION_CITY_GOLD) {
      rewards = [{ sort: 1, type: 1, count: await this.unionFamousCityGold(uid) }];
    } else {
      rewards = await this.rows(sql`select * from cfg_task_reward where tid = ${tid}
        order by type asc`);
      await this.scaleBattleRewards(uid, goalSort, rewards);
    }
    return [task, goals, rewards];
  }

  /**
   * `[tid, heroOrGearId?, secondGearId?]`: hands in a finished task. Answers `[1]`, or `[0, msg]`
   * when the day's 君主将 tasks are used up.
   */
  @GlobalCommand()
  async getReward(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.scope.transaction(() => this.reward(ctx.uid, param));
  }

  /** `[tid, count]`: hands in a repeatable task several times at once. */
  @GlobalCommand()
  async getMultiReward(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const tid = phpIntval(param[0]);
    const times = phpIntval(param[1]);
    if (times <= 0 || times >= 1000) throw GameError.lang('getReward.invalid_count');
    if (times === 1) return this.getReward(ctx, [tid]);
    return this.scope.transaction(async () => {
      if (!(await this.canRecomplete(tid))) throw GameError.lang('getReward.not_allowed_multi');
      const goals = await this.rows(sql`select * from cfg_task_goal where tid = ${tid}`);
      for (const goal of goals) {
        goal.count = times * phpNum(goal.count);
        const type = phpIntval(goal.type);
        if (
          !(await this.goals.isGoalComplete(uid, goal)) ||
          (phpIntval(goal.sort) === GoalSort.Resource && type >= 50 && type <= 52)
        ) {
          throw GameError.lang('getReward.not_enough_things', times);
        }
      }
      if (isHuangJinDonation(tid) || isDongZhuoDonation(tid) || isLuoYangTask(tid)) {
        throw new Error(`getMultiReward(${tid}): world-event tasks not ported`);
      }
      const cid = await this.lastcid(uid);
      for (const reward of await this.rows(sql`select * from cfg_task_reward where tid = ${tid}`)) {
        reward.count = phpNum(reward.count) * times;
        await this.rewards.giveReward(uid, cid, reward);
      }
      for (const goal of goals) {
        if (phpIntval(goal.reduce) === 1) await this.rewards.reduceGoal(uid, cid, goal);
      }
      return [1];
    });
  }

  /** `[groupid]`: gives up a 名将 or commission task group; answers like getAllTaskByType. */
  @GlobalCommand()
  async dropTask(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const group = phpIntval(param[0]);
    const db = this.scope.db;
    return this.scope.transaction(async () => {
      if (group >= COMMISSION_BASE) {
        await sql`delete from sys_user_reward_task where uid = ${uid} and tid = ${group}`.execute(
          db,
        );
        await sql`update sys_pub_reward_task set number = number - 1 where id = ${group}`.execute(
          db,
        );
        return this.allTasksByType(uid, TaskType.Commission);
      }
      if (group % 10 === 1) {
        const npcid = Math.floor((group - 20001) / 10);
        const taskMax = (40000 + npcid) * 10 + 9;
        const taskMin = (40000 + npcid) * 10 + 1;
        if (
          phpLooseEquals(
            2,
            await this.cell(
              sql`select state from sys_lionize where uid = ${uid} and npcid = ${npcid}`,
            ),
          )
        ) {
          await this.rewards.deleteHero(uid, npcid);
        }
        await sql`delete from sys_attack_position where tid >= ${taskMin} and tid <= ${taskMax}`.execute(
          db,
        );
        await sql`delete from sys_user_goal where uid = ${uid} and gid >= ${taskMin}
          and gid <= ${taskMax}`.execute(db);
        await sql`delete from sys_user_task where uid = ${uid} and tid >= ${taskMin}
          and tid <= ${taskMax}`.execute(db);
        await sql`delete from sys_hero_task where uid = ${uid} and \`group\` = ${group}`.execute(
          db,
        );
        await sql`insert into log_lionize (uid, npcid, type, count, time)
          select uid, npcid, 18, 0, unix_timestamp() from sys_lionize
          where uid = ${uid} and npcid = ${npcid}`.execute(db);
        await sql`delete from sys_lionize where uid = ${uid} and npcid = ${npcid}`.execute(db);
      } else {
        const npcid = Math.floor((group - 20000) / 10);
        const tids = [20000 + npcid, 30000 + npcid];
        await sql`delete a from sys_user_goal a, cfg_task_goal b
          where a.uid = ${uid} and a.gid = b.id and b.tid in (${sql.join(tids)})`.execute(db);
        await sql`delete from sys_user_task where uid = ${uid} and tid in (${sql.join(tids)})`.execute(
          db,
        );
      }
      return this.allTasksByType(uid, TaskType.Hero);
    });
  }

  /** `[tid]`: gives up a random lord task; answers like getAllTaskByType. */
  @GlobalCommand()
  async dropSysTask(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const tid = phpIntval(param[0]);
    return this.scope.transaction(async () => {
      const task = await this.row(sql`select * from cfg_task where id = ${tid}`);
      if (!task) throw GameError.lang('sysTask.not_task_of_user');
      const group = phpNum(task.group);
      if (group < 80000 || group > 99999) throw GameError.lang('sysTask.not_systask');
      await sql`update sys_user_task set state = 1 where uid = ${uid} and tid = ${tid}`.execute(
        this.scope.db,
      );
      return this.allTasksByType(uid, TaskType.Lord);
    });
  }

  /**
   * HotelFunc.php::refreshSysTask: deals ten new 君主将 tasks, the first refresh of the day free
   * and every further one 20 元宝, and answers with the lord task list.
   */
  @GlobalCommand()
  async refreshSysTask(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    return this.scope.transaction(async () => {
      const money = await this.cell(sql`select money from sys_user where uid = ${uid}`);
      const count = await this.cell(sql`select count from mem_user_systask_num where uid = ${uid}`);
      const cost = phpNum(count) > 0 ? SYS_TASK_REFRESH_COST : 0;
      if (cost > phpNum(money)) throw GameError.lang('sysTask.money_error');
      await this.generateSysTask(uid, SYS_TASK_COUNT);
      await sql`update mem_user_systask_num set count = count + 1 where uid = ${uid}`.execute(
        this.scope.db,
      );
      await this.rewards.addMoney(uid, -cost, MONEY_LOG_SYS_TASK);
      return this.getTaskTypeGroupList(ctx, [TaskType.Lord]);
    });
  }

  /** HotelFunc.php::generateSysTask: replaces the 君主将 tasks with `times` drawn by rate. */
  private async generateSysTask(uid: number, times: number): Promise<void> {
    const db = this.scope.db;
    const { min, max } = LORD_HERO_TASKS;
    const nobility = await this.cell(sql`select nobility from sys_user where uid = ${uid}`);
    await sql`delete from sys_user_goal where uid = ${uid} and gid in (select a.id
        from cfg_task_goal a, sys_user_task b
        where a.tid = b.tid and b.tid between ${min} and ${max} and b.uid = ${uid})`.execute(db);
    await sql`delete from sys_user_task where tid between ${min} and ${max}
      and uid = ${uid}`.execute(db);
    const rows = await this.rows(sql`select tid, rate from cfg_systask_rate
      where tid >= ${min} and tid < ${max} and nobility <= ${nobility}`);
    if (rows.length === 0) return;
    let sumRate = rows.reduce((sum, row) => sum + phpNum(row.rate), 0);
    for (let i = 0; i < times; i++) {
      const rate = 1 + Math.floor(Math.random() * sumRate);
      let curRate = 0;
      for (let j = 0; j < rows.length - i; j++) {
        const row = rows[j]!;
        curRate += phpNum(row.rate);
        if (curRate >= rate) {
          await this.receiveSysTask(uid, phpIntval(row.tid));
          rows[j] = rows[rows.length - i - 1]!;
          sumRate -= phpNum(row.rate);
          break;
        }
      }
    }
  }

  /** HotelFunc.php::receiveSysTask */
  private async receiveSysTask(uid: number, tid: number): Promise<void> {
    const db = this.scope.db;
    await sql`delete from sys_user_sys_task where uid = ${uid} and tid = ${tid}`.execute(db);
    await sql`insert into sys_user_task (uid, tid, state) values (${uid}, ${tid}, 0)
      on duplicate key update state = 0`.execute(db);
    const goals = await this.rows(sql`select * from cfg_task_goal where tid = ${tid}`);
    for (const goal of goals) {
      await sql`delete from sys_user_goal where gid = ${goal.id} and uid = ${uid}`.execute(db);
      if (!phpLooseEquals(goal.sort, GoalSort.Accumulated)) continue;
      await sql`insert into sys_user_goal (gid, uid, currentcount)
        values (${goal.id}, ${uid}, 0)`.execute(db);
    }
    await this.tasks.completeTaskWithTaskid(uid, TASK_RECEIVE_SYS_TASK);
  }

  private async reward(uid: number, param: unknown[]): Promise<unknown[]> {
    const db = this.scope.db;
    const tid = phpIntval(param[0]);
    if (tid >= COMMISSION_BASE && tid < 400000) {
      throw new Error('getReward: commission tasks not ported');
    }
    const lordHeroTask = tid >= LORD_HERO_TASKS.min && tid <= LORD_HERO_TASKS.max;
    if (lordHeroTask) {
      if (!(await this.check(sql`select uid from sys_user_task_num where uid = ${uid}`))) {
        await sql`insert into sys_user_task_num (uid, type, num) values (${uid}, 1, 0)`.execute(db);
      } else if (
        await this.check(sql`select 1 from sys_user_task_num where uid = ${uid} and num >= maxnum`)
      ) {
        return [0, this.lang.t('getReward.user_task_maxnum')];
      }
    }
    const goalSort = await this.cell(
      sql`select sort from cfg_task_goal where tid = ${tid} limit 1`,
    );
    if (
      !(await this.check(sql`select 1 from sys_user_task where uid = ${uid} and tid = ${tid}`)) &&
      !(await this.check(sql`select 1 from sys_hero_task where uid = ${uid} and tid = ${tid}`))
    ) {
      throw GameError.lang('getReward.already_got');
    }
    if (
      (tid > 800 || tid < 400) &&
      !(await this.canRecomplete(tid)) &&
      (await this.check(sql`select 1 from sys_user_task where uid = ${uid} and tid = ${tid}
        and state = 1`))
    ) {
      throw GameError.lang('getReward.already_got');
    }
    const selectId = param.length > 1 ? param[1] : 0;
    if (
      tid >= 400 &&
      tid <= 800 &&
      (await this.check(sql`select 1 from sys_hero_task where uid = ${uid}
        and \`group\` = ${phpString(selectId)} and tid = ${tid} and state = 2`))
    ) {
      throw GameError.lang('getReward.already_got');
    }
    const task = await this.row(sql`select * from cfg_task where id = ${tid}`);
    if (tid <= 0 || !task) throw GameError.lang('getReward.no_cfg_task');
    const inform = phpIntval(task.inform) === 1;

    let complete = true;
    for (const goal of await this.goals.goalsOf(uid, tid)) {
      if (
        !(await this.goals.isGoalComplete(uid, goal)) ||
        !(await this.chosenFits(uid, goal, selectId))
      ) {
        complete = false;
        break;
      }
    }
    let selectId2: unknown = 0;
    if (phpIntval(task.group) === ARMOR_EXCHANGE_GROUP && tid !== ARMOR_EXCHANGE_FIRST) {
      selectId2 = param[2];
      const part = (sid: unknown) =>
        this.cell(sql`select b.part, b.type from sys_user_armor a, cfg_armor b
          where a.armorid = b.id and a.hid = 0 and uid = ${uid} and sid = ${phpString(sid)}`);
      const part1 = await part(selectId);
      const part2 = await part(selectId2);
      // The original indexed the fetched part number as a string: only first digits compare.
      if (phpEmpty(part1) || phpEmpty(part2) || phpString(part1)[0] !== phpString(part2)[0]) {
        complete = false;
      }
    }
    if (!complete) throw GameError.lang('getReward.task_not_finished');

    if (
      isLuoYangTask(tid) ||
      isHuangJinDonation(tid) ||
      isDongZhuoDonation(tid) ||
      (tid > 400 && tid < 800) ||
      (tid > 400000 && tid < 420000)
    ) {
      throw new Error(`getReward(${tid}): world-event and 名将 tasks not ported`);
    }

    const cid = await this.lastcid(uid);
    let msg = '';
    if (tid === TASK_OFFICE_SALARY) {
      await this.rewards.giveResource(uid, cid, 1, await this.officeSalary(uid));
    } else if (tid === TASK_NOBILITY_SALARY) {
      const salary = await this.nobilitySalary(uid);
      for (const type of [2, 3, 4, 5]) await this.rewards.giveResource(uid, cid, type, salary);
    } else if (tid === TASK_UNION_CITY_GOLD) {
      await this.rewards.giveResource(uid, cid, 1, await this.unionFamousCityGold(uid));
    } else {
      if (tid === 101961 || tid === 101963 || tid === 101964) {
        await sql`update sys_user_task set state = 1
          where uid = ${uid} and tid in (101961, 101963, 101964)`.execute(db);
      }
      const rewards = await this.rows(sql`select * from cfg_task_reward where tid = ${tid}`);
      await this.scaleBattleRewards(uid, goalSort, rewards);
      const sort = phpIntval(goalSort);
      if (
        rewards.length > 0 &&
        (sort === GoalSort.CrossBattle || sort === GoalSort.CrossPveBattle)
      ) {
        await sql`update sys_user_task set state = 1 where tid = ${tid} and uid = ${uid}`.execute(
          db,
        );
      }
      for (const reward of rewards) {
        msg += await this.rewards.giveReward(uid, cid, reward, inform);
      }
      if (EVERYDAY_TASKS.has(tid)) {
        await sql`insert into log_everyday_task values (${uid}, ${tid}, unix_timestamp())
          on duplicate key update gettime = unix_timestamp()`.execute(db);
      }
    }

    if (!(await this.canRecomplete(tid))) {
      const set = [100632, 100642, 100652].find((first) => tid >= first && tid <= first + 2);
      if (set !== undefined) {
        await sql`update sys_user_task set state = 1
          where uid = ${uid} and tid between ${set} and ${set + 2}`.execute(db);
      } else {
        await sql`insert into sys_user_task (uid, tid, state) values (${uid}, ${tid}, 1)
          on duplicate key update state = 1`.execute(db);
      }
    }

    for (const goal of await this.rows(sql`select * from cfg_task_goal where tid = ${tid}`)) {
      if (phpIntval(goal.reduce) !== 1) continue;
      const sort = phpIntval(goal.sort);
      const type = phpIntval(goal.type);
      if (
        sort === 6 &&
        phpIntval(task.group) === ARMOR_EXCHANGE_GROUP &&
        tid !== ARMOR_EXCHANGE_FIRST
      ) {
        for (const sid of [selectId, selectId2]) {
          const armorid = await this.cell(sql`select armorid from sys_user_armor
            where sid = ${phpString(sid)}`);
          await this.rewards.cutArmorBySid(uid, armorid, phpString(sid));
        }
      } else if (sort === GoalSort.Resource && (type === 51 || type === 52)) {
        const armorid = await this.cell(sql`select armorid from sys_user_armor
          where sid = ${phpString(selectId)}`);
        await this.rewards.cutArmorBySid(uid, armorid, phpString(selectId));
      } else if (sort === GoalSort.Resource && type === 50) {
        await this.rewards.deleteHero(uid, phpString(selectId));
      } else if (sort === GoalSort.Accumulated) {
        await sql`update sys_user_goal set currentcount = 0
          where gid = ${goal.id} and uid = ${uid}`.execute(db);
      } else {
        await this.rewards.reduceGoal(uid, cid, goal);
      }
    }

    await this.triggerNextTasks(uid, tid);
    if (tid === TASK_LEAVE_PROTECTION) {
      const dongzhuo = await this.mem(State.DongZhuo);
      if (phpLooseEquals(dongzhuo, 1)) {
        await sql`insert into sys_user_task (uid, tid, state)
          select ${uid}, id, 0 from cfg_task where \`group\` = 15000
          on duplicate key update state = 0`.execute(db);
      } else if (phpLooseEquals(dongzhuo, 2)) {
        await sql`insert into sys_user_task (uid, tid, state)
          select ${uid}, id, 0 from cfg_task where id > 15100 and id < 16000
          on duplicate key update state = 0`.execute(db);
      }
      await this.finish243(uid);
    }

    if (inform) {
      const name = await this.cell(sql`select name from sys_user where uid = ${uid}`);
      await this.users.sendSysInform({
        type: 0,
        inuse: 1,
        starttime: 0,
        endtime: 300,
        interval: 1800,
        scrollcount: 1,
        color: 49151,
        msg: this.lang.t('getReward.inform', name, task.name, msg),
      });
    }
    if (LOGGED_TASKS.has(tid)) {
      await sql`insert into log_task (uid, tid, count, time)
        values (${uid}, ${tid}, 1, unix_timestamp())`.execute(db);
    }
    if (await this.unionEdictReady(uid)) {
      await sql`insert into sys_user_task (uid, tid, state)
        values ((select leader from sys_union
          where id = (select union_id from sys_user where uid = ${uid})), ${XIANDI_EDICT_TASK}, 0)
        on duplicate key update state = 0`.execute(db);
    }
    if (lordHeroTask) {
      await sql`update sys_user_task_num set num = num + 1 where type = 1 and uid = ${uid}`.execute(
        db,
      );
    }
    return [1];
  }

  /**
   * The hero (goal 50) or gear (goals 51, 52) picked for a sort-1 goal. The original fetched the
   * gear's part as a single value and then indexed it, so a gear goal only passes when no gear
   * matched and the asked count is "0"; that is kept.
   */
  private async chosenFits(uid: number, goal: Row, selectId: unknown): Promise<boolean> {
    if (phpIntval(goal.sort) !== GoalSort.Resource) return true;
    const type = phpIntval(goal.type);
    if (type === 51 || type === 52) {
      const part = await this.cell(sql`select b.part, b.type from sys_user_armor a, cfg_armor b
        where a.armorid = b.id and uid = ${uid} and sid = ${phpString(selectId)}`);
      if (!phpEmpty(part)) return true;
      return (part === 0 || part === '0') && phpLooseEquals('0', phpString(goal.count));
    }
    if (type === 50) {
      const count = await this.cell(sql`select count(1) from sys_city_hero where uid = ${uid}
        and hid = ${phpString(selectId)} and herotype != '1000' and level >= ${goal.count}`);
      return !phpLooseEquals(count, 0);
    }
    return true;
  }

  /** The tasks unlocked by this one (cfg_task.pretid), held back while their event is closed. */
  private async triggerNextTasks(uid: number, tid: number): Promise<void> {
    const db = this.scope.db;
    let huangjinProgress: unknown = null;
    for (const next of await this.rows(sql`select * from cfg_task where pretid = ${tid}`)) {
      const nextId = phpIntval(next.id);
      let open = true;
      const state = phpLooseEquals(next.default, 100) ? 0 : next.default;
      if (
        tid === TASK_LEAVE_PROTECTION &&
        (isHuangJinDonation(nextId) || isHuangJinExchange(nextId))
      ) {
        huangjinProgress = await this.mem(State.HuangJin);
        if (phpLooseEquals(huangjinProgress, -1) || phpLooseEquals(huangjinProgress, 1))
          open = false;
      }
      if (nextId >= 103005 && nextId <= 103009) {
        huangjinProgress = await this.mem(State.DongZhuo);
        open = phpLooseEquals(huangjinProgress, 2);
      }
      if ([10501, 6301, 6302, 6401, 6402].includes(nextId)) {
        open = phpLooseEquals(1, huangjinProgress);
      } else if (nextId >= 7001 && nextId <= 7003) {
        open = false;
      }
      if (!open) continue;
      await this.rewards.startCounters(uid, nextId);
      await sql`insert into sys_user_task (uid, tid, state) values (${uid}, ${nextId}, ${state})
        on duplicate key update state = ${state}`.execute(db);
    }
  }

  /** TaskFuncAdd.php::finish243: catches a player leaving protection up with the epic events. */
  private async finish243(uid: number): Promise<void> {
    const db = this.scope.db;
    const huangjin = await this.mem(State.HuangJin);
    const dongzhuo = phpNum(await this.mem(State.DongZhuo));
    const luoyang = await this.mem(State.LuoYang);
    if (!phpLooseEquals(huangjin, 1)) return;
    const give = (where: RawBuilder<unknown>, state = 0) =>
      sql`insert into sys_user_task (uid, tid, state)
        select ${uid}, id, ${state} from cfg_task where ${where}
        on duplicate key update state = ${state}`.execute(db);
    const close = (where: RawBuilder<unknown>) =>
      sql`update sys_user_task set state = 1 where uid = ${uid}
        and tid in (select id from cfg_task where ${where})`.execute(db);
    const show = (tids: number[]) =>
      sql`update sys_user_task set state = 0 where uid = ${uid}
        and tid in (${sql.join(tids)})`.execute(db);

    await sql`delete from sys_user_task where uid = ${uid}
      and tid in (select id from cfg_task where \`group\` in (1000, 2000, 3000, 4000))`.execute(db);
    await sql`update sys_user_task set state = 1 where tid between 11000 and 15000
      and uid = ${uid}`.execute(db);
    await give(sql`id in (10501, 6301, 6302, 6401, 6402)`);
    await give(sql`\`group\` in (10100, 10200, 10400)`);
    await give(sql`\`group\` in (15600)`);
    await give(sql`id in (10301, 10302, 10303, 10304)`);
    if (dongzhuo === 1) {
      await give(sql`id >= 420494 and id <= 420520`, 1);
      await show([420494, 420498, 420503, 420512]);
    } else if (dongzhuo === 2) {
      await sql`delete from sys_user_task where (tid >= 420494 and tid <= 420520)
        and uid = ${uid}`.execute(db);
      await give(sql`id >= 420464 and id <= 420490`, 1);
      await show([420464, 420468, 420473, 420482]);
      await give(sql`id in (103005, 103006, 103007, 103008, 103009)`);
      await give(sql`\`group\` in (10700)`);
      await close(sql`\`group\` = 10400`);
      await sql`insert into sys_user_task (uid, tid, state)
        select uid, id, 0 from sys_user_task, cfg_task
        where tid = ${TASK_LEAVE_PROTECTION} and state = 1 and \`group\` = 112022 and uid = ${uid}
        on duplicate key update state = 0`.execute(db);
    } else if (dongzhuo === 3) {
      await close(sql`\`group\` in (15100, 15200, 15300, 15400, 15500, 15600)`);
      await give(sql`\`group\` in (10700)`);
      await give(sql`id >= 420464 and id <= 420490`, 1);
      await show([420464, 420468, 420473, 420482]);
      if (phpLooseEquals(luoyang, 1)) {
        await give(sql`id >= 112001 and id <= 112007 and id <> ${XIANDI_EDICT_TASK}`);
      }
    }
    if (dongzhuo >= 2) {
      await close(sql`\`group\` in (10100, 10200, 10500, 15000)`);
      await sql`delete from sys_user_task where tid = 84014 and uid = ${uid}`.execute(db);
      await give(sql`\`group\` = 112022`);
      await close(sql`\`group\` = 10400`);
    }
  }

  /** checkXianDiMiZhaoEnoughTask: all of the union's 备战洛阳 donations are complete. */
  private async unionEdictReady(uid: number): Promise<boolean> {
    const unionId = await this.cell(sql`select union_id from sys_user where uid = ${uid}`);
    if (phpLooseEquals(unionId, 0)) return false;
    const tasks = await this.cell(
      sql`select count(*) from luoyang_progress where union_id = ${unionId}`,
    );
    if (phpEmpty(tasks) || phpNum(tasks) < 4) return false;
    return phpEmpty(
      await this.cell(sql`select count(*) from luoyang_progress
        where union_id = ${unionId} and curvalue < maxvalue`),
    );
  }

  private async taskList(uid: number, group: number): Promise<unknown[]> {
    if (group >= COMMISSION_BASE) throw new Error('getTaskList: commission tasks not ported');
    const tasks = [
      ...(await this.rows(sql`select t.* from sys_user_task u, cfg_task t
        where u.uid = ${uid} and u.tid = t.id and t.\`group\` = ${group} and u.state = 0
        order by t.id`)),
      ...(await this.rows(sql`select t.* from sys_hero_task h, cfg_task t
        where h.uid = ${uid} and h.\`group\` = ${group} and t.id = h.tid and h.state = 1`)),
    ];
    await this.goals.markComplete(uid, tasks);
    return [tasks, tasks.filter((task) => task.state === true).length];
  }

  /** TaskFunc.php::getAllTaskByType: the group list followed by each group's task list. */
  private async allTasksByType(uid: number, type: number): Promise<unknown[]> {
    if (type === TaskType.Commission) {
      const groups = await this.commissionGroups(uid);
      return [groups, ...groups.map((group) => [[group]])];
    }
    const groups = [
      ...(await this.rows(sql`select distinct g.* from sys_user_task u, cfg_task t, cfg_task_group g
        where t.\`group\` = g.id and u.tid = t.id and u.uid = ${uid} and u.state = 0
        and g.type = ${type} order by g.id`)),
      ...(await this.rows(sql`select distinct g.* from sys_hero_task a, cfg_task_group g
        where g.type = ${type} and a.\`group\` = g.id and a.uid = ${uid} and a.state = 1
        order by id`)),
    ];
    await this.countGroups(uid, groups, true);
    const ret: unknown[] = [groups];
    for (const group of groups) ret.push(await this.taskList(uid, phpIntval(group.id)));
    ret.push(await this.lordRefreshCount(uid));
    return ret;
  }

  /** Sets each group's `count` of finished tasks, with the 名将 tasks when `withHeroTasks`. */
  private async countGroups(uid: number, groups: Row[], withHeroTasks: boolean): Promise<void> {
    for (const group of groups) {
      const tasks = await this.rows(sql`select t.* from sys_user_task u, cfg_task t
        where u.uid = ${uid} and u.tid = t.id and t.\`group\` = ${group.id} and u.state = 0`);
      if (withHeroTasks) {
        tasks.push(
          ...(await this.rows(sql`select t.* from sys_hero_task u, cfg_task t
            where u.uid = ${uid} and u.tid = t.id and u.\`group\` = ${group.id} and u.state = 1`)),
        );
      }
      group.count = await this.goals.countComplete(uid, tasks);
    }
  }

  /** The player's open commission tasks shown as groups. */
  private async commissionGroups(uid: number): Promise<Row[]> {
    const tasks = await this.rows(sql`select a.* from sys_pub_reward_task a, sys_user_reward_task b
      where a.id = b.tid and b.uid = ${uid} and b.state <= 0 and b.tid >= ${COMMISSION_BASE}`);
    for (const task of tasks) {
      task.groupid = task.id;
      const state = await this.cell(sql`select state from sys_user_reward_task
        where uid = ${uid} and tid = ${task.id}`);
      task.count = phpNum(state) < 0 ? 1 : 0;
      task.description = this.lang.t('recordTask.task_group_description');
      const kind = phpString(task.type);
      if (kind === '0' || kind === '1' || kind === '2') {
        task.name = this.lang.t(`recordTask.task_group_name_${kind}`);
      }
    }
    return tasks;
  }

  /** The battlefield task rewards grow with the battlefield's level. */
  private async scaleBattleRewards(uid: number, goalSort: unknown, rewards: Row[]): Promise<void> {
    const sort = phpIntval(goalSort);
    if (sort === GoalSort.Battle) {
      let level = await this.cell(sql`select level from sys_user_battle_state
        where uid = ${uid} and state = 0`);
      if (level === false) {
        level = await this.cell(sql`select level from log_battle_honour
          where uid = ${uid} order by quittime desc limit 1`);
      }
      for (const reward of rewards) reward.count = phpNum(level) ** 2 * phpNum(reward.count);
    } else if (sort === GoalSort.CrossPveBattle) {
      let level = await this.cell(sql`select level + 1 from sys_user_battle_state
        where uid = ${uid} and state = 0 and in_cross_battle = 1`);
      if (phpEmpty(level)) {
        level = await this.cell(sql`select area_level + 1 from log_user_battlenet
          where uid = ${uid} order by quittime desc limit 1`);
      }
      for (const reward of rewards) {
        reward.count = Math.trunc(((phpNum(level) + 1) * phpNum(reward.count)) / 2);
      }
    }
  }

  private async checkDailyTask(uid: number): Promise<void> {
    const held = await this.cell(sql`select count(*) from sys_user_task
      where tid in (${sql.join(DAILY_TASKS)}) and uid = ${uid}`);
    if (!phpLooseEquals(held, 0)) return;
    for (const tid of DAILY_TASKS) {
      await sql`insert into sys_user_task (uid, tid, state) values (${uid}, ${tid}, 0)`.execute(
        this.scope.db,
      );
    }
  }

  private async lordRefreshCount(uid: number): Promise<unknown> {
    const count = await this.cell(sql`select count from mem_user_systask_num where uid = ${uid}`);
    return phpEmpty(count) ? 0 : count;
  }

  private async officeSalary(uid: number): Promise<number> {
    return phpNum(
      await this.cell(sql`select p.salary from sys_user u
        left join cfg_office_pos p on p.id = u.officepos where u.uid = ${uid}`),
    );
  }

  private async nobilitySalary(uid: number): Promise<number> {
    return phpNum(
      await this.cell(sql`select n.salary from sys_user u
        left join cfg_nobility n on n.id = u.nobility where u.uid = ${uid}`),
    );
  }

  private async unionFamousCityGold(uid: number): Promise<number> {
    const unionId = await this.cell(sql`select union_id from sys_user where uid = ${uid}`);
    if (phpLooseEquals(unionId, 0)) return 0;
    const cities = await this.rows(sql`select c.type, count(*) from sys_city c, sys_user u
      where u.uid = c.uid and u.union_id = ${unionId} and c.type > 0 and c.type < 5
      group by c.type`);
    return cities.reduce((gold, city) => gold + (FAMOUS_CITY_GOLD[phpIntval(city.type)] ?? 0), 0);
  }

  private canRecomplete(tid: number): Promise<boolean> {
    return canRecomplete(tid, () =>
      this.cell(sql`select \`default\` from cfg_task where id = ${tid}`),
    );
  }

  private mem(state: number): Promise<unknown> {
    return this.cell(sql`select value from mem_state where state = ${state}`);
  }

  private lastcid(uid: number): Promise<unknown> {
    return this.cell(sql`select lastcid from sys_user where uid = ${uid}`);
  }

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async row(query: RawBuilder<unknown>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  private async cell(query: RawBuilder<unknown>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : false;
  }

  private async check(query: RawBuilder<unknown>): Promise<boolean> {
    return (await this.rows(query)).length > 0;
  }
}
