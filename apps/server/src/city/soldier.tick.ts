import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { phpEmpty, phpFloatString, phpIntval, phpNum } from '../core/php';
import { DbScope } from '../db/database.module';
import { TickHandler, TickOrder } from '../tick/tick.decorator';

type Row = Record<string, unknown>;

/**
 * ReportCron.php::UpdateUsersSoldier: adds the finished batch to the city, starts the 兵营's next
 * entry and grants prestige (people per soldier times count) and ten times that as hero exp.
 */
@Injectable()
export class SoldierTick {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cityRules: CityRules,
    private readonly heroes: HeroRules,
  ) {}

  @TickHandler(TickOrder.Soldier)
  async updateUsersSoldier(): Promise<void> {
    const done = (
      await sql<Row>`select * from mem_city_draft
        where state_endtime <= unix_timestamp()`.execute(this.scope.db)
    ).rows;
    for (const row of done) await this.scope.transaction(() => this.finish(row));
  }

  private async finish(row: Row): Promise<void> {
    const db = this.scope.db;
    const cell = async (query: ReturnType<typeof sql<Row>>) => {
      const first = (await query.execute(db)).rows[0];
      return first ? Object.values(first)[0] : false;
    };
    const { id, cid, xy } = row;
    const sid = phpIntval(row.sid);
    const uid = await cell(sql<Row>`select uid from sys_city where cid = ${cid}`);
    await sql`delete from sys_city_draftqueue where id = ${id}`.execute(db);
    await sql`delete from mem_city_draft where id = ${id}`.execute(db);
    await this.cityRules.addCitySoldier(phpIntval(cid), sid, phpNum(row.count));
    const nextid = await cell(sql<Row>`select id from sys_city_draftqueue
      where cid = ${cid} and xy = ${xy} order by queuetime, id limit 1`);
    if (!phpEmpty(nextid)) {
      await sql`update sys_city_draftqueue set state = 1, state_starttime = unix_timestamp()
        where id = ${nextid}`.execute(db);
      await sql`insert into mem_city_draft (select id, cid, xy, sid, count,
          state_starttime + needtime from sys_city_draftqueue where id = ${nextid})`.execute(db);
    }
    const usepeople = this.lang.value<{ usepeople?: unknown[] }>('soldier')?.usepeople ?? [];
    const prestige = phpNum(usepeople[sid]) * phpNum(row.count);
    const add = phpFloatString(prestige);
    await sql`update sys_user set prestige = prestige + ${add}, warprestige = warprestige + ${add}
      where uid = ${uid}`.execute(db);
    await this.cityRules.refreshFoodArmyUsers(phpIntval(cid));
    let hid = phpNum(await cell(sql<Row>`select generalid from sys_city where cid = ${cid}`));
    if (hid === 0)
      hid = phpNum(await cell(sql<Row>`select chiefhid from sys_city where cid = ${cid}`));
    if (hid > 0) await this.heroes.addHeroExp(hid, prestige * 10);
  }
}
