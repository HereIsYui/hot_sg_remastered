import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { HeroRules } from '../core/hero-rules.service';
import { phpIntval, phpNum } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { DbScope } from '../db/database.module';
import { TickHandler, TickOrder } from '../tick/tick.decorator';
import { CityBuildingsService } from './city-buildings.service';
import { GAME_SPEED_RATE } from './technic-rules.service';

type Row = Record<string, unknown>;

/** Technics 1-20 complete the growth goals 46-65 when researched. */
const LAST_TASK_TECHNIC = 20;

/** ReportCron.php::UpdateUsersTechnic: finishes the research whose time is up. */
@Injectable()
export class TechnicTick {
  constructor(
    private readonly scope: DbScope,
    private readonly buildings: CityBuildingsService,
    private readonly tasks: TaskRules,
    private readonly heroes: HeroRules,
  ) {}

  @TickHandler(TickOrder.Technic)
  async updateUsersTechnic(): Promise<void> {
    const done = (
      await sql<Row>`select * from mem_technic_upgrading
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
    const tid = phpIntval(row.tid);
    const uid = phpIntval(await cell(sql<Row>`select uid from sys_city where cid = ${row.cid}`));
    await sql`update sys_technic set level = ${row.level}, state = 0 where id = ${row.id}`.execute(
      db,
    );
    await sql`delete from mem_technic_upgrading where id = ${row.id}`.execute(db);
    await this.buildings.syncUserTechnics(uid);
    if (tid >= 1 && tid <= LAST_TASK_TECHNIC) await this.tasks.completeTask(uid, tid + 45);
    let hid = phpNum(
      await cell(sql<Row>`select counsellorid from sys_city where cid = ${row.cid}`),
    );
    if (hid === 0) {
      hid = phpNum(await cell(sql<Row>`select chiefhid from sys_city where cid = ${row.cid}`));
    }
    if (hid > 0) {
      const time = await cell(sql<Row>`select upgrade_time from cfg_technic_level
        where level = ${row.level} and tid = ${tid}`);
      await this.heroes.addHeroExp(hid, (phpNum(time) / 2) * GAME_SPEED_RATE);
    }
  }
}
