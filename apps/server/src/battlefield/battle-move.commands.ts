/**
 * BattleFunc.php battlefield march & engagement command face (评审 S4 前半):
 *
 *   startBattleTroop          :1305  从城内出征到战场（写 sys_troops task=7、battlefieldid、startcid）
 *   getBattleFieldState       :1228  战场大地图的据点/军队快照
 *   getCurrentCityGroundLevel1:1283 / 2:1294  校场等级闸门（两个函数同体）
 *   battleTroopDispatch       :1965  战场内调遣（task=8，startcid=出发据点）
 *   getInfoForBattleArmyAttack:2035 / Reinforce:2081  攻击/援军对话框数据
 *   battlePatrol              :2132  信鸽侦察据点驻军（发 45 号战报后按原版抛成功文案）
 *   selectOneTroop            :2211 / getInfoForBattleArmySend:2222
 *   battleAttack              :2989  战场内攻击（task=9，targettroopid）
 *
 * Internal helpers are REUSED from the sibling slices (survey.alreadyDone): the two battle-state
 * readers, the mark cooldown, resetBattleFieldUid, getSoldierPeople/enhanceArmy/reGeneratePathTime
 * live in battle/battlefield-troop-support.ts (S4b's file, marked reusable), setFlags in
 * battle/battlefield-helpers.ts (S3 tick slice) and battleid2cid in battle/battlefield-utils.ts.
 * Only `canGoto` (BattleFunc.php:2190, the sys_battle_city.nextxy adjacency check) was unported —
 * it is exported here. The 官渡 2001 军粮 gate and the 董卓 4001 玉玺 gate are ported verbatim —
 * the four local battlefields (1001/3001/5001/8001) never trigger them, as in the original
 * single-machine package.
 *
 * Like StartTroop (start-troop.commands.ts) these writes are deliberately NOT wrapped in
 * scope.transaction(): the original runs them bare (MyISAM, no transaction), several paths end
 * in a thrown success message (battlePatrol) and startBattleTroop writes five tables in
 * sequence exactly as the original did.
 */

