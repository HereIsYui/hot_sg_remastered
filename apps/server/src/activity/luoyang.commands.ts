import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { TaskRewards } from '../task/task-rewards.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** LuoyangFunc.php — 洛阳战场的 cid（sys_luoyang_troops.targetcid 固定指向它）。 */
const LUOYANG_CID = 215265;

/** common.php 出征常量（与 StartTroop 同源）。 */
const GAME_SPEED_RATE = 1;
const GRID_DISTANCE = 60000;
/** 校场 building id（common.php ID_BUILDING_GROUND）。 */
const ID_BUILDING_GROUND = 8;
/** 军旗（出征洛阳必扣 1，见 LuoyangFunc.php:109）。 */
const FLAG_GID = 59;
/** 锦囊（计谋消耗物，cfg_trick.cost）。 */
const JINNANG_GID = 13;
/** mem_state: 2000=洛阳战场是否开启(0/1/2 冻结)，2001=开启时间戳。 */
const STATE_LUOYANG_OPEN = 2000;
const STATE_LUOYANG_TIME = 2001;
/** mem_hero_buffer buftype of 智多星符 (wisdom × 1.25). */
const BUFFER_ZHIDUOXING = 4;

/**
 * LuoyangFunc.php: the 洛阳战场 family — getLYBattleData (战场总览), luoyangTroopStart (派兵
 * 洛阳), luoyangCallbackTroop (召回), luoyangCityTroops (战场城军队列表), luoyangChangeCity
 * (战场内调城), luoyangAttack (开启遭遇战), useLuoyangTrick (千里奔袭) and luoyangYuanjun
 * (买援军权). All 8 sit in the openfunc whitelist (lang.php:2652) and are sent as global
 * commands (CampaignDialog.as:1794 / LuoYangBattlePanel.as / TroopDialog.as:1363 /
 * TrickDialog.as:370).
 *
 * Faithful quirks kept:
 * - the 周三晚 gate (`DATE_FORMAT(NOW(),'%w')==3 && %k>=19`, LuoyangFunc.php:19-24) reads the DB
 *   clock, so on the legacy side it cannot be diffed except for the out_of_time rejection;
 * - getTroopTime's 车轮技术 branch is `sid>=10 || sid<=12` — always true (original bug, :172) —
 *   so 辎重车/攻城器械/45-50 号兵 also take the wheel formula;
 * - luoyangCallbackTroop passes `$uid` where getTroopTime expects `$hid` (LuoyangFunc.php:458);
 *   the hero-speed/attribute lookups then run against hid=uid, usually finding nothing;
 * - its 途中召回 branch recomputes `pathtime=now-starttime` but both branches run the identical
 *   insert (LuoyangFunc.php:460-468 dead duplicate, kept as a single statement);
 * - luoyangTroopStart consumes 军旗 via an unconditional `reduceGoods($uid,59,1)` (:109) even
 *   when the client did not ask to use one (the count only clamps at 0);
 * - useLuoyangTrick only opens type 13 千里奔袭 (LuoyangFunc.php:274, original as-is) and its
 *   `lastcc`/`lastacc` share the 1h cooldown; with no troop row at all the null targetcid check
 *   throws trickQianLiBenXi.wrong_state before the waigua.invalid dead branch (:317) is reached;
 * - luoyangAttack writes the sys_battle row then takes `last_insert_id()` as a string for the
 *   reply; the mem_battle type=5 row settles through the common OLdBattleCron pipeline (no type
 *   special-case there) and its default tactics come from cfg_troop_tactics' plunder columns;
 * - the `DATE_FORMAT(NOW(),...)` / `unix_timestamp()` clocks all read the DB time, like PHP did.
 */
