import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { phpIntval, phpNum, phpString } from '../core/php';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/**
 * FriendFunc.php:47 getUserRelation — 取得好友和仇人列表: `[[relation, ...]]`, each row's
 * nobility passed through getBufferNobility and its unix `time` rendered as a datetime string.
 *
 * 有意为之的忠实复刻：the original openfunc whitelist ($GLOBALS['n'] in lang.php) lists only
 * invite51Friend / get51User / addFriend / ignoreFiendJoin / getUserRelation from FriendFunc.php
 * — addUserRelation, removeRelation and addFriendsTaskFinish are NOT whitelisted, so the shipped
 * 单机 answers every call with `$funcName + 你异常了!!!` without running them (FriendStubCommands
 * mirrors that). addFriendsTaskFinish IS whitelisted (lang.php:2646) and completes the friend
 * task here. sys_user_relation also has no `tname` column, so even a whitelisted insert would
 * die; the friend lang group is missing from lang.php entirely.
 */

/** 完成好友任务 (FriendFunc.php:87-88 completeTaskWithTaskid($uid, 313)). */
const FRIENDS_TASK = 313;
@Injectable()
export class FriendCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly tasks: TaskRules,
    private readonly users: UserRules,
  ) {}

  @GlobalCommand()
  async getUserRelation(ctx: CommandContext): Promise<unknown[]> {
    const relations = (await sql<Row>`select u.tuid, s.name as tname, u.type,
        n.name as unionName, s.nobility, u.time, u.cid, u.tcid from sys_user_relation u
      left join sys_user s on u.tuid = s.uid
      left join sys_union n on s.union_id = n.id
      where u.uid = ${ctx.uid}`
      .execute(this.scope.db)
      .then((r) => r.rows)) as Row[];
    if (relations.length === 0) return [];

    const ret: unknown[] = [];
    let index = 0;
    for (const relation of relations) {
      const row: Row = { ...relation };
      const real = await this.users.bufferNobility(
        phpIntval(relation.tuid),
        phpNum(relation.nobility),
      );
      row.nobility = real;
      row.time = phpString(
        await this.cell(sql<Row>`select from_unixtime(${phpIntval(relation.time)}) as v`),
      );
      ret[0] = ret[0] ?? [];
      (ret[0] as unknown[])[index] = row;
      index++;
    }
    return ret;
  }

  /** `[]` args; the PASSTYPE platform event of FriendFunc.php:91-103 is a later phase. */
  @GlobalCommand()
  async addFriendsTaskFinish(ctx: CommandContext): Promise<void> {
    await this.tasks.completeTaskWithTaskid(ctx.uid, FRIENDS_TASK);
  }

  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const rows = (await query.execute(this.scope.db)).rows;
    return rows[0] ? Object.values(rows[0])[0] : undefined;
  }
}
