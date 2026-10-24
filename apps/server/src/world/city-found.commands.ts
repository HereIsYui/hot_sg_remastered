import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules, cid2wid, wid2cid } from '../core/city-rules.service';
import { HeroRules, LORD_HERO_TYPE } from '../core/hero-rules.service';
import {
  phpCompare,
  phpFloatString,
  phpIntval,
  phpLooseEquals,
  phpNum,
  phpString,
} from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** 完成建立新城任务 (WorldFunc.php:386 completeTask($uid,169)). */
const GOAL_FOUND_CITY = 169;
/** logUserAction aid for founding a city (WorldFunc.php:406). */
const ACTION_FOUND_CITY = 1;

/**
 * WorldFunc.php::createCityFromLand (WorldFunc.php:254-418): 野地平地上筑新城。目标 wid 必须
 * 是 mem_world 的平地（type 1）、附属（ownercid）于玩家当前城（sys_user.lastcid）且不在交战
 * （state 0）；lastcid 城内五种资源各 ≥ 10000；爵位（含推恩令加成）的 cfg_nobility.city_count
 * 必须大于当前城数。建城时扣旧城 1 万资源、立 1 级官府、把驻扎在该平地（sys_troops state=4）
 * 的军队并入新城（第一支有将领的军队首领任城守，军队 resource 并入新城，soldiers 逐兵种入库，
 * sys_troops/sys_troop_tactics 删除），最后完成任务 169 并给新城加 5000 各资源。
 *
 * Reuses the shared rules (CityRules / HeroRules / TaskRules / UserRules / LangService);
 * resetCityGoodsAdd (utils.php:1396) is not ported anywhere else yet, so it lives below as a
 * private copy. Replaces the `createCityFromLand` stub in world-stub.commands.ts — the integrator
 * registers this provider in world.module.ts and drops the stub entry.
 *
 * 有意跳过的原版分支（外部平台 / 定制服集成，单机重制不需要）：
 *  - WorldFunc.php:389-393 USER_FOR_51：51SDK 建城事件（连带 389 行只为它取的 $username 查询）。
 *  - WorldFunc.php:394-405 PASSTYPE / AgentServiceFactory：联运方统计与它的错误日志。
 *  - WorldFunc.php:413-417 马来定制：mem_state state=197 值为 60 时 checkIsInSili 上报司隶筑城
 *    （checkIsInSili 函数本身不移植）。
 */