@Injectable()
export class LuoyangCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cityRules: CityRules,
    private readonly goods: GoodsRules,
    private readonly rewards: TaskRewards,
    private readonly users: UserRules,
  ) {}

  private get db() {
    return this.scope.db;
  }

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.db)).rows;
  }

  private async one(query: RawBuilder<Row>): Promise<Row | false> {
    return (await this.rows(query))[0] ?? false;
  }

  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const row = await this.one(query);
    return row === false ? false : Object.values(row)[0];
  }

  private async check(query: RawBuilder<Row>): Promise<boolean> {
    return (await this.one(query)) !== false;
  }

  // ───────────────────────────── 战场总览 ─────────────────────────────

  /** LuoyangFunc.php::getLYBattleData: `[战场城图, 剩余秒, 援军权, 自己的洛阳军队]`. */
  @GlobalCommand()
  async getLYBattleData(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const isOpen = await this.cell(
      sql<Row>`select value as v from mem_state where state = ${STATE_LUOYANG_OPEN}`,
    );
    if (phpIntval(isOpen) !== 1) throw GameError.lang('luoyang.out_of_time');
    const startTime = await this.cell(
      sql<Row>`select value as v from mem_state where state = ${STATE_LUOYANG_TIME}`,
    );
    if (phpEmpty(startTime) || phpNum(startTime) <= 0) {
      throw GameError.lang('waigua.invalid');
    }
    const now = phpNum(await this.cell(sql<Row>`select unix_timestamp() as t`));
    const endTime = phpNum(startTime) + 7200; // 持续 2 个小时
    if (endTime < now) throw GameError.lang('luoyang.has_close');

    // 推恩令有效
    const nobility = await this.cell(
      sql<Row>`select nobility as v from sys_user where uid = ${uid}`,
    );
    if ((await this.users.bufferNobility(uid, nobility)) < 6) {
      throw GameError.lang('luoyang.nobility_is_too_low');
    }
    // 必须在联盟
    const unionId = await this.cell(
      sql<Row>`select union_id as v from sys_user where uid = ${uid}`,
    );
    if (phpIntval(unionId) <= 0) throw GameError.lang('luoyang.not_in_union');

    // 原版 group by c.cid 在 MySQL 5.7 下隐式按 cid 排序，补 order by 保持行序确定。
    const cityInfo = await this.rows(sql<Row>`select a.*, group_concat(c.targetcid) as nextcid
      from cfg_luoyang_city_add a, cfg_luoyang_city c
      where a.cid = c.cid group by c.cid order by c.cid`);

    const leavingTime = endTime - now;
    let isOpenSecond = await this.cell(
      sql<Row>`select second as v from sys_user_luoyang where uid = ${uid} limit 1`,
    );
    const userTroopInfo = await this.rows(sql<Row>`select s.*,
        if(s.endtime - unix_timestamp() > 0, s.endtime - unix_timestamp(), 0) as leavingTime,
        h.name as heroname, h.level, h.sex, h.face, h.herotype
      from sys_luoyang_troops s, sys_city_hero h
      where s.hid = h.hid and s.uid = ${uid}`);
    if (phpEmpty(isOpenSecond)) isOpenSecond = 0;
    return [cityInfo, leavingTime, isOpenSecond, userTroopInfo];
  }

  // ───────────────────────────── 派兵洛阳 ─────────────────────────────

  /** LuoyangFunc.php::luoyangTroopStart: `[hid, cid, unionid, soldiers, usegoods]`. */
  @GlobalCommand()
  async luoyangTroopStart(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const hid = phpIntval(param.shift());
    const cid = phpIntval(param.shift());
    const unionid = phpIntval(param.shift());
    // 原 addslashes 只为拼接 SQL，改为参数绑定后直接用原始串。
    const soldiers = phpString(param.shift());
    const usegoods = param.shift();

    // 检查是否有军旗，军旗的 id 是 59
    if (!phpEmpty(usegoods) && !(await this.goods.checkGoods(uid, FLAG_GID))) {
      throw GameError.lang('StartTroop.no_flag');
    }
    // 19 点后（周三）才能开始派兵
    const day = phpNum(await this.cell(sql<Row>`select date_format(now(), '%w') as t`));
    const hour = phpNum(await this.cell(sql<Row>`select date_format(now(), '%k') as t`));
    if (day !== 3 || hour < 19) throw GameError.lang('luoyang.out_of_time');

    if (
      await this.check(
        sql<Row>`select 1 as x from mem_state where state = ${STATE_LUOYANG_OPEN} and value = 2`,
      )
    ) {
      throw GameError.lang('luoyang.has_close');
    }
    if (
      !(await this.check(
        sql<Row>`select 1 as x from sys_city_hero where uid = ${uid} and hid = ${hid}`,
      ))
    ) {
      throw GameError.lang('book.not_your_hero');
    }
    if (
      !(await this.check(sql<Row>`select 1 as x from sys_city where uid = ${uid} and cid = ${cid}`))
    ) {
      throw GameError.lang('searchcityname.target_union_not_exist');
    }
    if (
      !(await this.check(
        sql<Row>`select 1 as x from sys_user where uid = ${uid} and union_id = ${unionid}`,
      ))
    ) {
      throw GameError.lang('getUnionRelation.not_belongTo_union');
    }
    if (
      !(await this.check(
        sql<Row>`select 1 as x from sys_city_hero where uid = ${uid} and hid = ${hid} and state = '0'`,
      ))
    ) {
      throw GameError.lang('StartTroop.hero_is_busy');
    }
    // 推恩令有效
    const nobility = await this.cell(
      sql<Row>`select nobility as v from sys_user where uid = ${uid}`,
    );
    if ((await this.users.bufferNobility(uid, nobility)) < 6) {
      throw GameError.lang('luoyang.nobility_is_too_low');
    }
    const troopNum = await this.cell(
      sql<Row>`select count(*) as v from sys_luoyang_troops where uid = ${uid}`,
    );
    const second = await this.cell(
      sql<Row>`select second as v from sys_user_luoyang where uid = ${uid}`,
    );
    if (phpEmpty(second) && !phpEmpty(troopNum)) {
      throw GameError.lang('luoyang.troop_exists');
    }

    // 检查一下当前城池是否有这么多军队
    const citySoldiers = new Map<number, Row>();
    for (const r of await this.rows(sql<Row>`select * from sys_city_soldier where cid = ${cid}`)) {
      citySoldiers.set(phpIntval(r.sid), r);
    }

    const soldierParts = soldiers.split(',');
    const numSoldiers = phpIntval(soldierParts.shift());
    const takeSoldiers = new Map<number, number>(); // 真正带出去的军队
    if (numSoldiers > 12) throw GameError.lang('StartTroop.too_many_sid');
    let soldierAllCount = 0;
    for (let i = 0; i < numSoldiers; i++) {
      const sid = phpIntval(soldierParts.shift());
      let cnt = phpNum(soldierParts.shift());
      if (cnt < 0) cnt = 0;
      takeSoldiers.set(sid, cnt);
      // 实际军队人数 < 客户端传来的人数（城里没有该兵种时原版取到 null，同样拦截正数）
      if (phpNum(citySoldiers.get(sid)?.count) < cnt) {
        throw GameError.lang('StartTroop.no_so_many_army');
      }
      soldierAllCount += cnt;
    }
    if (soldierAllCount <= 0) throw GameError.lang('StartTroop.no_soldier');

    // 出征人数限制
    const groundLevel = phpIntval(
      await this.cell(
        sql<Row>`select level as v from sys_building where cid = ${cid} and bid = ${ID_BUILDING_GROUND}`,
      ),
    );
    let groundLevelLimit = groundLevel * 10000 * GAME_SPEED_RATE;
    let limitadd = 0;
    // 使用军旗
    if (!phpEmpty(usegoods)) limitadd += 25;
    const myCityInfo = (await this.one(sql<Row>`select * from sys_city where cid = ${cid}`)) as Row;
    // 名城出征人数
    if (phpIntval(myCityInfo.type) === 0) {
      if ((await this.specialSoldierId(cid)) > 0) limitadd += 25;
    } else {
      const t = phpIntval(myCityInfo.type);
      if (t === 1) limitadd += 25;
      else if (t === 2) limitadd += 50;
      else if (t === 3) limitadd += 75;
      else if (t === 4) limitadd += 100;
    }
    if (limitadd > 0) {
      groundLevelLimit = Math.ceil((groundLevelLimit * (100 + limitadd)) / 100);
    }
    // 是否超过人数
    if (soldierAllCount > groundLevelLimit) {
      throw GameError.lang('StartTroop.no_enough_ground_level', groundLevelLimit);
    }

    // 原版不判断 usegoods 一律扣 1 面军旗（数量最低为 0）。
    await this.goods.reduceGoods(uid, FLAG_GID, 1);

    const pathNeedTime = await this.getTroopTime(hid, cid, takeSoldiers);

    // 减兵员
    await this.cityRules.addCitySoldiers(cid, takeSoldiers, false);

    await sql<Row>`insert into sys_luoyang_troops
      (uid, cid, hid, targetcid, starttime, pathtime, endtime, soldiers, startcid, unionid)
      values (${uid}, ${cid}, ${hid}, ${LUOYANG_CID}, unix_timestamp(), ${pathNeedTime},
        unix_timestamp() + ${pathNeedTime}, ${soldiers}, ${cid}, ${unionid})`.execute(this.db);
    await sql<Row>`update sys_city_hero set state = '2' where hid = ${hid}`.execute(this.db);

    return [this.lang.t('luoyang.start_troop_succ')];
  }

  /**
   * LuoyangFunc.php::getTroopTime: 洛阳行军时间 — 单程时间 = 每格距离 / 最慢兵种速度，目标固定
   * 洛阳。注意 `sid>=10 || sid<=12` 恒真（原版 bug，:172），辎重车/器械/45-50 也走车轮公式。
   */
  private async getTroopTime(
    hid: number,
    cid: number,
    takeSoldiers: Map<number, number>,
  ): Promise<number> {
    const heroInfo = await this.one(sql<Row>`select * from sys_city_hero where hid = ${hid}`);
    // 步兵速度加成 / 骑兵速度加成（书院 tid 12/13）
    const techLevel = async (tid: number) =>
      phpIntval(
        await this.cell(
          sql<Row>`select level as v from sys_city_technic where cid = ${cid} and tid = ${tid}`,
        ),
      );
    const speedAddRate1 = 1 + (await techLevel(12)) * 0.1;
    const speedAddRate2 = 1 + (await techLevel(13)) * 0.05;
    // 将领速度加成
    let speedAddRate3 = 1;
    // 车轮技术（tid 26）
    const speedAddRate4 = (await techLevel(26)) * 0.05;
    if (hid !== 0) {
      speedAddRate3 = 1 + phpNum(heroInfo !== false ? heroInfo.speed_add_on : null) * 0.01;
    }
    const currentX = cid % 1000;
    const currentY = Math.floor(cid / 1000);
    const targetX = LUOYANG_CID % 1000;
    const targetY = Math.floor(LUOYANG_CID / 1000);

    const pathLength = Math.sqrt((targetX - currentX) ** 2 + (targetY - currentY) ** 2);
    let minSpeed = 999999999;
    const soldierConfig = await this.rows(
      sql<Row>`select * from cfg_soldier where fromcity = 1 order by sid`,
    );
    for (const soldier of soldierConfig) {
      // 找到当前军队里最慢的
      const sid = phpIntval(soldier.sid);
      let speedAdd = 0;
      // 计算将领身上因为装备而得到的该士兵的速度加成
      if ((sid >= 1 && sid <= 12) || (sid >= 45 && sid <= 50)) {
        const attid = 2000 + (sid - 1) * 100 + 11; // 取得属性 id
        const attr = await this.one(
          sql<Row>`select * from sys_hero_attribute where hid = ${hid} and attid = ${attid}`,
        );
        if (attr !== false) speedAdd = phpNum(attr.value);
      }
      if (!phpEmpty(takeSoldiers.get(sid))) {
        const base = phpNum(soldier.speed);
        if (sid < 7 && sid !== 3) {
          // 除了斥候外的步兵速度加成
          minSpeed = Math.min(base * speedAddRate1 * speedAddRate3 + speedAdd, minSpeed);
        } else if (sid === 8 || sid === 7) {
          // 骑兵加成
          minSpeed = Math.min(base * speedAddRate2 * speedAddRate3 + speedAdd, minSpeed);
        } else if (sid >= 10 || sid <= 12) {
          // 车轮技术（条件恒真，照抄原版）
          minSpeed = Math.min(
            base * speedAddRate2 * speedAddRate3 + base * speedAddRate4 + speedAdd,
            minSpeed,
          );
        }
      }
    }

    let pathNeedTime = (pathLength * GRID_DISTANCE) / minSpeed;
    if (await this.beaconAdd(cid, LUOYANG_CID)) {
      pathNeedTime *= 0.5;
    }
    return Math.trunc(Math.floor(pathNeedTime));
  }

  /** GroundFunc.php::getBeaconAdd: 烽火台覆盖范围（玩家主城 type=5）内行军时间减半。 */
  private async beaconAdd(cid: number, targetcid: number): Promise<boolean> {
    const cityType = await this.cell(sql<Row>`select type as v from sys_city where cid = ${cid}`);
    if (phpNum(cityType) !== 5) return false;
    const beaconLevel = phpNum(
      await this.cell(
        sql<Row>`select max(level) as v from sys_building where bid = 19 and cid = ${cid}`,
      ),
    );
    const currentX = cid % 1000;
    const currentY = Math.floor(cid / 1000);
    const targetX = targetcid % 1000;
    const targetY = Math.floor(targetcid / 1000);
    let length = 0;
    if (beaconLevel > 10) length = 5;
    length = length + (beaconLevel - 11) * 2;
    return Math.abs(targetX - currentX) <= length && Math.abs(targetY - currentY) <= length;
  }

  /** utils.php::getSpacialSoldierId: 城的特殊兵种 id（type<>4），没有为 0。 */
  private async specialSoldierId(cid: number): Promise<number> {
    const sid = await this.cell(
      sql<Row>`select sid as v from cfg_soldier_special_city where cid = ${cid} and type <> '4'`,
    );
    return phpEmpty(sid) ? 0 : phpIntval(sid);
  }

  // ───────────────────────────── 战场内操作 ─────────────────────────────

  /** LuoyangFunc.php::luoyangChangeCity: `[troopId, cid, targetcid]`. */
  @GlobalCommand()
  async luoyangChangeCity(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const troopId = phpIntval(param.shift());
    const cid = phpIntval(param.shift());
    const targetcid = phpIntval(param.shift());

    if (
      !(await this.check(
        sql<Row>`select 1 as x from sys_luoyang_troops where uid = ${uid} and id = ${troopId}`,
      ))
    ) {
      throw GameError.lang('luoyang.not_your_troop');
    }
    if (
      !(await this.check(
        sql<Row>`select 1 as x from cfg_luoyang_city where cid = ${cid} and targetcid = ${targetcid}`,
      ))
    ) {
      throw GameError.lang('luoyang.cannot_go_city');
    }
    if (
      await this.check(
        sql<Row>`select 1 as x from sys_luoyang_troops
        where endtime > unix_timestamp() and id = ${troopId}`,
      )
    ) {
      throw GameError.lang('luoyang.time_not_pass');
    }
    if (
      await this.check(
        sql<Row>`select 1 as x from sys_luoyang_troops where cid = ${cid} and uid < 1000 limit 1`,
      )
    ) {
      throw GameError.lang('luoyang.NPC_troops_exists');
    }
    await sql<Row>`update sys_luoyang_troops set cid = ${targetcid}, targetcid = ${targetcid},
      starttime = unix_timestamp(), pathtime = 120, endtime = unix_timestamp() + 120
      where id = ${troopId}`.execute(this.db);

    const curTroopInfo = await this.one(sql<Row>`select id, hid, cid, targetcid, pathtime
      from sys_luoyang_troops where id = ${troopId}`);
    return [curTroopInfo, this.lang.t('luoyang.start_troop_succ')];
  }

  /** LuoyangFunc.php::luoyangCityTroops: `[cid, hid]` → `[战场城内所有军队(含 NPC)]`. */
  @GlobalCommand()
  async luoyangCityTroops(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const cid = phpIntval(param.shift());
    const hid = phpIntval(param.shift());

    if (
      !(await this.check(
        sql<Row>`select 1 as x from sys_luoyang_troops
        where uid = ${uid} and cid = ${cid} and hid = ${hid}`,
      ))
    ) {
      throw GameError.lang('luoyang.not_in_city');
    }

    const troopInfos: Row[] = [];
    const troopInfoTmp = await this.rows(sql<Row>`select id, uid as userId, cid, hid, state,
      soldiers, battleid, unionid from sys_luoyang_troops where cid = ${cid} order by unionid asc`);
    for (const troopInfo of troopInfoTmp) {
      troopInfo.name = await this.cell(
        sql<Row>`select name as v from sys_user where uid = ${phpNum(troopInfo.userId)} limit 1`,
      );
      const heroInfo = await this.one(
        sql<Row>`select name, level from sys_city_hero where hid = ${phpNum(troopInfo.hid)} limit 1`,
      );
      // 原版将领行缺失时取到 null（PHP 5 notice）。
      troopInfo.heroName = heroInfo !== false ? heroInfo.name : null;
      troopInfo.heroLevel = heroInfo !== false ? heroInfo.level : null;
      if (phpIntval(troopInfo.userId) > 1000) {
        troopInfo.unionName = await this.cell(
          sql<Row>`select name as v from sys_union where id = ${phpNum(troopInfo.unionid)} limit 1`,
        );
      } else {
        troopInfo.unionName = ' ';
      }
      troopInfos.push(troopInfo);
    }
    return [troopInfos];
  }

  /** LuoyangFunc.php::luoyangAttack: `[attackHid, resistHid, battleCid]` → `[battleid]`. */
  @GlobalCommand()
  async luoyangAttack(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const attackHid = phpIntval(param.shift());
    const resistHid = phpIntval(param.shift());
    const battleCid = phpIntval(param.shift());

    const value = await this.cell(
      sql<Row>`select value as v from mem_state where state = ${STATE_LUOYANG_OPEN}`,
    );
    if (phpNum(value) === 0) {
      // 无行时原版取到 false，`false == 0` 同样走这里
      throw GameError.lang('luoyang.not_open');
    } else if (phpNum(value) === 2) {
      throw GameError.lang('luoyang.has_close');
    }
    const attackTroop = await this.one(sql<Row>`select * from sys_luoyang_troops
      where hid = ${attackHid} and cid = ${battleCid}`);
    const resistTroop = await this.one(sql<Row>`select * from sys_luoyang_troops
      where hid = ${resistHid} and cid = ${battleCid}`);
    if (attackTroop === false || resistTroop === false) {
      throw GameError.lang('luoyang.troop_not_exists');
    }
    if (phpLooseEquals(attackTroop.unionid, resistTroop.unionid)) {
      throw GameError.lang('luoyang.union_is_same');
    }
    if (phpNum(attackTroop.state) === 1) {
      throw GameError.lang('luoyang.troop_self_battle');
    }
    if (phpNum(resistTroop.state) === 1) {
      throw GameError.lang('luoyang.troop_other_battle');
    }

    const inserted = await sql<Row>`insert into sys_battle
      (type, starttime, cid, attackuid, resistuid, attacktroop, resisttroops)
      values (5, unix_timestamp(), ${phpNum(attackTroop.cid)}, ${phpNum(attackTroop.uid)},
        ${phpNum(resistTroop.uid)}, ${phpNum(attackTroop.id)}, ${phpNum(resistTroop.id)})`.execute(
      this.db,
    );
    // 原版回读 last_insert_id()（字符串）；type=5 洛阳遭遇战交给通用 OLdBattleCron 结算。
    const id = phpString(inserted.insertId === undefined ? 0 : Number(inserted.insertId));
    await sql<Row>`replace into mem_battle
      (\`id\`, \`type\`, \`nexttime\`, \`round\`, \`attackcid\`, \`attackhid\`, \`attacksoldiers\`,
       \`resistcid\`, \`resisthid\`, \`resistsoldiers\`, \`level\`, \`attackstartcid\`, \`resiststartcid\`)
      values (${Number(id)}, 5, unix_timestamp(), 0, ${phpNum(attackTroop.cid)},
        ${phpNum(attackTroop.hid)}, ${phpString(attackTroop.soldiers)}, ${phpNum(resistTroop.cid)},
        ${phpNum(resistTroop.hid)}, ${phpString(resistTroop.soldiers)}, 10,
        ${phpNum(attackTroop.cid)}, ${phpNum(resistTroop.cid)})`.execute(this.db);
    await sql<Row>`update sys_luoyang_troops set state = '1'
      where hid = ${phpNum(attackTroop.hid)} and cid = ${battleCid}`.execute(this.db);
    await sql<Row>`update sys_luoyang_troops set state = '1'
      where hid = ${phpNum(resistTroop.hid)} and cid = ${battleCid}`.execute(this.db);
    await sql<Row>`update sys_luoyang_troops set battleid = ${Number(id)}
      where hid = ${phpNum(resistTroop.hid)} and cid = ${battleCid}`.execute(this.db);
    await sql<Row>`update sys_luoyang_troops set battleid = ${Number(id)}
      where hid = ${phpNum(attackTroop.hid)} and cid = ${battleCid}`.execute(this.db);
    // 给沙场系统设置默认战术（双方都为遭遇战战术，取 cfg_troop_tactics 的 plunder 列）
    await sql<Row>`replace into mem_battle_tactics
      (battleid, attack, stype, action, target, action2, target2)
      (select ${Number(id)}, 1, stype, plunder_action, plunder_target, '0', '0'
        from cfg_troop_tactics)`.execute(this.db);
    await sql<Row>`replace into mem_battle_tactics
      (battleid, attack, stype, action, target, action2, target2)
      (select ${Number(id)}, 0, stype, plunder_action, plunder_target, '0', '0'
        from cfg_troop_tactics)`.execute(this.db);

    return [id];
  }

  /** LuoyangFunc.php::luoyangYuanjun: 花 100 元宝买援军权（sys_user_luoyang.second=1）。 */
  @GlobalCommand()
  async luoyangYuanjun(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const usermoney = await this.cell(sql<Row>`select money as v from sys_user where uid = ${uid}`);
    if (phpEmpty(usermoney) || phpNum(usermoney) < 100) {
      throw GameError.lang('buyGoods.no_enough_YuanBao');
    }
    const unionid = await this.cell(
      sql<Row>`select union_id as v from sys_user where uid = ${uid}`,
    );
    await sql<Row>`insert into sys_user_luoyang (uid, unionid, second) values (${uid}, ${phpNum(unionid)}, 1)
      on duplicate key update second = 1`.execute(this.db);
    // 原版 addMoney 的日志类型 91。
    await this.rewards.addMoney(uid, -100, 91);
    return [this.lang.t('heroexpr.get_reward_success')];
  }

  // ───────────────────────────── 千里奔袭 ─────────────────────────────

  /** LuoyangFunc.php::useLuoyangTrick: `[hid, type, usetype]` → `[消息, 剩余锦囊]`. */
  @GlobalCommand()
  async useLuoyangTrick(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const hid = phpIntval(param.shift());
    const type = phpIntval(param.shift());
    const usetype = phpIntval(param.shift());

    // 先只开放千里奔袭（原版即如此）
    if (type !== 13) throw GameError.lang('luoyang.can_not_use_trick');
    const hero = await this.one(sql<Row>`select * from sys_city_hero where hid = ${hid}`);
    if (hero === false) throw GameError.lang('useTrick.hero_not_exist');
    const trick = await this.one(sql<Row>`select * from cfg_trick where id = ${type}`);
    if (trick === false || !phpLooseEquals(trick.usetype, usetype)) {
      throw GameError.lang('useTrick.trick_not_exist');
    }
    // 原版查的是单行 count（非 sum，照抄）
    const userjinnang = await this.cell(
      sql<Row>`select count as v from sys_goods where uid = ${uid} and gid = ${JINNANG_GID}`,
    );
    if (phpNum(userjinnang) < phpNum(trick.cost)) {
      const tempnum = phpNum(trick.cost) - phpNum(userjinnang);
      // 原样字符串错误：客户端弹出 not_enough_goods13#N 的买即用弹窗。
      throw GameError.raw(`not_enough_goods${JINNANG_GID}#${tempnum}`);
    }

    let wisdom = phpNum(hero.wisdom_base) + phpNum(hero.wisdom_add);
    if (await this.isHeroHasBuffer(hid, BUFFER_ZHIDUOXING)) {
      // 智多星符
      wisdom *= 1.25;
    }
    wisdom += phpNum(hero.wisdom_add_on);

    // -1 从洛阳返回（sys_troops），1 派遣到洛阳（sys_luoyang_troops），0 出异常了
    let isBack = 0;
    let lastcc: unknown = 0;
    let troop = await this.one(
      sql<Row>`select * from sys_luoyang_troops where uid = ${uid} and hid = ${hid}`,
    );
    if (troop === false) {
      troop = await this.one(
        sql<Row>`select * from sys_troops where uid = ${uid} and hid = ${hid}`,
      );
      if (troop !== false) {
        isBack = -1;
        lastcc = troop.lastacc;
      }
    } else {
      isBack = 1;
      lastcc = troop.lastcc;
    }

    let msg: string;
    // 千里奔袭分支里 troop 必已命中（无军队行时上面 targetcid 检查已抛 wrong_state）。
    const troopRow = troop as Row;
    switch (type) {
      case 13: {
        // 千里奔袭
        const addrate = 100 / (100 + wisdom);
        // 无军队行时原版取到 null，同样按状态错处理
        if (!phpLooseEquals(troop !== false ? troop.targetcid : null, LUOYANG_CID)) {
          throw GameError.lang('trickQianLiBenXi.wrong_state');
        }
        const now = phpNum(await this.cell(sql<Row>`select unix_timestamp() as t`));
        if (now - phpNum(lastcc) < 3600) throw GameError.lang('trickQianLiBenXi.cool_down');

        if (isBack === -1) {
          await sql<Row>`update sys_troops
            set endtime = unix_timestamp() + (endtime - unix_timestamp()) * ${addrate},
              lastacc = unix_timestamp()
            where id = ${phpNum(troopRow.id)}`.execute(this.db);
        } else if (isBack === 1) {
          await sql<Row>`update sys_luoyang_troops
            set endtime = unix_timestamp() + (endtime - unix_timestamp()) * ${addrate},
              lastcc = unix_timestamp()
            where id = ${phpNum(troopRow.id)}`.execute(this.db);
        } else {
          // 无军队行时上面 targetcid 检查已抛 wrong_state，此为原版的死分支（:317）。
          throw GameError.lang('waigua.invalid');
        }
        msg = this.lang.t('trickQianLiBenXi.succ');
        break;
      }
      default:
        throw GameError.lang('luoyang.can_not_use_trick');
    }
    await this.goods.addGoods(uid, JINNANG_GID, -phpNum(trick.cost), 0);
    return [
      msg,
      await this.cell(
        sql<Row>`select sum(count) as v from sys_goods where uid = ${uid} and gid = ${JINNANG_GID}`,
      ),
    ];
  }

  /** utils.php::isHeroHasBuffer — the original ignores the buffer's endtime. */
  private async isHeroHasBuffer(hid: number, buftype: number): Promise<boolean> {
    return this.check(
      sql<Row>`select * from mem_hero_buffer where hid = ${hid} and buftype = ${buftype}`,
    );
  }

  // ───────────────────────────── 召回 ─────────────────────────────

  /** LuoyangFunc.php::luoyangCallbackTroop: `[troopid]` → 把洛阳军队转成回城 sys_troops。 */
  @GlobalCommand()
  async luoyangCallbackTroop(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const troopid = phpIntval(param.shift());
    const troopInfo = await this.one(
      sql<Row>`select * from sys_luoyang_troops where uid = ${uid} and id = ${troopid}`,
    );
    if (troopInfo === false) throw GameError.lang('luoyang.not_your_troop');
    if (phpNum(troopInfo.state) === 1) throw GameError.lang('luoyang.in_luoyang_battle');

    const soldierParts = phpString(troopInfo.soldiers).split(',');
    const numSoldiers = phpIntval(soldierParts.shift());
    const takeSoldiers = new Map<number, number>(); // 真正带出去的军队
    if (numSoldiers > 12) throw GameError.lang('StartTroop.too_many_sid');
    for (let i = 0; i < numSoldiers; i++) {
      const sid = phpIntval(soldierParts.shift());
      let cnt = phpNum(soldierParts.shift());
      if (cnt < 0) cnt = 0;
      takeSoldiers.set(sid, cnt);
    }
    // 原版把 $uid 当 getTroopTime 的 $hid 传入（LuoyangFunc.php:458），照抄。
    let pathNeedTime = await this.getTroopTime(uid, phpNum(troopInfo.startcid), takeSoldiers);
    const starttime = phpNum(
      await this.cell(
        sql<Row>`select starttime as v from sys_luoyang_troops
        where uid = ${uid} and id = ${troopid} limit 1`,
      ),
    );
    if (phpIntval(troopInfo.targetcid) === LUOYANG_CID) {
      // 派遣洛阳的途中进行召回：pathtime=now-starttime。
      // （原版两个分支的 insert SQL 完全相同，:460-468 死写法，这里合并为一条。）
      const now = phpNum(await this.cell(sql<Row>`select unix_timestamp() as t`));
      pathNeedTime = now - starttime;
    }
    // 洛阳战场内召回 — 同一条 insert（原版两分支相同）。
    await sql<Row>`insert into sys_troops
      (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource)
      values (${uid}, ${phpNum(troopInfo.startcid)}, ${phpNum(troopInfo.hid)}, ${LUOYANG_CID}, 1, 1,
        unix_timestamp(), ${pathNeedTime}, unix_timestamp() + ${pathNeedTime},
        ${phpString(troopInfo.soldiers)}, '0,0,0,0,0')`.execute(this.db);
    await sql<Row>`delete from sys_luoyang_troops where uid = ${uid} and id = ${troopid}`.execute(
      this.db,
    );
    return [this.lang.t('battle.callback_succ')];
  }
}
