import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { LangService } from '../common/lang.service';
import { DbScope } from '../db/database.module';
import type { Row } from '../task/task-goals.service';
import { phpIntval, phpLooseEquals, phpNum } from './php';
import { UserRules } from './user-rules.service';
const FIRST_PLAYER_UID = 897;
const AchievementOpen = { AfterNewbie: 1, AfterHuangJin: 2 } as const;
@Injectable()
export class AchievementRules {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly users: UserRules,
  ) {}
  /** utils.php::finishAchivement */
  async finishAchievement(uid: number, id: number): Promise<void> {
    if (uid < FIRST_PLAYER_UID) return;
    if (await this.check(sql`select 1 from cfg_achivement where id = ${id} and state = '0'`))
      return;
    if (
      await this.check(sql`select 1 from sys_user_achivement
        where uid = ${uid} and achivement_id = ${id}`)
    ) {
      return;
    }
    const openTime = phpIntval(
      await this.cell(sql`select open_time from cfg_achivement where id = ${id}`),
    );
    if (openTime === AchievementOpen.AfterNewbie) {
      const state = await this.cell(sql`select state from sys_user where uid = ${uid}`);
      if (!phpLooseEquals(state, 0)) return;
    } else if (openTime === AchievementOpen.AfterHuangJin) {
      const state = await this.cell(sql`select value from mem_state where state = 5`);
      if (!phpLooseEquals(state, 1)) return;
    }
    const db = this.scope.db;
    await sql`insert into sys_user_achivement (uid, achivement_id, time)
      values (${uid}, ${id}, unix_timestamp())`.execute(db);
    const cfg = await this.row(sql`select union_inform, system_inform, name, point
      from cfg_achivement where id = ${id}`);
    await sql`update sys_user set achivement_count = achivement_count + 1,
        achivement_point = achivement_point + ${phpNum(cfg?.point)}
      where uid = ${uid}`.execute(db);
    const user = await this.row(sql`select name, union_id from sys_user where uid = ${uid}`);
    const msg = this.lang.t('Achivement.congrats', user?.name, cfg?.name);
    if (phpLooseEquals(cfg?.union_inform, 1)) {
      for (const table of ['sys_union_event', 'mem_union_event']) {
        await sql`insert into ${sql.table(table)} (unionid, type, content, evttime)
          values (${user?.union_id}, 11, ${msg}, unix_timestamp())`.execute(db);
      }
    }
    if (phpLooseEquals(cfg?.system_inform, 1)) {
      await this.users.sendSysInform({
        type: 0,
        inuse: 1,
        starttime: 0,
        endtime: 600,
        interval: 50000,
        scrollcount: 1,
        color: 49151,
        msg,
      });
    }
  }

  private async row(query: RawBuilder<unknown>): Promise<Row | undefined> {
    return (await query.execute(this.scope.db)).rows[0] as Row | undefined;
  }
  private async cell(query: RawBuilder<unknown>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : false;
  }
  private async check(query: RawBuilder<unknown>): Promise<boolean> {
    return !!(await this.row(query));
  }
}