@Injectable()
export class CityFoundCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cityRules: CityRules,
    private readonly heroes: HeroRules,
    private readonly tasks: TaskRules,
    private readonly users: UserRules,
  ) {}

  @GlobalCommand()
  async createCityFromLand(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    // 原版 PHP 无事务，但所有会抛错的分支都在第一条写入之前，整包进一个事务不改变可观察行为。
    return this.scope.transaction(async () => {
      const uid = ctx.uid;
      const targetwid = phpIntval(param[0]);
      const targetcid = wid2cid(targetwid);
      const worldInfo = await this.row(sql`select * from mem_world where wid = ${targetwid}`);
      const lastcid = phpIntval(
        await this.cell(sql`select lastcid from sys_user where uid = ${uid}`),
      );
      if (!phpLooseEquals(worldInfo?.type, 1)) {
        throw GameError.lang('createCityFromLand.only_flatlands_can_build');
      }
      if (!phpLooseEquals(worldInfo?.ownercid, lastcid)) {
        throw GameError.lang('createCityFromLand.target_flatlands_notYours');
      }
      if (!phpLooseEquals(worldInfo?.state, 0)) {
        throw GameError.lang('createCityFromLand.target_flatlands_in_war');
      }
      const troops = await this.rows(
        sql`select * from sys_troops where uid = ${uid} and targetcid = ${targetcid} and state = 4`,
      );
      // 新建城池优化，不再需要有军队驻扎：WorldFunc.php:273-274 的 no_army 检查已被原版注释掉；
      // WorldFunc.php:275 的 $chiefhid = 0 此后再未读过（死变量），两者都不移植。
      // 军队 resource CSV 是 "gold,food,wood,rock,iron"，逐支累加后并入新城（原版 281-293 行）。
      let gold = 0;
      let food = 0;
      let wood = 0;
      let rock = 0;
      let iron = 0;
      for (const troop of troops) {
        // 合一下资源
        const res = phpString(troop.resource).split(',');
        gold += phpNum(res[0]);
        food += phpNum(res[1]);
        wood += phpNum(res[2]);
        rock += phpNum(res[3]);
        iron += phpNum(res[4]);
      }

      // 新建城池优化，资源从原来的城池里面减：先检查 lastcid 城内五种资源各够 1 万。
      const cityresourceinfo = await this.row(
        sql`select * from mem_city_resource where cid = ${lastcid}`,
      );
      if (
        phpNum(cityresourceinfo?.gold) < 10000 ||
        phpNum(cityresourceinfo?.food) < 10000 ||
        phpNum(cityresourceinfo?.wood) < 10000 ||
        phpNum(cityresourceinfo?.rock) < 10000 ||
        phpNum(cityresourceinfo?.iron) < 10000
      ) {
        throw GameError.lang('createCityFromLand.no_enough_resource');
      }

      // 推恩：getBufferNobility 提升后的爵位决定可拥有的城数。
      const nobility = await this.users.bufferNobility(
        uid,
        await this.cell(sql`select nobility from sys_user where uid = ${uid}`),
      );
      // 原版 309 行的 name 列取了没用，照原 SQL 保留。
      const nobilityinfo = await this.row(
        sql`select name, city_count from cfg_nobility where id = ${nobility}`,
      );
      const current_city_count = phpIntval(
        await this.cell(sql`select count(*) from sys_city where uid = ${uid}`),
      );
      // PHP `$current_city_count >= $nobilityinfo['city_count']` 是宽松比较（没有爵位行时 null
      // 走布尔比较），用 phpCompare 复刻。
      if (phpCompare(current_city_count, nobilityinfo?.city_count) >= 0) {
        const nextname = await this.cell(
          sql`select name from cfg_nobility where id = ${nobility + 1}`,
        );
        throw GameError.lang('createCityFromLand.nobility_not_enough', phpString(nextname));
      }

      const db = this.scope.db;
      // 新建城池优化，资源从原来的城池里面减，扣资源。addCityResources 的参数顺序是
      // (cid, wood, rock, iron, food, gold)（utils.php:193，rg 确认过），这里五项数值相同。
      await this.cityRules.addCityResources(lastcid, -10000, -10000, -10000, -10000, -10000);

      const newcityName = this.lang.t('worldfunc.newcity');
      // 清除伤兵，逃兵，俘虏
      await sql`delete from mem_city_wounded where cid = ${targetcid}`.execute(db);
      await sql`delete from mem_city_lamster where cid = ${targetcid}`.execute(db);
      await sql`delete from mem_city_captive where cid = ${targetcid}`.execute(db);

      await sql`replace into sys_city (cid, uid, name, type, state, province)
        values (${targetcid}, ${uid}, ${newcityName}, 0, 0, ${worldInfo!.province})`.execute(db);
      // 自动建设1级官府
      await sql`delete from sys_building where cid = ${targetcid} and xy = 120`.execute(db);
      await sql`replace into sys_building (cid, xy, bid, level)
        values (${targetcid}, 120, 6, 1)`.execute(db);
      // 军队并入的资源在这里落库；people 固定 0。
      await sql`replace into mem_city_resource (cid, people, food, wood, rock, iron, gold, lastupdate)
        values (${targetcid}, 0, ${phpFloatString(food)}, ${phpFloatString(wood)},
          ${phpFloatString(rock)}, ${phpFloatString(iron)}, ${phpFloatString(gold)},
          unix_timestamp())`.execute(db);
      await sql`replace into sys_city_res_add (cid) values (${targetcid})`.execute(db);
      // 修改所在地的属性
      await sql`update mem_world set ownercid = ${targetcid}, type = 0
        where wid = ${cid2wid(targetcid)}`.execute(db);

      // 重新计算宝物加成
      await this.resetCityGoodsAdd(uid, targetcid);

      // 军队入住
      let hasSetChief = false;
      for (const troop of troops) {
        const hid = phpIntval(troop.hid);
        if (hid > 0) {
          if (!hasSetChief) {
            // 第一支军队的首领作为城守
            hasSetChief = true;
            await sql`update sys_city_hero set cid = ${targetcid}, state = 1
              where hid = ${hid}`.execute(db);
            await sql`update sys_city set chiefhid = ${hid} where cid = ${targetcid}`.execute(db);
          } else {
            await sql`update sys_city_hero set cid = ${targetcid}, state = 0
              where hid = ${hid}`.execute(db);
          }
        }
        // soldiers CSV 是「数量,sid,数量,sid,…」：首字段是兵种数，其后是 (sid, 数量) 对。
        // 原版 `count($soldiers) > 0` 恒真（explode 至少返回一个元素），不必复刻。
        const parts = phpString(troop.soldiers).split(',');
        const types = phpNum(parts[0]);
        for (let i = 0; i < types; i++) {
          const sid = phpIntval(parts[i * 2 + 1]);
          const n = phpFloatString(phpNum(parts[i * 2 + 2]));
          await sql`insert into sys_city_soldier (cid, sid, \`count\`)
            values (${targetcid}, ${sid}, ${n})
            on duplicate key update \`count\` = \`count\` + ${n}`.execute(db);
          await sql`insert into log_city_soldier (cid, sid, \`uid\`, \`count\`, \`type\`)
            values (${targetcid}, ${sid}, ${uid}, ${n}, 10)
            on duplicate key update \`count\` = \`count\` + ${n}`.execute(db);
        }
        const troopid = phpIntval(troop.id);
        await sql`delete from sys_troops where id = ${troopid}`.execute(db);
        await sql`delete from sys_troop_tactics where troopid = ${troopid}`.execute(db);
        await this.cityRules.updateCityResourceAdd(phpIntval(troop.cid));
      }
      await this.cityRules.updateCityResourceAdd(targetcid);

      await this.heroes.updateCityHeroChange(uid, lastcid);
      await this.heroes.updateCityHeroChange(uid, targetcid);
      // 完成建立新城任务
      await this.tasks.completeTask(uid, GOAL_FOUND_CITY);
      await this.cityRules.addCityResources(targetcid, 5000, 5000, 5000, 5000, 5000);

      // WorldFunc.php:389-405：USER_FOR_51（51SDK 建城事件）与 PASSTYPE /
      // AgentServiceFactory（联运方统计）两块外部平台集成跳过，只为它们服务的 389 行
      // $username 查询也不再执行。
      await this.users.logUserAction(uid, ACTION_FOUND_CITY);

      // 创建君主将（WorldFunc.php:407-412）。原版 409 行 insert 的 cid 用的是未定义的 $cid
      // （函数里只有 $targetcid）：PHP 里是空串，MySQL 非严格模式落库为 0 —— 照原样传 0，
      // 这是原版 bug（君主将的 cid 是 0，不在新城里），忠实复刻。开发库 MySQL 8.4 严格模式
      // 也要求传 0 而不能传空串。该分支只在玩家没有 herotype=1000 君主将时执行。
      if (
        !(await this.check(
          sql`select 1 from sys_city_hero where uid = ${uid} and herotype = ${LORD_HERO_TYPE}`,
        ))
      ) {
        const inserted = await sql`insert into sys_city_hero (uid, name, sex, face, cid, state,
            level, command_base, affairs_base, bravery_base, wisdom_base, loyalty, herotype)
          select uid, name, sex, face, 0, 0, 1, 50, 1, 1, 1, 100, ${LORD_HERO_TYPE}
          from sys_user where uid = ${uid}`.execute(db);
        const hid = Number(inserted.insertId);
        await sql`insert into mem_hero_blood (hid, \`force\`, force_max, energy, energy_max)
          values (${hid}, 150, 150, 150, 150)`.execute(db);
      }
      return [];
    });
  }

  /**
   * utils.php::resetCityGoodsAdd（原版 WorldFunc.php:341 调用）：按玩家未过期的增益 buff
   * （buftype 1-4：神农锄 / 鲁班斧 / 开山斧 / 精铁锤之类）把新城 sys_city_res_add 的
   * goods_*_add 置为 25 并标记资源重算。共享服务里还没有它的移植，故放在本文件私有实现。
   */
  private async resetCityGoodsAdd(uid: number, cid: number): Promise<void> {
    const buffers = await this.rows(
      sql`select * from mem_user_buffer
        where uid = ${uid} and buftype <= 4 and endtime > unix_timestamp()`,
    );
    let food_add = 0;
    let wood_add = 0;
    let rock_add = 0;
    let iron_add = 0;
    for (const buffer of buffers) {
      const buftype = phpIntval(buffer.buftype);
      if (buftype === 1) food_add = 25;
      else if (buftype === 2) wood_add = 25;
      else if (buftype === 3) rock_add = 25;
      else if (buftype === 4) iron_add = 25;
    }
    await sql`update sys_city_res_add set goods_food_add = ${food_add}, goods_wood_add = ${wood_add},
      goods_rock_add = ${rock_add}, goods_iron_add = ${iron_add}, resource_changing = 1
      where cid = ${cid}`.execute(this.scope.db);
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
