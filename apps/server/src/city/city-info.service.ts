import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { cid2wid } from '../core/city-rules.service';
import { GameState, GameStateService } from '../core/game-state.service';
import { OwnershipService } from '../core/ownership.service';
import { phpEmpty, phpIntval } from '../core/php';
import { phpDate, phpTime } from '../core/php-time';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { dbNow } from '../db/sql-fragments';
import { CityBuildingsService } from './city-buildings.service';
import { CityProductionService } from './city-production.service';

type Row = Record<string, unknown>;

/** mem_state rows read here besides GameState. */
const LOTTERY_OPEN_STATE = 150;
/** City skin buffs: bufparam 705 with buftype 11021 or 10932-10937. */
const CITY_SKIN_BUFPARAM = 705;

/** The city data the client loads (utils.php / global.php). */
@Injectable()
export class CityInfoService {
  constructor(
    private readonly scope: DbScope,
    private readonly state: GameStateService,
    private readonly users: UserRules,
    private readonly ownership: OwnershipService,
    private readonly buildings: CityBuildingsService,
    private readonly production: CityProductionService,
  ) {}

  private async one(query: ReturnType<typeof sql<Row>>): Promise<Row | false> {
    return (await query.execute(this.scope.db)).rows[0] ?? false;
  }

