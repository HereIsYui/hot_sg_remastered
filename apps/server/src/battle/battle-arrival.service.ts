/**
 * NestJS host for cfg_js.php HandleTroop's task-3/4/9 battle arrival (see battle-arrival.ts). It
 * assembles the `BattleArrivalDeps` from the shared game services and delegates to the pure-ish
 * `handleBattleArrival`, so `TroopTick` only needs to call `arrival.handle(args)` from its
 * task-3/4/9 dispatch branch. Exported from the battle module and injected by the world module.
 */

import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { phpIntval, phpNum } from '../core/php';
import { RandomService } from '../core/random.service';
import { ReportService } from '../core/report.service';
import { TaskRules } from '../core/task-rules.service';
import { DbScope } from '../db/database.module';
import { type ArrivalArgs, type BattleArrivalDeps, handleBattleArrival } from './battle-arrival';

type Row = Record<string, unknown>;

@Injectable()
export class BattleArrivalService {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cityRules: CityRules,
    private readonly heroes: HeroRules,
    private readonly tasks: TaskRules,
    private readonly report: ReportService,
    private readonly random: RandomService,
  ) {}

  /** cfg_js.php HandleTroop task-3/4/9 arrival for one due troop (state 0). */
  async handle(args: ArrivalArgs): Promise<void> {
    await handleBattleArrival(this.deps(), args);
  }

  private deps(): BattleArrivalDeps {
    const db = this.scope.db;
    const query = async (q: ReturnType<typeof sql<Row>>) => (await q.execute(db)).rows;
    return {
      db,
      query,
      one: async (q) => (await query(q))[0] ?? false,
      cell: async (q) => {
        const row = (await query(q))[0];
        return row ? Object.values(row)[0] : undefined;
      },
      lang: {
        report: (key) => this.reportStr(key),
        battle: (key) => this.battleStr(key),
      },
      cityRules: {
        getNamePosition: (cid, type) => this.cityRules.getNamePosition(cid, type),
        refreshFoodArmyUsers: (cid) => this.cityRules.refreshFoodArmyUsers(cid),
        addCitySoldiers: (cid, soldiers, add) => this.cityRules.addCitySoldiers(cid, soldiers, add),
        updateFieldResourceAdds: (cid) => this.updateFieldResourceAdds(cid),
      },
      heroes: { throwHeroToField: (hero) => this.heroes.throwHeroToField(hero as never) },
      tasks: { completeTask: (uid, goalId) => this.tasks.completeTask(uid, goalId) },
      report: {
        sendReport: (uid, title, origincid, happencid, content) =>
          this.report.sendReport(uid, title, origincid, happencid, content),
      },
      soldierInfo: async () => {
        const rows = (
          await sql<Row>`select sid, speed, \`range\`, hp, ap, dp, type from cfg_soldier`.execute(
            db,
          )
        ).rows;
        const out = new Map<
          number,
          { speed: number; range: number; hp: number; ap: number; dp: number; type: number }
        >();
        for (const s of rows) {
          out.set(phpIntval(s.sid), {
            speed: phpNum(s.speed),
            range: phpNum(s.range),
            hp: phpNum(s.hp),
            ap: phpNum(s.ap),
            dp: phpNum(s.dp),
            type: phpNum(s.type),
          });
        }
        return out;
      },
      rand: (min, max) => this.random.randRange(min, max),
      mtRand: (min, max) => this.random.mtRand(min, max),
      randRaw: () => this.random.rand(),
      soldierValue: () => {
        const sv = (this.lang.value<Record<string, unknown>>('soldier')?.soldiervalue ??
          []) as unknown[];
        return sv.map((v) => phpNum(v));
      },
      addCitySoldiers: (cid, soldiers, add) => this.cityRules.addCitySoldiers(cid, soldiers, add),
    };
  }

  /** OLdBattleCron.php::updateFieldResourceAdds: recompute a city's field-resource adds. */
  private async updateFieldResourceAdds(cid: number): Promise<void> {
    const fields = (
      await sql<Row>`select type, level from mem_world where type > 1 and ownercid = ${cid}`.execute(
        this.scope.db,
      )
    ).rows;
    let food = 0;
    let wood = 0;
    let rock = 0;
    let iron = 0;
    for (const f of fields) {
      const level = phpNum(f.level);
      if (level <= 0) continue;
      switch (phpIntval(f.type)) {
        case 2: // WT_DESERT
          rock += 3 + 2 * level;
          break;
        case 3: // WT_FOREST
          wood += 3 + 2 * level;
          break;
        case 4: // WT_GRASS
          food += 2 + level;
          break;
        case 5: // WT_HILL
          iron += 3 + 2 * level;
          break;
        case 6: // WT_LAKE
          food += 5 + 3 * level;
          break;
        case 7: // WT_SWAMP
          food += 3 + 2 * level;
          break;
      }
    }
    await sql`update sys_city_res_add set field_food_add = ${food}, field_wood_add = ${wood},
      field_rock_add = ${rock}, field_iron_add = ${iron} where cid = ${cid}`.execute(this.scope.db);
    await this.cityRules.updateCityResourceAdd(cid);
  }

  private reportStr(key: string): string {
    const v = this.lang.value<Record<string, unknown>>('report')?.[key];
    return typeof v === 'string' ? v : '';
  }
  private battleStr(key: string): string {
    const v = this.lang.value<Record<string, unknown>>('battle')?.[key];
    return typeof v === 'string' ? v : '';
  }
}
