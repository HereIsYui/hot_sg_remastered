import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { cid2wid, wid2cid } from '../core/city-rules.service';
import { HeroRules, isActHero, type ThrownHero } from '../core/hero-rules.service';
import { phpEmpty, phpIntval, phpLooseEquals } from '../core/php';
import { ReportService } from '../core/report.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** The NPC lord that takes over discarded cities. */
const NPC_UID = 895;
const CAPITAL_TYPE = 5;
/** sys_report.title of 废弃城池. */
const REPORT_DISCARD_CITY = 25;
/** tid of the office task of officepos 5; the higher offices follow. */
const OFFICE_TASK_BASE = 271 - 5;

/** The 官府's 所有城池 list of CityFunc.php. */
@Injectable()
export class CityListCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly heroes: HeroRules,
    private readonly reports: ReportService,
    private readonly users: UserRules,
  ) {}

  /** The player's cities with their chief's name, population and morale. */
  @GlobalCommand()
  async getCityList(ctx: CommandContext): Promise<unknown[]> {
    return this.cityList(ctx.uid);
  }

  /**
   * `[cid]`: hands the city with its heroes and troops to the NPC lord, empties its
   * resources and queues, and demotes the player's office when it was the last city of its
   * rank. The 2级密码 is only asked by the client, as in the original.
   */
  @GlobalCommand()
  async discardCity(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const cid = phpIntval(param[0]);
    return this.scope.transaction(async () => {
      const city = await this.row(sql`select * from sys_city where cid = ${cid}`);
      if (!phpLooseEquals(city?.uid ?? null, uid)) {
        throw GameError.lang('discardCity.not_your_city');
      }
      if (
        await this.check(sql`select 1 from mem_world where wid = ${cid2wid(cid)} and state = 1`)
      ) {
        throw GameError.lang('discardCity.city_in_battle');
      }
      if (await this.check(sql`select 1 from sys_troops where cid = ${cid} and uid = ${uid}`)) {
        throw GameError.lang('discardCity.has_army_outside');
      }
      const type = phpIntval(city?.type);
      if (type === CAPITAL_TYPE) throw GameError.lang('discardCity.can_not_big_city');
      if (await this.check(sql`select cid from cfg_soldier_special_city where cid = ${cid}`)) {
        throw GameError.lang('spacialcity.not_discard_city');
      }
      await this.checkFieldTroops(uid, cid);

      const government = await this.cell(
        sql`select level from sys_building where cid = ${cid} and bid = 6`,
      );
      const governmentLevel = phpEmpty(government) ? 1 : phpIntval(government);
      await this.releaseHeroes(uid, cid);

      const db = this.scope.db;
      await sql`update sys_troops set uid = ${NPC_UID} where cid = ${cid} and uid = ${uid}`.execute(
        db,
      );
      await sql`update mem_city_resource set wood = 0, rock = 0, iron = 0, food = 0, gold = 0,
          people = 0, tax = 10, complaint = 0, morale = 90 where cid = ${cid}`.execute(db);
      if (type > 0) {
        await sql`update sys_union_city set count = greatest(0, count - 1)
          where unionid = (select union_id from sys_user where uid = ${uid})`.execute(db);
      }
      await sql`update sys_city set uid = ${NPC_UID},
          discardtime = unix_timestamp() + ${governmentLevel * 86400} where cid = ${cid}`.execute(
        db,
      );
      await sql`update sys_technic set state = 0 where cid = ${cid}`.execute(db);
      await sql`update sys_building set state = 0 where cid = ${cid}`.execute(db);
      for (const table of [
        'mem_technic_upgrading',
        'mem_building_upgrading',
        'mem_building_destroying',
        'mem_city_draft',
        'sys_city_draftqueue',
        'mem_city_reinforce',
        'sys_city_reinforcequeue',
        'sys_city_soldier',
      ]) {
        await sql`delete from ${sql.table(table)} where cid = ${cid}`.execute(db);
      }
      await sql`delete from sys_city_trade where cid = ${cid} and state = 0 and buycid = 0`.execute(
        db,
      );
      await sql`insert into mem_city_schedule (cid, last_change_army) values (${cid}, unix_timestamp())
        on duplicate key update last_change_army = unix_timestamp()`.execute(db);
      await sql`delete from sys_gather where wid = ${cid2wid(cid)}`.execute(db);

      if (type === 3) {
        await sql`delete from sys_user_designation
          where uid = ${uid} and did = ${city?.province}`.execute(db);
      }
      if (type > 0) await this.demoteOffice(uid, type);

      const name = await this.cell(sql`select name from sys_city where cid = ${cid}`);
      const place = `${String(name ?? '')}(${cid % 1000},${Math.floor(cid / 1000)})`;
      await this.reports.sendReport(
        uid,
        REPORT_DISCARD_CITY,
        cid,
        cid,
        this.lang.t('discardCity.giveup_city', place),
      );
      return [await this.cityList(uid), await this.users.userCities(uid)];
    });
  }

  private async cityList(uid: number): Promise<unknown[]> {
    const result = await sql`select c.*, h.name as chiefname, m.people, m.morale
      from mem_city_resource m, sys_city c left join sys_city_hero h on c.chiefhid = h.hid
      where m.cid = c.cid and c.uid = ${uid}`.execute(this.scope.db);
    return result.rows;
  }

  /** Allies' troops, or troops of the player's other cities, may not stay on the fields. */
  private async checkFieldTroops(uid: number, cid: number): Promise<void> {
    const fields = await this.rows(sql`select wid from mem_world where ownercid = ${cid}`);
    if (fields.length === 0) return;
    const cids = fields.map((f) => wid2cid(f.wid));
    const list = sql.join(cids);
    if (
      await this.check(sql`select uid from sys_troops where targetcid in (${list}) and state = 4
        and uid <> ${uid} and uid > 0`)
    ) {
      throw GameError.lang('discardCity.has_union_army');
    }
    if (
      await this.check(sql`select uid from sys_troops where targetcid in (${list}) and state = 4
        and cid <> ${cid} and uid = ${uid}`)
    ) {
      throw GameError.lang('discardCity.has_your_other_city_army');
    }
  }

  /**
   * Event heroes go back to the wild; the others pass to the NPC lord without their gear,
   * blood and 求贤 records, and famous heroes take their exclusive tasks with them. The
   * original clears those tasks of every player and logs the hero ids as npcids.
   */
  private async releaseHeroes(uid: number, cid: number): Promise<void> {
    const db = this.scope.db;
    const heroes = await this.rows(
      sql`select * from sys_city_hero where cid = ${cid} and uid = ${uid}`,
    );
    const hids: unknown[] = [];
    for (const hero of heroes) {
      if (isActHero(hero.herotype)) {
        await this.heroes.throwHeroToField(hero as unknown as ThrownHero);
        continue;
      }
      hids.push(hero.hid);
      const npcid = phpIntval(hero.npcid);
      if (npcid !== 0) {
        const min = 10 * (npcid + 40000);
        await sql`delete from sys_user_task where tid > ${min} and tid < ${min + 10}`.execute(db);
        await sql`delete from sys_user_goal where gid > ${min} and gid < ${min + 10}`.execute(db);
        await sql`delete from sys_attack_position where tid > ${min} and tid < ${min + 10}`.execute(
          db,
        );
      }
    }
    if (hids.length === 0) return;
    const list = sql.join(hids);
    await sql`delete from sys_hero_armor where hid in (${list})`.execute(db);
    await sql`update sys_user_book set hid = 0 where hid in (${list})`.execute(db);
    await sql`update sys_user_armor set hid = 0 where hid in (${list})`.execute(db);
    await sql`delete from mem_hero_blood where hid in (${list})`.execute(db);
    await sql`update sys_city_hero set uid = ${NPC_UID} where cid = ${cid} and uid = ${uid}`.execute(
      db,
    );
    await sql`insert into log_lionize (uid, npcid, type, count, time)
      select uid, npcid, 13, 0, unix_timestamp() from sys_lionize
      where uid = ${uid} and npcid in (${list})`.execute(db);
    await sql`delete from sys_lionize where uid = ${uid} and npcid in (${list})`.execute(db);
  }

  /**
   * 丞相 needs a 都城, 州牧 a 州城, 9-11 a 郡城 and 6-8 a 县城; losing the last one steps the
   * office down and reopens the office tasks above it.
   */
  private async demoteOffice(uid: number, type: number): Promise<void> {
    const db = this.scope.db;
    const original = phpIntval(
      await this.cell(sql`select officepos from sys_user where uid = ${uid}`),
    );
    const left = async (cityType: number) =>
      phpIntval(
        await this.cell(
          sql`select count(*) from sys_city where type = ${cityType} and uid = ${uid}`,
        ),
      );
    let pos = original;
    if (type === 4 && pos === 13) pos = 12;
    if (type >= 3 && pos === 12 && (await left(3)) === 0) pos = 11;
    if (type >= 2 && pos >= 9 && pos < 12 && (await left(2)) === 0) pos = 8;
    if (type >= 1 && pos >= 6 && pos < 9 && (await left(1)) === 0) pos = 5;
    if (pos === original) return;
    await sql`update sys_user set officepos = ${pos} where uid = ${uid}`.execute(db);
    for (let i = pos; i < original; i++) {
      await sql`insert into sys_user_task (uid, tid, state) values (${uid}, ${OFFICE_TASK_BASE + i}, 0)
        on duplicate key update state = 0`.execute(db);
    }
  }

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async row(query: RawBuilder<unknown>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  private async cell(query: RawBuilder<unknown>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : undefined;
  }

  private async check(query: RawBuilder<unknown>): Promise<boolean> {
    return (await this.rows(query)).length > 0;
  }
}