  private async rows(query: ReturnType<typeof sql<Row>>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows;
  }

  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = (await query.execute(this.scope.db)).rows[0];
    return row === undefined ? false : Object.values(row)[0];
  }

  private async userRow(uid: number): Promise<Row> {
    const user = (await this.one(sql<Row>`select * from sys_user where uid = ${uid}`)) || {};
    let openLottery = await this.state.value(LOTTERY_OPEN_STATE);
    if (phpEmpty(openLottery)) openLottery = 0;
    return { ...user, openLottery };
  }

  /** `isAdult` / `onLineTime` of the anti-addiction system (1 / 0 when it is off). */
  private async adultFields(uid: number): Promise<Row> {
    if (!(await this.state.isAdultOpen())) return { isAdult: 1, onLineTime: 0 };
    return {
      isAdult: await this.cell(sql<Row>`select state from sys_user_fcm where uid = ${uid}`),
      onLineTime: await this.cell(sql<Row>`select onlinetime from sys_user_fcm where uid = ${uid}`),
    };
  }

  /**
   * utils.php::doGetCityBaseInfo: `[user, resources, heroes, soldiers, defences, alarm]`, after
   * recomputing the city's production.
   */
  async baseInfo(uid: number, cid: number): Promise<unknown[]> {
    const user = await this.userRow(uid);
    Object.assign(user, await this.adultFields(uid));
    user.openIndex = await this.state.value(GameState.MinorityRegionOpen);
    Object.assign(user, await this.users.designationFields(uid));
    await this.production.updateUsersCityResource(uid, cid);
    const resources = await this.one(sql<Row>`select * from mem_city_resource where cid = ${cid}`);
    user.currentYear = await this.users.currentYear();
    return [
      user,
      resources,
      await this.heroRows(uid, cid),
      await this.rows(sql<Row>`select * from sys_city_soldier where cid = ${cid} order by sid`),
      await this.rows(sql<Row>`select * from sys_city_defence where cid = ${cid} order by did`),
      await this.one(sql<Row>`select * from sys_alarm where uid = ${uid}`),
    ];
  }

  private heroRows(uid: number, cid: number): Promise<Row[]> {
    return this
      .rows(sql<Row>`select * from sys_city_hero h left join mem_hero_blood m on m.hid = h.hid
      where h.cid = ${cid} and h.uid = ${uid}`);
  }

  /**
   * utils.php::doGetCityAllInfo: `[city, baseInfo, buildings, technics, [{province, jun}]]`.
   */
  async allInfo(uid: number, cid: number): Promise<unknown[]> {
    const city = await this.one(sql<Row>`select * from sys_city where cid = ${cid}`);
    if (!city) throw GameError.lang('doGetCityAllInfo.no_city_info');
    city.spacialSid = await this.specialSoldierId(cid);
    return [
      city,
      await this.baseInfo(uid, cid),
      await this.buildings.buildingInfo(uid, cid),
      await this.rows(sql<Row>`select tid, level from sys_city_technic where cid = ${cid}`),
      await this.rows(sql<Row>`select province, jun from mem_world where wid = ${cid2wid(cid)}`),
    ];
  }

  /** utils.php::getSpacialSoldierId */
  private async specialSoldierId(cid: number): Promise<unknown> {
    const sid = await this.cell(
      sql<Row>`select sid from cfg_soldier_special_city where cid = ${cid} and type <> '4'`,
    );
    return phpEmpty(sid) ? 0 : sid;
  }

  /**
   * global.php::getCityInfoRes (CityCommand type 0, polled every 15 s): advances resources of
   * every player city by one poll's worth, drifts morale and population every sixth minute,
   * refills hero stamina, and returns `[user, resources, alarm, skillGoldAdd, now, infoCount,
   * info?]`.
   */
  async resourceInfo(uid: number, cid: number): Promise<unknown[]> {
    const db = this.scope.db;
    await this.ownership.checkCityOwner(cid, uid);
    const user = await this.userRow(uid);
    user.real_nobility = '';
    const nobility = await this.users.bufferNobility(uid, user.nobility);
    if (nobility != user.nobility) {
      user.real_nobility = user.nobility;
      user.nobility = nobility;
    }
    Object.assign(user, await this.adultFields(uid));
    user.openIndex = await this.state.value(GameState.MinorityRegionOpen);
    const designation = await this.users.designationFields(uid);
    user.curDesigName = designation.curDesigName;
    user.curDesigid = designation.curDesigid;
    user.designations = designation.designations;
    for (const d of designation.designations as Row[]) {
      if (phpIntval(d.state) === 2) {
        await sql`update sys_user_designation set state = '1'
          where uid = ${uid} and did = ${d.did}`.execute(db);
      }
    }
    const reward = await sql<{ last: string | null; today: string }>`select
        (select substr(from_unixtime(getrewardtime), 1, 10) from sys_user_level where uid = ${uid}) as last,
        substr(now(), 1, 10) as today`.execute(db);
    const { last, today } = reward.rows[0]!;
    user.hasGetReward = !phpEmpty(last) && last === today;
    user.currentYear = await this.users.currentYear();

    const now = await dbNow(db);
    const special = phpIntval(
      await this.cell(sql<Row>`select is_special from sys_city where cid = ${cid}`),
    );
    const skinEnd = await this.cell(sql<Row>`select endtime from mem_city_buffer
      where cid = ${cid} and bufparam = ${String(CITY_SKIN_BUFPARAM)}
        and (buftype = '11021' or buftype between 10932 and 10937)`);
    if ((phpEmpty(skinEnd) || phpIntval(skinEnd) < now) && special >= 10 && special <= 50) {
      await sql`update sys_city set is_special = '0' where cid = ${cid} limit 1`.execute(db);
    }

    await this.production.setCityBaseProduce(cid);
    await this.advanceResources();
    const clock = phpTime();
    if (Number(phpDate('i', clock)) % 6 === 0 && Number(phpDate('s', clock)) <= 16) {
      await this.driftMoraleAndPeople();
    }
    await sql`update mem_hero_blood set
        \`force\` = case when ((\`force\` + force_max / 150) < force_max) then (\`force\` + force_max / 150) else force_max end,
        energy = case when ((energy + energy_max / 150) < energy_max) then (energy + energy_max / 150) else energy_max end`.execute(
      db,
    );

    const ret: unknown[] = [
      user,
      await this.one(sql<Row>`select m.*, b.endtime as shuilibian from mem_city_resource m
        left join mem_user_buffer b on b.uid = ${uid} and b.buftype = 15 where m.cid = ${cid}`),
      await this.one(sql<Row>`select * from sys_alarm where uid = ${uid}`),
      await this.cell(sql<Row>`select skill_gold_add from sys_city_res_add where cid = ${cid}`),
      await dbNow(db),
    ];
    const total = await this.cell(sql<Row>`select count(*) from sys_info_alarm where uid = ${uid}`);
    ret.push(total);
    if (Number(total) > 0) {
      const info = await this.one(
        sql<Row>`select * from sys_info_alarm where uid = ${uid} order by time limit 1`,
      );
      ret.push(info);
      if (info) await sql`delete from sys_info_alarm where id = ${info.id}`.execute(db);
    }
    return ret;
  }

  /**
   * One poll's growth for every active player city: 1/225 of the hourly output (1/255 for wood,
   * stone and iron, as in the original), capped at the storage limit unless already above it.
   */
  private async advanceResources(): Promise<void> {
    await sql`update mem_city_resource set
        food = case when ((food_add - food_army_use) > 0)
          then least(food + (food_add - food_army_use) / 225, greatest(food, food_max))
          else greatest(0, food + (food_add - food_army_use) / 225) end,
        wood = least(greatest(wood_max, wood), wood + wood_add / 255),
        rock = least(greatest(rock_max, rock), rock + rock_add / 255),
        iron = least(greatest(iron_max, iron), iron + iron_add / 255),
        gold = case when ((people * gold_rate / 10000 * tax - hero_fee) > 0)
          then least(greatest(gold_max, gold), gold + (people * gold_rate * tax / 10000 - hero_fee) / 225)
          else greatest(0, gold + (people * gold_rate * tax / 10000 - hero_fee) / 225) end
      where exists (select cid from sys_city where uid > 1000 and cid = mem_city_resource.cid)
        and vacation = 0 and forbidden = 0`.execute(this.scope.db);
  }

  /** Morale moves 1 toward 100 - tax - complaint; population moves toward people_stable. */
  private async driftMoraleAndPeople(): Promise<void> {
    await sql`update mem_city_resource set
        morale = case when (morale < 100 - tax - complaint) then least(100, morale + 1)
          when (morale > 100 - tax - complaint) then greatest(0, morale - 1) else morale end,
        people_stable = people_max * morale * 0.01,
        people = case when (people < people_stable) then least(people + ceiling(people_max / 200), people_stable)
          when (people > people_stable) then greatest(people_stable, people - ceiling(people_max / 200))
          else greatest(0, people) end`.execute(this.scope.db);
  }

  /** global.php::getCityInfoHero (CityCommand type 1): heroes with buffs and carry bonuses. */
  async heroInfo(uid: number, cid: number): Promise<Row[]> {
    const db = this.scope.db;
    const heroes = await this.heroRows(uid, cid);
    const ret: Row[] = [];
    for (const hero of heroes) {
      const out: Row = { ...hero };
      const buffers = await this.rows(sql<Row>`select * from mem_hero_buffer
        where hid = ${hero.hid} and endtime > unix_timestamp()`);
      for (const buf of buffers) out[`buf${String(buf.buftype)}`] = buf.endtime;
      const attributes = await this.rows(sql<Row>`select * from sys_hero_attribute
        where hid = ${hero.hid} and attid >= 2000 and attid <= 4999 and attid % 100 in (11, 12)
        order by attid % 100`);
      for (const attr of attributes) out[String(attr.attid)] = attr.value;
      const attribute = async (attid: number) =>
        (
          await sql<Row>`select * from sys_hero_attribute where hid = ${hero.hid} and attid = ${attid}`.execute(
            db,
          )
        ).rows[0]?.value ?? 0;
      out['12'] = await attribute(12);
      out['10012'] = await attribute(10012);
      if (phpIntval(out.herotype) === 1000) {
        const level = await this.cell(
          sql<Row>`select level from sys_user_level where uid = ${uid}`,
        );
        out.kingLevel = phpEmpty(level) ? 0 : level;
      }
      out.curCid = await this.heroCity(hero.hid);
      ret.push(out);
    }
    return ret;
  }

  /** ArmorFunc.php::getHeroDetail: one hero row with its buffers, as the armor commands reply. */
  async heroDetail(hid: number): Promise<Row | undefined> {
    const hero = await this.one(sql<Row>`select * from sys_city_hero h
      left join mem_hero_blood m on m.hid = h.hid where h.hid = ${hid}`);
    if (!hero) return undefined;
    const buffers = await this.rows(sql<Row>`select * from mem_hero_buffer
      where hid = ${hero.hid} and endtime > unix_timestamp()`);
    for (const buf of buffers) hero[`buf${String(buf.buftype)}`] = buf.endtime;
    if (phpIntval(hero.herotype) === 1000) {
      const level = await this.cell(
        sql<Row>`select level from sys_user_level where uid = ${hero.uid}`,
      );
      hero.kingLevel = phpEmpty(level) ? 0 : level;
    }
    hero.curCid = await this.heroCity(hero.hid);
    return hero;
  }

  /** global.php::doGetHeroState: where the hero is, the garrison target when stationed (4). */
  private async heroCity(hid: unknown): Promise<unknown> {
    const hero = await this.one(sql<Row>`select * from sys_city_hero where hid = ${hid} limit 1`);
    let cid: unknown = phpIntval(hero ? hero.cid : 0);
    if (hero && phpIntval(hero.state) === 4) {
      cid = await this.cell(sql<Row>`select targetcid from sys_troops where hid = ${hid} limit 1`);
    }
    return cid;
  }

  /** global.php::getCityInfoArmy (type 2) */
  async armyInfo(uid: number, cid: number): Promise<unknown[]> {
    await this.ownership.checkCityOwner(cid, uid);
    return [
      await this.rows(sql<Row>`select * from sys_city_soldier where cid = ${cid} order by sid`),
    ];
  }

  /** global.php::getCityInfoDefence (type 3) */
  async defenceInfo(uid: number, cid: number): Promise<unknown[]> {
    await this.ownership.checkCityOwner(cid, uid);
    return [
      await this.rows(sql<Row>`select * from sys_city_defence where cid = ${cid} order by did`),
    ];
  }
}
