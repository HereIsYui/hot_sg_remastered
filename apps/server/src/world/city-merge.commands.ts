import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { Building, CityRules, wid2cid } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import {
  phpEmpty,
  phpFloatString,
  phpIntval,
  phpLooseEquals,
  phpNum,
  phpString,
} from '../core/php';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** 名城契约物品 gid（utils.php::addGoods 对它有专门的掉落规则）。 */
const CONTRACT_GID = 160052;

/** makeMergeReport 里逐座展示升级差值的建筑（四种资源田、民房、军营、仓库）。 */
const MULTI_LEVEL_BIDS = new Set<number>([
  Building.Farmland,
  Building.Wood,
  Building.Rock,
  Building.Iron,
  Building.House,
  Building.Army,
  Building.Store,
]);

/**
 * getUpgradeResource / calculateResource 里 PHP `static $cache` 的复刻。两个缓存键格式相同
 * （bid_level），在原版里是两个独立的 static 数组，必须分开存。
 */
class MergeCache {
  readonly upgradeRows = new Map<string, Row | undefined>();
  readonly totals = new Map<string, [number, number, number, number]>();
}

/**
 * CityMergeFunc.php::mergeCity（CityMergeFunc.php:14-48）合城：把分城并入主城，主城建筑
 * 升级。param = [主城cid, 分城cid]。校验（名城契约 / 爵位 / 城池归属 / 分城驻军 / 主城官府
 * 10-14 级）通过后：备份分城数据（subCityBak）、主城官府 +1 级、把分城建筑按 cfg_building_level
 * 折算成资源升级主城的 cfg_building_merge 建筑（城内 doMergeCity(1)、城外 doMergeCity(0)，
 * 多轮循环，民房/军营/仓库每轮最多各升一座，剩余资源加回主城）、并入分城资源、删除分城的
 * 全部数据并把地块变回平地、扣掉名城契约并把主城 type 置 5、刷新人口/黄金上限与产量标记、
 * 重算声望，最后发一封建筑升级表格的系统战报（title 53）。成功正常 return array(1)，所以
 * 写入按服务端约定包在一个事务里。
 *
 * 复用的共享服务：GoodsRules.addGoods（utils.php::addGoods 的名城契约分支）、CityRules 的
 * updateCityPeopleMax / updateCityGoldMax / updateCityResourceAdd（utils.php）、UserRules.
 * updateUserPrestige（utils.php）。utils.php::getSpacialSoldierId 尚无共享移植（各模块都是
 * 私有副本），这里也作为私有方法。
 *
 * 整个文件没有 51SDK / PASSTYPE / 马来定制之类的外部平台分支（通读过全文），无跳过项。
 */
