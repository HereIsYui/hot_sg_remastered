/**
 * OLdBattleCron.php::HandleBattle / updateBattle wired into NestJS. On the TickOrder.Battle slot
 * (after HandleBattle's 演习 settlement), this advances every due `mem_battle` one round via the
 * pure `playRound` engine, writes the result back, and — when a side is wiped — runs the terminal
 * `getBattleResult`.
 *
 * `$_SESSION['battle'][$battleid]` (the per-battle cache of tech levels, hero combat, npc flags and
 * the built `fightsoldier`) is replaced by a per-TICK `Map` held for the duration of one
 * `settleDueBattles` call — identical semantics (loaded once, reused across the rounds settled in
 * that pass) without leaking across ticks the way a PHP session would.
 */

import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { phpIntval, phpNum, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { ReportService } from '../core/report.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import {
  type BattleRoundInput,
  type HeroCombat,
  type RoundTactic,
  buildFightSoldiers,
  playRound,
} from './battle-round';
import { getBattleResult, type BattleResultDeps } from './battle-result';

type Row = Record<string, unknown>;

/** The cached per-battle facts the rounds reuse (the `$_SESSION['battle'][id]` role). */
interface BattleCache {
  soldierInfo: Map<
    number,
    { speed: number; range: number; hp: number; ap: number; dp: number; type: number }
  >;
  defenceInfo: Map<number, { range: number; hp: number; ap: number; dp: number }>;
}

