import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DbScope } from '../db/database.module';
import { unixNow } from '../db/sql-fragments';

/** Gid 0 in drops means 礼金 (sys_user.gift) instead of an item. */
const GIFT_GID = 0;
/** 契约: at most one, and only for players who never used one. */
const CONTRACT_GID = 160052;

/** Item grants from utils.php. `type` is the log reason code stored with the grant. */
@Injectable()
export class GoodsRules {
  constructor(private readonly scope: DbScope) {}

  /** utils.php::addGoods */
  async addGoods(uid: number, gid: number, count: number, type: number): Promise<void> {
    if (count === 0) return;
    const db = this.scope.db;
    if (gid === CONTRACT_GID) {
      const used = await db
        .selectFrom('log_qiyue')
        .select('uid')
        .where('uid', '=', uid)
        .where('gid', '=', CONTRACT_GID)
        .where('count', '<', 0)
        .executeTakeFirst();
      if (!used) {
        await sql`insert into sys_goods (uid, gid, count) values (${uid}, ${gid}, ${count})
          on duplicate key update count = 1`.execute(db);
        await db.insertInto('log_qiyue').values({ uid, gid, count, time: unixNow() }).execute();
      }
      return;
    }
    if (gid === GIFT_GID) {
      await sql`update sys_user set gift = gift + ${count} where uid = ${uid}`.execute(db);
      await db.insertInto('log_gift').values({ uid, gid, count, time: unixNow(), type }).execute();
      return;
    }
    const target = gid === 152 ? 888888 : gid;
    await sql`insert into sys_goods (uid, gid, count) values (${uid}, ${target}, ${count})
      on duplicate key update count = count + ${count}`.execute(db);
    await db
      .insertInto('log_goods')
      .values({ uid, gid: target, count, time: unixNow(), type })
      .execute();
  }

  /** utils.php::addThings */
  async addThings(uid: number, tid: number, count: number, type: number): Promise<void> {
    if (count === 0) return;
    const db = this.scope.db;
    await db.insertInto('log_things').values({ uid, tid, count, time: unixNow(), type }).execute();
    await sql`insert into sys_things (uid, tid, count) values (${uid}, ${tid}, ${count})
      on duplicate key update count = count + ${count}`.execute(db);
  }
}