@Injectable()
export class CityMergeCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cityRules: CityRules,
    private readonly goods: GoodsRules,
    private readonly users: UserRules,
  ) {}

  @GlobalCommand()
  async mergeCity(ctx: CommandContext, param: unknown[]): Promise<number[]> {
    const uid = ctx.uid;
    const mainCid = phpIntval(param[0]); // 主城cid
    const subCid = phpIntval(param[1]); // 分城cid
    // CityMergeFunc.php:15 的 set_time_limit(3600) 是 PHP 运行时限，无对应物，跳过。
    // 校验放在事务外：原版 308 行「召回开往分城的军队」这条 update 写在 311-316 行官府
    // 等级校验之前，等级不达标时它在原版里已经提交；包进事务会被一并回滚，行为不一致。
    await this.checkCityMerge(uid, mainCid, subCid);
    // CityMergeFunc.php:22 的 lockUser / 46 行的 unlockuser（及 pacifyPeople.server_busy
    // 文案）由命令网关的按用户互斥锁承担（gateway/command.service.ts），重制版里该分支
    // 不可达，不再单独移植。
    // 校验通过后原版不再有可达的抛错分支（subCityBak 的 bak_error 只在 cid 为空时触发，
    // 而 cid 已通过上面的归属校验），因此所有写入包成一个事务，失败时整体回滚。
    return this.scope.transaction(async () => {
      await this.subCityBak(uid, subCid);
      const originalBuildings = await this.rows(this.snapshotSql(mainCid));
      // 主城官府升1级
      await sql`update sys_building set level = level + 1 where cid = ${mainCid} and bid = 6`.execute(
        this.scope.db,
      );
      const governLevel = await this.cell(
        sql`select level from sys_building where cid = ${mainCid} and bid = 6`,
      );
      await this.completeBuildTask(uid, Building.Government, governLevel);
      const cache = new MergeCache();
      await this.doMergeCity(uid, mainCid, subCid, 1, cache); // 合并城内
      await this.doMergeCity(uid, mainCid, subCid, 0, cache); // 合并城外
      await this.doMergeResource(mainCid, subCid);
      // 销毁分城
      await this.destorySubCity(subCid);
      // 恢复分城的野地，野地中其他玩家驻军都返回。
      await this.clearSubCityWild(subCid);
      // 扣除名城契约
      await this.reduceMingchengqiyue(uid, mainCid);
      // 更新城池最大值
      await this.cityRules.updateCityPeopleMax(mainCid);
      await this.cityRules.updateCityGoldMax(mainCid);
      await this.cityRules.updateCityResourceAdd(mainCid);
      await this.users.updateUserPrestige(uid);
      // 生成报告
      const nowBuildings = await this.rows(this.snapshotSql(mainCid));
      await this.makeMergeReport(uid, mainCid, originalBuildings, nowBuildings);
      return [1];
    });
  }

  /**
   * CityMergeFunc.php 里 mergeCity 前后各读一次的主城建筑快照（20 行 / 43 行）：按 bid 分组、
   * group_concat 拼等级，供战报计算差值。
   */
  private snapshotSql(mainCid: number): RawBuilder<unknown> {
    return sql`select b.bid, c.name, group_concat(b.level) as levels
      from sys_building b left join cfg_building c on c.bid = b.bid
      left join cfg_building_merge m on b.bid = m.bid
      where b.cid = ${mainCid} group by b.bid order by seq`;
  }

  /** CityMergeFunc.php::checkCityMerge（259-318）：全部前置校验 + 召回开往分城的军队。 */
  private async checkCityMerge(uid: number, mainCid: number, subCid: number): Promise<void> {
    // 检查名城契约相关（主城已是 type 5 名城时跳过）
    const type = await this.cell(sql`select type from sys_city where cid = ${mainCid}`);
    if (!phpLooseEquals(type, 5)) {
      if (
        await this.check(
          sql`select 1 from log_qiyue where uid = ${uid} and gid = 160052 and count < 0`,
        )
      ) {
        throw GameError.lang('MergeCity.used');
      }
      const cnt = await this.cell(
        sql`select count from sys_goods where gid = 160052 and uid = ${uid}`,
      );
      // 无 sys_goods 行时 PHP 的 false < 1 同样为真，phpNum(false)=0 复刻
      if (phpNum(cnt) < 1) throw GameError.lang('MergeCity.no_mingchengqiyue');
    }
    // 验证玩家爵位
    await this.checkUserNobility(uid, mainCid);
    const subCityState = await this.cell(
      sql`select state from mem_world where type = 0 and ownercid = ${subCid}`,
    );
    if (phpLooseEquals(subCityState, 1)) throw GameError.lang('MergeCity.not_in_peace');

    const subCityType = await this.cell(sql`select type from sys_city where cid = ${subCid}`);
    if (!phpLooseEquals(subCityType, 0)) throw GameError.lang('MergeCity.must_be_user_city');
    // 检查城池归属
    if (
      !(await this.check(sql`select 1 from sys_city where cid = ${mainCid} and uid = ${uid}`)) ||
      !(await this.check(sql`select 1 from sys_city where cid = ${subCid} and uid = ${uid}`))
    ) {
      throw GameError.lang('MergeCity.not_your_city');
    }
    const mainSpecial = await this.specialSoldierId(mainCid);
    if (phpNum(mainSpecial) > 0) {
      // 活动城池不让当主城合并
      throw GameError.lang('MergeCity.cannot_be_spacial_city');
    }
    const subSpecial = await this.specialSoldierId(subCid);
    if (phpNum(subSpecial) > 0) {
      throw GameError.lang('MergeCity.cannot_be_spacial_city');
    }
    // 主城不能为王者之城
    if (await this.check(sql`select 1 from sys_city where cid = ${mainCid} and is_special = '2'`)) {
      throw GameError.lang('MergeCity.cannot_be_isSpecial');
    }
    const mainCityType = await this.cell(
      sql`select \`type\` from sys_city where cid = ${mainCid} and uid = ${uid}`,
    );
    if (!phpLooseEquals(mainCityType, 0) && !phpLooseEquals(mainCityType, 5)) {
      // 主城必须为普通城池或者是玩家的主城。
      throw GameError.lang('MergeCity.cannot_be_famous_city');
    }
    // 检查分城将领（军队）
    const heroCnt = await this.cell(
      sql`select count(*) from sys_city_hero where cid = ${subCid} and uid = ${uid}`,
    );
    if (phpNum(heroCnt) > 0) throw GameError.lang('MergeCity.sub_city_not_empty');
    const soldierCnt = await this.cell(
      sql`select sum(\`count\`) from sys_city_soldier where sid <= 12 and cid = ${subCid}`,
    );
    if (phpNum(soldierCnt) > 0) throw GameError.lang('MergeCity.sub_city_not_empty');
    const troopCount = await this.cell(sql`select count(*) from sys_troops where cid = ${subCid}`);
    if (phpNum(troopCount) > 0) throw GameError.lang('MergeCity.sub_city_not_empty');
    // 原版 303-306 行的市场交易检查（sub_city_trade_not_empty）已被注释掉，不复刻。
    // 所有派过来的军队都返回（在下面的官府等级校验之前，失败时原版也已提交）
    await sql`update sys_troops set state = 1 where targetcid = ${subCid}`.execute(this.scope.db);
    // 主城官府必须10级以上
    const governLevel = await this.cell(
      sql`select level from sys_building where cid = ${mainCid} and bid = 6`,
    );
    if (phpNum(governLevel) < 10) throw GameError.lang('MergeCity.government_not_enough_level');
    if (phpNum(governLevel) >= 15) {
      // lang.php 从未定义 MergeCity.government_max_level（rg 全库确认）：PHP 读未定义索引
      // 得 null，amfphp 的 errorLevel 是 E_ALL^E_NOTICE，notice 被吞掉，异常消息是空串。
      throw GameError.raw('');
    }
  }

  /** utils.php::getSpacialSoldierId（767-774）：城的专属神兵 sid（type 4 除外），无则 0。 */
  private async specialSoldierId(cid: number): Promise<unknown> {
    const sid = await this.cell(
      sql`select sid from cfg_soldier_special_city where cid = ${cid} and type <> '4'`,
    );
    return phpEmpty(sid) ? 0 : sid;
  }

  /** CityMergeFunc.php::checkUserNobility（360-384）：合城把官府升到 gLevel+1 所需的爵位。 */
  private async checkUserNobility(uid: number, mainCid: number): Promise<void> {
    const nobility = await this.cell(sql`select nobility from sys_user where uid = ${uid}`);
    const gLevel = await this.cell(
      sql`select level from sys_building where bid = 6 and cid = ${mainCid}`,
    );
    let flag = true;
    let name: unknown;
    if (phpLooseEquals(gLevel, 10) && phpNum(nobility) < 4) {
      flag = false;
      name = await this.cell(sql`select name from cfg_nobility where id = 4`);
    } else if (phpLooseEquals(gLevel, 11) && phpNum(nobility) < 5) {
      flag = false;
      name = await this.cell(sql`select name from cfg_nobility where id = 5`);
    } else if (phpLooseEquals(gLevel, 12) && phpNum(nobility) < 8) {
      flag = false;
      name = await this.cell(sql`select name from cfg_nobility where id = 8`);
    } else if (phpLooseEquals(gLevel, 13) && phpNum(nobility) < 10) {
      flag = false;
      name = await this.cell(sql`select name from cfg_nobility where id = 10`);
    } else if (phpLooseEquals(gLevel, 14) && phpNum(nobility) < 12) {
      flag = false;
      name = await this.cell(sql`select name from cfg_nobility where id = 12`);
    }
    if (!flag) {
      // sprintf($GLOBALS['MergeCity']['nobility'], $gLevel+1, $name)
      throw GameError.lang('MergeCity.nobility', phpNum(gLevel) + 1, phpString(name));
    }
  }

  /** CityMergeFunc.php::subCityBak（335-346）：分城数据快照进 *_bak 表 + 合城日志。 */
  private async subCityBak(uid: number, cid: number): Promise<void> {
    if (phpEmpty(cid)) throw GameError.lang('MergeCity.bak_error');
    const db = this.scope.db;
    await sql`replace into mem_city_resource_bak select * from mem_city_resource where cid = ${cid}`.execute(
      db,
    );
    await sql`replace into mem_city_schedule_bak select * from mem_city_schedule where cid = ${cid}`.execute(
      db,
    );
    await sql`replace into sys_city_bak select * from sys_city where cid = ${cid}`.execute(db);
    await sql`replace into sys_city_defence_bak select * from sys_city_defence where cid = ${cid}`.execute(
      db,
    );
    await sql`replace into sys_city_res_add_bak select * from sys_city_res_add where cid = ${cid}`.execute(
      db,
    );
    await sql`replace into sys_city_tactics_bak select * from sys_city_tactics where cid = ${cid}`.execute(
      db,
    );
    await sql`replace into sys_city_technic_bak select * from sys_city_technic where cid = ${cid}`.execute(
      db,
    );
    await sql`replace into sys_building_bak select * from sys_building where cid = ${cid}`.execute(
      db,
    );
    await sql`insert into log_merge_city (uid, cid, time) values (${uid}, ${cid}, unix_timestamp())`.execute(
      db,
    );
  }

  /** CityMergeFunc.php::doMergeCity（50-72）：把分城 inner 区域的建筑折算成资源交给主城升级。 */
  private async doMergeCity(
    uid: number,
    mainCid: number,
    subCid: number,
    inner: number,
    cache: MergeCache,
  ): Promise<void> {
    // 计算分城现有建筑的资源量
    const subBuildings = await this
      .rows(sql`SELECT sys.bid, sys.level FROM sys_building sys, cfg_building cfg
      where sys.bid = cfg.bid AND cfg.inner = ${inner} and sys.cid = ${subCid}`);

    let foodRes = 0;
    let woodRes = 0;
    let rockRes = 0;
    let ironRes = 0;
    for (const subBuilding of subBuildings) {
      const bid = subBuilding.bid;
      const level = subBuilding.level;
      // 计算该级别类型建筑需要的资源数。true 表示升级前，直接算十级以下的资源（原版 63 行
      // 注释）：11 级以上的分城建筑折算时被忽略（见 calculateResource）。
      const [food, wood, rock, iron] = await this.calculateResource(bid, level, true, cache);
      // 累加分城的所有建筑资源
      foodRes += food;
      woodRes += wood;
      rockRes += rock;
      ironRes += iron;
    }
    // 正式升级合并
    await this.upgradeMainCityBuilding(
      uid,
      mainCid,
      foodRes,
      woodRes,
      rockRes,
      ironRes,
      inner,
      cache,
    );
  }

  /**
   * CityMergeFunc.php::getUpgradeResource（74-91）：cfg_building_level 里升到某级的四项资源
   * 整行。flag 只查 10 级以下；查不到该级时 PHP 返回 null（未定义索引的 notice），照抄为
   * undefined，调用方按 0 参与累加。static $cache 用 MergeCache 复刻，含它的副作用：一旦
   * flag=true 查询缓存了 1-10 级，后续同 bid 的 flag=false 全量查询也会被缓存挡住。
   */
  private async getUpgradeResource(
    bid: unknown,
    level: unknown,
    flag: boolean,
    cache: MergeCache,
  ): Promise<Row | undefined> {
    const key = `${phpString(bid)}_${phpString(level)}`;
    if (cache.upgradeRows.has(key)) return cache.upgradeRows.get(key);
    const needResources = await this.rows(
      flag
        ? sql`SELECT level, upgrade_food, upgrade_wood, upgrade_rock, upgrade_iron FROM cfg_building_level
            WHERE bid = ${bid} and level <= 10 order by level`
        : sql`SELECT level, upgrade_food, upgrade_wood, upgrade_rock, upgrade_iron FROM cfg_building_level
            WHERE bid = ${bid} order by level`,
    );
    for (const needResource of needResources) {
      cache.upgradeRows.set(`${phpString(bid)}_${phpString(needResource.level)}`, needResource);
    }
    return cache.upgradeRows.get(key);
  }

  /**
   * CityMergeFunc.php::calculateResource（92-120）：升到该级的累计四项资源。分城 11+ 级建筑
   * 折算时只累计 1-10 级（flag=true 查不到更高级的行，null 按 0 累加——10 级以上的投入即
   * 丢失，原版如此，照抄）。
   */
  private async calculateResource(
    bid: unknown,
    level: unknown,
    flag: boolean,
    cache: MergeCache,
  ): Promise<[number, number, number, number]> {
    const key = `${phpString(bid)}_${phpString(level)}`;
    const cached = cache.totals.get(key);
    if (cached) return cached;
    let foodRes = 0;
    let woodRes = 0;
    let rockRes = 0;
    let ironRes = 0;
    for (let i = 1; i <= phpNum(level); i++) {
      const needRes = await this.getUpgradeResource(bid, i, flag, cache);
      foodRes += phpNum(needRes?.upgrade_food);
      woodRes += phpNum(needRes?.upgrade_wood);
      rockRes += phpNum(needRes?.upgrade_rock);
      ironRes += phpNum(needRes?.upgrade_iron);
    }
    const totalRes = [foodRes, woodRes, rockRes, ironRes] as [number, number, number, number];
    cache.totals.set(key, totalRes);
    return totalRes;
  }

  /**
   * CityMergeFunc.php::upgradeMainCityBuilding（122-179）：用手里的资源尽量升级主城的
   * cfg_building_merge 建筑（官府除外）。每轮重新读取建筑列表（原注释：迁移到循环里是为
   * 了避免由于一个民房建筑较低，每次都升级这个建筑的问题）；正在升级/拆除的建筑、以及民房
   * /军营/仓库每轮已升过一座时跳过；某一轮一座都没升时把剩余资源加回主城并返回。
   */
  private async upgradeMainCityBuilding(
    uid: number,
    mainCid: number,
    foodRes: number,
    woodRes: number,
    rockRes: number,
    ironRes: number,
    inner: number,
    cache: MergeCache,
  ): Promise<void> {
    const db = this.scope.db;
    const governLevel = await this.cell(
      sql`select level from sys_building where cid = ${mainCid} and bid = 6`,
    );
    await this.completeBuildTask(uid, Building.Government, governLevel);
    // 取出正在升降级的建筑
    const xys = new Set(
      (
        await this.rows(sql`select xy from mem_building_upgrading where cid = ${mainCid}
          union select xy from mem_building_destroying where cid = ${mainCid}`)
      ).map((r) => phpString(r.xy)),
    );
    while (true) {
      // 取出主城内除官府外的所有建筑
      const mainBuildings = await this
        .rows(sql`SELECT sb.bid, xy, level FROM sys_building sb, cfg_building_merge cbm, cfg_building cb
        WHERE sb.bid = cbm.bid AND sb.bid = cb.bid AND sb.cid = ${mainCid} AND sb.bid != 6 AND cb.inner = ${inner}
        ORDER BY seq, level`);
      // 一轮下来成功升级的建筑数目，如果该轮下来没建筑升级，则掉出循环，返回
      let upgradeCnt = 0;
      let houseUpgradeCnt = 0; // 一轮下来民房成功升级的建筑数目
      let armyUpgradeCnt = 0; // 一轮下来军营成功升级的建筑数目
      let storeUpgradeCnt = 0; // 一轮下来仓库成功升级的建筑数目
      for (const mainBuilding of mainBuildings) {
        const bid = phpIntval(mainBuilding.bid);
        const level = phpNum(mainBuilding.level);
        const xy = phpIntval(mainBuilding.xy);
        // 正在升级或销毁中的建筑不能升级
        if (xys.has(phpString(xy))) continue;
        // 民房，军营，仓库每轮最多只升级一个
        if (
          (bid === Building.House && houseUpgradeCnt > 0) ||
          (bid === Building.Army && armyUpgradeCnt > 0) ||
          (bid === Building.Store && storeUpgradeCnt > 0)
        ) {
          continue;
        }
        const upgradeRes = await this.getUpgradeResource(bid, level + 1, false, cache);
        if (
          level < phpNum(governLevel) &&
          foodRes >= phpNum(upgradeRes?.upgrade_food) &&
          woodRes >= phpNum(upgradeRes?.upgrade_wood) &&
          rockRes >= phpNum(upgradeRes?.upgrade_rock) &&
          ironRes >= phpNum(upgradeRes?.upgrade_iron)
        ) {
          foodRes -= phpNum(upgradeRes?.upgrade_food);
          woodRes -= phpNum(upgradeRes?.upgrade_wood);
          rockRes -= phpNum(upgradeRes?.upgrade_rock);
          ironRes -= phpNum(upgradeRes?.upgrade_iron);

          await sql`update sys_building set level = level + 1 where cid = ${mainCid} and bid = ${bid} and xy = ${xy}`.execute(
            db,
          );
          await this.completeBuildTask(uid, bid, level + 1);
          // 原版把 level+1 写回 $mainBuilding（160 行），但列表每轮都重新查询，写回没有
          // 可见效果，不复刻。
          upgradeCnt++;
          if (bid === Building.House) houseUpgradeCnt++;
          if (bid === Building.Army) armyUpgradeCnt++;
          if (bid === Building.Store) storeUpgradeCnt++;
        } else {
          continue;
        }
      }
      if (upgradeCnt === 0) {
        // 将剩余资源放入主城资源里
        await sql`update mem_city_resource set food = food + ${phpFloatString(foodRes)},
          wood = wood + ${phpFloatString(woodRes)}, rock = rock + ${phpFloatString(rockRes)},
          iron = iron + ${phpFloatString(ironRes)} where cid = ${mainCid}`.execute(db);
        return;
      }
    }
  }

  /**
   * CityMergeFunc.php::destorySubCity（181-212，原版即拼作 destory）：删除分城的全部数据
   * 行并把它的地块变回平地。sys_building 删了两遍（195、206 行），照抄。
   */
  private async destorySubCity(subCid: number): Promise<void> {
    if (phpEmpty(subCid)) return;
    const db = this.scope.db;
    await sql`delete from mem_building_destroying where cid = ${subCid}`.execute(db);
    await sql`delete from mem_building_upgrading where cid = ${subCid}`.execute(db);
    await sql`delete from mem_city_autotrans where tocid = ${subCid}`.execute(db);
    await sql`delete from mem_city_captive where cid = ${subCid}`.execute(db);
    await sql`delete from mem_city_draft where cid = ${subCid}`.execute(db);
    await sql`delete from mem_city_lamster where cid = ${subCid}`.execute(db);
    await sql`delete from mem_city_reinforce where cid = ${subCid}`.execute(db);
    await sql`delete from mem_city_resource where cid = ${subCid}`.execute(db);
    await sql`delete from mem_city_schedule where cid = ${subCid}`.execute(db);
    await sql`delete from mem_city_wounded where cid = ${subCid}`.execute(db);
    await sql`delete from mem_technic_upgrading where cid = ${subCid}`.execute(db);
    await sql`delete from mem_treasure_map where cid = ${subCid}`.execute(db);
    await sql`delete from sys_building where cid = ${subCid}`.execute(db);
    await sql`delete from sys_city where cid = ${subCid}`.execute(db);
    await sql`delete from sys_city_defence where cid = ${subCid}`.execute(db);
    await sql`delete from sys_city_draftqueue where cid = ${subCid}`.execute(db);
    await sql`delete from sys_city_reinforcequeue where cid = ${subCid}`.execute(db);
    await sql`delete from sys_city_res_add where cid = ${subCid}`.execute(db);
    await sql`delete from sys_city_rumor where cid = ${subCid}`.execute(db);
    await sql`delete from sys_city_soldier where cid = ${subCid}`.execute(db);
    await sql`delete from sys_city_tactics where cid = ${subCid}`.execute(db);
    await sql`delete from sys_city_technic where cid = ${subCid}`.execute(db);
    await sql`delete from sys_city_trade where cid = ${subCid}`.execute(db);
    await sql`delete from sys_building where cid = ${subCid}`.execute(db);
    await sql`delete from sys_thing_position where cid = ${subCid}`.execute(db);
    await sql`update sys_technic set state = 0 where cid = ${subCid}`.execute(db);
    // 城池变成平地
    await sql`update mem_world set type = 1, ownercid = 0 where ownercid = ${subCid} and type = 0`.execute(
      db,
    );
    await sql`update mem_world set ownercid = 0 where ownercid = ${subCid}`.execute(db);
  }

  /** CityMergeFunc.php::makeMergeReport（214-257）：建筑升级表格的合城战报（title 53）。 */
  private async makeMergeReport(
    uid: number,
    mainCid: number,
    originalBuildings: Row[],
    nowBuildings: Row[],
  ): Promise<void> {
    let content = this.lang.t('MergeCity.table_start');
    // 取出各个升级信息
    const buildingCnt = originalBuildings.length;
    for (let i = 0; i < buildingCnt; i++) {
      const originalBuilding = originalBuildings[i]!;
      const nowBuilding = nowBuildings[i] ?? {};
      const originalLevels = originalBuilding.levels;
      const nowLevels = nowBuilding.levels;
      let upgradeLevelStr = '';

      if (MULTI_LEVEL_BIDS.has(phpIntval(originalBuilding.bid))) {
        // 可能多座的建筑逐座对比等级差；其余按 group_concat 结果做数值减法（PHP 的数字
        // 字符串相减取前导数字，phpNum 复刻）
        const origLevelArray = phpString(originalLevels).split(',');
        const nowLevelArray = phpString(nowLevels).split(',');
        const arrayCnt = origLevelArray.length;
        for (let j = 0; j < arrayCnt; j++) {
          upgradeLevelStr += phpString(phpNum(nowLevelArray[j]) - phpNum(origLevelArray[j]));
          if (j !== arrayCnt - 1) upgradeLevelStr += ',';
        }
      } else {
        upgradeLevelStr = phpString(phpNum(nowLevels) - phpNum(originalLevels));
      }
      content += this.lang.t('MergeCity.table_item_1');
      content += phpString(originalBuilding.name);
      content += this.lang.t('MergeCity.table_item_2');
      content += upgradeLevelStr;
      content += this.lang.t('MergeCity.table_item_3');
    }
    content += this.lang.t('MergeCity.table_end');

    const cityName = phpString(
      await this.cell(sql`select name from sys_city where cid = ${mainCid}`),
    );
    await sql`insert into sys_report (uid, origincid, origincity, happencid, happencity, title,
        type, time, \`read\`, battleid, content)
      values (${uid}, ${mainCid}, ${cityName}, ${mainCid}, ${cityName}, 53, 3, unix_timestamp(), 0, 0, ${content})`.execute(
      this.scope.db,
    );
    await sql`insert into sys_alarm (uid, report) values (${uid}, 1) on duplicate key update report = 1`.execute(
      this.scope.db,
    );
  }

  /**
   * CityMergeFunc.php::clearSubCityWild（320-327）：把分城附属野地上其他玩家的驻军召回。
   * 注意它在 destorySubCity 之后运行，而后者已把所有 ownercid=subCid 的地块清零，因此
   * 这条查询在原版流程里恒为空集——原版死代码，照抄。
   */
  private async clearSubCityWild(subCid: number): Promise<void> {
    if (phpEmpty(subCid)) return;
    const wids = await this.rows(sql`select wid from mem_world where ownercid = ${subCid}`);
    for (const wid of wids) {
      const cid = wid2cid(wid.wid);
      await sql`update sys_troops set state = 1 where targetcid = ${cid}`.execute(this.scope.db);
    }
  }

  /**
   * CityMergeFunc.php::reduceMingchengqiyue（329-333）：addGoods(160052, -1)（log_qiyue 记
   * 负数、sys_goods 落 -1），随后无条件把 sys_goods.count 置 0（契约是消耗品）并把主城
   * type 置 5（合城后的「名城」）。
   */
  private async reduceMingchengqiyue(uid: number, mainCid: number): Promise<void> {
    const db = this.scope.db;
    await this.goods.addGoods(uid, CONTRACT_GID, -1, 0); // 这里type不需要。
    await sql`update sys_goods set count = 0 where uid = ${uid} and gid = 160052`.execute(db);
    await sql`update sys_city set type = 5 where cid = ${mainCid}`.execute(db);
  }

  /** CityMergeFunc.php::doMergeResource（348-352）：分城资源并入主城（分城行稍后被删）。 */
  private async doMergeResource(mainCid: number, subCid: number): Promise<void> {
    const res = (
      await this.rows(
        sql`select wood, food, iron, rock, gold from mem_city_resource where cid = ${subCid}`,
      )
    )[0];
    // 无行时 PHP 换成一串 0
    const wood = phpFloatString(phpNum(res?.wood));
    const rock = phpFloatString(phpNum(res?.rock));
    const iron = phpFloatString(phpNum(res?.iron));
    const food = phpFloatString(phpNum(res?.food));
    const gold = phpFloatString(phpNum(res?.gold));
    await sql`update mem_city_resource set wood = wood + ${wood}, rock = rock + ${rock},
      iron = iron + ${iron}, food = food + ${food}, gold = gold + ${gold}
      where cid = ${mainCid}`.execute(this.scope.db);
  }

  /**
   * CityMergeFunc.php::completeBuildTask（354-358）：完成「把某建筑升到某级」的任务目标。
   * 原版条件 `count > 10 and count = $level` 要求 level 本身大于 10 才可能命中（sort=6
   * 的目标都是 11 级起），照抄。
   */
  private async completeBuildTask(uid: number, bid: number, level: unknown): Promise<void> {
    const goalId = await this.cell(
      sql`select id from cfg_task_goal where sort = 6 and count > 10 and type = ${bid} and count = ${phpNum(level)}`,
    );
    if (!phpEmpty(goalId)) {
      await sql`replace into sys_user_goal (\`uid\`, \`gid\`) values (${uid}, ${goalId})`.execute(
        this.scope.db,
      );
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
