import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { makeTimeLeft } from '../core/user-rules.service';
import { CityRules, cid2wid } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { DbScope } from '../db/database.module';
import { DialogCommand, type CommandContext } from '../gateway/decorators';
import { ExternService } from './extern.service';

type Row = Record<string, unknown>;

/** common.php Define constants used by the 出征 maths. */
const GAME_SPEED_RATE = 1;
const GRID_DISTANCE = 60000;
const NPC_UID_END = 897;
const WT_CITY = 0;

/** Building ids from common.php. */
const ID_BUILDING_GROUND = 8;
const ID_BUILDING_DAK = 18;
const ID_BUILDING_BALEFIRE = 19;

/** 军旗 goods id. */
const FLAG_GID = 59;

/**
 * GroundFunc.php: 出征 (StartTroop) and its 阵型方案 (getTroopScheme / setTroopScheme).
 *
 * 出征 validates the target, task legality (运输/派遣/侦察/掠夺/占领), hero force cost, soldier
 * mix and carry/food limits, computes the march time (speed techs, 驿站, 烽火台 range, equipment)
 * and food use, spends the resources and soldiers, writes the `sys_troops` row and raises the
 * target's alarm. 洛阳 (luoyangTroopStart) is left unported.
 *
 * Note: StartTroop writes its row and then THROWS the success message (the client treats a thrown
 * string as text), so it must not run inside a transaction — the throw would roll the write back,
 * exactly as the original (MyISAM, no transaction) did.
 */
