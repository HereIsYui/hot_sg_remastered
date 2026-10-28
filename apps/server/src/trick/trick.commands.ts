import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { ReportService } from '../core/report.service';
import { TaskRules } from '../core/task-rules.service';
import { makeTimeLeft, UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { HeroExprCommands } from '../hero/hero-expr.commands';
import { TroopCommands } from '../world/troop.commands';

type Row = Record<string, unknown>;

/** TrickFunc.php:7 sys_report title of the 计谋 alarm the target receives. */
const TITLE_TRICK = 23;
/** TrickFunc.php:8 sys_report title of the own 顺藤摸瓜 city list. */
const TITLE_SHUNTENGMOGUA = 30;
/** TrickFunc.php:431 sys_report title of the own 蛛丝马迹 troop table. */
const TITLE_ZHUSIMAJI = 32;
/** TrickFunc.php:943 every useTrick ends with completeTask(88). */
const TASK_TRICK_USED = 88;
/** The 计谋 goal sort the per-trick completeTaskGoalBySortandType calls drive. */
const TASK_SORT_TRICK = 53;
/** gid of the 锦囊 the tricks consume. */
const GOODS_JINNANG = 13;
/** mem_hero_buffer buftype of 智多星符 (wisdom × 1.25). */
const BUFFER_ZHIDUOXING = 4;

/** HeroFunc.php::isHeroInCity: free, city chief, general or adviser. */
function isHeroInCity(state: unknown): boolean {
  return [0, 1, 7, 8].some((s) => phpLooseEquals(state, s));
}

/**
 * TrickFunc.php: the 计谋 (trick) system — getTrickList, useTrick (one command dispatching all 24
 * cfg_trick rows through the trick* functions) and BufferFunc.php::getTrickBuffer (the trick
 * buffer panel of a city).
 *
 * Faithful quirks kept:
 * - the `throw Exception(...)` without `new` (e.g. TrickFunc.php:23) is a PHP fatal error on the
 *   legacy side; the paths are unreachable because useTrick's own prevalidation
 *   (target_is_mine / union / vacation / forbiend) fires first — the port throws the intended
 *   message and says so where it happens;
 * - TrickFunc.php:859 re-seeds the MT with time() after the 城守 wisdom roll, so every later roll
 *   is unfixed on the legacy side; the port keeps its single RandomService source;
 * - trick 9 (不宣而战) is commented out of the switch but its 6h cooldown check remains — dead,
 *   because cfg_trick has no row 9 and the trick_not_exist check fires first;
 * - 千里奔袭 (13) wraps its whole effect in `if ($troop['hid'] > 0)` — without a hero the 锦囊
 *   and energy are still spent for nothing;
 * - the chief-wisdom roll passes the ATTACKER's hid to isHeroHasBuffer, so the attacker's own
 *   智多星符 raises the defender's rolled wisdom (TrickFunc.php:843, copy-paste quirk);
 * - 釜底抽薪 (25) calls callBackTroop / cancelHeroExpr for the TARGET's owner (extracted as
 *   TroopCommands.recallTroop / HeroExprCommands.cancelExpr).
 */
@Injectable()
export class TrickCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cityRules: CityRules,
    private readonly goods: GoodsRules,
    private readonly tasks: TaskRules,
    private readonly report: ReportService,
    private readonly random: RandomService,
    private readonly users: UserRules,
    private readonly troops: TroopCommands,
    private readonly heroExpr: HeroExprCommands,
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

  /** utils.php::MakeEndTime: a wall-clock string via the DB clock. */
  private async makeEndTime(endtime: number): Promise<string> {
    const fmt = `%Y${this.lang.t('MakeEndTime.year')}%m${this.lang.t('MakeEndTime.month')}%d${this.lang.t('MakeEndTime.day')} %H:%i:%s`;
    const v = await this.cell(sql<Row>`select from_unixtime(${endtime}, ${fmt}) as t`);
    return phpString(v);
  }

  /** utils.php::getCityNamePosition: "城名(x,y)"; a missing name renders just "(x,y)". */
  private async cityNamePosition(cid: number): Promise<string> {
    const name = await this.cell(sql<Row>`select name from sys_city where cid = ${cid}`);
    return `${phpString(name)}(${cid % 1000},${Math.floor(cid / 1000)})`;
  }

  /** utils.php::isHeroHasBuffer — the original ignores the buffer's endtime. */
  private async isHeroHasBuffer(hid: number, buftype: number): Promise<boolean> {
    return this.check(
      sql<Row>`select * from mem_hero_buffer where hid = ${hid} and buftype = ${buftype}`,
    );
  }

  // ───────────────────────────── 命令 ─────────────────────────────

  /** TrickFunc.php::getTrickList: `[cfg_trick rows, own 锦囊 count]`. */
  @GlobalCommand()
  async getTrickList(ctx: CommandContext): Promise<unknown[]> {
    const ret: unknown[] = [];
    ret.push(await this.rows(sql<Row>`select * from cfg_trick order by id`));
    ret.push(
      await this.cell(
        sql<Row>`select sum(count) as c from sys_goods where uid = ${ctx.uid} and gid = ${GOODS_JINNANG}`,
      ),
    );
    return ret;
  }

  /** BufferFunc.php::getTrickBuffer: `[now, the city's live mem_city_buffer rows]`. */
  @GlobalCommand()
  async getTrickBuffer(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const cid = phpIntval(param.shift());
    const userid = await this.cell(sql<Row>`select uid from sys_city where cid = ${cid}`);
    if (!phpLooseEquals(ctx.uid, userid)) throw GameError.lang('getCityBuffer.not_your_city');
    const nowtime = await this.cell(sql<Row>`select unix_timestamp() as t`);
    const bufs = await this.rows(sql<Row>`select * from mem_city_buffer
      where cid = ${cid} and endtime > ${nowtime}`);
    return [nowtime, bufs];
  }

  /**
   * TrickFunc.php::useTrick: `[hid, trickid, tricktype, target]`. The original only intval()s the
   * first two and feeds tricktype/tricktarget into its SQL raw (MySQL coerces numerically);
   * intval() at the boundary is equivalent for every client input, null included.
   */
  @GlobalCommand()
  async useTrick(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const hid = phpIntval(param.shift());
    const trickid = phpIntval(param.shift());
    const tricktype = phpIntval(param.shift());
    const tricktarget = phpIntval(param.shift());

    const trick = await this.one(sql<Row>`select * from cfg_trick where id = ${trickid}`);
    if (trick === false || !phpLooseEquals(trick.usetype, tricktype)) {
      throw GameError.lang('useTrick.trick_not_exist');
    }

    // TrickFunc.php:701 lockUser (utils.php:1099) always returned true — its server_busy branch
    // is unreachable; the gateway's per-user KeyedMutex replaces the file lock.
    const jinnang = phpNum(
      await this.cell(
        sql<Row>`select sum(count) as c from sys_goods where uid = ${uid} and gid = ${GOODS_JINNANG}`,
      ),
    );
    if (jinnang < phpNum(trick.cost)) {
      // 原样字符串错误：客户端弹出 not_enough_goods13#N 的买即用弹窗。
      throw GameError.raw(`not_enough_goods${GOODS_JINNANG}#${phpNum(trick.cost) - jinnang}`);
    }

    const hero = await this.one(sql<Row>`select * from sys_city_hero where hid = ${hid}`);
    if (hero === false) throw GameError.lang('useTrick.hero_not_exist');
    if (trickid !== 13 && !isHeroInCity(hero.state) && tricktype !== 2) {
      throw GameError.lang('useTrick.hero_not_incity');
    }

    let wisdom = phpNum(hero.wisdom_base) + phpNum(hero.wisdom_add);
    if (await this.isHeroHasBuffer(hid, BUFFER_ZHIDUOXING)) wisdom *= 1.25;
    wisdom += phpNum(hero.wisdom_add_on);

    let targetcid = 0;
    let troop: Row | false = false;
    if (tricktype === 0) {
      targetcid = phpIntval(
        await this.cell(sql<Row>`select lastcid from sys_user where uid = ${uid}`),
      );
    } else if (tricktype === 1) {
      targetcid = tricktarget;
      const targetuser = await this.one(sql<Row>`select * from sys_user
        where uid = (select uid from sys_city where cid = ${targetcid})`);
      const targetuid = phpNum(targetuser !== false ? targetuser.uid : null);
      if (phpLooseEquals(targetuid, uid)) throw GameError.lang('useTrick.target_is_mine');
      const myunion = await this.cell(sql<Row>`select union_id from sys_user where uid = ${uid}`);
      if (
        phpLooseEquals(targetuser !== false ? targetuser.union_id : null, myunion) &&
        phpNum(myunion) > 0
      ) {
        throw GameError.lang('useTrick.target_is_union');
      }
      if (
        await this.check(sql<Row>`select vacend from sys_user_state
          where uid = ${targetuid} and vacend > unix_timestamp()`)
      ) {
        throw GameError.lang('useTrick.target_in_vacation');
      }
      if (
        await this.check(sql<Row>`select forbiend from sys_user_state
          where uid = ${targetuid} and forbiend > unix_timestamp()`)
      ) {
        throw GameError.lang('useTrick.target_be_locked');
      }
    } else if (tricktype === 2) {
      const troopid = tricktarget;
      troop = await this.one(sql<Row>`select * from sys_troops where id = ${troopid}`);
      if (troop === false || !phpLooseEquals(troop.uid, uid)) {
        throw GameError.lang('useTrick.target_is_not_my_troop');
      }
      if (phpNum(troop.hid) === 0) throw GameError.lang('useTrick.target_has_no_hero');
      if (trickid === 10) {
        if (phpNum(troop.state) > 1) throw GameError.lang('useTrick.target_is_not_on_way');
        const now = phpNum(await this.cell(sql<Row>`select unix_timestamp() as t`));
        if (now - phpNum(troop.lastrun) < 3600) {
          throw GameError.lang(
            'useTrick.target_is_just_run',
            makeTimeLeft(this.lang, 3600 - now + phpNum(troop.lastrun)),
          );
        }
      } else if (trickid === 26) {
        if (phpNum(troop.state) !== 0) throw GameError.lang('useTrick.target_is_not_on_way');
      }
    } else if (tricktype === 3) {
      const troopid = tricktarget;
      troop = await this.one(sql<Row>`select * from sys_troops where id = ${troopid}`);
      if (troop === false || phpNum(troop.state) !== 0) {
        if (trickid === 11) throw GameError.lang('useTrick.target_not_coming_1');
        else if (trickid === 12) throw GameError.lang('useTrick.target_not_coming_2');
      }
    }

    // 不宣而战 (9) 保留 6h 冷却检查，但 cfg_trick 没有第 9 行，上面 trick_not_exist 已挡住，
    // 这里是死分支；switch 里对应 case 也被原版注释掉（TrickFunc.php:887-889）。
    if (trickid === 9) {
      const targetuid = phpNum(
        await this.cell(sql<Row>`select uid from sys_city where cid = ${targetcid}`),
      );
      const now = phpNum(await this.cell(sql<Row>`select unix_timestamp() as t`));
      const lastTrickWar = await this.cell(
        sql<Row>`select last_trick_war from mem_user_schedule where uid = ${targetuid}`,
      );
      if (now - phpNum(lastTrickWar) < 21600) {
        throw GameError.lang('trickBuXuanErZhan.cool_down');
      }
    } else if (trickid === 10) {
      // 金蝉脱壳冷却（同一条规则在 tricktype 2 前置校验里已查过一次，原版查了两遍）。
      const now = phpNum(await this.cell(sql<Row>`select unix_timestamp() as t`));
      if (now - phpNum(troop !== false ? troop.lastrun : null) < 3600) {
        throw GameError.lang('trickJinChaoTuoQiao.cool_down');
      }
    } else if (trickid === 13) {
      // 千里奔袭冷却。
      const now = phpNum(await this.cell(sql<Row>`select unix_timestamp() as t`));
      if (now - phpNum(troop !== false ? troop.lastacc : null) < 3600) {
        throw GameError.lang('trickQianLiBenXi.cool_down');
      }
    } else if (trickid === 5) {
      // 暗度陈仓，需要目标城市已经中了十面埋伏。
      const shimian = await this.one(sql<Row>`select * from mem_city_buffer
        where cid = ${targetcid} and buftype = 8 and endtime > unix_timestamp()`);
      if (phpEmpty(shimian)) throw GameError.lang('trickAnDuChenChang.fail_not_shimianmanfu');
    }

    const curEnergy = await this.cell(
      sql<Row>`select energy from mem_hero_blood where hid = ${hid}`,
    );
    if (phpNum(curEnergy) < phpNum(trick!.cost)) {
      throw GameError.lang('useTrick.hero_no_energy');
    }
    await sql`update mem_hero_blood set \`energy\` = GREATEST(0, \`energy\` - ${phpNum(trick!.cost)})
      where hid = ${hid}`.execute(this.db);
    // 先把锦囊扣掉
    await this.goods.addGoods(uid, GOODS_JINNANG, -phpNum(trick!.cost), 0);

    let trickmsg = '';
    let cantrick = true;
    if (tricktype === 1) {
      if (trickid !== 7) {
        // 挑拨离间不跟城守比，而是跟其中一个将领比。
        const cityhids = await this.one(sql<Row>`select chiefhid, generalid, counsellorid
          from sys_city where cid = ${targetcid}`);
        let chiefhid = 0;
        if (cityhids !== false) {
          if (phpNum(cityhids.counsellorid) > 0) chiefhid = phpIntval(cityhids.counsellorid);
          else if (phpNum(cityhids.chiefhid) > 0) chiefhid = phpIntval(cityhids.chiefhid);
          else if (phpNum(cityhids.generalid) > 0) chiefhid = phpIntval(cityhids.generalid);
        }
        const chiefhero = await this.one(
          sql<Row>`select * from sys_city_hero where hid = ${chiefhid}`,
        );
        if (chiefhero !== false) {
          let chiefWisdom = phpNum(chiefhero.wisdom_base) + phpNum(chiefhero.wisdom_add);
          // 原版这里查的是进攻方的 hid：我方的智多星符反而抬高对方城守的智谋（:843）。
          if (await this.isHeroHasBuffer(hid, BUFFER_ZHIDUOXING)) chiefWisdom *= 1.25;
          chiefWisdom += phpNum(chiefhero.wisdom_add_on);
          // mt_rand 的参数按 PHP 语义取整。
          if (this.random.mtRand(1, phpIntval(chiefWisdom)) > wisdom) {
            trickmsg = this.lang.t('useTrick.fail_no_wisdom');
            cantrick = false;
          }
        }
      }
    }

    if (cantrick) {
      // TrickFunc.php:859 在此处 mt_srand(time()) 重播种——原版侧此后的 roll 无法用 s.rng/s.seed
      // 固定；重制版只有一个随机源，所有 roll 继续走 RandomService。
      switch (trickid) {
        case 1:
          trickmsg = await this.trickCaoMuJieBin(uid, targetcid, wisdom);
          break;
        case 2:
          trickmsg = await this.trickKongCheng(uid, targetcid, wisdom);
          break;
        case 3:
          trickmsg = await this.trickPaoZhuangYingYu(uid, targetcid, wisdom);
          break;
        case 4:
          trickmsg = await this.trickJinBiQingYe(uid, targetcid, wisdom);
          break;
        case 5:
          trickmsg = await this.trickAnDuChenChang(uid, targetcid, wisdom);
          break;
        case 6:
          trickmsg = await this.trickYaoYinHuoZhong(uid, targetcid, wisdom);
          break;
        case 7:
          trickmsg = await this.trickTiaoBoLiJian(uid, targetcid, wisdom);
          break;
        case 8:
          trickmsg = await this.trickShiMianMaiFu(uid, targetcid, wisdom);
          break;
        // case 9 不宣而战：原版注释掉，函数体缺失。
        case 10:
          trickmsg = await this.trickJinChaoTuoQiao(uid, troop as Row, wisdom);
          break;
        case 11:
          trickmsg = await this.trickBaMemJinShuo(uid, troop as Row, wisdom);
          break;
        case 12:
          trickmsg = await this.trickGuanMemDaGou(uid, troop as Row, wisdom);
          break;
        case 13:
          trickmsg = await this.trickQianLiBenXi(uid, troop as Row, wisdom);
          break;
        case 14:
          trickmsg = await this.trickShunTengMoGua(uid, targetcid);
          break;
        case 15:
          trickmsg = await this.trickChenHuoDaJie(uid, targetcid, wisdom);
          break;
        case 18:
          trickmsg = await this.trickZhuSiMaJi(uid, targetcid);
          break;
        case 19:
          trickmsg = await this.trickWeiWeiJiuZhao(uid, targetcid);
          break;
        case 20:
          trickmsg = await this.trickFenShaoLiangCao(uid, targetcid, wisdom);
          break;
        case 21:
          trickmsg = await this.trickXuZhangShengShi(uid, troop as Row, wisdom);
          break;
        case 22:
          trickmsg = await this.trickYanQiXiGu(uid, troop as Row, wisdom);
          break;
        case 23:
          trickmsg = await this.trickYouDiShenRu(uid, troop as Row, wisdom);
          break;
        case 25:
          trickmsg = await this.trickHuDiChouXin(uid, targetcid);
          break;
        case 26:
          trickmsg = await this.trickYiYiDaiLao(uid, troop as Row);
          break;
        case 27:
          trickmsg = await this.trickDiaoHuLiShan(uid, targetcid);
          break;
        case 28:
          trickmsg = await this.trickShangWuChouTi(uid, targetcid, wisdom);
          break;
        default:
          trickmsg = this.lang.t('useTrick.trick_not_exist');
      }
    }
    // unlockUser — 网关互斥锁（见上 lockUser 注释）。
    await this.tasks.completeTask(uid, TASK_TRICK_USED);
    await this.users.logUserAction(uid, trickid + 1000);
    const ret: unknown[] = [];
    ret.push(trickmsg);
    ret.push(
      await this.cell(
        sql<Row>`select sum(count) as c from sys_goods where uid = ${uid} and gid = ${GOODS_JINNANG}`,
      ),
    );
    return ret;
  }

  // ───────────────────────────── 对本城（usetype 0） ─────────────────────────────

  /** TrickFunc.php::trickCaoMuJieBin 草木皆兵: shows 5~10× the troops for wisdom*10 minutes. */
  private async trickCaoMuJieBin(uid: number, cid: number, wisdom: number): Promise<string> {
    const rate = this.random.mtRand(5, 10);
    const delay = wisdom * 600;
    const myuid = await this.cell(sql<Row>`select uid from sys_city where cid = ${cid}`);
    if (!phpLooseEquals(uid, myuid)) throw GameError.lang('waigua.forbidden'); // 原版 :23 少 new，见类注释。
    await sql`insert into mem_city_buffer (cid, buftype, bufparam, endtime)
      values (${cid}, 1, ${rate}, unix_timestamp() + ${delay})
      on duplicate key update endtime = endtime + ${delay}, bufparam = ${rate}`.execute(this.db);
    const endtime = await this.cell(sql<Row>`select endtime from mem_city_buffer
      where cid = ${cid} and buftype = 1`);
    if (!phpEmpty(myuid)) await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 1);
    return this.lang.t('trickCaoMuJieBin.succ', rate, await this.makeEndTime(phpNum(endtime)));
  }

  /** TrickFunc.php::trickKongCheng 空城计: shows 10~20% of the troops for wisdom*10 minutes. */
  private async trickKongCheng(uid: number, cid: number, wisdom: number): Promise<string> {
    const rate = this.random.mtRand(10, 20);
    const delay = wisdom * 600;
    const myuid = await this.cell(sql<Row>`select uid from sys_city where cid = ${cid}`);
    if (!phpLooseEquals(uid, myuid)) throw GameError.lang('waigua.forbidden'); // 原版 :40 少 new。
    await sql`insert into mem_city_buffer (cid, buftype, bufparam, endtime)
      values (${cid}, 2, ${rate}, unix_timestamp() + ${delay})
      on duplicate key update endtime = endtime + ${delay}, bufparam = ${rate}`.execute(this.db);
    const endtime = await this.cell(sql<Row>`select endtime from mem_city_buffer
      where cid = ${cid} and buftype = 2`);
    if (!phpEmpty(myuid)) await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 2);
    return this.lang.t('trickKongCheng.succ', rate, await this.makeEndTime(phpNum(endtime)));
  }

  /** TrickFunc.php::trickPaoZhuangYingYu 抛砖引玉: shows 5~10× the resources. */
  private async trickPaoZhuangYingYu(uid: number, cid: number, wisdom: number): Promise<string> {
    const rate = this.random.mtRand(5, 10);
    const delay = wisdom * 600;
    const myuid = await this.cell(sql<Row>`select uid from sys_city where cid = ${cid}`);
    if (!phpLooseEquals(uid, myuid)) throw GameError.lang('waigua.forbidden'); // 原版 :58 少 new。
    await sql`insert into mem_city_buffer (cid, buftype, bufparam, endtime)
      values (${cid}, 3, ${rate}, unix_timestamp() + ${delay})
      on duplicate key update endtime = endtime + ${delay}, bufparam = ${rate}`.execute(this.db);
    const endtime = await this.cell(sql<Row>`select endtime from mem_city_buffer
      where cid = ${cid} and buftype = 3`);
    if (!phpEmpty(myuid)) await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 3);
    return this.lang.t('trickPaoZhuangYingYu.succ', rate, await this.makeEndTime(phpNum(endtime)));
  }

  /** TrickFunc.php::trickJinBiQingYe 坚壁清野: shows 10~20% of the resources. */
  private async trickJinBiQingYe(uid: number, cid: number, wisdom: number): Promise<string> {
    const rate = this.random.mtRand(10, 20);
    const delay = wisdom * 600;
    const myuid = await this.cell(sql<Row>`select uid from sys_city where cid = ${cid}`);
    if (!phpLooseEquals(uid, myuid)) throw GameError.lang('waigua.forbidden'); // 原版 :77 少 new。
    await sql`insert into mem_city_buffer (cid, buftype, bufparam, endtime)
      values (${cid}, 4, ${rate}, unix_timestamp() + ${delay})
      on duplicate key update endtime = endtime + ${delay}, bufparam = ${rate}`.execute(this.db);
    const endtime = await this.cell(sql<Row>`select endtime from mem_city_buffer
      where cid = ${cid} and buftype = 4`);
    if (!phpEmpty(myuid)) await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 4);
    return this.lang.t('trickJinBiQingYe.succ', rate, await this.makeEndTime(phpNum(endtime)));
  }

  /** TrickFunc.php::trickAnDuChenChang 暗度陈仓: breaks the 十面埋伏 blockade for wisdom minutes. */
  private async trickAnDuChenChang(uid: number, cid: number, wisdom: number): Promise<string> {
    const delay = wisdom * 60;
    const myuid = await this.cell(sql<Row>`select uid from sys_city where cid = ${cid}`);
    if (!phpLooseEquals(uid, myuid)) throw GameError.lang('waigua.forbidden'); // 原版 :92 少 new。
    await sql`insert into mem_city_buffer (cid, buftype, bufparam, endtime)
      values (${cid}, 5, 0, unix_timestamp() + ${delay})
      on duplicate key update endtime = endtime + ${delay}`.execute(this.db);
    const endtime = await this.cell(sql<Row>`select endtime from mem_city_buffer
      where cid = ${cid} and buftype = 5`);
    if (!phpEmpty(myuid)) await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 5);
    return this.lang.t('trickAnDuChenChang.succ', await this.makeEndTime(phpNum(endtime)));
  }

  // ───────────────────────────── 对敌城（usetype 1） ─────────────────────────────

  /** TrickFunc.php::trickYaoYinHuoZhong 妖言惑众: cuts morale, 24h city cooldown. */
  private async trickYaoYinHuoZhong(
    uid: number,
    targetcid: number,
    wisdom: number,
  ): Promise<string> {
    const user = await this.one(sql<Row>`select name, lastcid from sys_user where uid = ${uid}`);
    const username = phpString(user !== false ? user.name : null);
    const targetcity = await this.cityNamePosition(targetcid);
    const targetuid = phpNum(
      await this.cell(sql<Row>`select uid from sys_city where cid = ${targetcid}`),
    );
    if (phpLooseEquals(uid, targetuid)) throw GameError.lang('waigua.forbidden');
    const delta = phpNum(
      await this.cell(
        sql<Row>`select unix_timestamp() - last_trick_morale as t from mem_city_schedule
        where cid = ${targetcid}`,
      ),
    );
    if (delta < 86400) {
      // 无 schedule 行时原版取到 null，同样走这条失败分支（0 < 86400）。
      await this.report.sendReport(
        targetuid,
        TITLE_TRICK,
        phpNum(user !== false ? user.lastcid : null),
        targetcid,
        this.lang.t('trickYaoYinHuoZhong.fail_caution', username, targetcity),
      );
      return this.lang.t('trickYaoYinHuoZhong.fail', targetcity);
    }
    let moraleReduce = Math.ceil(wisdom / 10.0);
    moraleReduce = Math.min(moraleReduce, 60); // 最多降低60点民心
    const citymorale = phpNum(
      await this.cell(sql<Row>`select morale from mem_city_resource where cid = ${targetcid}`),
    );
    if (citymorale < moraleReduce) moraleReduce = citymorale;
    await sql`update mem_city_resource set morale = morale - ${moraleReduce}
      where cid = ${targetcid}`.execute(this.db);
    await sql`update mem_city_resource set \`people_stable\` = \`people_max\` * morale * 0.01
      where cid = ${targetcid}`.execute(this.db);
    await sql`update mem_city_schedule set last_trick_morale = unix_timestamp()
      where cid = ${targetcid}`.execute(this.db);
    await this.report.sendReport(
      targetuid,
      TITLE_TRICK,
      phpNum(user !== false ? user.lastcid : null),
      targetcid,
      this.lang.t(
        'trickYaoYinHuoZhong.succ_caution',
        username,
        targetcity,
        targetcity,
        moraleReduce,
      ),
    );
    await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 6);
    return this.lang.t('trickYaoYinHuoZhong.succ', targetcity, moraleReduce);
  }

  /** TrickFunc.php::trickChenHuoDaJie 趁火打劫: weakens warehouse protection, 24h cooldown. */
  private async trickChenHuoDaJie(uid: number, targetcid: number, wisdom: number): Promise<string> {
    const user = await this.one(sql<Row>`select name, lastcid from sys_user where uid = ${uid}`);
    const username = phpString(user !== false ? user.name : null);
    const targetcity = await this.cityNamePosition(targetcid);
    const targetuid = phpNum(
      await this.cell(sql<Row>`select uid from sys_city where cid = ${targetcid}`),
    );
    if (phpLooseEquals(uid, targetuid)) throw GameError.lang('waigua.forbidden'); // 原版 :146 少 new。
    const delta = phpNum(
      await this.cell(
        sql<Row>`select unix_timestamp() - last_trick_chenhuodajie as t from mem_city_schedule
        where cid = ${targetcid}`,
      ),
    );
    if (delta < 86400) {
      await this.report.sendReport(
        targetuid,
        TITLE_TRICK,
        phpNum(user !== false ? user.lastcid : null),
        targetcid,
        this.lang.t('trickChenHuoDaJie.fail_caution', username, targetcity),
      );
      return this.lang.t('trickChenHuoDaJie.fail', targetcity);
    }
    // 15点智谋持续一分钟
    const delay = wisdom * 4;
    // 15点智谋降低百分之一的保护能力
    const param = Math.ceil(wisdom / 15.0);
    await sql`insert into mem_city_buffer (cid, buftype, bufparam, endtime)
      values (${targetcid}, 15, ${param}, unix_timestamp() + ${delay})
      on duplicate key update endtime = endtime + ${delay}, bufparam = ${param}`.execute(this.db);
    await sql`update mem_city_schedule set last_trick_chenhuodajie = unix_timestamp()
      where cid = ${targetcid}`.execute(this.db);
    await this.report.sendReport(
      targetuid,
      TITLE_TRICK,
      phpNum(user !== false ? user.lastcid : null),
      targetcid,
      this.lang.t(
        'trickChenHuoDaJie.succ_caution',
        username,
        targetcity,
        `${param}%`,
        Math.ceil(delay / 60),
      ),
    );
    await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 15);
    return this.lang.t('trickChenHuoDaJie.succ', targetcity, `${param}%`, Math.ceil(delay / 60));
  }

  /** TrickFunc.php::trickWeiWeiJiuZhao 围魏救赵: recalls the target's marching troops, 24h cd. */
  private async trickWeiWeiJiuZhao(uid: number, targetcid: number): Promise<string> {
    const user = await this.one(sql<Row>`select name, lastcid from sys_user where uid = ${uid}`);
    const username = phpString(user !== false ? user.name : null);
    const targetcity = await this.cityNamePosition(targetcid);
    const targetuid = phpNum(
      await this.cell(sql<Row>`select uid from sys_city where cid = ${targetcid}`),
    );
    if (phpLooseEquals(uid, targetuid)) throw GameError.lang('waigua.forbidden'); // 原版 :177 少 new。
    const delta = phpNum(
      await this.cell(
        sql<Row>`select unix_timestamp() - last_trick_weiweijiuzhao as t from mem_city_schedule
        where cid = ${targetcid}`,
      ),
    );
    // 24小时内不会再中计
    if (delta < 86400) {
      await this.report.sendReport(
        targetuid,
        TITLE_TRICK,
        phpNum(user !== false ? user.lastcid : null),
        targetcid,
        this.lang.t('trickWeiWeiJiuZhao.fail_caution', username, targetcity),
      );
      return this.lang.t('trickWeiWeiJiuZhao.fail', targetcity);
    }
    const troops = await this.rows(
      sql<Row>`select id from sys_troops where cid = ${targetcid} and state = 0`,
    );
    for (const troop of troops) {
      await sql`update sys_troops set \`state\` = 1,
          endtime = unix_timestamp() - starttime + unix_timestamp(), starttime = unix_timestamp()
        where id = ${troop.id}`.execute(this.db);
    }
    await sql`update mem_city_schedule set last_trick_weiweijiuzhao = unix_timestamp()
      where cid = ${targetcid}`.execute(this.db);
    await this.report.sendReport(
      targetuid,
      TITLE_TRICK,
      phpNum(user !== false ? user.lastcid : null),
      targetcid,
      this.lang.t('trickWeiWeiJiuZhao.succ_caution', username),
    );
    await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 17);
    return this.lang.t('trickWeiWeiJiuZhao.succ');
  }

  /** TrickFunc.php::trickHuDiChouXin 釜底抽薪: recalls famous heroes, 24h cooldown. */
  private async trickHuDiChouXin(uid: number, targetcid: number): Promise<string> {
    const user = await this.one(sql<Row>`select name, lastcid from sys_user where uid = ${uid}`);
    const username = phpString(user !== false ? user.name : null);
    const targetcity = await this.cityNamePosition(targetcid);
    const targetuid = phpNum(
      await this.cell(sql<Row>`select uid from sys_city where cid = ${targetcid}`),
    );
    if (phpLooseEquals(uid, targetuid)) throw GameError.lang('waigua.forbidden'); // 原版 :209 少 new。
    const delta = phpNum(
      await this.cell(
        sql<Row>`select unix_timestamp() - last_trick_hudichouxin as t from mem_city_schedule
        where cid = ${targetcid}`,
      ),
    );
    // 24小时内不会再中计
    if (delta < 86400) {
      await this.report.sendReport(
        targetuid,
        TITLE_TRICK,
        phpNum(user !== false ? user.lastcid : null),
        targetcid,
        this.lang.t('trickHuDiChouXin.fail_caution', username, targetcity),
      );
      return this.lang.t('trickHuDiChouXin.fail', targetcity);
    }
    const troops = await this.rows(sql<Row>`select id, state, noback from sys_troops
      where cid = ${targetcid} and state in (0, 2, 4) and hid > 0 and hid < 2000`);
    for (const troop of troops) {
      const troopid = phpIntval(troop.id);
      // 取消采集
      if (await this.check(sql<Row>`select * from sys_gather where troopid = ${troopid}`)) {
        await sql`delete from sys_gather where troopid = ${troopid}`.execute(this.db);
      }
      // 取消关门打狗
      if (phpNum(troop.state) === 0 && phpNum(troop.noback) > 0) {
        await sql`update sys_troops set noback = 0 where id = ${troopid}`.execute(this.db);
      }
      await this.troops.recallTroop(targetuid, troopid);
    }
    const heros = await this.rows(sql<Row>`select hid, state from sys_city_hero
      where cid = ${targetcid} and hid > 0 and hid < 2000`);
    for (const hero of heros) {
      if (phpLooseEquals(hero.state, 10)) {
        await this.heroExpr.cancelExpr(targetuid, phpIntval(hero.hid));
      }
    }
    await sql`update mem_city_schedule set last_trick_hudichouxin = unix_timestamp()
      where cid = ${targetcid}`.execute(this.db);
    await this.report.sendReport(
      targetuid,
      TITLE_TRICK,
      phpNum(user !== false ? user.lastcid : null),
      targetcid,
      this.lang.t('trickHuDiChouXin.succ_caution', username),
    );
    return this.lang.t('trickHuDiChouXin.succ');
  }

  /** TrickFunc.php::trickFenShaoLiangCao 焚烧粮草: burns food, 6h cooldown. */
  private async trickFenShaoLiangCao(
    uid: number,
    targetcid: number,
    wisdom: number,
  ): Promise<string> {
    const user = await this.one(sql<Row>`select name, lastcid from sys_user where uid = ${uid}`);
    const username = phpString(user !== false ? user.name : null);
    const targetcity = await this.cityNamePosition(targetcid);
    const targetuid = phpNum(
      await this.cell(sql<Row>`select uid from sys_city where cid = ${targetcid}`),
    );
    if (phpLooseEquals(uid, targetuid)) throw GameError.lang('waigua.forbidden'); // 原版 :264 少 new。
    const delta = phpNum(
      await this.cell(
        sql<Row>`select unix_timestamp() - last_trick_fenshaoliangcao as t from mem_city_schedule
        where cid = ${targetcid}`,
      ),
    );
    // 6小时内不会再中计
    if (delta < 21600) {
      await this.report.sendReport(
        targetuid,
        TITLE_TRICK,
        phpNum(user !== false ? user.lastcid : null),
        targetcid,
        this.lang.t('trickFenShaoLiangCao.fail_caution', username, targetcity),
      );
      return this.lang.t('trickFenShaoLiangCao.fail', targetcity);
    }
    // 15点智谋烧毁1%
    const foodRemove = (wisdom / 15) * 0.01;
    // 减粮草
    const food = phpNum(
      await this.cell(sql<Row>`select food from mem_city_resource where cid = ${targetcid}`),
    );
    const remove = Math.ceil(food * foodRemove);
    await this.cityRules.addCityResources(targetcid, 0, 0, 0, 0 - remove, 0);
    await sql`update mem_city_schedule set last_trick_fenshaoliangcao = unix_timestamp()
      where cid = ${targetcid}`.execute(this.db);
    await this.report.sendReport(
      targetuid,
      TITLE_TRICK,
      phpNum(user !== false ? user.lastcid : null),
      targetcid,
      this.lang.t('trickFenShaoLiangCao.succ_caution', username, targetcity, remove),
    );
    return this.lang.t('trickFenShaoLiangCao.succ', remove);
  }

  /** TrickFunc.php::trickShunTengMoGua 顺藤摸瓜: reports all the target's city positions. */
  private async trickShunTengMoGua(uid: number, targetcid: number): Promise<string> {
    const user = await this.one(sql<Row>`select name, lastcid from sys_user where uid = ${uid}`);
    const username = phpString(user !== false ? user.name : null);
    const targetuid = phpNum(
      await this.cell(sql<Row>`select uid from sys_city where cid = ${targetcid}`),
    );
    if (phpLooseEquals(uid, targetuid)) throw GameError.lang('waigua.forbidden'); // 原版 :357 少 new。
    // 选出所有城池的位置
    const citys = await this.rows(
      sql<Row>`select cid, name from sys_city where uid = ${targetuid}`,
    );
    let msg = this.lang.t('trickShunTengMoGua.report_first_line');
    for (const city of citys) {
      const cid = phpNum(city.cid);
      const y = Math.floor(cid / 1000);
      const x = cid % 1000;
      msg += this.lang.t('trickShunTengMoGua.report_city', phpString(city.name), x, y);
    }
    await this.report.sendReport(
      targetuid,
      TITLE_TRICK,
      phpNum(user !== false ? user.lastcid : null),
      targetcid,
      this.lang.t('trickShunTengMoGua.alarm', username),
    );
    await this.report.sendReport(
      uid,
      TITLE_SHUNTENGMOGUA,
      phpNum(user !== false ? user.lastcid : null),
      targetcid,
      msg,
    );
    await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 14);
    return this.lang.t('trickShunTengMoGua.succ');
  }

  /** TrickFunc.php::trickZhuSiMaJi 蛛丝马迹: reports the troops around the target city. */
  private async trickZhuSiMaJi(uid: number, targetcid: number): Promise<string> {
    const user = await this.one(sql<Row>`select name, lastcid from sys_user where uid = ${uid}`);
    const username = phpString(user !== false ? user.name : null);
    const targetuid = phpNum(
      await this.cell(sql<Row>`select uid from sys_city where cid = ${targetcid}`),
    );
    if (phpLooseEquals(uid, targetuid)) throw GameError.lang('waigua.forbidden'); // 原版 :387 少 new。
    // 选出目标城相关的所有军队
    const troops = await this.rows(sql<Row>`select t.task, t.cid, t.targetcid, t.endtime,
        c.name, c2.name as tocityname
      from sys_troops t
        left join sys_city c on t.cid = c.cid
        left join sys_city c2 on t.targetcid = c2.cid
      where t.cid = ${targetcid} or t.targetcid = ${targetcid}`);
    const taskNames = [
      this.lang.t('StartTroop.transport'),
      this.lang.t('StartTroop.send'),
      this.lang.t('StartTroop.detect'),
      this.lang.t('StartTroop.harry'),
      this.lang.t('StartTroop.occupy'),
      this.lang.t('StartTroop.fanji'),
      this.lang.t('StartTroop.qiyi'),
    ];
    let content = this.lang.t('trickZhuSiMaJi.table_start');
    for (const troop of troops) {
      content += this.lang.t('trickZhuSiMaJi.tr_start');
      const cid = phpNum(troop.cid);
      const y = Math.floor(cid / 1000);
      const x = cid % 1000;
      const task = phpIntval(troop.task);
      // 原版只映射 0-6，其余（副本 7/8/9）按原值打印。
      const taskName = task < taskNames.length ? taskNames[task] : phpString(troop.task);
      content += this.lang.t('trickZhuSiMaJi.td', taskName);
      content += this.lang.t('trickZhuSiMaJi.td', phpString(troop.name));
      content += this.lang.t('trickZhuSiMaJi.td', `[${x},${y}]`);
      const target = phpNum(troop.targetcid);
      const targetY = Math.floor(target / 1000);
      const targetX = target % 1000;
      let tocityname = phpString(troop.tocityname);
      if (phpEmpty(tocityname)) tocityname = this.lang.value<string[]>('fileName')?.[0] ?? '';
      content += this.lang.t('trickZhuSiMaJi.td', tocityname);
      content += this.lang.t('trickZhuSiMaJi.td', `[${targetX},${targetY}]`);
      content += this.lang.t('trickZhuSiMaJi.td', await this.makeEndTime(phpNum(troop.endtime)));
      content += this.lang.t('trickZhuSiMaJi.tr_end');
    }
    content += this.lang.t('trickZhuSiMaJi.table_end');
    await this.report.sendReport(
      uid,
      TITLE_ZHUSIMAJI,
      phpNum(user !== false ? user.lastcid : null),
      targetcid,
      content,
    );
    await this.report.sendReport(
      targetuid,
      TITLE_TRICK,
      phpNum(user !== false ? user.lastcid : null),
      targetcid,
      this.lang.t('trickZhuSiMaJi.alarm', username),
    );
    await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 16);
    return this.lang.t('trickZhuSiMaJi.succ');
  }

  /** TrickFunc.php::trickTiaoBoLiJian 挑拨离间: cuts a random in-city hero's loyalty. */
  private async trickTiaoBoLiJian(uid: number, targetcid: number, wisdom: number): Promise<string> {
    const user = await this.one(sql<Row>`select name, lastcid from sys_user where uid = ${uid}`);
    const username = phpString(user !== false ? user.name : null);
    const targetcity = await this.cityNamePosition(targetcid);
    const targetuid = phpNum(
      await this.cell(sql<Row>`select uid from sys_city where cid = ${targetcid}`),
    );
    if (phpLooseEquals(uid, targetuid)) throw GameError.lang('waigua.forbidden'); // 原版 :447 少 new。
    let ret: string;
    let caution: string;
    // 在城里的将领（原版 order by rand()，差分用例需固定候选）。
    const targethero = await this.one(sql<Row>`select * from sys_city_hero
      where cid = ${targetcid} and uid = ${targetuid} and (state = 0 or state = 1 or state = 7 or state = 8)
      order by rand() limit 1`);
    if (targethero === false) {
      // 无人中计
      ret = this.lang.t('trickTiaoBoLiJian.fail_nohero');
      caution = targetcity + this.lang.t('trickTiaoBoLiJian.fail_caution_nohero');
    } else {
      const lastTrick = phpNum(
        await this.cell(
          sql<Row>`select last_trick from mem_hero_schedule where hid = ${phpNum(targethero.hid)}`,
        ),
      );
      const now = phpNum(await this.cell(sql<Row>`select unix_timestamp() as t`));
      // 24小时冷却时间
      if (now - lastTrick < 86400) {
        ret = this.lang.t('trickTiaoBoLiJian.fail');
        caution = this.lang.t('trickTiaoBoLiJian.fail_caution', username, targetcity);
      } else {
        // 对比一下智谋（不含 wisdom_add_on、不吃智多星符，照原版；mt_rand 参数按 PHP 语义取整）。
        if (
          this.random.mtRand(
            1,
            phpIntval(wisdom + phpNum(targethero.wisdom_base) + phpNum(targethero.wisdom_add)),
          ) > wisdom
        ) {
          ret = this.lang.t('useTrick.fail_no_wisdom');
          caution = this.lang.t('trickTiaoBoLiJian.fail_caution', username, targetcity);
        } else {
          // 中计了
          let loyaltyReduce = Math.ceil(wisdom / 10);
          if (loyaltyReduce > 60) loyaltyReduce = 60; // 最多降低60点忠诚
          ret = this.lang.t('trickTiaoBoLiJian.succ');
          caution = this.lang.t('trickTiaoBoLiJian.succ_caution', username, targetcity);
          await sql`update sys_city_hero set loyalty = GREATEST(0, loyalty - ${loyaltyReduce})
            where hid = ${phpNum(targethero.hid)}`.execute(this.db);
          ret += this.lang.t(
            'trickTiaoBoLiJian.succ_reduceloyalty',
            phpString(targethero.name),
            loyaltyReduce,
          );
          caution += this.lang.t(
            'trickTiaoBoLiJian.succ_caution_reduceloyalty',
            phpString(targethero.name),
            loyaltyReduce,
          );
          caution += this.lang.t('trickTiaoBoLiJian.succ_caution_tail');
          await sql`insert into mem_hero_schedule (hid, last_trick)
            values (${phpNum(targethero.hid)}, unix_timestamp())
            on duplicate key update last_trick = unix_timestamp()`.execute(this.db);
        }
      }
    }
    await this.report.sendReport(
      targetuid,
      TITLE_TRICK,
      phpNum(user !== false ? user.lastcid : null),
      targetcid,
      caution,
    );
    await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 7);
    return ret;
  }

  /** TrickFunc.php::trickShiMianMaiFu 十面埋伏: blocks 出征 from the target, 24h cooldown. */
  private async trickShiMianMaiFu(uid: number, targetcid: number, wisdom: number): Promise<string> {
    const user = await this.one(sql<Row>`select name, lastcid from sys_user where uid = ${uid}`);
    const username = phpString(user !== false ? user.name : null);
    const targetcity = await this.cityNamePosition(targetcid);
    const targetuid = phpNum(
      await this.cell(sql<Row>`select uid from sys_city where cid = ${targetcid}`),
    );
    if (phpLooseEquals(uid, targetuid)) throw GameError.lang('waigua.forbidden'); // 原版 :535 少 new。
    const delta = phpNum(
      await this.cell(
        sql<Row>`select unix_timestamp() - last_trick_maifu as t from mem_city_schedule
        where cid = ${targetcid}`,
      ),
    );
    if (delta < 3600 * 24) {
      await this.report.sendReport(
        targetuid,
        TITLE_TRICK,
        phpNum(user !== false ? user.lastcid : null),
        targetcid,
        this.lang.t('trickShiMianMaiFu.fail_caution', username, targetcity),
      );
      return this.lang.t('trickShiMianMaiFu.fail', targetcity);
    }
    const delay = wisdom * 60;
    await sql`insert into mem_city_buffer (cid, buftype, bufparam, endtime)
      values (${targetcid}, 8, 0, unix_timestamp() + ${delay})
      on duplicate key update endtime = \`endtime\` + ${delay}`.execute(this.db);
    const endtime = await this.cell(sql<Row>`select endtime from mem_city_buffer
      where cid = ${targetcid} and buftype = 8`);
    await sql`update mem_city_schedule set last_trick_maifu = unix_timestamp()
      where cid = ${targetcid}`.execute(this.db);
    const ret = this.lang.t('trickShiMianMaiFu.succ', targetcity, makeTimeLeft(this.lang, delay));
    await this.report.sendReport(
      targetuid,
      TITLE_TRICK,
      phpNum(user !== false ? user.lastcid : null),
      targetcid,
      this.lang.t(
        'trickShiMianMaiFu.succ_caution',
        username,
        targetcity,
        targetcity,
        makeTimeLeft(this.lang, delay),
        await this.makeEndTime(phpNum(endtime)),
      ),
    );
    await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 8);
    return ret;
  }

  /** TrickFunc.php::trickDiaoHuLiShan 调虎离山: recalls 以逸待劳 troops, 24h cooldown. */
  private async trickDiaoHuLiShan(uid: number, targetcid: number): Promise<string> {
    const user = await this.one(sql<Row>`select name, lastcid from sys_user where uid = ${uid}`);
    const username = phpString(user !== false ? user.name : null);
    const targetcity = await this.cityNamePosition(targetcid);
    const targetuid = phpNum(
      await this.cell(sql<Row>`select uid from sys_city where cid = ${targetcid}`),
    );
    if (phpLooseEquals(uid, targetuid)) throw GameError.lang('waigua.forbidden'); // 原版 :667 少 new。
    const delta = await this.cell(sql<Row>`select buftype from mem_city_buffer
      where buftype = 27 and cid = ${targetcid} and endtime > unix_timestamp()`);
    if (!phpEmpty(delta)) {
      await this.report.sendReport(
        targetuid,
        TITLE_TRICK,
        phpNum(user !== false ? user.lastcid : null),
        targetcid,
        this.lang.t('trickDiaoHuLiShan.fail_caution', username, targetcity),
      );
      return this.lang.t('trickDiaoHuLiShan.fail', targetcity);
    }
    await sql`update sys_troops set \`state\` = 1,
        endtime = unix_timestamp() - starttime + unix_timestamp(), starttime = unix_timestamp()
      where state in (0, 2, 4) and cid = ${targetcid}
        and id in (select troopid from mem_troops_buffer where buftype = 26)`.execute(this.db);
    const delay = 3600 * 24;
    await sql`insert into mem_city_buffer (cid, buftype, bufparam, endtime)
      values (${targetcid}, 27, '0', unix_timestamp() + ${delay})
      on duplicate key update endtime = endtime + ${delay}`.execute(this.db);
    await this.report.sendReport(
      targetuid,
      TITLE_TRICK,
      phpNum(user !== false ? user.lastcid : null),
      targetcid,
      this.lang.t('trickDiaoHuLiShan.succ_caution', username),
    );
    return this.lang.t('trickDiaoHuLiShan.succ');
  }

  /** TrickFunc.php::trickShangWuChouTi 上屋抽梯: blocks union reinforcements, 5h cooldown. */
  private async trickShangWuChouTi(
    uid: number,
    targetcid: number,
    wisdom: number,
  ): Promise<string> {
    const user = await this.one(sql<Row>`select name, lastcid from sys_user where uid = ${uid}`);
    const username = phpString(user !== false ? user.name : null);
    const targetcity = await this.cityNamePosition(targetcid);
    const targetuid = phpNum(
      await this.cell(sql<Row>`select uid from sys_city where cid = ${targetcid}`),
    );
    if (phpLooseEquals(uid, targetuid)) throw GameError.lang('waigua.forbidden'); // 原版 :958 少 new。
    let delta = await this.cell(
      sql<Row>`select unix_timestamp() - last_trick_shangwuchouti as t from mem_city_schedule
      where cid = ${targetcid}`,
    );
    if (phpLooseEquals(delta, false)) {
      // 无 schedule 行：原版补一行并把冷却视为一个远古时间（PHP 0==false 语义下同样覆盖 delta=0，
      // 同秒内重复施计会让这行 insert 撞主键）。原版 sql_query 失败走 lib/database.php:202 的
      // trigger_error('PearDB returned an error. ') + die()，报文按原样复刻。
      try {
        await sql`insert into mem_city_schedule (cid, last_trick_shangwuchouti)
          values (${targetcid}, 0)`.execute(this.db);
      } catch {
        throw GameError.raw('PearDB returned an error. ');
      }
      delta = 1214200000;
    }
    if (phpNum(delta) < 3600 * 5) {
      await this.report.sendReport(
        targetuid,
        TITLE_TRICK,
        phpNum(user !== false ? user.lastcid : null),
        targetcid,
        this.lang.t('trickSWCT.fail_caution', username, targetcity),
      );
      return this.lang.t('trickSWCT.fail', targetcity);
    }
    const delay = wisdom * 120;
    await sql`insert into mem_city_buffer (cid, buftype, bufparam, endtime)
      values (${targetcid}, 28, 0, unix_timestamp() + ${delay})
      on duplicate key update endtime = \`endtime\` + ${delay}`.execute(this.db);
    const endtime = await this.cell(sql<Row>`select endtime from mem_city_buffer
      where cid = ${targetcid} and buftype = 28`);
    await sql`update mem_city_schedule set last_trick_shangwuchouti = unix_timestamp()
      where cid = ${targetcid}`.execute(this.db);
    const ret = this.lang.t('trickSWCT.succ', targetcity, makeTimeLeft(this.lang, delay));
    await this.report.sendReport(
      targetuid,
      TITLE_TRICK,
      phpNum(user !== false ? user.lastcid : null),
      targetcid,
      this.lang.t(
        'trickSWCT.succ_caution',
        username,
        targetcity,
        targetcity,
        makeTimeLeft(this.lang, delay),
        await this.makeEndTime(phpNum(endtime)),
      ),
    );
    return ret;
  }

  // ───────────────────────────── 对军队（usetype 2/3） ─────────────────────────────

  /** TrickFunc.php::trickXuZhangShengShi 虚张声势: shows 5~10× the troop size. */
  private async trickXuZhangShengShi(uid: number, troop: Row, wisdom: number): Promise<string> {
    const delay = wisdom * 600;
    const rate = this.random.mtRand(5, 10);
    await sql`insert into mem_troops_buffer (troopid, buftype, bufparam, endtime)
      values (${phpNum(troop.id)}, 21, ${rate}, unix_timestamp() + ${delay})
      on duplicate key update endtime = endtime + ${delay}, bufparam = ${rate}`.execute(this.db);
    const endtime = await this.cell(sql<Row>`select endtime from mem_troops_buffer
      where troopid = ${phpNum(troop.id)} and buftype = 21`);
    await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 18);
    return this.lang.t('trickXuZhangShengShi.succ', rate, await this.makeEndTime(phpNum(endtime)));
  }

  /** TrickFunc.php::trickYanQiXiGu 偃旗息鼓: shows 10~20% of the troop size. */
  private async trickYanQiXiGu(uid: number, troop: Row, wisdom: number): Promise<string> {
    const delay = wisdom * 600;
    const rate = this.random.mtRand(10, 20);
    await sql`insert into mem_troops_buffer (troopid, buftype, bufparam, endtime)
      values (${phpNum(troop.id)}, 22, ${rate}, unix_timestamp() + ${delay})
      on duplicate key update endtime = endtime + ${delay}, bufparam = ${rate}`.execute(this.db);
    const endtime = await this.cell(sql<Row>`select endtime from mem_troops_buffer
      where troopid = ${phpNum(troop.id)} and buftype = 22`);
    await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 19);
    return this.lang.t('trickYanQiXiGu.succ', `${rate}%`, await this.makeEndTime(phpNum(endtime)));
  }

  /**
   * The wisdom-vs-hero roll of 诱敌深入 / 八门金锁 / 关门打狗: `mt_rand(1, wisdom + hero 的
   * 智谋基础+加点) > wisdom` 失败（不含 wisdom_add_on、不吃智多星符，照原版）。返回失败文案或
   * false。`username` / `lastcid` 由调用方按各自原版的 select 一次取出。
   */
  private async heroRollLost(
    troop: Row,
    wisdom: number,
    failCautionKey: string,
    username: string,
    lastcid: number,
  ): Promise<string | false> {
    if (phpNum(troop.hid) > 0) {
      const hero = await this.one(
        sql<Row>`select * from sys_city_hero where hid = ${phpNum(troop.hid)}`,
      );
      if (hero !== false) {
        if (
          this.random.mtRand(
            1,
            phpIntval(wisdom + phpNum(hero.wisdom_base) + phpNum(hero.wisdom_add)),
          ) > wisdom
        ) {
          await this.report.sendReport(
            phpNum(troop.uid),
            TITLE_TRICK,
            lastcid,
            0,
            this.lang.t(failCautionKey, username),
          );
          return this.lang.t('useTrick.fail_no_wisdom');
        }
      }
    }
    return false;
  }

  /** TrickFunc.php::trickYouDiShenRu 诱敌深入: speeds an enemy troop up, 1h cooldown. */
  private async trickYouDiShenRu(uid: number, troop: Row, wisdom: number): Promise<string> {
    const now = phpNum(await this.cell(sql<Row>`select unix_timestamp() as t`));
    const user = await this.one(
      sql<Row>`select name, prestige, lastcid from sys_user where uid = ${uid}`,
    );
    const username = phpString(user !== false ? user.name : null);
    if (now - phpNum(troop.lastTempt) < 3600) {
      await this.report.sendReport(
        phpNum(troop.uid),
        TITLE_TRICK,
        phpNum(user !== false ? user.lastcid : null),
        0,
        this.lang.t('trickYouDiShenRu.fail_caution', username),
      );
      return this.lang.t('trickYouDiShenRu.fail');
    }
    const lost = await this.heroRollLost(
      troop,
      wisdom,
      'trickYouDiShenRu.fail_caution',
      username,
      phpNum(user !== false ? user.lastcid : null),
    );
    if (lost !== false) return lost;
    const addrate = (100 + wisdom) / 100;
    await sql`update sys_troops set endtime = unix_timestamp() + (endtime - unix_timestamp()) / ${addrate},
        lastTempt = unix_timestamp() where id = ${phpNum(troop.id)}`.execute(this.db);
    await this.report.sendReport(
      phpNum(troop.uid),
      TITLE_TRICK,
      phpNum(user !== false ? user.lastcid : null),
      0,
      this.lang.t('trickYouDiShenRu.succ_caution', username),
    );
    await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 20);
    return this.lang.t('trickYouDiShenRu.succ');
  }

  /** TrickFunc.php::trickJinChaoTuoQiao 金蝉脱壳: speeds the own troop's return. */
  private async trickJinChaoTuoQiao(uid: number, troop: Row, wisdom: number): Promise<string> {
    if (phpNum(troop.state) === 0) {
      // 前进中的先返回
      await sql`update sys_troops set \`state\` = 1,
          endtime = unix_timestamp() - starttime + unix_timestamp(), starttime = unix_timestamp()
        where id = ${phpNum(troop.id)}`.execute(this.db);
    }
    const delay = wisdom * 60;
    await sql`update sys_troops set endtime = endtime - ${delay}, lastrun = unix_timestamp()
      where id = ${phpNum(troop.id)}`.execute(this.db);
    await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 10);
    return this.lang.t('trickJinChaoTuoQiao.succ');
  }

  /** TrickFunc.php::trickBaMemJinShuo 八门金锁: slows an enemy troop, 6h cooldown. */
  private async trickBaMemJinShuo(uid: number, troop: Row, wisdom: number): Promise<string> {
    const now = phpNum(await this.cell(sql<Row>`select unix_timestamp() as t`));
    const user = await this.one(
      sql<Row>`select name, prestige, lastcid from sys_user where uid = ${uid}`,
    );
    const username = phpString(user !== false ? user.name : null);
    if (now - phpNum(troop.lastlock) < 6 * 3600) {
      await this.report.sendReport(
        phpNum(troop.uid),
        TITLE_TRICK,
        phpNum(user !== false ? user.lastcid : null),
        0,
        this.lang.t('trickBaMemJinShuo.fail_caution', username),
      );
      return this.lang.t('trickBaMemJinShuo.fail');
    }
    const lost = await this.heroRollLost(
      troop,
      wisdom,
      'trickBaMemJinShuo.fail_caution',
      username,
      phpNum(user !== false ? user.lastcid : null),
    );
    if (lost !== false) return lost;
    const delay = wisdom * 60;
    await sql`update sys_troops set endtime = endtime + ${delay}, lastlock = unix_timestamp()
      where id = ${phpNum(troop.id)}`.execute(this.db);
    await this.report.sendReport(
      phpNum(troop.uid),
      TITLE_TRICK,
      phpNum(user !== false ? user.lastcid : null),
      0,
      this.lang.t('trickBaMemJinShuo.succ_caution', username, makeTimeLeft(this.lang, delay)),
    );
    await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 11);
    return this.lang.t('trickBaMemJinShuo.succ', makeTimeLeft(this.lang, delay));
  }

  /** TrickFunc.php::trickGuanMemDaGou 关门打狗: pins an enemy troop (no return until battle). */
  private async trickGuanMemDaGou(uid: number, troop: Row, wisdom: number): Promise<string> {
    const user = await this.one(sql<Row>`select name, lastcid from sys_user where uid = ${uid}`);
    const username = phpString(user !== false ? user.name : null);
    const lost = await this.heroRollLost(
      troop,
      wisdom,
      'trickGuanMemDaGou.fail_caution',
      username,
      phpNum(user !== false ? user.lastcid : null),
    );
    if (lost !== false) return lost;
    await sql`update sys_troops set noback = 1 where id = ${phpNum(troop.id)}`.execute(this.db);
    await this.report.sendReport(
      phpNum(troop.uid),
      TITLE_TRICK,
      phpNum(user !== false ? user.lastcid : null),
      0,
      this.lang.t('trickGuanMemDaGou.succ_caution', username),
    );
    await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 12);
    return this.lang.t('trickGuanMemDaGou.succ');
  }

  /**
   * TrickFunc.php::trickQianLiBenXi 千里奔袭: speeds the own troop up, 1h cooldown. The whole
   * effect sits inside `if ($troop['hid'] > 0)` — without a hero the 锦囊/energy are spent for
   * nothing and the success message still returns.
   */
  private async trickQianLiBenXi(uid: number, troop: Row, wisdom: number): Promise<string> {
    if (phpNum(troop.hid) > 0) {
      const addrate = 100 / (100 + wisdom);
      if (phpNum(troop.state) !== 0 && phpNum(troop.state) !== 1) {
        throw GameError.lang('trickQianLiBenXi.wrong_state');
      }
      await sql`update sys_troops set endtime = unix_timestamp() + (endtime - unix_timestamp()) * ${addrate},
          lastacc = unix_timestamp() where id = ${phpNum(troop.id)}`.execute(this.db);
    }
    await this.tasks.completeTaskGoalBySortandType(uid, TASK_SORT_TRICK, 13);
    return this.lang.t('trickQianLiBenXi.succ');
  }

  /** TrickFunc.php::trickYiYiDaiLao 以逸待劳: queues extra attacks (until year 2033). */
  private async trickYiYiDaiLao(uid: number, troop: Row): Promise<string> {
    await sql`insert into mem_troops_buffer (troopid, buftype, bufparam, endtime)
      values (${phpNum(troop.id)}, 26, '', 2000000000)
      on duplicate key update endtime = 2000000000`.execute(this.db);
    return this.lang.t('trickYiYiDaiLao.succ');
  }
}