import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { makeTimeLeft } from '../core/user-rules.service';
import { addslashes, phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { ReportService } from '../core/report.service';
import { TaskRules } from '../core/task-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, RejectedCommand, type CommandContext } from '../gateway/decorators';
import {
  enoughIntervalFromLastMark,
  firstGetUserBattleInfo,
  ifFrozeExit,
  resetBattleFieldUid,
} from '../battle/battlefield-troop-support';
import { setFlags } from '../battle/battlefield-helpers';
import { battleid2cid } from '../battle/battlefield-utils';

type Row = Record<string, unknown>;

/**
 * BattleFunc.php::canGoto (line 2190): is `targetcid` reachable from the 据点 whose `nextxy`
 * adjacency string (`count,x,y,...`) we hold? Four outcomes: adjacent → true; listed as `-xy` →
 * the road exists but is locked → throws `battle.road_not_opens`; not listed → false; empty list
 * → false.
 */
export function canGoto(lang: LangService, targetcid: number, nextcids: unknown): boolean {
  const targetxy = targetcid % 1000;
  const parts = phpString(nextcids).split(',');
  const nextcount = phpIntval(parts.shift());
  for (let i = 0; i < nextcount; i++) {
    const temp = parts.shift();
    if (phpLooseEquals(temp, targetxy)) return true;
    if (phpLooseEquals(temp, -targetxy)) throw GameError.lang('battle.road_not_opens');
  }
  return false;
}

/** common.php: 校场 building id and the march-speed scale (both fixed in this package). */
const ID_BUILDING_GROUND = 8;
const GAME_SPEED_RATE = 1;

/** 军旗 goods id (startBattleTroop) and 信鸽 goods id (battlePatrol). */
const FLAG_GID = 59;
const PIGEON_GID = 140;

/** 董卓副本的玉玺 thing id (sys_troop_things.thing_id). */
const YUXI_THING_ID = 45;

/**
 * Battlefield March & engagement commands (BattleFunc.php). Command names are the openfunc
 * whitelist entries, sent by the client as global commands with action "battle"
 * (BattleCampaignDialog.as:664, BattleFiledViewDialog.as:346/371/605/893, …).
 */
@Injectable()
export class BattleMoveCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cityRules: CityRules,
    private readonly goods: GoodsRules,
    private readonly tasks: TaskRules,
    private readonly report: ReportService,
  ) {}

  private get db() {
    return this.scope.db;
  }

  private async rows(query: ReturnType<typeof sql<Row>>): Promise<Row[]> {
    return (await query.execute(this.db)).rows;
  }

  private async one(query: ReturnType<typeof sql<Row>>): Promise<Row | false> {
    return (await this.rows(query))[0] ?? false;
  }

  /** sql_fetch_one_cell: the first column of the first row; false when the query is empty. */
  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = await this.one(query);
    return row === false ? false : Object.values(row)[0];
  }

  private async check(query: ReturnType<typeof sql<Row>>): Promise<boolean> {
    return (await this.one(query)) !== false;
  }

  /**
   * The deps face the sibling-slice helpers take (battle/battlefield-troop-support.ts and
   * battle/battlefield-helpers.ts): both read `db`/`rows|query`/`one`/`cell`/`lang`.
   */
  private deps() {
    const db = this.db;
    const query = async (q: RawBuilder<Row>) => (await q.execute(db)).rows;
    return {
      db,
      rows: query,
      query,
      one: async (q: RawBuilder<Row>) => (await q.execute(db)).rows[0] ?? false,
      cell: async (q: RawBuilder<Row>) => {
        const row = (await q.execute(db)).rows[0];
        return row ? Object.values(row)[0] : false;
      },
      lang: (key: string, ...args: unknown[]) => this.lang.t(key, ...args),
    };
  }

  // ─────────────────────────── startBattleTroop ───────────────────────────

  /**
   * BattleFunc.php::startBattleTroop (line 1305): march an army from a home city onto the
   * battlefield. Validates the start city (`cfg_battle_start_city`, honour gate, per-bid troop
   * and dispatch-count limits), the hero, the soldier mix (≤12 kinds, ≤11 for 5001), the
   * 校场-level size caps, the 军旗 and the food cost (hours until the battlefield ends), then
   * spends soldiers/food/flag and writes the task-7 `sys_troops` row with
   * `endtime = unix_timestamp()+10` (the original's fixed 10-second leg into the instance).
   */
  @GlobalCommand()
  async startBattleTroop(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const p = [...param];
    const cid = phpIntval(p.shift());
    const hid = phpIntval(p.shift());
    const soldiers = phpString(p.shift());
    let usegoods = p.shift();
    const xy = phpIntval(p.shift());

    if (hid <= 0) throw GameError.lang('start_battle_troop.no_hero');
    // 检查目标战场的有效性.
    const battleinfo = (await firstGetUserBattleInfo(this.deps(), uid)) as Row;

    // 据点战场，要等人数够了开启才行.
    if (
      !phpLooseEquals(battleinfo.bid, 6001) &&
      phpLooseEquals(battleinfo.type, 1) &&
      phpLooseEquals(battleinfo.state, 2)
    ) {
      throw GameError.lang('battle.battle_in_ready');
    }
    if (phpLooseEquals(battleinfo.type, 1)) {
      // 据点战场不能使用军旗.
      usegoods = 0;
    }
    let startcityinfo: Row | false;
    if (phpLooseEquals(battleinfo.bid, 6001)) {
      startcityinfo = await this.one(sql<Row>`select 0 as needhonour from sys_user_battle_state
        where state = 0 and uid = ${uid} and startcid = ${xy} limit 1`);
    } else {
      startcityinfo = await this.one(sql<Row>`select * from cfg_battle_start_city
        where bid = ${phpIntval(battleinfo.bid)} and xy = ${xy}
        and unionid = ${phpIntval(battleinfo.unionid)}`);
    }
    if (!startcityinfo) throw GameError.lang('start_battle_troop.city_not_allow');
    if (phpNum(startcityinfo.needhonour) > phpNum(battleinfo.honour)) {
      throw GameError.lang('start_battle_troop.not_enought_honour');
    }
    const alreadySentTroopCount = await this.cell(
      sql<Row>`select sent_troop_count from sys_user_battle_state where state = 0 and uid = ${uid}`,
    );
    if (
      (phpLooseEquals(battleinfo.bid, 5001) && phpLooseEquals(alreadySentTroopCount, 1)) ||
      (phpLooseEquals(battleinfo.bid, 6001) && phpLooseEquals(alreadySentTroopCount, 2))
    ) {
      throw GameError.lang('start_battle_troop.reach_limit');
    }

    const targetcid = battleid2cid(phpIntval(battleinfo.battlefieldid), xy);

    const troopcount = phpNum(
      await this.cell(sql<Row>`select count(*) as c from sys_troops
        where uid = ${uid} and battlefieldid = ${phpIntval(battleinfo.battlefieldid)}`),
    );
    let maxTroopCount = 2;
    if (phpLooseEquals(battleinfo.bid, 5001)) maxTroopCount = 1;
    if (troopcount >= maxTroopCount) throw GameError.lang('start_battle_troop.max_troop');

    // 检查是否有军旗，军旗的id是59.
    if (!phpEmpty(usegoods) && !(await this.goods.checkGoods(uid, FLAG_GID))) {
      throw GameError.raw('not_enough_goods59');
    }
    // 当前城池已经发生战斗了，就不能出发了。（原版注释掉的 mem_world state 校验，照留）

    // 检查一下是暗渡陈仓状态，如果没有暗渡陈仓，中了十面埋伏的话就不能出兵了.
    const anduTime = await this.cell(sql<Row>`select \`endtime\` from mem_city_buffer
      where cid = ${cid} and buftype = 5 and \`endtime\` > unix_timestamp()`);
    if (phpEmpty(anduTime)) {
      // 检查一下十面埋伏状态.
      const shimianTime = await this.cell(sql<Row>`select \`endtime\` - unix_timestamp()
        from mem_city_buffer where cid = ${cid} and buftype = 8 and \`endtime\` > unix_timestamp()`);
      if (!phpEmpty(shimianTime)) {
        throw GameError.lang(
          'StartTroop.suffer_ShiMianMaiFu',
          makeTimeLeft(this.lang, phpNum(shimianTime)),
        );
      }
    }

    // 校场的等级不够的话就不能出发.
    const groundLevel = phpIntval(
      await this.cell(sql<Row>`select level from sys_building
        where cid = ${cid} and bid = ${ID_BUILDING_GROUND}`),
    );

    const troopCount = phpIntval(
      await this.cell(sql<Row>`select count(*) as c from sys_troops
        where uid = ${uid} and cid = ${cid}`),
    );
    if (troopCount >= groundLevel) {
      throw GameError.lang('StartTroop.insufficient_ground_level');
    }

    const forceNeed = 5;
    // 检查一下英雄的有效性.
    let heroInfo: Row | false = false;
    if (hid !== 0) {
      heroInfo = await this.one(sql<Row>`select * from sys_city_hero h
        left join mem_hero_blood m on m.hid = h.hid
        where h.hid = ${hid} and h.uid = ${uid} and h.cid = ${cid}`);
      if (!heroInfo) {
        throw GameError.lang('StartTroop.hero_not_found');
      }
      if (!phpLooseEquals(heroInfo.state, 0) || !phpLooseEquals(heroInfo.hero_health, 0)) {
        throw GameError.lang('StartTroop.hero_is_busy');
      }
      if (phpNum(heroInfo.force) < forceNeed) {
        throw GameError.lang(
          'StartTroop.hero_not_enough_force',
          this.lang.t('StartTroop.goto_battle'),
          forceNeed,
        );
      }
    }

    // 要检查自己是不是刚使用过高级迁城令.
    const lastMoveCD = phpIntval(
      await this.cell(sql<Row>`select last_adv_move + 43200 - unix_timestamp()
        from mem_city_schedule where cid = ${cid}`),
    );
    if (lastMoveCD > 0) {
      throw GameError.lang('StartTroop.adv_move_cooldown', makeTimeLeft(this.lang, lastMoveCD));
    }

    // 检查一下当前城池是否有这么多军队.
    const citySoldiers = new Map<number, Row>();
    for (const r of await this.rows(sql<Row>`select * from sys_city_soldier where cid = ${cid}`)) {
      citySoldiers.set(phpIntval(r.sid), r);
    }

    const soldierParts = soldiers.split(',');
    const numSoldiers = phpIntval(soldierParts.shift());
    const takeSoldiers = new Map<number, number>(); // 真正带出去的军队
    let soldierAllCount = 0;
    let cihouCount = 0;
    if (numSoldiers > 12) throw GameError.lang('StartTroop.too_many_sid');
    if (phpLooseEquals(battleinfo.bid, 5001) && numSoldiers > 11) {
      throw GameError.lang('StartTroop.too_many_sid11');
    }
    for (let i = 0; i < numSoldiers; i++) {
      const sid = phpIntval(soldierParts.shift());
      let cnt = phpNum(soldierParts.shift());
      if (cnt < 0) cnt = 0;
      takeSoldiers.set(sid, cnt);
      // 实际军队人数<客户端传来的人数.
      if (phpNum(citySoldiers.get(sid)?.count) < cnt) {
        throw GameError.lang('StartTroop.no_so_many_army');
      }
      soldierAllCount += cnt;
      if (sid === 3) cihouCount += cnt;
    }

    if (soldierAllCount <= 0) throw GameError.lang('StartTroop.no_soldier');

    // 不能斥候独立出征.
    if (cihouCount >= soldierAllCount) throw GameError.lang('battle.spy_cant_alone');

    // 出征人数限制.
    let groundLevelLimit = groundLevel * 10000 * GAME_SPEED_RATE;
    let limitadd = 0;
    // 使用军旗.
    if (!phpEmpty(usegoods)) limitadd += 25;
    const myCityInfo =
      (await this.one(sql<Row>`select * from sys_city where cid = ${cid}`)) || ({} as Row);
    // 名城出征人数.
    const myType = phpIntval(myCityInfo.type);
    if (myType > 0) {
      if (myType === 1) limitadd += 25;
      else if (myType === 2) limitadd += 50;
      else if (myType === 3) limitadd += 75;
      else if (myType === 4) limitadd += 100;
    }
    if (limitadd > 0) {
      groundLevelLimit = Math.ceil((groundLevelLimit * (100 + limitadd)) / 100);
    }

    // 针对战场等级的出征人数限制.
    const soldierLimit = this.lang.value<Record<string, unknown>>('battle')?.soldier_limit as
      unknown[] | undefined;
    let groundLevelLimit1 = phpNum(soldierLimit?.[phpIntval(battleinfo.level)]);
    if (!phpEmpty(usegoods)) groundLevelLimit1 = Math.ceil(groundLevelLimit1 * 1.25);
    groundLevelLimit = Math.min(groundLevelLimit, groundLevelLimit1);
    // 千里走单骑空出两个辎重车.
    if (phpLooseEquals(battleinfo.bid, 5001)) groundLevelLimit -= 2;
    // 是否超过人数.
    if (soldierAllCount > groundLevelLimit) {
      throw GameError.lang('StartTroop.no_enough_ground_level', groundLevelLimit);
    }

    // 行军技巧和驾驭技巧.
    const techLevel = async (tid: number) =>
      phpIntval(
        await this.cell(
          sql<Row>`select level from sys_city_technic where cid = ${cid} and tid = ${tid}`,
        ),
      );
    // 步兵速度加成.
    const speedAddRate1 = 1 + (await techLevel(12)) * 0.1;
    // 骑兵速度加成.
    const speedAddRate2 = 1 + (await techLevel(13)) * 0.05;
    // 将领速度加成.
    let speedAddRate3 = 1;
    if (hid !== 0 && heroInfo) {
      speedAddRate3 = 1 + phpNum(heroInfo.speed_add_on) * 0.01;
    }

    // 单程时间 ＝ 每格子距离/最慢兵种速度+宿营时间（每格距离＝60000/game_speed_rate）
    const pathLength = 162000;
    let minSpeed = 999999999;
    const soldierConfig = await this.rows(
      sql<Row>`select * from cfg_soldier where fromcity = 1 order by sid`,
    );
    for (const soldier of soldierConfig) {
      // 找到当前军队里最慢的
      const sid = phpIntval(soldier.sid);
      let speedAdd = 0;
      if (
        hid > 0 &&
        ((sid >= 1 && sid <= 12) || (sid >= 45 && sid <= 50)) // 计算将领身上因为装备而得到的该士兵的速度加成
      ) {
        const attid = 2000 + (sid - 1) * 100 + 11; // 取得属性id
        const attr = await this.one(
          sql<Row>`select * from sys_hero_attribute where hid = ${hid} and attid = ${attid}`,
        );
        if (attr) speedAdd = phpNum(attr.value);
      }
      if (!phpEmpty(takeSoldiers.get(sid))) {
        if (sid < 7 && sid !== 3) {
          // 除了斥候外的步兵速度加成
          minSpeed = Math.min(
            phpNum(soldier.speed) * speedAddRate1 * speedAddRate3 + speedAdd,
            minSpeed,
          );
        } else {
          // 骑兵加成
          minSpeed = Math.min(
            phpNum(soldier.speed) * speedAddRate2 * speedAddRate3 + speedAdd,
            minSpeed,
          );
        }
      }
    }

    let pathNeedTime = Math.trunc(Math.floor(pathLength / minSpeed)); // 需要多少时间

    // 出征耗粮 ＝ 兵的耗粮/小时*12*单程时间.
    let foodUse = 0;
    let allpeople = 0;
    for (const soldier of soldierConfig) {
      // 找到当前军队里最慢的
      const sid = phpIntval(soldier.sid);
      if (!phpEmpty(takeSoldiers.get(sid))) {
        foodUse += phpNum(soldier.food_use) * phpNum(takeSoldiers.get(sid));
        allpeople += phpNum(soldier.people_need) * phpNum(takeSoldiers.get(sid));
      }
    }

    const now = phpNum(await this.cell(sql<Row>`select unix_timestamp() as t`));
    let foodRate = Math.ceil((phpNum(battleinfo.endtime) - now) / 3600);
    if (foodRate <= 0) foodRate = 1;
    foodUse *= foodRate;
    // 军队行程耗粮量. 检查一下当前城池是否有足够的军粮，直接吃掉.
    const food = phpNum(
      await this.cell(sql<Row>`select food from mem_city_resource where cid = ${cid}`),
    );
    if (food < foodUse) throw GameError.lang('StartTroop.no_enough_food');

    if (hid !== 0) {
      // 让将领置成出征状态.
      await sql`update sys_city_hero set state = 2 where hid = ${hid}`.execute(this.db);
      await sql`update mem_hero_blood set \`force\` = GREATEST(0, \`force\` - ${forceNeed})
        where hid = ${hid}`.execute(this.db);
    }
    // 减资源.
    await this.cityRules.addCityResources(cid, 0, 0, 0, -foodUse, 0);
    // 减兵员.
    await this.cityRules.addCitySoldiers(cid, takeSoldiers, false);
    // 减军旗.
    if (!phpEmpty(usegoods)) {
      await this.goods.reduceGoods(uid, FLAG_GID, 1);
      await this.tasks.completeTaskWithTaskid(uid, 303);
    }
    if (phpLooseEquals(battleinfo.bid, 6001)) {
      // 逐鹿中原移动时间固定为60秒.
      pathNeedTime = 60;
    }
    const troopid = Number(
      (
        await sql<Row>`insert into sys_troops
        (\`uid\`, \`cid\`, \`hid\`, \`task\`, \`state\`, \`starttime\`, \`pathtime\`, \`endtime\`,
         \`soldiers\`, \`resource\`, \`people\`, \`fooduse\`, \`battlefieldid\`, \`battleunionid\`,
         \`targetcid\`, \`startcid\`, \`bid\`, \`ulimit\`)
        values (${uid}, ${cid}, ${hid}, 7, 0, unix_timestamp(), ${pathNeedTime},
          unix_timestamp() + 10, ${soldiers}, '0', ${allpeople}, ${foodUse},
          ${phpIntval(battleinfo.battlefieldid)}, ${phpIntval(battleinfo.unionid)}, ${targetcid},
          ${cid}, ${phpIntval(battleinfo.bid)}, ${soldierAllCount})`.execute(this.db)
      ).insertId ?? 0,
    );

    // 设置当前军队的战术为玩家当前战术.
    const tactics = await this.one(sql<Row>`select * from sys_user_tactics where uid = ${uid}`);
    if (tactics) {
      await sql`replace into sys_troop_tactics
        (\`troopid\`, \`plunder\`, \`invade\`, \`patrol\`, \`field\`)
        values (${troopid}, ${tactics.plunder}, ${tactics.invade}, ${tactics.patrol},
          ${tactics.field})`.execute(this.db);
    }
    await sql`update sys_user_battle_state set sent_troop_count = sent_troop_count + 1
      where state = 0 and uid = ${uid}`.execute(this.db);

    return [this.lang.t('StartTroop.succ')];
  }

  // ─────────────────────────── getBattleFieldState ───────────────────────────

  /**
   * BattleFunc.php::getBattleFieldState (line 1228): the battlefield map snapshot — the viewed
   * city's name, both sides' troops there (NPC uid<897 / player uid>897), the flagged 据点
   * list, the caller's own battlefield troops, and the 增兵/探索 gates.
   */
  @GlobalCommand()
  async getBattleFieldState(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const p = [...param];
    const battleinfo = (await firstGetUserBattleInfo(this.deps(), uid)) as Row;
    const battlefieldid = phpIntval(p.shift());
    const unionid = phpIntval(p.shift());
    const cid = phpIntval(p.shift());
    const cityname = addslashes(phpString(p.shift())); // the PHP returns the escaped string
    const currentTroopCid = phpIntval(p.shift());

    const troopcityinfo = await this.one(
      sql<Row>`select * from sys_battle_city where cid = ${currentTroopCid}`,
    );
    if (phpLooseEquals(battleinfo.bid, 6001) && cid !== currentTroopCid) {
      if (!troopcityinfo || !canGoto(this.lang, cid, phpString(troopcityinfo.nextxy))) {
        throw GameError.lang('battle.can_not_view_city');
      }
    }
    const curcityinfo =
      (await this.one(sql<Row>`select * from sys_battle_city where cid = ${cid}`)) || ({} as Row);

    const troops1 = await this.rows(sql<Row>`select s.*, CASE WHEN u.name IS NULL THEN u2.name
        ELSE u.name END AS \`name\`, CASE WHEN u.name IS NULL THEN u2.name ELSE u.name END
        AS \`union\`, h.name as hero, h.can_chat as can_chat, h.can_chat as enable_chat,
      h.no_attack as no_attack, h.level as level
    from sys_troops s
    left join cfg_battle_union u on s.battleunionid = u.unionid
    left join cfg_battle_hero h on (s.hid = h.hid)
    left join sys_user u2 on s.battleunionid = u2.uid
    where s.uid < 897 and s.battlefieldid = ${battlefieldid} and s.cid = ${cid}
      and (s.state = 4 or s.state = 3)`);
    const troops2 = await this.rows(sql<Row>`select s.*, u2.name as name,
        CASE WHEN u.name IS NULL THEN u2.name ELSE u.name END AS \`union\`, h.name as hero,
        0 as can_chat, 0 as enable_chat, 0 as no_attack, h.level as level
    from sys_troops s
    left join cfg_battle_union u on s.battleunionid = u.unionid
    left join sys_city_hero h on (s.hid = h.hid)
    left join sys_user u2 on s.uid = u2.uid
    where s.uid > 897 and s.battlefieldid = ${battlefieldid} and s.cid = ${cid}
      and ((s.state = 4 or s.state = 3) or s.targetcid = ${cid})`);

    const ret: unknown[] = [];
    ret.push(cityname);
    ret.push(cid);
    const troops3 = [...troops1, ...troops2];
    if (phpLooseEquals(battleinfo.bid, 7001)) {
      // 三让徐州不能一直交谈.
      for (const troopitem of troops3) {
        if (!phpEmpty(troopitem.can_chat)) {
          if (
            !(await enoughIntervalFromLastMark(
              this.deps(),
              battlefieldid,
              2,
              phpIntval(troopitem.hid),
            ))
          ) {
            troopitem.enable_chat = '0';
          }
        }
      }
    }
    ret.push(troops3);

    const cityinfo = await this.rows(
      sql<Row>`select * from sys_battle_city where battlefieldid = ${battlefieldid}`,
    );
    ret.push(await setFlags(this.deps(), unionid, cityinfo));
    ret.push(
      await this.rows(sql<Row>`select t.state, t.targetcid, t.soldiers, t.cid, t.id, t.ulimit,
        h.face, h.sex, h.name as heroname, h.level, h.hid, h.herotype
      from sys_troops t left join sys_city_hero h on t.hid = h.hid
      where t.uid = ${uid} and t.battlefieldid = ${battlefieldid} order by t.id asc`),
    );

    // 可否从该城池增兵.
    ret.push(
      (await this.check(sql<Row>`SELECT 1 as x FROM sys_battle_city a, sys_troops b
        WHERE a.battlefieldid = ${battlefieldid} AND a.cid = ${cid}
          AND a.ownerunionid = ${uid} AND a.cid = b.cid AND b.uid = a.uid AND b.uid = ${uid}`))
        ? 1
        : 0,
    );
    // 可否探索.
    ret.push(
      (phpLooseEquals(battleinfo.unionid, 28) || phpLooseEquals(battleinfo.unionid, 30)) &&
        phpLooseEquals(curcityinfo.can_quest, '1'),
    );
    let interval = 300;
    if (phpLooseEquals(battleinfo.unionid, 28)) interval = 300;
    else if (phpLooseEquals(battleinfo.unionid, 30)) interval = 60;
    ret.push(
      (phpLooseEquals(battleinfo.unionid, 28) || phpLooseEquals(battleinfo.unionid, 30)) &&
        phpLooseEquals(curcityinfo.can_quest, '1') &&
        (await enoughIntervalFromLastMark(this.deps(), battlefieldid, 1, cid, false, interval)),
    );
    return ret;
  }

  // ─────────────────────────── 校场等级 ───────────────────────────

  /** BattleFunc.php::getCurrentCityGroundLevel1 (line 1283). */
  // NOT in lang.php openfunc (only ...Level2 is): legacy answers
  // `getCurrentCityGroundLevel1你异常了!!!` — reproduced via RejectedCommand.
  @RejectedCommand()
  async getCurrentCityGroundLevel1(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const cid = phpIntval(param[0]);
    const groundLevel = phpIntval(
      await this.cell(sql<Row>`select level from sys_building
        where cid = ${cid} and bid = ${ID_BUILDING_GROUND}`),
    );
    if (phpEmpty(groundLevel) || groundLevel === 0) {
      throw GameError.lang('getGroundInfo.no_ground_built');
    }
    return [groundLevel];
  }

  /** BattleFunc.php::getCurrentCityGroundLevel2 (line 1294) — same body as level 1. */
  @GlobalCommand()
  async getCurrentCityGroundLevel2(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.getCurrentCityGroundLevel1(ctx, param);
  }

  // ─────────────────────────── battleTroopDispatch ───────────────────────────

  /**
   * BattleFunc.php::battleTroopDispatch (line 1965): march a stationed (state 4) troop to an
   * ADJACENT 据点 — task 8. The march time is the troop's stored `pathtime`
   * (`endtime = unix_timestamp()+pathtime`), the 4001 玉玺 sojourn gate and the instance-wide
   * attack lock are ported, and the origin 据点's owner is re-derived afterwards.
   */
  @GlobalCommand()
  async battleTroopDispatch(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const p = [...param];
    const troopid = phpIntval(p.shift());
    const targetcid = phpIntval(p.shift());
    // $heroname / $targetName only feed the commented-out playTroopLeave in the original.
    p.shift();
    p.shift();

    const battlefieldinfo = await ifFrozeExit(this.deps(), uid);
    const troop = await this.one(sql<Row>`select * from sys_troops
      where id = ${troopid} and uid = ${uid}
      and battlefieldid = ${phpIntval(battlefieldinfo.battlefieldid)}`);
    if (!troop) throw GameError.lang('battle.troop_not_exist');
    if (!phpLooseEquals(troop.state, 4)) throw GameError.lang('battle.troop_not_stay');

    // 检查目的据点.
    const targetcity = await this.one(
      sql<Row>`select * from sys_battle_city where cid = ${targetcid}`,
    );
    if (!targetcity) throw GameError.lang('battle.city_not_exist');

    // 检查出发据点.
    const origincity = await this.one(
      sql<Row>`select * from sys_battle_city where cid = ${phpIntval(troop.cid)}`,
    );
    if (!origincity) throw GameError.lang('battle.city_not_exist');

    // 是否连通.
    if (!canGoto(this.lang, targetcid, origincity.nextxy)) {
      throw GameError.lang('battle.city_cannot_goto');
    }
    // 如果是董卓副本，身上有玉玺的话需要检查是否停留的够久.
    if (phpIntval(troop.battlefieldid) === 4001) {
      const yuxi = await this.one(sql<Row>`select * from sys_troop_things
        where troop_id = ${troopid} and thing_id = ${YUXI_THING_ID}`);
      if (yuxi) {
        const timediff = await this.cell(sql<Row>`select unix_timestamp() - arrive_time
          from sys_troops where id = ${troopid}`);
        if (phpIntval(timediff) < 60) {
          throw GameError.lang('battle.must_stay_one_minute');
        }
      }
    }

    const lockcid = targetcid % 1000;
    const attackLock = await this.one(sql<Row>`SELECT * FROM mem_battle_attack_lock
      WHERE battlefieldid = ${phpIntval(battlefieldinfo.battlefieldid)} AND cid = ${lockcid}
      AND (uid in (${uid}, 0) or uid IS NULL)`);
    if (attackLock) throw GameError.raw(phpString(attackLock.msg));

    await sql`update sys_troops set starttime = unix_timestamp(), state = 0,
      targetcid = ${targetcid}, task = 8, endtime = unix_timestamp() + pathtime, arrive_time = 0
      where id = ${troopid}`.execute(this.db);
    const ret: unknown[] = [this.lang.t('StartTroop.succ')];
    await resetBattleFieldUid(this.deps(), phpIntval(troop.cid));
    return ret;
  }

  // ─────────────────────────── 攻击 / 援军 / 驻守信息 ───────────────────────────

  /** BattleFunc.php::getInfoForBattleArmyAttack (line 2035): the 攻击 dialog's two sides. */
  @GlobalCommand()
  async getInfoForBattleArmyAttack(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const p = [...param];
    const troopid = phpIntval(p.shift());
    const targettroopid = phpIntval(p.shift());
    const targetname = addslashes(phpString(p.shift()));

    const troop = await this.one(sql<Row>`select t.cid, t.id, t.uid, t.soldiers, t.pathtime,
      t.state, h.name as heroname, h.level, h.hid
    from sys_troops t left join sys_city_hero h on t.hid = h.hid
    where t.id = ${troopid} and t.uid = ${uid}`);
    if (!troop) throw GameError.lang('battle.troop_not_exist');
    if (!phpLooseEquals(troop.state, 4)) throw GameError.lang('battle.troop_not_stay');

    const targettroop = await this.one(sql<Row>`select cid, id, uid, soldiers, hid, state
      from sys_troops where id = ${targettroopid}`);
    if (!targettroop) throw GameError.lang('battle.troop_not_exist');
    if (phpIntval(troop.cid) === phpIntval(targettroop.cid)) {
      // 同据点攻击,30秒后开始 对手不能在攻击状.
      if (!phpLooseEquals(targettroop.state, 4)) {
        throw GameError.lang('battle.troop_in_same_city_not_stay');
      }
      troop.pathtime = 10;
    } else {
      targettroop.soldiers = '';
    }

    if (phpNum(targettroop.uid) > 0) {
      // 被攻击的部队是玩家部队.
      const heroinfo = await this.one(
        sql<Row>`select name, level from sys_city_hero where hid = ${phpIntval(targettroop.hid)}`,
      );
      targettroop.heroname = heroinfo ? heroinfo.name : null;
      targettroop.level = heroinfo ? heroinfo.level : null;
    } else {
      // 防守方的部队.
      const heroinfo = await this.one(
        sql<Row>`select name, level from cfg_battle_hero where hid = ${phpIntval(targettroop.hid)}`,
      );
      targettroop.heroname = heroinfo ? heroinfo.name : null;
      targettroop.level = heroinfo ? heroinfo.level : null;
    }

    return [troop, targettroop, targetname];
  }

  /** BattleFunc.php::getInfoForBattleArmyReinforce (line 2081). */
  @GlobalCommand()
  async getInfoForBattleArmyReinforce(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const troopinfo = await this.rows(sql<Row>`select t.cid, t.id, t.uid, t.soldiers, t.pathtime,
      t.state, h.name as heroname, h.level, h.hid
    from sys_troops t left join sys_city_hero h on t.hid = h.hid
    where t.cid = ${cid} and t.uid = ${uid}`);
    const reinforceSoldiers = await this.cell(
      sql<Row>`select reinforce_soldiers from sys_battle_city where cid = ${cid}`,
    );
    return [troopinfo, reinforceSoldiers === false ? null : reinforceSoldiers];
  }

  /**
   * BattleFunc.php::battlePatrol (line 2132): scout a 据点's stationed troop with a 信鸽 (140).
   * Files the type-45 report, spends the pigeon and — as the original — reports success by
   * THROWING `battle.patrol_report_suc` (the client renders the thrown text).
   */
  @GlobalCommand()
  async battlePatrol(ctx: CommandContext, param: unknown[]): Promise<never> {
    const { uid } = ctx;
    const p = [...param];
    const troopid = phpIntval(p.shift());
    const targettroopid = phpIntval(p.shift());

    // 先检查有没有信鸽.
    if (!(await this.goods.checkGoods(uid, PIGEON_GID))) {
      throw GameError.raw('not_enough_goods140');
    }

    const troop = await this.one(sql<Row>`select t.cid, t.id, t.uid, t.soldiers, t.pathtime,
      t.state, h.name as heroname, h.level
    from sys_troops t left join sys_city_hero h on t.hid = h.hid
    where t.id = ${troopid} and t.uid = ${uid}`);
    if (!troop) throw GameError.lang('battle.troop_not_exist');
    const targettroop = await this.one(sql<Row>`select cid, id, uid, soldiers, hid, bid, state
      from sys_troops where id = ${targettroopid}`);
    if (!targettroop) throw GameError.lang('battle.troop_not_exist');

    let heroname: unknown;
    let level: unknown;
    if (phpNum(targettroop.uid) > 0) {
      // 被攻击的部队是玩家部队.
      const heroinfo = await this.one(
        sql<Row>`select name, level from sys_city_hero where hid = ${phpIntval(targettroop.hid)}`,
      );
      heroname = heroinfo ? heroinfo.name : null;
      level = heroinfo ? heroinfo.level : null;
    } else {
      // 防守方的部队.
      const heroinfo = await this.one(
        sql<Row>`select name, level from cfg_battle_hero where hid = ${phpIntval(targettroop.hid)}`,
      );
      heroname = heroinfo ? heroinfo.name : null;
      level = heroinfo ? heroinfo.level : null;
    }

    const xy = phpIntval(targettroop.cid) % 1000;
    const targetcityname = await this.cell(sql<Row>`select name from cfg_battle_city
      where bid = ${phpIntval(targettroop.bid)} and xy = ${xy}`);

    // lang.t 本身就是 sprintf 渲染：必须把参数传进去；再包一层 sprintf 会拿到已渲染成空槽
    // 的文本（%s 已被无参渲染吃掉），侦察三要素全部丢空。
    let msg = this.lang.t(
      'battle.patrol_report',
      targetcityname === false ? '' : phpString(targetcityname),
      heroname,
      level,
    );
    const soldierParts = phpString(targettroop.soldiers).split(',');
    const soldierscount = phpIntval(soldierParts.shift());
    const names = this.lang.value<Record<string, unknown>>('battle')?.patrol_report_soldier as
      Record<string, unknown> | undefined;
    for (let i = 0; i < soldierscount; i++) {
      const sid = phpString(soldierParts.shift());
      const count = phpString(soldierParts.shift());
      msg += `${phpString(names?.[sid] ?? '')} ${count}<br/>`;
    }

    // 发战报.
    await this.report.sendReport(uid, 45, 0, 0, msg);

    await this.goods.reduceGoods(uid, PIGEON_GID, 1);

    throw GameError.lang('battle.patrol_report_suc');
  }

  /** BattleFunc.php::selectOneTroop (line 2211): refresh one troop's current position. */
  @GlobalCommand()
  async selectOneTroop(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const troopid = phpIntval(param[0]);
    const troop = await this.one(sql<Row>`select id, cid from sys_troops
      where id = ${troopid} and uid = ${uid}`);
    if (!troop) throw GameError.lang('battle.troop_not_exist');
    return [[], troop];
  }

  /** BattleFunc.php::getInfoForBattleArmySend (line 2222): the 调遣 dialog's source troop. */
  @GlobalCommand()
  async getInfoForBattleArmySend(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const p = [...param];
    const troopid = phpIntval(p.shift());
    const targetid = phpIntval(p.shift());
    const targetname = addslashes(phpString(p.shift()));

    const troop = await this.one(sql<Row>`select t.id, t.uid, t.soldiers, t.pathtime, t.state,
      h.name as heroname, h.level, t.cid
    from sys_troops t left join sys_city_hero h on t.hid = h.hid
    where t.id = ${troopid} and t.uid = ${uid}`);
    if (!troop) throw GameError.lang('battle.troop_not_exist');
    if (!phpLooseEquals(troop.state, 4)) throw GameError.lang('battle.troop_not_stay');
    if (phpIntval(troop.cid) === targetid) {
      throw GameError.lang('battle.troop_in_same_city');
    }
    troop.targetname = targetname;
    troop.targetid = targetid;
    return [troop];
  }

  // ─────────────────────────── battleAttack ───────────────────────────

  /**
   * BattleFunc.php::battleAttack (line 2989): march a stationed troop onto an ENEMY troop —
   * task 9. Same-city targets march 10 seconds; others must be adjacent and pass the per-战场
   * gates: 官渡 2001 军粮 (winpoint by 据点 767/101), 十常侍 3001 attack lock, 董卓 4001 per-user
   * lock + 玉玺 sojourn, and the default lock (uid in (me,0) or NULL).
   */
  @GlobalCommand()
  async battleAttack(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const p = [...param];
    const troopid = phpIntval(p.shift());
    const targettroopid = phpIntval(p.shift());
    // $heroname / $targetcityname only feed the commented-out playTroopLeave in the original.
    phpString(p.shift());
    phpString(p.shift());

    const battlefieldinfo = await ifFrozeExit(this.deps(), uid);

    if (phpLooseEquals(battlefieldinfo.type, 1) && phpLooseEquals(battlefieldinfo.state, 2)) {
      throw GameError.lang('battle.battle_in_ready');
    }
    if (phpLooseEquals(battlefieldinfo.bid, 6001) && phpLooseEquals(battlefieldinfo.progress, 0)) {
      throw GameError.lang('battle.battle_in_dispatch');
    }
    const troop = await this.one(sql<Row>`select * from sys_troops
      where id = ${troopid} and uid = ${uid}
      and battlefieldid = ${phpIntval(battlefieldinfo.battlefieldid)}`);
    if (!troop) throw GameError.lang('battle.troop_not_exist');
    if (!phpLooseEquals(troop.state, 4)) throw GameError.lang('battle.troop_not_stay');

    // 检查目的部队.
    const targettroop = await this.one(
      sql<Row>`select * from sys_troops where id = ${targettroopid}`,
    );
    if (!targettroop) throw GameError.lang('battle.targettroop_not_exist');

    // 检查出发据点.
    const origincity = await this.one(
      sql<Row>`select * from sys_battle_city where cid = ${phpIntval(troop.cid)}`,
    );
    if (!origincity) throw GameError.lang('battle.city_not_exist');
    const targetcity = await this.one(
      sql<Row>`select * from sys_battle_city where cid = ${phpIntval(targettroop.cid)}`,
    );
    if (!targetcity) throw GameError.lang('battle.city_not_exist');
    const targetcid = phpIntval(targetcity.cid);

    // 是否是我方阵营.
    const unionid = phpIntval(battlefieldinfo.unionid);
    if (phpLooseEquals(targettroop.battleunionid, unionid)) {
      throw GameError.lang('battle.same_union');
    }

    const sameCity = phpIntval(targetcity.cid) === phpIntval(origincity.cid);
    if (!sameCity) {
      // 是否连通（同一据点内相互攻击不需要邻接）.
      if (!canGoto(this.lang, targetcid, origincity.nextxy)) {
        throw GameError.lang('battle.city_cannot_goto');
      }
      const bid = phpIntval(battlefieldinfo.bid);
      if (bid === 2001) {
        // 如果是官渡，则要检查.
        const xy = phpIntval(targettroop.cid) % 1000;
        if (xy === 767) {
          // 攻击许都，检查曹军粮草是否耗尽.
          const point = await this.cell(sql<Row>`select point from sys_battle_winpoint
            where battlefieldid = ${phpIntval(battlefieldinfo.battlefieldid)} and unionid = 4`);
          if (phpNum(point) > 0) throw GameError.lang('battle.cao_has_food');
        } else if (xy === 101) {
          // 攻击袁绍1，或者袁绍3，检查曹军粮草是否耗尽.
          const point = await this.cell(sql<Row>`select point from sys_battle_winpoint
            where battlefieldid = ${phpIntval(battlefieldinfo.battlefieldid)} and unionid = 3`);
          if (phpNum(point) > 0) throw GameError.lang('battle.yuan_has_food');
        }
      } else if (bid === 3001) {
        // 如果是十常侍，攻击洛阳之前必须检查搜集罪证的任务是否已经完成了.
        // 需要检查被攻击的城市是否属于攻击锁定状态.
        const lockcid = phpIntval(targettroop.cid) % 1000;
        const attackLock = await this.one(sql<Row>`SELECT * FROM mem_battle_attack_lock
          WHERE battlefieldid = ${phpIntval(battlefieldinfo.battlefieldid)} AND cid = ${lockcid}`);
        if (attackLock) throw GameError.raw(phpString(attackLock.msg));
      } else if (bid === 4001) {
        const lockcid = phpIntval(targettroop.cid) % 1000;
        const attackLock = await this.one(sql<Row>`SELECT * FROM mem_battle_attack_lock
          WHERE battlefieldid = ${phpIntval(battlefieldinfo.battlefieldid)} AND cid = ${lockcid}
          AND uid = ${uid}`);
        if (attackLock) throw GameError.raw(phpString(attackLock.msg));

        // 如果是董卓副本，身上有玉玺的话需要检查是否停留的够久.
        const yuxi = await this.one(sql<Row>`select * from sys_troop_things
          where troop_id = ${troopid} and thing_id = ${YUXI_THING_ID}`);
        if (yuxi) {
          const timediff = await this.cell(sql<Row>`select unix_timestamp() - arrive_time
            from sys_troops where id = ${troopid}`);
          if (phpIntval(timediff) < 60) {
            throw GameError.lang('battle.must_stay_one_minute');
          }
        }
      } else {
        const lockcid = phpIntval(targettroop.cid) % 1000;
        const attackLock = await this.one(sql<Row>`SELECT * FROM mem_battle_attack_lock
          WHERE battlefieldid = ${phpIntval(battlefieldinfo.battlefieldid)} AND cid = ${lockcid}
          AND (uid in (${uid}, 0) or uid IS NULL)`);
        if (attackLock) throw GameError.raw(phpString(attackLock.msg));
      }
    }

    if (sameCity) {
      // 同一据点内相互攻击.
      await sql`update sys_troops set starttime = unix_timestamp(), state = 0,
        targetcid = ${targetcid}, task = 9, targettroopid = ${targettroopid},
        endtime = unix_timestamp() + 10, arrive_time = 0
        where id = ${troopid}`.execute(this.db);
    } else {
      await sql`update sys_troops set starttime = unix_timestamp(), state = 0,
        targetcid = ${targetcid}, task = 9, targettroopid = ${targettroopid},
        endtime = unix_timestamp() + pathtime, arrive_time = 0
        where id = ${troopid}`.execute(this.db);
    }
    const ret: unknown[] = [this.lang.t('StartTroop.succ')];
    await resetBattleFieldUid(this.deps(), phpIntval(troop.cid));
    return ret;
  }
}
