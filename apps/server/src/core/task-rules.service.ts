import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DbScope } from '../db/database.module';
import { cellOf } from '../db/sql-fragments';
import { UserRules } from './user-rules.service';

/** Task helpers from utils.php. */
@Injectable()
export class TaskRules {
  constructor(
    private readonly scope: DbScope,
    private readonly users: UserRules,
  ) {}

  /** utils.php::completeTaskWithTaskid: marks every goal of the task reached. */
  async completeTaskWithTaskid(uid: number, taskId: number): Promise<void> {
    const goals = await this.scope.db
      .selectFrom('cfg_task_goal')
      .select('id')
      .where('tid', '=', taskId)
      .execute();
    for (const goal of goals) {
      await sql`replace into sys_user_goal (uid, gid) values (${uid}, ${goal.id})`.execute(
        this.scope.db,
      );
    }
  }

  /** utils.php::myupdateUserDailyTasks: re-issues the repeatable daily tasks. */
  async updateUserDailyTasks(uid: number): Promise<void> {
    const db = this.scope.db;
    const user = await db
      .selectFrom('sys_user')
      .select('nobility')
      .where('uid', '=', uid)
      .executeTakeFirst();
    const nobility = await this.users.bufferNobility(uid, cellOf(user, 'nobility'));
    if (nobility < 1) return;

    await sql`delete from sys_user_task where tid between 100331 and 100333`.execute(db);
    await sql`delete from sys_user_goal where gid between 2060391 and 2060393`.execute(db);
    await this.resetChain(uid, 100311, 4);

    await sql`delete from sys_user_task where uid = ${uid} and (tid between 90000 and 90018)`.execute(
      db,
    );
    await sql`delete from sys_user_goal where uid = ${uid} and (gid between 102502 and 102520)`.execute(
      db,
    );
    await sql`delete from sys_user_task where uid = ${uid} and (tid between 90032 and 90041)`.execute(
      db,
    );
    await sql`delete from sys_user_goal where uid = ${uid} and (gid between 102534 and 102543)`.execute(
      db,
    );
    await this.giveTaskOnce(uid, 90000);

    await sql`delete from sys_user_task where uid = ${uid} and (tid between 101181 and 101186)`.execute(
      db,
    );
    await sql`delete from sys_user_goal where uid = ${uid} and (gid between 3000032 and 3000037)`.execute(
      db,
    );
    await this.resetChain(uid, 101181, 6);

    await sql`delete from sys_user_goal where uid = ${uid} and (gid between 3101152 and 3101156)`.execute(
      db,
    );
    await sql`delete from sys_user_task where uid = ${uid} and (tid between 103801 and 103805)`.execute(
      db,
    );
    await this.giveTaskOnce(uid, 103801);
  }

  private async giveTaskOnce(uid: number, tid: number): Promise<void> {
    await sql`insert into sys_user_task (uid, tid, state) values (${uid}, ${tid}, 0)
      on duplicate key update tid = ${tid}`.execute(this.scope.db);
  }

  /** Finished tasks (state 1) lose their sort-5 goal and restart; missing ones are given. */
  private async resetChain(uid: number, first: number, count: number): Promise<void> {
    const db = this.scope.db;
    for (let tid = first; tid < first + count; tid++) {
      const task = await db
        .selectFrom('sys_user_task')
        .select('state')
        .where('uid', '=', uid)
        .where('tid', '=', tid)
        .executeTakeFirst();
      const goal = await db
        .selectFrom('cfg_task_goal')
        .select('id')
        .where('tid', '=', tid)
        .where('sort', '=', 5)
        .limit(1)
        .executeTakeFirst();
      if (task?.state === 1) {
        await sql`delete from sys_user_goal where uid = ${uid} and gid = ${goal?.id ?? null}`.execute(
          db,
        );
        await db
          .updateTable('sys_user_task')
          .set({ state: 0 })
          .where('uid', '=', uid)
          .where('tid', '=', tid)
          .execute();
      } else {
        await this.giveTaskOnce(uid, tid);
      }
    }
  }
}
