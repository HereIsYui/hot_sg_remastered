import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { DbScope } from '../db/database.module';

type Row = Record<string, unknown>;

@Injectable()
export class UnionRules {
  constructor(private readonly scope: DbScope) {}

  async addUnionEvent(unionid: number, type: number, content: string): Promise<void> {
    await sql`insert into sys_union_event (unionid, type, content, evttime)
      values (${unionid}, ${type}, ${content}, unix_timestamp())`.execute(this.scope.db);
    await sql`insert into mem_union_event (unionid, type, content, evttime)
      values (${unionid}, ${type}, ${content}, unix_timestamp())`.execute(this.scope.db);
  }

  async notifyUnionChange(uid: number, unionid: number, state: number): Promise<void> {
    const name = phpString(
      (
        await sql<{ v: unknown }>`select name as v from sys_user where uid = ${uid}`.execute(
          this.scope.db,
        )
      ).rows[0]?.v,
    );
    await sql`insert into mem_union_buf (uid, nick, union_id, state, updatetime)
      values (${uid}, ${name}, ${unionid}, ${state}, unix_timestamp())`.execute(this.scope.db);
  }

  async memberMaxCount(unionid: number): Promise<number> {
    const level = phpNum(
      (
        await sql<{ v: unknown }>`select level as v from sys_union_building
          where unionid = ${unionid} and bid = 2 limit 1`.execute(this.scope.db)
      ).rows[0]?.v,
    );
    const gov = phpEmpty(level) ? 1 : level;
    return gov >= 50 ? 60 : gov + 10;
  }

  async inviteList(uid: number): Promise<unknown[]> {
    const user = (
      await sql<Row>`select union_id, union_pos from sys_user where uid = ${uid}`.execute(
        this.scope.db,
      )
    ).rows[0];
    if (phpIntval(user?.union_id) <= 0 || phpIntval(user?.union_pos) === 0) {
      throw GameError.lang('getInviteList.you_are_not_official');
    }
    return (
      await sql<Row>`select u.uid as userid, u.name, u.rank, u.prestige, i.inviter, i.time
        from sys_union_invite i left join sys_user u on u.uid = i.uid
        where i.unionid = ${phpIntval(user?.union_id)}`.execute(this.scope.db)
    ).rows;
  }

  /** UnionFunc.php::canUserLeaveUnion: the 献帝密诏 badge, buffer or task blocks leaving. */
  async canUserLeaveUnion(uid: number): Promise<void> {
    const count = (
      await sql<{
        v: unknown;
      }>`select count as v from sys_goods where uid = ${uid} and gid = 161501`.execute(
        this.scope.db,
      )
    ).rows[0]?.v;
    if (!phpEmpty(count)) throw GameError.lang('xiandimizhao.can_not_leave_union');
    if (
      (
        await sql`select 1 as v from mem_user_buffer where uid = ${uid}
          and endtime > unix_timestamp() and buftype = 161501`.execute(this.scope.db)
      ).rows.length > 0
    ) {
      throw GameError.lang('xiandimizhao.can_not_leave_union');
    }
    if (
      (
        await sql`select 1 as v from sys_user_task where uid = ${uid}
          and tid = 112005 and state = 0`.execute(this.scope.db)
      ).rows.length > 0
    ) {
      throw GameError.lang('xiandimizhao.can_not_leave_union');
    }
  }
}