@Injectable()
export class OldBattleService {
  private readonly logger = new Logger(OldBattleService.name);

  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cityRules: CityRules,
    private readonly heroes: HeroRules,
    private readonly tasks: TaskRules,
    private readonly users: UserRules,
    private readonly report: ReportService,
    private readonly random: RandomService,
  ) {}

  /** OLdBattleCron.php::HandleBattle: settle every `mem_battle` whose `nexttime` has passed. */
  async settleDueBattles(): Promise<number> {
    const cache = new Map<number, BattleCache>();
    const battles = (
      await sql<Row>`select * from mem_battle where nexttime <= unix_timestamp()`.execute(
        this.scope.db,
      )
    ).rows;
    let settled = 0;
    for (const battle of battles) {
      const id = phpIntval(battle.id);
      try {
        await this.scope.transaction(async () => {
          const state = phpNum(
            await this.cell(sql<Row>`select state as v from sys_battle where id = ${id}`),
          );
          if (state === 1) {
            await sql`delete from mem_battle where id = ${id}`.execute(this.scope.db);
          } else {
            await this.updateBattle(id, cache);
          }
        });
        settled++;
      } catch (err) {
        this.logger.error(
          `battle ${id} settle failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
        );
      }
    }
    return settled;
  }

  /** OLdBattleCron.php::updateBattle → return_new_place: advance one round of battle `id`. */
  private async updateBattle(id: number, cache: Map<number, BattleCache>): Promise<void> {
    const db = this.scope.db;
    const mem = (await sql<Row>`select * from mem_battle where id = ${id}`.execute(db)).rows[0];
    if (!mem) return;
    const sys =
      (await sql<Row>`select * from sys_battle where id = ${id}`.execute(db)).rows[0] ?? {};
    const round = phpIntval(mem.round);

    const shared = cache.get(id) ?? (await this.loadCache());
    cache.set(id, shared);

    const input = await this.buildRoundInput(mem, sys, shared);
    const fight = buildFightSoldiers(input);
    const result = playRound(input, fight, (min, max) => this.random.randRange(min, max));

    const time = Math.floor(Date.now() / 1000) + 25;
    const attackcid = phpIntval(mem.attackcid);
    // mem_battle_army_copy wall-hp mirror (OLdBattleCron wrote this for the client's live view).
    await sql`update mem_battle_army_copy set people_need = ${result.wallhp}
      where sid = 18 and cid = ${attackcid} and type = 1`.execute(db);
    await sql`update mem_battle set resistpos = ${result.resistpos}, wallhp = ${result.wallhp},
      attackpos = ${result.attackpos}, attacksoldiers = ${result.attacksoldiers},
      resistsoldiers = ${result.resistsoldiers}, nexttime = ${time}, round = round + 1,
      resistdefence = ${result.resistdefence} where id = ${id}`.execute(db);
    await sql`insert into sys_battle_report (battleid, round, report)
      values (${id}, ${round}, ${result.report})`.execute(db);

    if (result.battleEnd !== undefined) {
      const mynpctargetWid = cid2wid(phpIntval(sys.cid || mem.resistcid));
      await sql`update mem_world set state = 0 where wid = ${mynpctargetWid}`.execute(db);
      const memAfter =
        (await sql<Row>`select * from mem_battle where id = ${id}`.execute(db)).rows[0] ?? mem;
      await this.applyEndTroops(id, mem, sys, result.battleEnd);
      await getBattleResult(this.resultDeps(), memAfter, result.battleEnd);
      // The settled mem_battle row stays until the next due tick removes it (HandleBattle's
      // sys_battle.state = 1 check, mirrored in settleDueBattles above) — the original's cron
      // deletes it the same way, one tick later.
      cache.delete(id);
    }
  }

  /** The `$battle_end` troop/hero bookkeeping return_new_place did before getBattleResult. */
  private async applyEndTroops(id: number, mem: Row, sys: Row, end: number): Promise<void> {
    const db = this.scope.db;
    const type = phpIntval(mem.type);
    const resistuid = phpIntval(sys.resistuid);
    const attackuid = phpIntval(sys.attackuid);
    const attacktroop = phpIntval(sys.attacktroop);
    const attackhid = phpIntval(mem.attackhid);
    const resisthid = phpIntval(mem.resisthid);
    const resistnpc = resistuid === 0 || resistuid < 1000;

    if (end === 0) {
      await sql`update sys_battle set state = 1, result = 0 where id = ${id}`.execute(db);
      if (type === 4)
        await sql`update sys_troops set cid = targetcid, state = 4 where battleid = ${id}`.execute(
          db,
        );
      else
        await sql`update sys_troops set state = 1, starttime = unix_timestamp(), endtime = unix_timestamp() + pathtime where battleid = ${id}`.execute(
          db,
        );
      if (resistuid < 1000)
        await sql`delete from sys_troops where battleid = ${id} and uid = ${resistuid}`.execute(db);
      if (attackuid < 1000) await sql`delete from sys_troops where id = ${attacktroop}`.execute(db);
    } else if (end === 1) {
      await sql`update sys_battle set state = 1, result = 1 where id = ${id}`.execute(db);
      await sql`delete from sys_troops where id = ${attacktroop}`.execute(db);
      if (resistnpc) await sql`delete from sys_troops where battleid = ${id}`.execute(db);
      else
        await sql`update sys_troops set state = 1, starttime = unix_timestamp(), endtime = unix_timestamp() + 2 where battleid = ${id}`.execute(
          db,
        );
      if (attackhid > 0 || resisthid > 0)
        await sql`update sys_city_hero set state = 0 where hid = ${attackhid} or hid = ${resisthid}`.execute(
          db,
        );
    } else {
      await sql`update sys_battle set state = 1, result = 2 where id = ${id}`.execute(db);
      await sql`update sys_troops set state = 1, starttime = unix_timestamp(), endtime = unix_timestamp() + pathtime where battleid = ${id}`.execute(
        db,
      );
      if (resistuid < 1000)
        await sql`delete from sys_troops where battleid = ${id} and uid = ${resistuid}`.execute(db);
      if (attackuid < 1000) await sql`delete from sys_troops where id = ${attacktroop}`.execute(db);
    }
  }

  /** Load the per-battle cfg caches once (cfg_soldier, cfg_defence). */
  private async loadCache(): Promise<BattleCache> {
    const soldiers = (
      await sql<Row>`select sid, speed, \`range\`, hp, ap, dp, type from cfg_soldier`.execute(
        this.scope.db,
      )
    ).rows;
    const soldierInfo = new Map<
      number,
      { speed: number; range: number; hp: number; ap: number; dp: number; type: number }
    >();
    for (const s of soldiers) {
      soldierInfo.set(phpIntval(s.sid), {
        speed: phpNum(s.speed),
        range: phpNum(s.range),
        hp: phpNum(s.hp),
        ap: phpNum(s.ap),
        dp: phpNum(s.dp),
        type: phpNum(s.type),
      });
    }
    const defences = (
      await sql<Row>`select did, \`range\`, hp, ap, dp from cfg_defence`.execute(this.scope.db)
    ).rows;
    const defenceInfo = new Map<number, { range: number; hp: number; ap: number; dp: number }>();
    for (const d of defences) {
      defenceInfo.set(phpIntval(d.did), {
        range: phpNum(d.range),
        hp: phpNum(d.hp),
        ap: phpNum(d.ap),
        dp: phpNum(d.dp),
      });
    }
    return { soldierInfo, defenceInfo };
  }

  /** Assemble the `BattleRoundInput` from the mem_battle/sys_battle rows + cached cfg. */
  private async buildRoundInput(
    mem: Row,
    sys: Row,
    shared: BattleCache,
  ): Promise<BattleRoundInput> {
    const db = this.scope.db;
    const attackcid = phpIntval(mem.attackcid);
    const resistcid = phpIntval(mem.resistcid);
    const attackhid = phpIntval(mem.attackhid);
    const resisthid = phpIntval(mem.resisthid);

    const tech = async (cid: number): Promise<Record<number, number>> => {
      const rows = (
        await sql<Row>`select tid, level from sys_city_technic where cid = ${cid}`.execute(db)
      ).rows;
      const out: Record<number, number> = {};
      for (const r of rows) out[phpIntval(r.tid)] = phpNum(r.level);
      return out;
    };
    const hero = async (
      hid: number,
    ): Promise<{ combat: HeroCombat; command: number; speed: number }> => {
      if (hid === 0) return { combat: { bravery: 0, wisdom: 0 }, command: 0, speed: 0 };
      const h =
        (await sql<Row>`select * from sys_city_hero where hid = ${hid}`.execute(db)).rows[0] ?? {};
      const bravery = phpNum(h.bravery_base) + phpNum(h.bravery_add) + phpNum(h.bravery_add_on);
      const wisdom = phpNum(h.wisdom_base) + phpNum(h.wisdom_add) + phpNum(h.wisdom_add_on);
      const command = (phpNum(h.level) + phpNum(h.command_base) + phpNum(h.command_add_on)) * 1100;
      return { combat: { bravery, wisdom }, command, speed: phpNum(h.speed_add_on) };
    };
    const ah = await hero(attackhid);
    const dh = await hero(resisthid);

    const tactics = new Map<string, RoundTactic>();
    const tacticRows = (
      await sql<Row>`select attack, stype, action, target from mem_battle_tactics where battleid = ${phpIntval(mem.id)}`.execute(
        db,
      )
    ).rows;
    for (const t of tacticRows)
      tactics.set(`${phpIntval(t.attack)}:${phpIntval(t.stype)}`, {
        action: phpIntval(t.action),
        target: phpIntval(t.target),
      });

    return {
      type: phpIntval(mem.type),
      round: phpIntval(mem.round),
      fieldrange: phpNum(mem.fieldrange),
      wallhp: phpNum(mem.wallhp),
      attacksoldiers: phpString(mem.attacksoldiers),
      resistsoldiers: phpString(mem.resistsoldiers),
      attackpos: phpString(mem.attackpos),
      resistpos: phpString(mem.resistpos),
      resistdefence: phpString(mem.resistdefence),
      tactics,
      soldierInfo: shared.soldierInfo,
      defenceInfo: shared.defenceInfo,
      attackhid,
      resisthid,
      attackCommand: ah.combat,
      resistCommand: dh.combat,
      attackHeroCommand: ah.command,
      resistHeroCommand: dh.command,
      attackSpeed: ah.speed,
      resistSpeed: dh.speed,
      attackTech: await tech(attackcid),
      resistTech: await tech(resistcid),
    };
  }

  /** The dependency bundle `getBattleResult` consumes. */
  resultDeps(): BattleResultDeps {
    return {
      db: this.scope.db,
      query: async (q) => (await q.execute(this.scope.db)).rows,
      cell: async (q) => Object.values((await q.execute(this.scope.db)).rows[0] ?? {})[0],
      lang: {
        report: (key) => this.reportStr(key),
        reportArr: (key, index) => this.reportArr(key, index),
        row: (n) => this.reportRow(n),
        battle: (key) => this.battleStr(key),
        battleArr: (key, index) => this.battleArr(key, index),
        soldierName: (sid) => this.soldierName(sid),
        defenceName: (did) => this.defenceName(did),
      },
      cityRules: {
        addCitySoldiers: (cid, soldiers, add) => this.cityRules.addCitySoldiers(cid, soldiers, add),
        addCityResources: (cid, w, r, i, f, g) =>
          this.cityRules.addCityResources(cid, w, r, i, f, g),
        getNamePosition: (cid, type) => this.cityRules.getNamePosition(cid, type),
        refreshFoodArmyUsers: (cid) => this.cityRules.refreshFoodArmyUsers(cid),
        updateCityResourceAdd: (cid) => this.cityRules.updateCityResourceAdd(cid),
      },
      heroes: {
        addHeroExp: (hid, exp) => this.heroes.addHeroExp(hid, exp),
        throwHeroToField: (hero) => this.heroes.throwHeroToField(hero as never),
        updateCityHeroChange: (uid, cid) => this.heroes.updateCityHeroChange(uid, cid),
      },
      tasks: { completeTask: (uid, goalId) => this.tasks.completeTask(uid, goalId) },
      users: { bufferNobility: (uid, nobility) => this.users.bufferNobility(uid, nobility) },
      report: {
        sendReport: (uid, title, origincid, happencid, content) =>
          this.report.sendReport(uid, title, origincid, happencid, content),
      },
      warEvent: (battleid, unionid, type, content) =>
        this.raiseWarEvent(battleid, unionid, type, content),
      rand: (min, max) => this.random.randRange(min, max),
      mtRand: (min, max) => this.random.mtRand(min, max),
      usepeople: this.usepeopleTable(),
      carry: this.carryTable(),
    };
  }

  /** mem_war_event insert (the "push" the task referred to as war-event.service). */
  async raiseWarEvent(
    battleid: number,
    unionid: number,
    type: number,
    content: string,
  ): Promise<void> {
    await sql`insert into mem_war_event (battleid, unionid, type, content, evttime)
      values (${battleid}, ${unionid}, ${type}, ${content}, unix_timestamp())`.execute(
      this.scope.db,
    );
  }

  private async cell(q: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = (await q.execute(this.scope.db)).rows[0];
    return row ? Object.values(row)[0] : undefined;
  }

  // lang helpers — $GLOBALS['report'] / $GLOBALS['battle'] access like troop.tick.ts.
  private reportStr(key: string): string {
    const v = this.lang.value<Record<string, unknown>>('report')?.[key];
    return typeof v === 'string' ? v : '';
  }
  private reportRow(n: string): string {
    const rows = this.lang.value<Record<string, unknown>>('report')?.title_2row as
      Record<string, unknown> | undefined;
    const v = rows?.[n];
    return typeof v === 'string' ? v : '';
  }
  private reportArr(key: string, index: number): string {
    const v = this.lang.value<Record<string, unknown>>('report')?.[key];
    return Array.isArray(v) ? phpString(v[index]) : '';
  }
  private battleStr(key: string): string {
    const v = this.lang.value<Record<string, unknown>>('battle')?.[key];
    return typeof v === 'string' ? v : '';
  }
  /** `$GLOBALS['battle'][key][index]` — the array lang values (citytype, juewei, ...). */
  private battleArr(key: string, index: number): string {
    const v = this.lang.value<Record<string, unknown>>('battle')?.[key];
    return Array.isArray(v) ? phpString(v[index]) : '';
  }
  private soldierName(sid: number): string {
    const names = this.lang.value<Record<string, unknown>>('battle')?.patrol_report_soldier as
      Record<string, unknown> | undefined;
    return phpString(names?.[String(sid)] ?? '');
  }
  private defenceName(did: number): string {
    const names = this.lang.value<Record<string, unknown>>('battle')?.patrol_report_defence as
      Record<string, unknown> | undefined;
    return phpString(names?.[String(did)] ?? '');
  }
  private usepeopleTable(): Record<number, number> {
    const v = this.lang.value<Record<string, unknown>>('soldier') as
      { usepeople?: Record<string, unknown> } | undefined;
    const out: Record<number, number> = {};
    if (v?.usepeople) for (const [k, n] of Object.entries(v.usepeople)) out[Number(k)] = phpNum(n);
    return out;
  }
  private carryTable(): Record<number, number> {
    const v = this.lang.value<Record<string, unknown>>('soldier') as
      { carry?: Record<string, unknown> } | undefined;
    const out: Record<number, number> = {};
    if (v?.carry) for (const [k, n] of Object.entries(v.carry)) out[Number(k)] = phpNum(n);
    return out;
  }
}

// cid2wid needs importing without pulling the service dependency; re-declare the pure helper.
function cid2wid(cid: number): number {
  const y = Math.floor(cid / 1000);
  const x = cid % 1000;
  return Math.floor(y / 10) * 10000 + Math.floor(x / 10) * 100 + (y % 10) * 10 + (x % 10);
}
