import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Building, CityRules } from '../core/city-rules.service';
import { phpEmpty, phpFloat, phpFloatString, phpIntval, phpNum, phpString } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { DbScope } from '../db/database.module';

type Row = Record<string, unknown>;

/** common.php */
const GAME_SPEED_RATE = 1;
/** Output per worker per hour. */
const RATE = { food: 10, wood: 10, rock: 5, iron: 4 } as const;
/** ID_TECHNIC_*: 1-4 raise the matching resource by 10% per level. */
const Technic = { Food: 1, Wood: 2, Rock: 3, Iron: 4, Leadership: 6, Storage: 15 } as const;

/** Hero buffs (mem_hero_buffer.buftype) that affect the city chief. */
const HeroBuff = { Hufu: 1, Wenquxing: 2 } as const;
/** Skill books (cfg_book.id) of the city chief that add production. */
const ChiefSkill = { Tax: 8, Prosperity: 9, Food: 10, Wood: 11, Rock: 12, Iron: 13 } as const;
/** Resource goods buffs (mem_user_buffer.buftype). */
const GoodsBuff = { food: 1, wood: 2, rock: 3, iron: 4 } as const;

/** Production thresholds of `food_add_base` etc. and the goals they complete. */
const PRODUCTION_GOALS: Record<'food' | 'wood' | 'rock' | 'iron', number[]> = {
  food: [189, 190, 191, 192],
  wood: [193, 194, 195, 196],
  rock: [197, 198, 199, 200],
  iron: [201, 202, 203, 204],
};
const PRODUCTION_STEPS = [1000, 5000, 10000, 50000];

/** Result of CityFunc.php::getCityProduct, in reply order. */
export interface CityProduct {
  resAdd: Row;
  people: { food: unknown; wood: unknown; rock: unknown; iron: unknown };
  base: { food: number; wood: number; rock: number; iron: number };
  technic: { food: unknown; wood: unknown; rock: unknown; iron: unknown };
  foodArmyUse: unknown;
  chiefAdd: number;
  goodsEndtime: { food: unknown; wood: unknown; rock: unknown; iron: unknown };
  skillAdd: unknown[];
}

