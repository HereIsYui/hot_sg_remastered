import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DbScope } from '../db/database.module';
import { unixNow } from '../db/sql-fragments';
import { AchievementRules } from './achievement-rules.service';
import { phpEmpty, phpIntval, phpNum } from './php';

/** Gid 0 in drops means 礼金 (sys_user.gift) instead of an item. */
const GIFT_GID = 0;
/** 契约: at most one, and only for players who never used one. */
const CONTRACT_GID = 160052;

/** Item grants from utils.php. `type` is the log reason code stored with the grant. */
@Injectable()
export class GoodsRules {
  constructor(
    private readonly scope: DbScope,
    private readonly achievements?: AchievementRules,
  ) {}

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

  /** utils.php::checkGoods: owns at least one. */
  async checkGoods(uid: number, gid: number): Promise<boolean> {
    return this.checkGoodsCount(uid, gid, 1);
  }

  /** utils.php::checkGoodsCount. */
  async checkGoodsCount(uid: number, gid: number, needed: number): Promise<boolean> {
    const row = await sql<{ count: unknown }>`select count from sys_goods
      where uid = ${uid} and gid = ${gid}`.execute(this.scope.db);
    const count = row.rows[0]?.count;
    return (phpEmpty(count) ? 0 : phpNum(count)) >= needed;
  }

  /** utils.php::reduceGoods, including historical negative-log achievement totals. */
  async reduceGoods(uid: number, gid: number, count: number, type = 0): Promise<void> {
    gid = phpIntval(gid);
    count = phpIntval(count);
    if (count <= 0) return;
    const db = this.scope.db;
    await db
      .insertInto('log_goods')
      .values({ uid, gid, count: -count, time: unixNow(), type })
      .execute();
    await sql`update sys_goods set count = greatest(0, count - ${count})
      where uid = ${uid} and gid = ${gid}`.execute(db);
    if (gid > 110000 && gid < 160000) {
      const result = await sql<{ used: unknown }>`select -sum(count) as used from log_goods
        where gid > 110000 and gid < 160000 and uid = ${uid} and count < 0`.execute(db);
      if (phpNum(result.rows[0]?.used) >= 30) await this.finishAchievement(uid, 30);
    } else if (gid === 158) {
      const result = await sql<{ used: unknown }>`select -sum(count) as used from log_goods
        where gid = ${gid} and uid = ${uid} and count < 0 and type = 0`.execute(db);
      if (phpNum(result.rows[0]?.used) >= 15) await this.finishAchievement(uid, 70016);
    }
  }

  private async finishAchievement(uid: number, id: number): Promise<void> {
    if (!this.achievements)
      throw new Error('GoodsRules requires AchievementRules for achievement hooks');
    await this.achievements.finishAchievement(uid, id);
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
