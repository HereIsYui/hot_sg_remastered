import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BuildingInfoService } from '../city/building-info.service';
import { CityInfoService } from '../city/city-info.service';
import { HotelRules } from '../city/hotel-rules.service';
import { LangService } from '../common/lang.service';
import { GameError } from '../common/game-error';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { phpIntval, phpNum, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { TaskRules } from '../core/task-rules.service';
import { DbScope } from '../db/database.module';
import { DialogCommand, GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;
type ChiefType = 1 | 7 | 8;

const ROLE_COLUMN = {
  1: 'chiefhid',
  7: 'generalid',
  8: 'counsellorid',
} as const;

@Injectable()
export class OfficeCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cityRules: CityRules,
    private readonly heroes: HeroRules,
    private readonly hotel: HotelRules,
    private readonly goods: GoodsRules,
    private readonly tasks: TaskRules,
    private readonly random: RandomService,
    private readonly buildingInfo: BuildingInfoService,
    private readonly cityInfo: CityInfoService,
  ) {}

  /** OfficeFunc.php::setCityChief: replace 城守 / 主将 / 军师 in one batch. */
  @DialogCommand()
  async setCityChief(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid, cid } = ctx;
    const owner = await this.one(
      sql<Row>`select cid from sys_city where uid = ${uid} and cid = ${cid}`,
    );
    if (!owner) throw GameError.lang('waigua.invalid');
    const sets: { hid: number; type: ChiefType }[] = [];
    for (const value of param) {
      if (!Array.isArray(value)) throw GameError.lang('setCityChief.set_chief_fail_2');
      const hid = phpIntval(value[0]);
      const type = phpIntval(value[1]);
      if (hid > 0) {
        const valid = await this.one(sql<Row>`select hid from sys_city_hero
          where cid = ${cid} and hid = ${hid} and state in (0, 1, 7, 8)`);
        if (!valid) throw GameError.lang('setCityChief.set_chief_fail');
      }
      if (type === 1 || type === 7 || type === 8) sets.push({ hid, type });
    }
    await this.scope.transaction(async () => {
      for (const { hid } of sets) {
        const oldtype = phpIntval(
          await this.cell(sql<Row>`select state from sys_city_hero where hid = ${hid}`),
        );
        if (oldtype === 1 || oldtype === 7 || oldtype === 8) {
          await this.setRole(uid, cid, oldtype, 0);
        }
      }
      for (const { hid, type } of sets) await this.setRole(uid, cid, type, hid);
    });
    const office = await this.one(sql<Row>`select * from sys_building
      where cid = ${cid} and bid = 11 order by level desc limit 1`);
    if (!office) throw GameError.lang('getOfficeInfo.no_office_built');
    return this.buildingInfo.buildingInfo(uid, cid, phpIntval(office.xy), 11, phpNum(office.level));
  }

  /** HeroFunc.php::getExileHeros: the 召回旧部 list. */
  @GlobalCommand()
  async getExileHeros(ctx: CommandContext): Promise<unknown[]> {
    return [
      await this.rows(sql<Row>`select a.loyalty, h.hid, h.name, h.level,
        (h.command_base + h.level + h.command_add_on) as command,
        (h.affairs_base + h.affairs_add + h.affairs_add_on) as affairs,
        (h.bravery_base + h.bravery_add + h.bravery_add_on) as bravery,
        (h.wisdom_base + h.wisdom_add + h.wisdom_add_on) as wisdom
        from mem_hero_exile a join sys_city_hero h on a.hid = h.hid
        where a.uid = ${ctx.uid} and h.uid <= 897`),
    ];
  }

  /** HeroFunc.php::tryCallbackHero: validate and quote one recall before confirmation. */
  @DialogCommand()
  async tryCallbackHero(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const cid = phpIntval(param[0]);
    const hid = phpIntval(param[1]);
    const hero = await this.one(sql<Row>`select * from sys_city_hero where hid = ${hid}`);
    if (!hero) throw GameError.lang('tryCallback.no_hero_info');
    const exile = await this.one(
      sql<Row>`select * from mem_hero_exile where hid = ${hid} and uid = ${ctx.uid}`,
    );
    if (!exile)
      throw GameError.raw(`${phpString(hero.name)}${this.text('tryCallback', 'hero_not_exile')}`);
    if (!(await this.hotel.cityHasHeroPosition(ctx.uid, cid))) {
      throw GameError.lang('tryCallbackHero.hotel_level_low');
    }
    return [hid, await this.summonNeed(hero)];
  }

  /** HeroFunc.php::sureCallbackHero: pay the price and restore the exiled hero. */
  @DialogCommand()
  async sureCallbackHero(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const hid = phpIntval(param[1]);
    const owner = await this.one(
      sql<Row>`select cid from sys_city where uid = ${uid} and cid = ${cid}`,
    );
    if (!owner) throw GameError.lang('waigua.invalid');
    const hero = await this.one(sql<Row>`select * from sys_city_hero where hid = ${hid}`);
    if (!hero) throw GameError.lang('tryCallback.hero_not_exist');
    const exile = await this.one(sql<Row>`select * from mem_hero_exile where hid = ${hid}`);
    if (!exile) throw GameError.lang('tryCallback.hero_not_exile');
    if (!(await this.hotel.cityHasHeroPosition(uid, cid))) {
      throw GameError.lang('tryCallbackHero.hotel_level_low');
    }
    const goldNeed = this.summonGold(hero);
    const gold = await this.cell(sql<Row>`select gold from mem_city_resource where cid = ${cid}`);
    if (phpNum(gold) < goldNeed) throw GameError.lang('sureSummonHero.no_enough_gold');
    let goods = await this.rows(sql<Row>`select * from mem_hero_summon where hid = ${hid}`);
    if (goods.length === 0 && phpNum(hero.level) >= 50) {
      await this.summonNeed(hero);
      goods = await this.rows(sql<Row>`select * from mem_hero_summon where hid = ${hid}`);
    }
    for (const good of goods) {
      const enough = await this.one(sql<Row>`select gid from sys_goods
        where uid = ${uid} and gid = ${good.gid} and count >= ${good.count}`);
      if (!enough) {
        throw GameError.raw(this.format('sureSummonHero', 'no_enough_goods', good.name, hero.name));
      }
    }
    await this.scope.transaction(async () => {
      for (const good of goods)
        await this.goods.addGoods(uid, phpIntval(good.gid), -phpNum(good.count), 7);
      await this.cityRules.addCityResources(cid, 0, 0, 0, 0, -goldNeed);
      let maxLoyalty = 100;
      if (phpIntval(hero.herotype) === 10001) {
        maxLoyalty = 300;
        const childHid = await this.cell(
          sql<Row>`select hid from sys_user_child where out_hid = ${hid}`,
        );
        await sql`update mem_marry_relation set state = 4
          where uid = ${uid} and shid = (select hid from sys_user_child where out_hid = ${hid})`.execute(
          this.scope.db,
        );
        await sql`insert into log_child_status (hid, uid, out_hid, state, time)
          values (${childHid}, ${uid}, ${hid}, 4, unix_timestamp())
          on duplicate key update state = 4, time = unix_timestamp()`.execute(this.scope.db);
      }
      await sql`update sys_city_hero set state = 0, uid = ${uid}, cid = ${cid},
        loyalty = least(${phpIntval(exile.loyalty) + 10}, ${maxLoyalty}) where hid = ${hid}`.execute(
        this.scope.db,
      );
      await sql`delete from mem_hero_exile where hid = ${hid}`.execute(this.scope.db);
      if (phpNum(hero.npcid) > 0) {
        const goalId = await this.cell(
          sql<Row>`select id from cfg_task_goal where tid = ${30000 + phpIntval(hero.npcid)}`,
        );
        await this.tasks.completeTask(uid, phpIntval(goalId));
        await sql`insert into sys_lionize (uid, npcid, friend, state)
          values (${uid}, ${hid}, 100, 2)
          on duplicate key update friend = 100, state = 2`.execute(this.scope.db);
      }
      const forcemax =
        100 +
        Math.floor(phpNum(hero.level) / 5) +
        Math.floor((phpNum(hero.bravery_base) + phpNum(hero.bravery_add)) / 3);
      const energymax =
        100 +
        Math.floor(phpNum(hero.level) / 5) +
        Math.floor((phpNum(hero.wisdom_base) + phpNum(hero.wisdom_add)) / 3);
      await sql`insert into mem_hero_blood (hid, \`force\`, force_max, energy, energy_max)
        values (${hid}, 100, ${forcemax}, 100, ${energymax})
        on duplicate key update force_max = ${forcemax}, energy_max = ${energymax}`.execute(
        this.scope.db,
      );
      await this.heroes.regenerateHeroAttri(uid, hid);
      await this.heroes.updateCityHeroChange(uid, cid);
    });
    return this.cityInfo.heroInfo(uid, cid, true);
  }

  private async setRole(uid: number, cid: number, type: ChiefType, hid: number): Promise<void> {
    const column = ROLE_COLUMN[type];
    if (hid > 0) {
      await sql`update sys_city set chiefhid = 0 where cid = ${cid} and chiefhid = ${hid}`.execute(
        this.scope.db,
      );
      await sql`update sys_city set generalid = 0 where cid = ${cid} and generalid = ${hid}`.execute(
        this.scope.db,
      );
      await sql`update sys_city set counsellorid = 0 where cid = ${cid} and counsellorid = ${hid}`.execute(
        this.scope.db,
      );
    }
    const oldHid = phpIntval(
      await this.cell(sql<Row>`select ${sql.ref(column)} from sys_city where cid = ${cid}`),
    );
    if (oldHid > 0) {
      const busy = await this.one(
        sql<Row>`select hid from sys_troops where hid = ${oldHid} and uid != 0 limit 1`,
      );
      if (busy) throw GameError.lang('setCityChief.set_chief_hero_busy');
      await sql`update sys_city_hero set state = 0 where hid = ${oldHid}`.execute(this.scope.db);
    }
    if (hid > 0) {
      await sql`update sys_city_hero set state = ${type} where hid = ${hid}`.execute(this.scope.db);
      if (type === 1) {
        await sql`update mem_city_resource m, sys_city_hero h set m.chief_loyalty = h.loyalty
          where m.cid = ${cid} and h.hid = ${hid}`.execute(this.scope.db);
        await this.cityRules.updateCityResourceAdd(cid);
        await this.tasks.completeTask(uid, 85);
      }
    } else if (type === 1) {
      await sql`update mem_city_resource set chief_loyalty = 0 where cid = ${cid}`.execute(
        this.scope.db,
      );
      await sql`update sys_city_res_add set resource_changing = 1 where cid = ${cid}`.execute(
        this.scope.db,
      );
    }
    if (type === 1) {
      await sql`update sys_city_res_add set skill_gold_add = 0, skill_food_add = 0,
        skill_wood_add = 0, skill_rock_add = 0, skill_iron_add = 0 where cid = ${cid}`.execute(
        this.scope.db,
      );
      if (hid > 0) {
        const attr = async (bid: number) =>
          phpNum(
            await this.cell(sql<Row>`select b.attr from sys_user_book a, cfg_book b
              where a.bid = b.id and a.level = b.level and a.bid = ${bid} and a.hid = ${hid}`),
          );
        const gold = await attr(8);
        if (gold)
          await sql`update sys_city_res_add set skill_gold_add = ${gold} where cid = ${cid}`.execute(
            this.scope.db,
          );
        const all = await attr(9);
        if (all)
          await sql`update sys_city_res_add set skill_gold_add = ${all}, skill_food_add = ${all},
          skill_wood_add = ${all}, skill_rock_add = ${all}, skill_iron_add = ${all} where cid = ${cid}`.execute(
            this.scope.db,
          );
        const food = await attr(10);
        if (food)
          await sql`update sys_city_res_add set skill_food_add = ${food} where cid = ${cid}`.execute(
            this.scope.db,
          );
        const wood = await attr(11);
        if (wood)
          await sql`update sys_city_res_add set skill_wood_add = ${wood} where cid = ${cid}`.execute(
            this.scope.db,
          );
        const rock = await attr(12);
        if (rock)
          await sql`update sys_city_res_add set skill_rock_add = ${rock} where cid = ${cid}`.execute(
            this.scope.db,
          );
        const iron = await attr(13);
        if (iron)
          await sql`update sys_city_res_add set skill_iron_add = ${iron} where cid = ${cid}`.execute(
            this.scope.db,
          );
        await sql`update sys_city_res_add set resource_changing = 1 where cid = ${cid}`.execute(
          this.scope.db,
        );
      }
    }
    await sql`update sys_city set ${sql.ref(column)} = ${hid} where cid = ${cid}`.execute(
      this.scope.db,
    );
    if (type !== 1) await this.tasks.completeTaskWithTaskid(uid, type === 7 ? 328 : 330);
  }

  private summonGold(hero: Row): number {
    const over = (base: unknown, add: unknown) => Math.max(phpNum(base) + phpNum(add) - 90, 0);
    return (
      (phpNum(hero.level) * 20 +
        (over(hero.affairs_base, hero.affairs_add) +
          over(hero.bravery_base, hero.bravery_add) +
          over(hero.wisdom_base, hero.wisdom_add)) *
          50) *
      50
    );
  }

  private async summonNeed(hero: Row): Promise<string> {
    let need = `${this.text('trySummonHero', 'hero_need')}${this.text('trySummonHero', 'gold')}${this.summonGold(hero)}`;
    if (phpNum(hero.level) >= 50) {
      let goods = await this.rows(sql<Row>`select * from mem_hero_summon where hid = ${hero.hid}`);
      if (goods.length === 0) {
        await this.makeSummonNeed(hero);
        goods = await this.rows(sql<Row>`select * from mem_hero_summon where hid = ${hero.hid}`);
      }
      for (const good of goods) need += `，${phpString(good.name)}${phpString(good.count)}`;
    }
    if (phpNum(hero.npcid) > 0) need += this.text('hero', 'summon_hero_msg');
    return `${need}。`;
  }

  private async makeSummonNeed(hero: Row): Promise<void> {
    const level = phpNum(hero.level);
    let typeCount = Math.min(1 + Math.floor((level - 50) / 10), 9);
    let totalValue = (level * level) / 10;
    const goods = await this.rows(sql<Row>`select * from cfg_goods where gid >= 30 and gid <= 38`);
    while (typeCount > 0 && totalValue > 0 && goods.length > 0) {
      typeCount--;
      const idx = this.random.mtRand(0, goods.length - 1);
      const [good] = goods.splice(idx, 1);
      if (!good) break;
      const count = Math.ceil(totalValue / phpNum(good.value));
      const realCount = typeCount === 0 ? count : this.random.mtRand(1, count);
      if (typeCount > 0) totalValue -= realCount * phpNum(good.value);
      await sql`insert into mem_hero_summon (hid, gid, name, count)
        values (${hero.hid}, ${good.gid}, ${good.name}, ${realCount})`.execute(this.scope.db);
    }
  }

  private text(group: string, key: string): string {
    return phpString(this.lang.value<Record<string, unknown>>(group)?.[key] ?? key);
  }

  private format(group: string, key: string, ...args: unknown[]): string {
    let text = this.text(group, key);
    for (const arg of args) text = text.replace(/%s/, phpString(arg));
    return text;
  }

  private async rows(query: ReturnType<typeof sql<Row>>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows;
  }

  private async one(query: ReturnType<typeof sql<Row>>): Promise<Row | false> {
    return (await this.rows(query))[0] ?? false;
  }

  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = await this.one(query);
    return row === false ? false : Object.values(row)[0];
  }
}
