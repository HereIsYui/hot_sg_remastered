import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { GameError } from '../common/game-error';
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
/** sys_user_relation 上限：好友或仇人合计 20 个 (FriendFunc.php:19-21). */
const RELATION_MAX = 20;
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

  /**
   * `[tname, type]`: 0 好友 1 仇人; returns [tuid, tname, type]. In the original these writes go
   * through the EXTERNAL chat server's binary protocol (FriendOperation PROC_CHAT_*) — no chat
   * server ships in the 单机包, so the shipped game simply cannot add friends. The remaster
   * carries the writes on the main command channel instead (an intentional redesign, recorded in
   * the README), with the guards the original HTTP body had: type < 2, the user exists, and 20
   * relations max. The broken `tname` column of the original insert is gone.
   */
  @GlobalCommand()
  async addUserRelation(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    // 添加的名字；0 好友 1 仇
    const tname = phpString(param[0]);
    const type = phpIntval(param[1]);
    if (type >= 2) throw GameError.raw('');

    // 目标用户是否存在
    const tuid = phpIntval(
      await this.cell(sql<Row>`select uid as v from sys_user where name = ${tname}`),
    );
    if (phpEmpty(tuid)) throw GameError.raw('');

    const count = phpNum(
      await this.cell(sql<Row>`select count(*) as v from sys_user_relation where uid = ${uid}`),
    );
    // 好友或者仇人大于等于20个
    if (count >= RELATION_MAX) throw GameError.raw('');
    await sql`insert into sys_user_relation (uid, tuid, type, time, cid, tcid)
      values (${uid}, ${tuid}, ${type}, unix_timestamp(),
        (select cid from sys_city where uid = ${uid} order by cid desc limit 1),
        (select cid from sys_city where uid = ${tuid} order by cid desc limit 1))`.execute(
      this.scope.db,
    );

    if (type === 0) {
      await this.tasks.completeTaskWithTaskid(uid, FRIENDS_TASK);
    }

    return [tuid, tname, type];
  }

  /**
   * `[tname, type]`: removes the caller's relation by the target's NAME — the client-side shape
   * (FriendDialog passes the name), resolved to the uid here. The original delete (a) hit the
   * nonexistent tname column and (b) had no uid filter at all; the remaster scopes it to the
   * caller and matches sys_user.tname through the join.
   */
  @GlobalCommand()
  async removeRelation(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const tname = phpString(param[0]);
    const type = phpIntval(param[1]);
    await sql`delete u from sys_user_relation u join sys_user s on s.uid = u.tuid
      where u.uid = ${ctx.uid} and s.name = ${tname} and u.type = ${type}`.execute(this.scope.db);
    return [tname, type];
  }

  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const rows = (await query.execute(this.scope.db)).rows;
    return rows[0] ? Object.values(rows[0])[0] : undefined;
  }
}