@Injectable()
export class StartTroopCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cityRules: CityRules,
    private readonly goods: GoodsRules,
    private readonly tasks: TaskRules,
    private readonly extern: ExternService,
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

  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = await this.one(query);
    return row === false ? false : Object.values(row)[0];
  }

  private async check(query: ReturnType<typeof sql<Row>>): Promise<boolean> {
    return (await this.one(query)) !== false;
  }

  /** utils.php::getSpacialSoldierId: the city's special soldier id (non-type-4), 0 for none. */
  private async specialSoldierId(cid: number): Promise<number> {
    const sid = await this.cell(
      sql<Row>`select sid from cfg_soldier_special_city where cid = ${cid} and type <> '4'`,
    );
    return phpEmpty(sid) ? 0 : phpIntval(sid);
  }

  /** utils.php::MakeEndTime: a wall-clock string via the DB clock. */
  private async makeEndTime(endtime: number): Promise<string> {
    const fmt = `%Y${this.lang.t('MakeEndTime.year')}%m${this.lang.t('MakeEndTime.month')}%d${this.lang.t('MakeEndTime.day')} %H:%i:%s`;
    const v = await this.cell(sql<Row>`select from_unixtime(${endtime}, ${fmt}) as t`);
    return phpString(v);
  }

  // ───────────────────────────── 出征 ─────────────────────────────

  /** StartTroop($uid,$cid,$param). */
  @DialogCommand()
  async StartTroop(ctx: CommandContext, param: unknown[]): Promise<never> {
    const { uid, cid } = ctx;
    const hid = phpIntval(param[0]);
    const targetcid = phpIntval(param[1]);
    const task = phpIntval(param[2]);
    let secondAdd = phpNum(param[3]);
    const soldiers = phpString(param[4]);
    // 防作弊：资源字段只保留前 5 项并转为整数。
    let resource = phpString(param[5]);
    const serverType = phpNum(
      await this.cell(sql<Row>`select value from mem_state where state = 197`),
    );
    const now = phpNum(await this.cell(sql<Row>`select unix_timestamp() as t`));

    const vacendTime = await this.cell(
      sql<Row>`select vacend from sys_user_state where uid = ${uid}`,
    );
    if (!phpEmpty(vacendTime) && phpIntval(vacendTime) > now) {
      // 休假中：静默返回（原函数 `return;`，无返回值）。
      return undefined as never;
    }

    await this.checkOutOpen(targetcid);
    await this.checkMianZhanCondition(uid, cid, targetcid, task, serverType);

    {
      const parts = resource.split(',');
      const n = Math.min(parts.length, 5);
      let out = '';
      for (let i = 0; i < n; i++) out += `${phpIntval(parts[i])},`;
      resource = out;
    }

    const usegoods = param[6];
    if (targetcid === cid) throw GameError.lang('StartTroop.target_cant_be_current');

    // 军旗（道具 59）。
    if (usegoods && !(await this.goods.checkGoods(uid, FLAG_GID))) {
      throw GameError.lang('StartTroop.no_flag');
    }

    // 暗渡陈仓 / 十面埋伏。
    const anduTime = await this.cell(sql<Row>`select endtime from mem_city_buffer
      where cid = ${cid} and buftype = 5 and endtime > unix_timestamp()`);
    if (phpEmpty(anduTime)) {
      const shimianTime = await this.cell(sql<Row>`select endtime - unix_timestamp()
        from mem_city_buffer where cid = ${cid} and buftype = 8 and endtime > unix_timestamp()`);
      if (!phpEmpty(shimianTime)) {
        throw GameError.lang(
          'StartTroop.suffer_ShiMianMaiFu',
          makeTimeLeft(this.lang, phpNum(shimianTime)),
        );
      }
    }

    const targetwid = cid2wid(targetcid);
    const worldinfo = await this.one(sql<Row>`select * from mem_world where wid = ${targetwid}`);
    if (worldinfo === false) throw GameError.lang('StartTroop.invalid_target', task);

    const targetCityInfo =
      (await this.one(sql<Row>`select * from sys_city where cid = ${worldinfo.ownercid}`)) ||
      ({} as Row);

    let targetcitytype = phpIntval(targetCityInfo.type);
    const worldType = phpIntval(worldinfo.type);
    let canProtected = true;
    if (serverType === 1) {
      if (targetcitytype >= 0 && targetcitytype <= 5) canProtected = true;
      if (worldType > 0) canProtected = false;
      if ((await this.specialSoldierId(targetcid)) > 0) canProtected = true;
    } else {
      if (targetcitytype === 5) targetcitytype = 0;
      canProtected = true;
      if (worldType > 0 || targetcitytype > 0) canProtected = false;
      if ((await this.specialSoldierId(targetcid)) > 0) canProtected = false;
    }

    // 司隶（州 198 开关 + province 1）不受保护。
    let isSili = 0;
    const yysType = await this.cell(sql<Row>`select value from mem_state where state = 198`);
    if (phpNum(yysType) === 1 && phpIntval(worldinfo.province) === 1) isSili = 1;

    // 校场等级限制出征队伍数。
    const groundLevel = phpIntval(
      await this.cell(
        sql<Row>`select level from sys_building where cid = ${cid} and bid = ${ID_BUILDING_GROUND}`,
      ),
    );
    const troopCount = phpIntval(
      await this.cell(
        sql<Row>`select count(*) as c from sys_troops where cid = ${cid} and uid = ${uid}`,
      ),
    );
    if (troopCount >= groundLevel) throw GameError.lang('StartTroop.insufficient_ground_level');

    const taskname = [
      this.lang.t('StartTroop.transport'),
      this.lang.t('StartTroop.send'),
      this.lang.t('StartTroop.detect'),
      this.lang.t('StartTroop.harry'),
      this.lang.t('StartTroop.occupy'),
    ];
    const forceNeed = [2, 1, 3, 4, 5];
    if (task === 3 && hid === 0) throw GameError.lang('StartTroop.plunder_no_hero');
    if (task === 4 && hid === 0) throw GameError.lang('StartTroop.invade_no_hero');

    // 将领有效性与体力。
    let heroInfo: Row | false = false;
    if (hid !== 0) {
      heroInfo = await this.one(sql<Row>`select * from sys_city_hero h
        left join mem_hero_blood m on m.hid = h.hid
        where h.hid = ${hid} and h.uid = ${uid} and h.cid = ${cid}`);
      if (!heroInfo) throw GameError.lang('StartTroop.hero_not_found');
      if (phpIntval(heroInfo.state) !== 0 || phpIntval(heroInfo.hero_health) !== 0) {
        throw GameError.lang('StartTroop.hero_is_busy');
      }
      if (phpNum(heroInfo.force) < forceNeed[task]!) {
        throw GameError.lang('StartTroop.hero_not_enough_force', taskname[task], forceNeed[task]);
      }
    }

    // 目标归属判定。
    let targetIsUnion = false;
    let targetuid = 0;
    if (phpIntval(worldinfo.ownercid) === cid) {
      targetIsUnion = true;
      targetuid = uid;
    } else if (worldType === 0) {
      targetuid = phpIntval(targetCityInfo.uid);
    } else if (phpIntval(worldinfo.ownercid) !== 0) {
      targetuid = phpIntval(targetCityInfo.uid);
    }

    // 上屋抽梯：盟友军队排不过来。
    const swctEndTime = await this.cell(sql<Row>`select endtime from mem_city_buffer
      where cid = ${targetcid} and buftype = 28 and endtime > unix_timestamp()`);
    if (!phpEmpty(swctEndTime)) {
      const targetUnionId = phpNum(
        await this.cell(sql<Row>`select a.union_id
        from sys_user a, sys_city b where a.uid = b.uid and b.cid = ${targetcid}`),
      );
      const myUnionId = phpNum(
        await this.cell(sql<Row>`select union_id from sys_user where uid = ${uid}`),
      );
      if (
        targetUnionId > 0 &&
        myUnionId > 0 &&
        targetUnionId === myUnionId &&
        task <= 1 &&
        uid !== targetuid
      ) {
        throw GameError.lang('trickSWCT.in_trick');
      }
    }

    if (!(task === 0 && targetuid === uid && worldType === 0)) {
      // 高级迁城令冷却（非给自己野地运输时）。
      const lastMoveCD = phpIntval(
        await this.cell(sql<Row>`select last_adv_move + 43200 - unix_timestamp() as c
          from mem_city_schedule where cid = ${cid}`),
      );
      if (lastMoveCD > 0) {
        throw GameError.lang('StartTroop.adv_move_cooldown', makeTimeLeft(this.lang, lastMoveCD));
      }
    }

    // 全民休战期（固定 2012 时段）对掠夺/占领的限制。
    if (worldType === 0 && targetuid > NPC_UID_END) {
      const startyear = 1327244400;
      const endyear = 1327453200;
      const nowtime = Math.floor(Date.now() / 1000);
      if (nowtime > startyear && nowtime < endyear) {
        const newhour = phpNum(
          await this.cell(sql<Row>`select hour(from_unixtime(${nowtime})) as h`),
        );
        if (((newhour >= 0 && newhour < 9) || newhour >= 23) && (task === 3 || task === 4)) {
          throw GameError.lang('year.bidwar');
        }
      }
    }

    const myUserInfo =
      (await this.one(sql<Row>`select * from sys_user where uid = ${uid}`)) || ({} as Row);
    const targetUserInfo =
      (await this.one(sql<Row>`select * from sys_user where uid = ${targetuid}`)) || ({} as Row);
    if (!phpEmpty(targetuid)) {
      const targetunion = targetUserInfo.union_id;
      const myunion = myUserInfo.union_id;
      if (uid === targetuid) {
        targetIsUnion = true;
      } else if (
        !phpEmpty(targetunion) &&
        phpNum(myunion) === phpNum(targetunion) &&
        phpNum(myunion) > 0
      ) {
        targetIsUnion = true;
      }

      if (worldType === 0 && !targetIsUnion) {
        const unionRelation = await this.one(sql<Row>`select * from sys_union_relation
          where unionid = ${myunion} and target = ${targetunion}`);
        if (unionRelation && phpIntval(unionRelation.type) === 0 && task === 2) {
          throw GameError.lang('StartTroop.cant_detect_friendly_union');
        }
        if (
          isSili === 1 &&
          unionRelation &&
          phpIntval(unionRelation.type) === 0 &&
          (task === 3 || task === 4)
        ) {
          throw GameError.lang('StartTroop.not_in_battle_condition');
        }
        const userTrickwar = await this.rows(sql<Row>`select * from mem_user_trickwar
          where (uid = ${uid} and targetuid = ${targetuid}) or (uid = ${targetuid} and targetuid = ${uid})`);
        const userInwar = await this.one(sql<Row>`select * from mem_user_inwar
          where (uid = ${uid} and targetuid = ${targetuid}) or (uid = ${targetuid} and targetuid = ${uid})`);
        if (isSili === 0 && (!unionRelation || phpIntval(unionRelation.type) !== 2)) {
          if (!(targetuid < NPC_UID_END || targetcitytype > 0)) {
            if (task > 2) {
              if (userTrickwar.length === 0) {
                if (!userInwar) throw GameError.lang('StartTroop.not_in_battle_condition');
                if (phpIntval(userInwar.state) === 0) {
                  throw GameError.lang(
                    'StartTroop.wait_to_battle',
                    await this.makeEndTime(phpNum(userInwar.endtime)),
                  );
                }
              }
            }
          }
        } else if (isSili === 0 && (task === 4 || task === 3)) {
          if (userTrickwar.length === 0 && (!userInwar || phpIntval(userInwar.state) === 0)) {
            if (
              unionRelation &&
              now - phpNum(unionRelation.time) < 3600 * 8 &&
              targetcitytype === 0
            ) {
              throw GameError.lang(
                'StartTroop.wait_to_union_battle',
                await this.makeEndTime(phpNum(unionRelation.time) + 3600 * 8),
              );
            }
          }
        }
      }
    }

    // 对手封禁 / 休假。
    if (isSili === 0 && targetcitytype === 0) {
      const targetuserstate = await this
        .one(sql<Row>`select forbiend, vacend, unix_timestamp() as nowtime
        from sys_user_state where uid = ${targetuid}
          and (forbiend > unix_timestamp() or vacend > unix_timestamp())`);
      if (targetuserstate) {
        if (phpNum(targetuserstate.forbiend) > phpNum(targetuserstate.nowtime)) {
          throw GameError.lang('StartTroop.target_be_locked');
        }
        if (canProtected && phpNum(targetuserstate.vacend) > phpNum(targetuserstate.nowtime)) {
          throw GameError.lang('StartTroop.target_in_vacation');
        }
      }
    }

    // 名城掠夺 / 占领的黄巾史诗与都城限制。
    if (task > 2) {
      let tct = phpIntval(targetCityInfo.type);
      if (tct === 5) tct = 0;
      const luoyangopen = await this.cell(sql<Row>`select value from mem_state where state = 8`);
      if (phpNum(luoyangopen) === 1) {
        if (tct === 4) {
          if (task === 3) {
            if (!(await this.userUnionHasXianDiZhaoShu(uid)))
              throw GameError.lang('StartTroop.nobufferluoyang');
          } else {
            throw GameError.lang('StartTroop.capital');
          }
        }
      } else {
        if (tct === 4) throw GameError.lang('StartTroop.capital');
        else if (targetcid === 225185) throw GameError.lang('StartTroop.changan');
      }
      if (tct > 0) {
        const huangjinProgress = await this.cell(
          sql<Row>`select value from mem_state where state = 5`,
        );
        if (phpNum(huangjinProgress) !== 1) throw GameError.lang('StartTroop.huangjin_unfinished');
        const chiefhid = phpIntval(targetCityInfo.chiefhid);
        if (chiefhid > 0) {
          const chiefhero = await this.one(
            sql<Row>`select * from sys_city_hero where hid = ${chiefhid}`,
          );
          if (
            chiefhero &&
            phpNum(chiefhero.npcid) > 0 &&
            phpNum(chiefhero.npcid) === phpNum(chiefhero.uid)
          ) {
            let alldelete = true;
            const deleteheros = await this.rows(sql<Row>`select * from sys_city_hero
              where uid = ${chiefhero.uid} and herotype = 100`);
            for (const dh of deleteheros) {
              const deletehid = phpIntval(dh.hid);
              if (
                !(await this.check(sql<Row>`select * from sys_troops where hid = ${deletehid}`))
              ) {
                await sql`delete from sys_city_hero where hid = ${deletehid}`.execute(this.db);
              } else alldelete = false;
            }
            if (!alldelete) throw GameError.lang('StartTroop.has_temporary_hero', chiefhero.name);
            const followingCnt = phpNum(
              await this.cell(sql<Row>`select count(*) as c
              from sys_city_hero where uid = ${chiefhero.uid} and herotype <> 100`),
            );
            if (followingCnt > 1) {
              throw GameError.lang('StartTroop.has_following', chiefhero.name, followingCnt - 1);
            }
          }
        }
      }
    }

    const mystate = phpIntval(myUserInfo.state);
    let isOut = 0;
    if (
      await this.check(
        sql<Row>`select 1 as x from mem_world where province >= 14 and wid = ${targetwid}`,
      )
    ) {
      isOut = 1;
    }

    // 向他人城池进发时的新手 / 免战 / 休假校验。
    if (worldType === 0 && targetuid !== uid) {
      if (task > 1) {
        if (mystate === 1) throw GameError.lang('StartTroop.still_in_protection');
        if (isSili === 0 && isOut === 0 && mystate === 2)
          throw GameError.lang('StartTroop.in_peace_condition');
        const targetstate = phpIntval(targetUserInfo.state);
        if (targetstate === 1) throw GameError.lang('StartTroop.target_in_protection');
        if (
          serverType === 1 &&
          isSili === 0 &&
          isOut === 0 &&
          canProtected &&
          targetstate === 2 &&
          targetcitytype >= 0 &&
          targetcitytype <= 5
        ) {
          throw GameError.lang('StartTroop.target_in_peace');
        }
        if (
          isSili === 0 &&
          canProtected &&
          isOut === 0 &&
          targetstate === 2 &&
          targetcitytype === 0
        ) {
          throw GameError.lang('StartTroop.target_in_peace');
        }
        const vacend = await this.cell(
          sql<Row>`select vacend from sys_user_state where uid = ${uid}`,
        );
        if (!phpEmpty(vacend)) throw GameError.lang('book.vacation_cannot_sendtroop');
      }
    }

    if (task === 0) {
      if (!(targetIsUnion && worldType === 0))
        throw GameError.lang('StartTroop.only_transport_to_friendly');
      if (targetuid !== uid && (mystate === 2 || mystate === 1)) {
        throw GameError.lang('StartTroop.transport_in_peace_or_protection');
      }
    } else if (task === 1) {
      if (!targetIsUnion) throw GameError.lang('StartTroop.only_send_to_friendly');
      if (targetuid !== uid) {
        if (mystate === 2 || mystate === 1)
          throw GameError.lang('StartTroop.send_in_peace_or_protection');
        const allowUnionTroop = await this.cell(sql<Row>`select \`allow\`
          from sys_allow_union_troop where uid = ${targetuid}`);
        if (phpEmpty(allowUnionTroop)) throw GameError.lang('StartTroop.not_allow_union_troop');
        const targetstate = phpIntval(targetUserInfo.state);
        if (targetstate === 1) throw GameError.lang('StartTroop.target_in_protection');
        if (targetstate === 2 && targetcitytype === 0 && isOut === 0)
          throw GameError.lang('StartTroop.target_in_peace');
      }
    } else {
      if (targetIsUnion) throw GameError.lang('StartTroop.only_towards_enemy', taskname[task]);
    }

    // ───────── 军队构成与数量/载重/耗粮 ─────────
    const citySoldiers = new Map<number, Row>();
    for (const r of await this.rows(sql<Row>`select * from sys_city_soldier where cid = ${cid}`)) {
      citySoldiers.set(phpIntval(r.sid), r);
    }
    const soldierParts = soldiers.split(',');
    const numSoldiers = phpIntval(soldierParts.shift());
    if (numSoldiers > 12) throw GameError.lang('StartTroop.too_many_sid');

    // 派遣到野地的兵种数限制（与野地现有兵种合计不超过 12 种）。
    if (task === 1 && worldType !== 0) {
      const allTypes = new Set<number>();
      const fieldTroops = await this.rows(sql<Row>`select soldiers from sys_troops
        where targetcid = ${targetcid} and state in (0, 2, 4)`);
      for (const ft of fieldTroops) {
        const arr = phpString(ft.soldiers).split(',');
        const n = phpIntval(arr.shift());
        for (let i = 0; i < n; i++) {
          const sid = phpIntval(arr.shift());
          arr.shift();
          allTypes.add(sid);
        }
      }
      let dispatchBlocked = false;
      if (allTypes.size > 12) {
        const tmp = [...soldierParts];
        for (let i = 0; i < numSoldiers; i++) {
          const sid = phpIntval(tmp.shift());
          tmp.shift();
          if (!allTypes.has(sid)) dispatchBlocked = true;
        }
      } else {
        const combined = new Set(allTypes);
        const tmp = [...soldierParts];
        for (let i = 0; i < numSoldiers; i++) {
          const sid = phpIntval(tmp.shift());
          tmp.shift();
          combined.add(sid);
        }
        if (combined.size > 12) dispatchBlocked = true;
      }
      if (dispatchBlocked) {
        let tmpStr = '';
        for (const t of allTypes) {
          tmpStr +=
            ',' +
            phpString(await this.cell(sql<Row>`select name from cfg_soldier where sid = ${t}`));
        }
        throw GameError.lang('StartTroop.too_many_soldier_type', tmpStr);
      }
    }

    const takeSoldiers = new Map<number, number>();
    let soldierAllCount = 0;
    let cihouCount = 0;
    {
      const arr = [...soldierParts];
      for (let i = 0; i < numSoldiers; i++) {
        const sid = phpIntval(arr.shift());
        let cnt = phpNum(arr.shift());
        if (cnt < 0) cnt = 0;
        takeSoldiers.set(sid, cnt);
        if (phpNum(citySoldiers.get(sid)?.count) < cnt)
          throw GameError.lang('StartTroop.no_so_many_army');
        soldierAllCount += cnt;
        if (sid === 3) cihouCount += cnt;
      }
    }
    if (soldierAllCount <= 0) throw GameError.lang('StartTroop.no_soldier');
    if (task === 2 && cihouCount <= 0) throw GameError.lang('StartTroop.army_with_spy');
    if (task > 2 && cihouCount >= soldierAllCount)
      throw GameError.lang('StartTroop.spy_cant_alone');

    // 出征人数上限（校场等级 + 军旗 + 名城加成）。
    let groundLevelLimit = groundLevel * 10000 * GAME_SPEED_RATE;
    let limitadd = 0;
    if (!phpEmpty(usegoods)) limitadd += 25;
    const myCityInfo =
      (await this.one(sql<Row>`select * from sys_city where cid = ${cid}`)) || ({} as Row);
    const myType = phpIntval(myCityInfo.type);
    if (myType === 0) {
      if ((await this.specialSoldierId(cid)) > 0) limitadd += 25;
    } else {
      if (myType === 1) limitadd += 25;
      else if (myType === 2) limitadd += 50;
      else if (myType === 3) limitadd += 75;
      else if (myType === 4) limitadd += 100;
    }
    if (limitadd > 0) groundLevelLimit = Math.ceil((groundLevelLimit * (100 + limitadd)) / 100);
    if (soldierAllCount > groundLevelLimit) {
      throw GameError.lang('StartTroop.no_enough_ground_level', groundLevelLimit);
    }

    // ───────── 行军时间 ─────────
    const techLevel = async (tid: number) =>
      phpIntval(
        await this.cell(
          sql<Row>`select level from sys_city_technic where cid = ${cid} and tid = ${tid}`,
        ),
      );
    const speedAddRate1 = 1 + (await techLevel(12)) * 0.1;
    const speedAddRate2 = 1 + (await techLevel(13)) * 0.05;
    let speedAddRate3 = 1;
    const speedAddRate4 = (await techLevel(26)) * 0.05;
    if (hid !== 0 && heroInfo) speedAddRate3 = 1 + phpNum(heroInfo.speed_add_on) * 0.01;

    const currentX = cid % 1000;
    const currentY = Math.floor(cid / 1000);
    const targetX = targetcid % 1000;
    const targetY = Math.floor(targetcid / 1000);
    const pathLength = Math.sqrt((targetX - currentX) ** 2 + (targetY - currentY) ** 2);

    const soldierConfig = await this.rows(
      sql<Row>`select * from cfg_soldier where fromcity = 1 order by sid`,
    );
    const heroAttr = async (attid: number) =>
      this.one(sql<Row>`select * from sys_hero_attribute where hid = ${hid} and attid = ${attid}`);

    let minSpeed = 999999999;
    for (const soldier of soldierConfig) {
      const sid = phpIntval(soldier.sid);
      let speedAdd = 0;
      if (hid > 0 && ((sid >= 1 && sid <= 12) || (sid >= 45 && sid <= 50))) {
        const attr = await heroAttr(2000 + (sid - 1) * 100 + 11);
        if (attr) speedAdd = phpNum(attr.value);
      }
      if (!phpEmpty(takeSoldiers.get(sid))) {
        const base = phpNum(soldier.speed);
        if (sid < 7 && sid !== 3) {
          minSpeed = Math.min(base * speedAddRate1 * speedAddRate3 + speedAdd, minSpeed);
        } else if (sid === 8 || sid === 7) {
          minSpeed = Math.min(base * speedAddRate2 * speedAddRate3 + speedAdd, minSpeed);
        } else if (sid >= 10 || sid <= 12) {
          minSpeed = Math.min(
            base * speedAddRate2 * speedAddRate3 + base * speedAddRate4 + speedAdd,
            minSpeed,
          );
        }
      }
    }
    if (targetIsUnion) {
      const dakRate = await this.cell(sql<Row>`select (1.0 + level * 0.5) as r from sys_building
        where cid = ${cid} and bid = ${ID_BUILDING_DAK}`);
      if (!phpEmpty(dakRate)) minSpeed *= phpNum(dakRate);
    }

    let pathNeedTime = (pathLength * GRID_DISTANCE) / minSpeed;
    if (task !== 0) {
      const maxTime = await this.extern.getTroopMaxTime2(targetX, targetY);
      if (maxTime && maxTime < pathNeedTime) pathNeedTime = maxTime;
    }
    if (secondAdd < 0) secondAdd = 0;
    pathNeedTime += secondAdd;
    if (await this.beaconAdd(cid, targetcid)) pathNeedTime *= 0.5;
    pathNeedTime = Math.trunc(Math.floor(pathNeedTime));

    // ───────── 载重 / 耗粮 ─────────
    let carryTechLevel = phpNum(await techLevel(11));
    if (carryTechLevel < 0) carryTechLevel = 0;
    const carryTechAdd = 1 + carryTechLevel * 0.1;
    let carryHeroAdd = 0;
    let carryPercentAdd = 0;
    if (hid > 0) {
      const a = await heroAttr(12);
      if (a) carryHeroAdd = phpNum(a.value);
      const b = await heroAttr(10012);
      if (b) carryPercentAdd = phpNum(b.value);
    }

    let foodUse = 0;
    let allpeople = 0;
    let allcarry = 0;
    for (const soldier of soldierConfig) {
      const sid = phpIntval(soldier.sid);
      let carryAdd = 0;
      if (hid > 0 && ((sid >= 1 && sid <= 12) || (sid >= 45 && sid <= 50))) {
        const attr = await heroAttr(2000 + (sid - 1) * 100 + 12);
        if (attr) carryAdd = phpNum(attr.value);
      }
      const take = phpNum(takeSoldiers.get(sid));
      if (!phpEmpty(takeSoldiers.get(sid))) {
        foodUse += phpNum(soldier.food_use) * take;
        allpeople += phpNum(soldier.people_need) * take;
        allcarry +=
          (phpNum(soldier.carry) * (carryTechAdd + carryPercentAdd * 0.01) +
            carryAdd +
            carryHeroAdd) *
          take;
      }
    }
    const hourfooduse = foodUse * 2;
    foodUse *= 2 * pathNeedTime;
    foodUse = Math.floor(foodUse / 3600);

    const cityresource =
      (await this.one(sql<Row>`select * from mem_city_resource where cid = ${cid}`)) || ({} as Row);
    if (phpNum(cityresource.food) < foodUse) throw GameError.lang('StartTroop.no_enough_food');

    const res = resource.split(',');
    const gold = phpNum(res[0]);
    const food = phpNum(res[1]);
    const wood = phpNum(res[2]);
    const rock = phpNum(res[3]);
    const iron = phpNum(res[4]);
    if (gold < 0 || food < 0 || wood < 0 || rock < 0 || iron < 0) {
      throw GameError.lang('StartTroop.cant_carry_negative');
    }
    if (
      phpNum(cityresource.gold) < gold ||
      phpNum(cityresource.food) < food + foodUse ||
      phpNum(cityresource.wood) < wood ||
      phpNum(cityresource.rock) < rock ||
      phpNum(cityresource.iron) < iron
    ) {
      throw GameError.lang('StartTroop.no_enough_resource');
    }
    if (allcarry + 10 < gold + food + wood + rock + iron + foodUse) {
      throw GameError.lang('StartTroop.army_carry_limit');
    }

    // ───────── 执行：扣兵扣粮、将领出征、写 sys_troops ─────────
    if (hid !== 0) {
      if (
        !(await this.check(
          sql<Row>`select hid from sys_city_hero where state = 0 and hid = ${hid}`,
        ))
      ) {
        throw GameError.lang('StartTroop.hero_is_busy');
      }
      await sql`update sys_city_hero set state = 2 where hid = ${hid}`.execute(this.db);
      const forceReduce = forceNeed[task]!;
      await sql`update mem_hero_blood set \`force\` = GREATEST(0, \`force\` - ${forceReduce})
        where hid = ${hid}`.execute(this.db);
    }
    await this.cityRules.addCityResources(cid, -wood, -rock, -iron, -foodUse - food, -gold);
    await this.cityRules.addCitySoldiers(cid, takeSoldiers, false);

    const troopid = Number(
      (
        await sql<Row>`insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
          values (${uid}, ${cid}, ${hid}, ${targetcid}, ${task}, 0, unix_timestamp(), ${pathNeedTime},
            unix_timestamp() + ${pathNeedTime}, ${soldiers}, ${resource}, ${allpeople}, ${hourfooduse})`.execute(
          this.db,
        )
      ).insertId,
    );

    // 玩家当前战术复制到本支军队。
    const tactics = await this.one(sql<Row>`select * from sys_user_tactics where uid = ${uid}`);
    if (tactics) {
      await sql`replace into sys_troop_tactics (troopid, plunder, invade, patrol, field)
        values (${troopid}, ${tactics.plunder}, ${tactics.invade}, ${tactics.patrol}, ${tactics.field})`.execute(
        this.db,
      );
    }

    // 对方 烽火台 警报。
    if (worldType === WT_CITY) {
      const targetbalefireLevel = phpNum(
        await this.cell(sql<Row>`select level from sys_building
          where cid = ${targetcid} and bid = ${ID_BUILDING_BALEFIRE} limit 1`),
      );
      if (targetbalefireLevel > 0) {
        const tUid = phpNum(
          await this.cell(sql<Row>`select uid from sys_city where cid = ${targetcid}`),
        );
        if (targetbalefireLevel < 5) {
          if (tUid !== uid && tUid > 0) await this.raiseEnemyAlarm(tUid);
        } else {
          const filtercount = await this.enemyFilter(targetcid, task);
          if (phpEmpty(filtercount) || soldierAllCount > phpNum(filtercount)) {
            if (tUid !== uid && tUid > 0) await this.raiseEnemyAlarm(tUid);
          }
        }
      }
    } else if (phpNum(worldinfo.ownercid) > 0) {
      const targetbalefireLevel = phpNum(
        await this.cell(sql<Row>`select level from sys_building
          where cid = ${worldinfo.ownercid} and bid = ${ID_BUILDING_BALEFIRE} limit 1`),
      );
      if (targetbalefireLevel > 0 && targetuid !== uid && targetuid > 0) {
        await this.raiseEnemyAlarm(targetuid);
      }
    }

    if (usegoods) {
      await this.goods.reduceGoods(uid, FLAG_GID, 1);
      await this.tasks.completeTaskWithTaskid(uid, 303);
    }

    // 活动野地占领记录。
    if (worldType !== WT_CITY && task === 4) {
      const combat = await this.one(sql<Row>`select * from fc_combat
        where starttime <= unix_timestamp() and unix_timestamp() < endtime and open = 1 and havefield = 1 limit 1`);
      if (combat) {
        const fieldinfo = await this.one(sql<Row>`select * from fc_fields
          where combatid = ${combat.id} and wid = ${targetwid}`);
        if (fieldinfo) {
          await sql`insert into fc_log (time, combatid, wid, uid, cid)
            values (unix_timestamp(), ${combat.id}, ${targetwid}, ${uid}, ${cid})`.execute(this.db);
        }
      }
    }

    throw GameError.lang('StartTroop.succ');
  }

  /** utils.php::`insert sys_alarm ... on duplicate key update enemy=1`. */
  private async raiseEnemyAlarm(uid: number): Promise<void> {
    await sql`insert into sys_alarm (uid, enemy) values (${uid}, 1)
      on duplicate key update enemy = 1`.execute(this.db);
  }

  /** GroundFunc.php::getEnemyFilter: the set count for one task on a city's 敌军过滤. */
  private async enemyFilter(cid: number, taskid: number): Promise<unknown> {
    return this.cell(sql<Row>`select \`count\` from sys_enemy_troop_filter
      where cid = ${cid} and action = ${taskid}`);
  }

  /** GroundFunc.php::getBeaconAdd: 烽火台 halves march time within range of a 玩家主城 (type 5). */
  private async beaconAdd(cid: number, targetcid: number): Promise<boolean> {
    const cityType = await this.cell(sql<Row>`select type from sys_city where cid = ${cid}`);
    if (phpNum(cityType) !== 5) return false;
    const beaconLevel = phpNum(
      await this.cell(
        sql<Row>`select max(level) as l from sys_building where bid = 19 and cid = ${cid}`,
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

  /** GroundFunc.php::doUserUnionHasXianDiZhaoShuBuffer. */
  private async userUnionHasXianDiZhaoShu(uid: number): Promise<boolean> {
    const unionid = await this.cell(sql<Row>`select union_id from sys_user where uid = ${uid}`);
    const creator = await this.cell(sql<Row>`select leader from sys_union where id = ${unionid}`);
    if (!creator) return false;
    const remain = await this.cell(sql<Row>`select endtime - unix_timestamp() as r
      from mem_user_buffer where uid = ${creator} and buftype = 161501 and endtime > unix_timestamp()`);
    return !phpEmpty(remain);
  }

  /** GroundFunc.php::checkOutOpen: 蛮夷之地 (province 14/15/17/18) open gate. */
  private async checkOutOpen(targetcid: number): Promise<void> {
    const wid = cid2wid(targetcid);
    const tcid = await this.cell(sql<Row>`select ownercid from mem_world where wid = ${wid}`);
    let cid = targetcid;
    if (!phpEmpty(tcid)) cid = phpIntval(tcid);
    const ownerUid = await this.cell(sql<Row>`select uid from sys_city where cid = ${cid}`);
    if (!phpEmpty(ownerUid) && phpNum(ownerUid) > 1000) return;
    const province = await this.cell(
      sql<Row>`select province from mem_world where wid = ${cid2wid(cid)}`,
    );
    if (phpEmpty(province)) throw GameError.lang('out.targetcity_not_exists');
    const p = phpIntval(province);
    const value = phpIntval(
      await this.cell(sql<Row>`select value from mem_state where state = 111`),
    );
    const blocked =
      (value === 1 && (p === 14 || p === 15 || p === 17 || p === 18)) ||
      (value === 2 && (p === 14 || p === 15 || p === 18)) ||
      (value === 3 && (p === 14 || p === 15)) ||
      (value === 4 && p === 14);
    if (blocked) throw GameError.lang('out.not_open');
  }

  /** GroundFunc.php::checkMianZhanCondition: 免战 gate for attacks on other players' main cities. */
  private async checkMianZhanCondition(
    uid: number,
    cid: number,
    targetcid: number,
    task: number,
    serverType: number,
  ): Promise<void> {
    const targetWid = cid2wid(targetcid);
    const targetMemWorld = await this.one(
      sql<Row>`select * from mem_world where wid = ${targetWid}`,
    );
    if (!targetMemWorld) throw GameError.lang('StartTroop.some_thing_wrong');
    if (phpIntval(targetMemWorld.type) !== 0) return;

    const targetCityInfo = await this.one(
      sql<Row>`select * from sys_city where cid = ${targetcid}`,
    );
    if (!targetCityInfo) throw GameError.lang('waigua.invalid');
    if (cid === phpIntval(targetCityInfo.cid))
      throw GameError.lang('StartTroop.target_cant_be_current');
    const targetCityProvince = phpIntval(targetCityInfo.province);
    if (targetCityProvince > 13) return;
    const malaiType = await this.cell(sql<Row>`select value from mem_state where state = 198`);
    if (phpIntval(malaiType) === 1 && targetCityProvince === 1) return;

    if (phpIntval(targetCityInfo.uid) > 1000 && phpIntval(targetCityInfo.uid) !== uid) {
      if (task >= 2 && task <= 4) {
        const tct = phpIntval(targetCityInfo.type);
        if (tct > 0 && tct < 5) return;
        if ((await this.specialSoldierId(targetcid)) > 0 && serverType !== 1) return;
        const isMianZhan = await this.cell(sql<Row>`select 1 as x from mem_user_buffer
          where uid = ${targetCityInfo.uid} and buftype = '7' and endtime > unix_timestamp()`);
        if (!phpEmpty(isMianZhan)) throw GameError.lang('StartTroop.target_in_peace');
      }
    }
  }

  // ───────────────────────────── 阵型方案 ─────────────────────────────

  /** GroundFunc.php::getTroopScheme: read the saved 出征方案 of type 1 or 2. */
  @DialogCommand()
  async getTroopScheme(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const type = phpIntval(param[0]);
    if (type < 1 || type > 2) throw GameError.lang('waigua.invalid');
    const scheme = await this.one(
      sql<Row>`select * from sys_user_troopScheme where uid = ${ctx.uid} and type = ${type}`,
    );
    return scheme ? [scheme] : [];
  }

  /** GroundFunc.php::setTroopScheme: save the 出征方案 of type 1 or 2. */
  @DialogCommand()
  async setTroopScheme(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const type = phpIntval(param[0]);
    const soldiers = phpString(param[1]);
    if (type < 1 || type > 2 || soldiers.length === 0) throw GameError.lang('waigua.invalid');
    const existing = await this.one(
      sql<Row>`select * from sys_user_troopScheme where uid = ${ctx.uid} and type = ${type}`,
    );
    if (!existing) {
      await sql`insert into sys_user_troopScheme (uid, type, soldiers)
        values (${ctx.uid}, ${type}, ${soldiers})`.execute(this.db);
      return [this.lang.t('ground.scheme_set_succ')];
    }
    await sql`update sys_user_troopScheme set soldiers = ${soldiers}
      where uid = ${ctx.uid} and type = ${type}`.execute(this.db);
    return [this.lang.t('ground.scheme_update_succ')];
  }
}