/** Resource production of a city (CityFunc.php / utils.php). */
@Injectable()
export class CityProductionService {
  constructor(
    private readonly scope: DbScope,
    private readonly cityRules: CityRules,
    private readonly tasks: TaskRules,
  ) {}

  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = (await query.execute(this.scope.db)).rows[0];
    return row === undefined ? false : Object.values(row)[0];
  }

  /** CityFunc.php::getCityProduct */
  async product(uid: number, cid: number): Promise<CityProduct> {
    const db = this.scope.db;
    let resAdd = (await sql<Row>`select * from sys_city_res_add where cid = ${cid}`.execute(db))
      .rows[0];
    if (!resAdd) {
      await sql`insert into sys_city_res_add (cid) values (${cid})`.execute(db);
      resAdd = (await sql<Row>`select * from sys_city_res_add where cid = ${cid}`.execute(db))
        .rows[0]!;
    }

    const workers = (bid: number) =>
      this.cell(sql<Row>`select sum(l.using_people) from sys_building b, cfg_building_level l
        where b.bid = l.bid and b.level = l.level and b.cid = ${cid} and b.bid = ${bid}`);
    const people = {
      food: await workers(Building.Farmland),
      wood: await workers(Building.Wood),
      rock: await workers(Building.Rock),
      iron: await workers(Building.Iron),
    };
    const base = {
      food: RATE.food * phpNum(people.food) * GAME_SPEED_RATE,
      wood: RATE.wood * phpNum(people.wood) * GAME_SPEED_RATE,
      rock: RATE.rock * phpNum(people.rock) * GAME_SPEED_RATE,
      iron: RATE.iron * phpNum(people.iron) * GAME_SPEED_RATE,
    };
    const technicRate = (tid: number) =>
      this.cell(
        sql<Row>`select level * 10 from sys_city_technic t where tid = ${tid} and cid = ${cid}`,
      );
    const technic = {
      food: await technicRate(Technic.Food),
      wood: await technicRate(Technic.Wood),
      rock: await technicRate(Technic.Rock),
      iron: await technicRate(Technic.Iron),
    };

    const { chiefAdd, skillAdd } = await this.chiefBonus(cid, resAdd);
    const foodArmyUse = await this.cell(
      sql<Row>`select food_army_use from mem_city_resource where cid = ${cid}`,
    );
    const goodsEndtime = {
      food: 0 as unknown,
      wood: 0 as unknown,
      rock: 0 as unknown,
      iron: 0 as unknown,
    };
    for (const kind of ['food', 'wood', 'rock', 'iron'] as const) {
      if (phpNum(resAdd[`goods_${kind}_add`]) > 0) {
        goodsEndtime[kind] = await this.cell(sql<Row>`select endtime from mem_user_buffer
          where uid = ${uid} and buftype = ${GoodsBuff[kind]}`);
      }
    }
    return { resAdd, people, base, technic, foodArmyUse, chiefAdd, goodsEndtime, skillAdd };
  }

  /** The reply array of getCityProduct. */
  static reply(p: CityProduct): unknown[] {
    return [
      p.resAdd,
      p.people.food,
      p.people.wood,
      p.people.rock,
      p.people.iron,
      p.base.food,
      p.base.wood,
      p.base.rock,
      p.base.iron,
      p.technic.food,
      p.technic.wood,
      p.technic.rock,
      p.technic.iron,
      p.foodArmyUse,
      phpFloat(p.chiefAdd),
      p.goodsEndtime.food,
      p.goodsEndtime.wood,
      p.goodsEndtime.rock,
      p.goodsEndtime.iron,
      p.skillAdd,
    ];
  }

  /**
   * The chief's 内政 bonus, scaled down when his 统率 cannot cover the population, and the
   * production skill books he has learned.
   */
  private async chiefBonus(
    cid: number,
    resAdd: Row,
  ): Promise<{ chiefAdd: number; skillAdd: unknown[] }> {
    const db = this.scope.db;
    let chiefAdd = 0;
    const skillAdd: unknown[] = [0];
    const chief = (
      await sql<Row>`select c.chiefhid, h.* from sys_city c left join sys_city_hero h on c.chiefhid = h.hid
        where h.cid = ${cid} and c.cid = ${cid}`.execute(db)
    ).rows[0];
    if (!chief || !(phpNum(chief.chiefhid) > 0)) return { chiefAdd, skillAdd };

    const hid = chief.chiefhid;
    chiefAdd =
      phpNum(chief.affairs_add) + phpNum(chief.affairs_base) + phpNum(chief.affairs_add_on);
    const heroCommand =
      phpNum(chief.level) + phpNum(chief.command_base) + phpNum(chief.command_add_on);
    const cityPeopleMax = await this.cell(
      sql<Row>`select people_max from mem_city_resource where cid = ${cid}`,
    );
    const hasBuff = async (buftype: number) =>
      (
        await sql`select hid from mem_hero_buffer where hid = ${hid} and buftype = ${buftype}
          and endtime > unix_timestamp()`.execute(db)
      ).rows.length > 0;
    const hufu = (await hasBuff(HeroBuff.Hufu)) ? 1.5 : 1;
    const leaderTechLevel = phpIntval(
      await this.cell(
        sql<Row>`select level from sys_city_technic where cid = ${cid} and tid = ${Technic.Leadership}`,
      ),
    );
    let peopleRate =
      (heroCommand * 10.0 * (100 * hufu + leaderTechLevel * 10)) / (phpNum(cityPeopleMax) + 1);
    if (peopleRate > 1.0) peopleRate = 1.0;
    chiefAdd = chiefAdd * peopleRate;
    if (await hasBuff(HeroBuff.Wenquxing)) chiefAdd = chiefAdd * 1.25;

    if (phpEmpty(hid)) return { chiefAdd, skillAdd };
    const book = (bid: number) =>
      this.cell(sql<Row>`select b.id from sys_user_book a, cfg_book b
        where a.bid = b.id and a.level = b.level and a.bid = ${bid} and a.hid = ${hid}`);
    const learned = async (bid: number, extra: unknown) => {
      const id = await book(bid);
      if (phpEmpty(id)) return;
      skillAdd[0] = 1;
      skillAdd.push(id, extra);
    };
    await learned(ChiefSkill.Tax, resAdd.skill_gold_add);
    await learned(ChiefSkill.Prosperity, [
      resAdd.skill_food_add,
      resAdd.skill_wood_add,
      resAdd.skill_rock_add,
      resAdd.skill_iron_add,
    ]);
    await learned(ChiefSkill.Food, resAdd.skill_food_add);
    await learned(ChiefSkill.Wood, resAdd.skill_wood_add);
    await learned(ChiefSkill.Rock, resAdd.skill_rock_add);
    await learned(ChiefSkill.Iron, resAdd.skill_iron_add);
    return { chiefAdd, skillAdd };
  }

  /** utils.php::UpdateUsersCityResource: recomputes hourly output and storage limits. */
  async updateUsersCityResource(uid: number, cid: number): Promise<void> {
    const db = this.scope.db;
    const p = await this.product(uid, cid);
    const rate = (
      await sql<Row>`select food_rate, wood_rate, rock_rate, iron_rate from sys_city_res_add
        where cid = ${cid}`.execute(db)
    ).rows[0];
    let skillFoodAdd = await this.cell(
      sql<Row>`select skill_food_add from sys_city_res_add where cid = ${cid}`,
    );
    if (phpEmpty(skillFoodAdd)) skillFoodAdd = 0;
    const skillFood = (p.base.food * phpNum(skillFoodAdd)) / 100;

    const s = (v: unknown) => phpString(v);
    await sql`update mem_city_resource set people_working =
        ${s(p.people.food)} * ${s(rate?.food_rate)} / 100 + ${s(p.people.wood)} * ${s(rate?.wood_rate)} / 100
        + ${s(p.people.rock)} * ${s(rate?.rock_rate)} / 100 + ${s(p.people.iron)} * ${s(rate?.iron_rate)} / 100
      where cid = ${cid}`.execute(db);
    const city = (await sql<Row>`select * from mem_city_resource where cid = ${cid}`.execute(db))
      .rows[0];
    const working = phpNum(city?.people_working);
    let productRate = phpNum(city?.people) / (working == 0 ? 1 : working);
    if (productRate > 1) productRate = 1;
    await sql`update sys_city_res_add set chief_add = ${phpFloatString(p.chiefAdd)}
      where cid = ${cid}`.execute(db);

    if (uid > 1000) {
      for (const kind of ['food', 'wood', 'rock', 'iron'] as const) {
        for (let i = 0; i < PRODUCTION_STEPS.length; i++) {
          if (p.base[kind] >= PRODUCTION_STEPS[i]!) {
            await this.tasks.completeTask(uid, PRODUCTION_GOALS[kind][i]!);
          }
        }
      }
    }

    const tlevelCell = await this.cell(
      sql<Row>`select 1 + level / 10 from sys_city_technic where tid = ${Technic.Storage} and cid = ${cid}`,
    );
    const tlevel = phpEmpty(tlevelCell) ? 1 : phpNum(tlevelCell);
    const r = p.resAdd;
    const output = (kind: 'food' | 'wood' | 'rock' | 'iron', skill: number) =>
      100 +
      skill +
      (p.base[kind] *
        productRate *
        (1 +
          (phpNum(p.technic[kind]) +
            phpNum(r[`field_${kind}_add`]) +
            phpNum(r[`goods_${kind}_add`]) +
            p.chiefAdd) /
            100) *
        phpNum(r[`${kind}_rate`])) /
        100;
    const limit = (kind: 'food' | 'wood' | 'rock' | 'iron') => 10000 + p.base[kind] * tlevel * 100;
    const f = phpFloatString;
    await sql`update mem_city_resource set
        food_add = ${f(output('food', skillFood))}, food_max = ${f(limit('food'))},
        wood_add = ${f(output('wood', 0))}, wood_max = ${f(limit('wood'))},
        rock_add = ${f(output('rock', 0))}, rock_max = ${f(limit('rock'))},
        iron_add = ${f(output('iron', 0))}, iron_max = ${f(limit('iron'))}
      where cid = ${cid}`.execute(db);
    await this.cityRules.updateCityPeopleMax(cid);
    await this.cityRules.updateCityPeopleStable(cid);
    await this.cityRules.updateCityGoldMax(cid);
  }

  /** utils.php::SetCityBaseProduce: storage limits from the levels of the production buildings. */
  async setCityBaseProduce(cid: number): Promise<void> {
    const db = this.scope.db;
    const buildings = (
      await sql<Row>`select * from sys_building where cid = ${cid} order by bid desc, level desc`.execute(
        db,
      )
    ).rows;
    if (buildings.length === 0) return;
    const max = { food: 0, wood: 0, rock: 0, iron: 0, gold: 0, people: 0 };
    for (const building of buildings) {
      const bid = phpIntval(building.bid);
      const level = phpNum(building.level);
      const cfg = (
        await sql<Row>`select * from cfg_building_level where bid = ${building.bid}
          and level = ${building.level}`.execute(db)
      ).rows[0];
      const using = phpNum(cfg?.using_people);
      if (bid === Building.Farmland) max.food += using * 1000;
      else if (bid === Building.Wood) max.wood += using * 1000;
      else if (bid === Building.Rock) max.rock += using * 500;
      else if (bid === Building.Iron) max.iron += using * 400;
      else if (bid === Building.House) max.people += 100 * level + (level * (level - 1) * 100) / 2;
      else if (bid === Building.Government) max.gold = using * 100000;
    }
    const f = phpFloatString;
    await sql`update mem_city_resource set wood_max = ${f(max.wood)}, food_max = ${f(max.food)},
        rock_max = ${f(max.rock)}, iron_max = ${f(max.iron)}, gold_max = ${f(max.gold)},
        people_max = ${f(max.people)}
      where cid = ${cid}`.execute(db);
  }
}
