import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import {
  addslashes,
  mbStrlen,
  phpEmpty,
  phpIntval,
  phpLooseEquals,
  phpNum,
  phpString,
  phpTrim,
} from '../core/php';
import { RandomService } from '../core/random.service';
import { TaskRewards } from '../task/task-rewards.service';
import { makeTimeLeft, UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { PkEngine } from './pk-engine';

type Row = Record<string, unknown>;

/**
 * MarrySystemFunc.php（婚姻/君主历练/亲子），MarrySystem 服务的全部 global 命令。
 *
 * 数值锚点（原版常量）：好感礼品梯 12066–12069 按 favor<20/50/80/100、favor+2、88/98 怀孕
 * （mem_marry_during 259200s）；胎教 500 元宝减 77760s 一次；接生 200 铜钱（gid 152）或 180
 * 元宝、每夫人 2 胎、8h 冷却、房间数必须多于孩子数；开房 200/400 元宝封顶 3；培养成功率
 * 80/60/20/5 按加值总和、属性 roll 1–3（70/25/5）；周游列国 600 铜钱；提亲四档
 * 666/333/222/0 成功率 5/30/90/100、3h 冷却；君主历练 1–8h、取消折半。
 *
 * 忠实保留的怪癖：
 * - lang.php:2657 白名单里的 sendGift / getMotherInfo 在 PHP 中没有定义（客户端 sendGift
 *   方法实际发的是 addMadamFavor）；新网关对未注册命令回裸头部，因此这里刻意不注册两者；
 * - getMadamChild 里名字与性别反着取（sex==0 取 boyname，MarrySystemFunc.php:331）；
 * - checkRoomCount 无孩子时 childCount 兜底成 1（不是 0，MarrySystemFunc.php:273）；
 * - finishMeetWife 成功后 `throw new Exception($msg)` 用异常返回成功文案，写库照常生效
 *   （原版逐句 autocommit，移植不加事务）；
 * - addGoods 写入时 gid 152 被换成 888888（积分），但本文件全部按 gid 152 读铜钱——原库无
 *   gid 152 行，铜钱支付分支永远走错误分支，两边一致（utils.php:889 的怪癖，照抄）；
 * - deleteSpecialChild 的 `intval($childInfo['out_hid']>0)` 括号位置原样保留（语义等价）。
 */
@Injectable()
export class MarryCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly rewards: TaskRewards,
    private readonly users: UserRules,
    private readonly random: RandomService,
    private readonly pk: PkEngine,
  ) {}

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
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

  /** utils.php::checkMoney — `empty(money) || money < need` 时为 false（0 元宝也算不足）。 */
  private async checkMoney(uid: number, money: number): Promise<boolean> {
    const have = await this.cell(sql`select money from sys_user where uid = ${uid}`);
    return !(phpEmpty(have) || phpNum(have) < money);
  }

  /** utils.php::checkGoodsCount（lockUser 由网关的按用户互斥承担）。 */
  private async checkGoodsCount(uid: number, gid: number, need: number): Promise<boolean> {
    const count = await this.cell(
      sql`select \`count\` from sys_goods where uid = ${uid} and gid = ${gid}`,
    );
    return (phpEmpty(count) ? 0 : phpNum(count)) >= need;
  }

  /** MarrySystemFunc.php:15 的自动建档：`insert ... on duplicate key update roomcount=roomcount`。 */
  private async vivifyMarry(uid: number): Promise<void> {
    await sql`insert into sys_user_marry (uid) values (${uid})
      on duplicate key update roomcount = roomcount`.execute(this.scope.db);
  }

  /** MarrySystemFunc.php:432 getGidByFavor。 */
  private gidByFavor(curFavor: number): number {
    if (curFavor >= 100) curFavor = 99;
    if (curFavor < 20) return 12066;
    if (curFavor < 50) return 12067;
    if (curFavor < 80) return 12068;
    return 12069;
  }

  /** MarrySystemFunc.php:451 addNextGoodInfo — 下一档礼品的名称与持有数。 */
  private async addNextGoodInfo(info: Row, uid: number, gid: number): Promise<void> {
    const good = await this.one(sql`select c.name, ifnull(s.count, 0) as count
      from cfg_goods c left join sys_goods s on c.gid = s.gid and s.uid = ${uid}
      where c.gid = ${gid}`);
    info.nextGidName = good ? good.name : null;
    info.nextGidCount = good ? good.count : null;
  }

  /** MarrySystemFunc.php:130 resetCaluHeroAttr — 培养后的四维（PHP round 为四舍五入）。 */
  private resetCalcHeroAttr(hero: Row): void {
    const mult = phpNum(hero.upgrade_value) + phpNum(hero.qixin_multip) + phpNum(hero.wenpo_multip);
    hero.command = Math.round(phpNum(hero.command_base) + phpNum(hero.command_add) * mult * 0.1);
    hero.affairs = Math.round(phpNum(hero.affairs_base) + phpNum(hero.affairs_add) * mult * 0.1);
    hero.bravery = Math.round(phpNum(hero.bravery_base) + phpNum(hero.bravery_add) * mult * 0.1);
    hero.wisdom = Math.round(phpNum(hero.wisdom_base) + phpNum(hero.wisdom_add) * mult * 0.1);
  }

  // ───────────────────────────── 君主历练 ─────────────────────────────

  /** MarrySystemFunc.php:478 loadMarryInfo：`[君主历练行, 红颜列表]`。 */
  @GlobalCommand()
  async loadMarryInfo(ctx: CommandContext): Promise<unknown[]> {
    const exprInfo = await this.kingExprRow(ctx.uid);
    const girlFriendInfo = await this.rows(sql`select *, unix_timestamp() as nowtime
      from mem_marry_hero_favor a left join cfg_marry_mother_hero b on a.hid = b.hid
      where uid = ${ctx.uid} and a.state = '0'`);
    return [exprInfo, girlFriendInfo];
  }

  /** MarrySystemFunc.php:491 loadMarryKingExpr：`[君主历练行]`。 */
  @GlobalCommand()
  async loadMarryKingExpr(ctx: CommandContext): Promise<unknown[]> {
    return [await this.kingExprRow(ctx.uid)];
  }

  /** MarrySystemFunc.php:481/494 共用的君主历练查询（herotype 1000 的君主将）。 */
  private async kingExprRow(uid: number): Promise<Row | false> {
    return this.one(sql`select a.state, unix_timestamp() as nowtime, b.starttime, b.endtime
      from sys_city_hero a left join sys_king_expr b on a.hid = b.hid
      where a.uid = ${uid} and a.herotype = '1000'`);
  }

  /** MarrySystemFunc.php:503 beginKingExpr：1–8 小时，休假/忙碌拒绝，herotype 1000。 */
  @GlobalCommand()
  async beginKingExpr(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const hours = phpIntval(param[0]);
    if (hours < 1 || hours > 8) throw GameError.lang('waigua.invalid');
    const nowtime = phpNum(await this.cell(sql`select unix_timestamp()`));
    const vacendTime = await this.cell(sql`select vacend from sys_user_state where uid = ${uid}`);
    if (!phpEmpty(vacendTime) && phpIntval(vacendTime) > nowtime) {
      throw GameError.lang('marry.vacend_can_not_expr');
    }
    const hero = await this.one(sql`select state, hid, cid from sys_city_hero
      where uid = ${uid} and herotype = '1000'`);
    if (hero === false) throw GameError.lang('useGoods.king_cannot_find');
    if (!phpLooseEquals(hero.state, 0)) throw GameError.lang('marry.king_hero_not_free');
    return this.scope.transaction(async () => {
      await this.users.logUserAction(uid, 21);
      await sql`insert into sys_king_expr (uid, cid, hid, type, starttime, endtime, hours,
          accTimes, state)
        values (${uid}, ${phpIntval(hero.cid)}, ${phpIntval(hero.hid)}, 0, unix_timestamp(),
          unix_timestamp() + 3600 * ${hours}, ${hours}, 0, 0)`.execute(this.scope.db);
      await sql`update sys_city_hero set state = 10 where hid = ${phpIntval(hero.hid)}`.execute(
        this.scope.db,
      );
      return [this.lang.t('marry.start_expr'), [await this.kingExprRow(uid)]];
    });
  }

  /** MarrySystemFunc.php:536 fasterKingExpr：历练中用君王拜帖（12060）减 30%（≥30 分钟），
   *  返回途中用鸿雁飞书（12061）立即召回。 */
  @GlobalCommand()
  async fasterKingExpr(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const heroExprInfo = await this.one(sql`select * from sys_king_expr where uid = ${uid}`);
    if (heroExprInfo === false) throw GameError.lang('marry.not_in_expr');
    const now = phpNum(await this.cell(sql`select unix_timestamp()`));
    if (phpLooseEquals(heroExprInfo.state, 0)) {
      // 历练过程中
      if (phpIntval(heroExprInfo.endtime) <= now) throw GameError.lang('marry.not_in_expr');
      const gid = 12060; // 君王拜帖
      if (!(await this.goods.checkGoods(uid, gid))) throw GameError.raw(`not_enough_goods${gid}`);
      const CFG_REDUCE = 30 * 60;
      let reduceTime = phpIntval(Math.floor((phpNum(heroExprInfo.endtime) - now) * 0.3));
      reduceTime = reduceTime > CFG_REDUCE ? reduceTime : CFG_REDUCE;
      const newEndTime = phpNum(heroExprInfo.endtime) - reduceTime;
      await sql`update sys_king_expr set endtime = ${newEndTime}, accTimes = accTimes + 1
        where hid = ${phpIntval(heroExprInfo.hid)}`.execute(this.scope.db);
      await this.goods.reduceGoods(uid, gid, 1);
    } else if (phpLooseEquals(heroExprInfo.state, 1)) {
      // 返回途中
      if (phpIntval(heroExprInfo.endtime) <= now) throw GameError.lang('marry.king_has_back');
      const gid = 12061; // 鸿雁飞书
      if (!(await this.goods.checkGoods(uid, gid))) throw GameError.raw(`not_enough_goods${gid}`);
      await sql`delete from sys_king_expr where hid = ${phpIntval(heroExprInfo.hid)}`.execute(
        this.scope.db,
      );
      await sql`update sys_city_hero set state = '0' where hid = ${phpIntval(heroExprInfo.hid)}`.execute(
        this.scope.db,
      );
      await this.goods.reduceGoods(uid, gid, 1);
    }
    return this.kingExprRow(uid).then((row) => [row]);
  }

  /** MarrySystemFunc.php:577 cancelKingExpr：转入返回途中，不足半程按已过时间折半封底。 */
  @GlobalCommand()
  async cancelKingExpr(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const heroExprInfo = await this.one(sql`select * from sys_king_expr where uid = ${uid}`);
    if (heroExprInfo === false || !phpLooseEquals(heroExprInfo.state, 0)) {
      throw GameError.lang('marry.not_in_expr');
    }
    await this.scope.transaction(async () => {
      await this.users.logActionCountback(uid, 21);
      await sql`update sys_king_expr set state = 1,
          endtime = if(unix_timestamp() - starttime > hours * 1800, endtime,
            2 * unix_timestamp() - starttime)
        where hid = ${phpIntval(heroExprInfo.hid)}`.execute(this.scope.db);
      await sql`update sys_city_hero set state = 11 where hid = ${phpIntval(heroExprInfo.hid)}
        and state = 10`.execute(this.scope.db);
    });
    return this.kingExprRow(uid).then((row) => [row]);
  }

  /** MarrySystemFunc.php:593 finishMeetWife：战报里的缘份奖励换红玫瑰，路人变红颜。 */
  @GlobalCommand()
  async finishMeetWife(ctx: CommandContext, param: unknown[]): Promise<never> {
    const uid = ctx.uid;
    const id = phpIntval(param[0]);
    const rewardinfo = await this.one(
      sql`select * from sys_king_expr_reward where uid = ${uid} and id = ${id}`,
    );
    if (rewardinfo === false) throw GameError.lang('marry.reward_not_exist');
    if (phpLooseEquals(rewardinfo.getFlag, 1)) throw GameError.lang('marry.reward_over');
    let needCount = phpNum(
      await this.cell(
        sql`select count from cfg_marry_mother_hero where hid = ${phpIntval(rewardinfo.hid)}`,
      ),
    );
    if (phpEmpty(needCount)) needCount = 1; // 默认值给 1
    const gid = 12065; // 红玫瑰
    if (!(await this.checkGoodsCount(uid, gid, needCount))) {
      throw GameError.lang('good.not_enough_goods83');
    }
    // 原版无 uid+hid 冲突预检——红颜已存在时这里按原样抛数据库重复键错误。
    await sql`insert into mem_marry_hero_favor (uid, hid, favor, state, count)
      values (${uid}, ${phpIntval(rewardinfo.hid)}, '0', '0', '0')`.execute(this.scope.db);
    await sql`update sys_king_expr_reward set getFlag = '1' where id = ${id}`.execute(
      this.scope.db,
    );
    await this.goods.reduceGoods(uid, gid, needCount);
    const username = phpString(await this.cell(sql`select name from sys_user where uid = ${uid}`));
    const girlfriendName = phpString(
      await this.cell(
        sql`select name from cfg_marry_mother_hero where hid = ${phpIntval(rewardinfo.hid)}`,
      ),
    );
    // 原版硬编码的公告文案（become_girlfriend_sys 那行在 PHP 里被注释掉了）。
    const msg =
      '玩家:' +
      username +
      '送上' +
      needCount +
      '朵红玫瑰以表爱慕！' +
      girlfriendName +
      '经不住引诱成为其女朋友！！！';
    await this.users.sendSysInform({
      type: 0,
      inuse: 1,
      starttime: 0,
      endtime: 600,
      interval: 50000,
      scrollcount: 1,
      color: 16247152,
      msg,
    });
    // 成功文案靠异常返回；上面写库在原版逐句 autocommit，照原样不回滚。
    throw GameError.lang('marry.become_girlfriend', girlfriendName);
  }

  /** MarrySystemFunc.php:624 byebye：分手，删缘份奖励与红颜行。 */
  @GlobalCommand()
  async byebye(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const hid = phpIntval(param[0]);
    const girlfriendInfo = await this.one(sql`select a.*, b.name from mem_marry_hero_favor a
      left join cfg_marry_mother_hero b on a.hid = b.hid
      where a.uid = ${uid} and a.hid = ${hid}`);
    if (girlfriendInfo === false || !phpLooseEquals(girlfriendInfo.state, 0)) {
      throw GameError.lang('marry.girlfriend_none');
    }
    const msg = this.lang.t('marry.girlfriend_broke_up', girlfriendInfo.name);
    await sql`delete from sys_king_expr_reward where uid = ${uid} and hid = ${hid}`.execute(
      this.scope.db,
    );
    await sql`delete from mem_marry_hero_favor where uid = ${uid} and hid = ${hid}`.execute(
      this.scope.db,
    );
    return [msg];
  }

  /** MarrySystemFunc.php:641 proposeMarry：四档聘礼成功率，掷中后与守护 NPC（cfg_pk_hero）
   *  打一场 startUserPK（PkEngine，即 PKFunc 的斗将引擎），打赢或空手必成才算提亲成功。 */
  @GlobalCommand()
  async proposeMarry(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    if (param.length !== 2) throw GameError.lang('waigua.invalid');
    const hid = phpIntval(param[0]);
    const giftType = phpIntval(param[1]);
    const girlfriendInfo = await this.one(sql`select a.*, b.name from mem_marry_hero_favor a
      left join cfg_marry_mother_hero b on a.hid = b.hid
      where a.uid = ${uid} and a.hid = ${hid}`);
    if (girlfriendInfo === false) throw GameError.lang('marry.girlfriend_none');
    if (phpNum(girlfriendInfo.favor) < 50 || !phpLooseEquals(girlfriendInfo.state, 0)) {
      throw GameError.lang('waigua.invalid');
    }
    const now = phpNum(await this.cell(sql`select unix_timestamp()`));
    if (phpNum(girlfriendInfo.proposeCoolTime) > now) {
      const leftTime = phpNum(girlfriendInfo.proposeCoolTime) - now;
      throw GameError.raw(
        this.lang.t('marrySystem.propose_cool', girlfriendInfo.name) +
          makeTimeLeft(this.lang, leftTime),
      );
    }
    // 高等聘礼 666 元宝、中等 333 元宝、低等 222 铜钱、空手（type 4 不扣任何东西）。
    if (giftType > 4 || giftType < 1) throw GameError.lang('waigua.invalid');
    await this.checkGoodAndReduce(uid, giftType);

    const rateArr: Record<number, number> = { 1: 5, 2: 30, 3: 90, 4: 100 };
    const rand = this.random.mtRand(1, 100);
    const ret: unknown[] = [];
    if (rand <= rateArr[giftType]!) {
      const npcid = await this.cell(
        sql`select npcid from cfg_marry_mother_hero where hid = ${hid}`,
      ); // 守护大哥
      const kingHid = await this.cell(
        sql`select hid from sys_city_hero where uid = ${uid} and herotype = '1000'`,
      );
      // `force` 是 MySQL 8 保留字，必须反引号（列在 mem_hero_blood 上，原版未加限定）。
      const attackHeroPartInfo = await this.one(sql`select a.hid, a.sex, \`force\` as energy,
          11 as standIndex, command_base + command_add_on as command,
          affairs_base + affairs_add + affairs_add_on as affair,
          bravery_base + bravery_add + bravery_add_on as bravery,
          wisdom_base + wisdom_add + wisdom_add_on as wisdom, speed_add_on as speed
        from sys_city_hero a, mem_hero_blood b where a.hid = b.hid and a.hid = ${phpIntval(kingHid)}`);
      const resistHeroPartInfo = await this.one(sql`select hid, sex, energy + energy_add as energy,
          11 as standIndex, command_base + command_add as command, affair_base + affair_add as affair,
          bravery_base + bravery_add as bravery, wisdom_base + wisdom_add as wisdom,
          speed_base + speed_add as speed
        from cfg_pk_hero where hid = ${phpIntval(npcid)}`);
      if (resistHeroPartInfo === false) throw GameError.lang('waigua.invalid');

      const kingHero = await this.one(sql`select h.*, b.* from sys_city_hero h, mem_hero_blood b
        where h.\`hid\` = b.\`hid\` and h.hid = ${phpIntval(kingHid)}`);
      const npcHero = await this.one(sql`select *, FLOOR((bravery_base + bravery_add) * 5
        + (energy + energy_add) * 10 + wisdom_base + wisdom_add) as battle
        from cfg_pk_hero where hid = ${phpIntval(npcid)}`);
      ret.push(0);
      ret.push(giftType);
      ret.push([kingHero, npcHero]);
      ret.push(this.pk.startUserPK([attackHeroPartInfo], [resistHeroPartInfo]));
    } else {
      ret.push(1); // 表示玩家没有碰到守护npc，提亲成功
      ret.push(girlfriendInfo.name);
    }
    const winer = (ret[3] as Row | undefined)?.winer;
    // 原版条件 `ret[3]['winer']==1 || ret[0]==1`：打赢守护 NPC，或根本没触发 PK（掷中率 100%
    // 的空手档也可能不触发——ret[0]=1 即提亲成功）都会发喜结连理公告；只有 PK 落败不结。
    if (phpLooseEquals(winer, 1) || phpLooseEquals(ret[0], 1)) {
      // 发提亲成功公告
      await sql`update mem_marry_hero_favor set state = '1' where uid = ${uid} and hid = ${hid}`.execute(
        this.scope.db,
      );
      const username = await this.cell(sql`select name from sys_user where uid = ${uid}`);
      const msg = this.lang.t('marry.get_married', username, girlfriendInfo.name);
      await this.users.sendSysInform({
        type: 0,
        inuse: 1,
        starttime: 0,
        endtime: 600,
        interval: 50000,
        scrollcount: 1,
        color: 16247152,
        msg,
      });
    }
    // 增加提亲冷却时间 3 小时
    await sql`update mem_marry_hero_favor set proposeCoolTime = (${now} + 3 * 60 * 60)
      where uid = ${uid} and hid = ${hid}`.execute(this.scope.db);
    return ret;
  }

  /** MarrySystemFunc.php:699 checkGoodAndReduce：1=666 元宝，2=333 元宝，3=222 铜钱，4=空手。 */
  private async checkGoodAndReduce(uid: number, type: number): Promise<void> {
    const userMoney = phpNum(await this.cell(sql`select money from sys_user where uid = ${uid}`));
    const userCopper = phpNum(
      await this.cell(sql`select count from sys_goods where uid = ${uid} and gid = '152'`),
    );
    if (type === 1) {
      if (phpIntval(userMoney) < 666) throw GameError.lang('buyGoods.no_enough_YuanBao');
      await this.rewards.addMoney(uid, -666, 826);
    } else if (type === 2) {
      if (phpIntval(userMoney) < 333) throw GameError.lang('buyGoods.no_enough_YuanBao');
      await this.rewards.addMoney(uid, -333, 826);
    } else if (type === 3) {
      if (phpIntval(userCopper) < 222) throw GameError.lang('blackMarket.no_enough_copper');
      await this.goods.addGoods(uid, 152, -222, 826);
    }
  }

  // ───────────────────────────── 夫人与好感 ─────────────────────────────

  /** MarrySystemFunc.php:5 loadMarryMadam：谈情说爱之外的每位夫人 + 房间/冷却/怀孕进度。 */
  @GlobalCommand()
  async loadMarryMadam(ctx: CommandContext): Promise<unknown[]> {
    return this.madamRows(ctx.uid);
  }

  private async madamRows(uid: number): Promise<unknown[]> {
    const motherInfos = await this.rows(sql`select c.*, m.*, m.uid as userid
      from cfg_marry_mother_hero c, mem_marry_hero_favor m
      where c.hid = m.hid and m.uid = ${uid} and m.state <> '0'`);
    const ret: unknown[] = [];
    for (const motherInfo of motherInfos) {
      const now = phpNum(await this.cell(sql`select unix_timestamp()`));
      await this.vivifyMarry(uid);
      const roomCount = phpNum(
        await this.cell(sql`select roomcount from sys_user_marry where uid = ${uid}`),
      );
      let childCount = phpNum(
        await this.cell(sql`select count(1) from sys_user_child where uid = ${uid}`),
      );
      if (phpEmpty(childCount)) childCount = 0;
      motherInfo.roomIsEnough = roomCount > childCount;
      motherInfo.leaveCoolTime = Math.max(phpIntval(motherInfo.coolingEndtime) - now, 0);

      const curFavorGid = this.gidByFavor(phpIntval(motherInfo.favor));
      await this.addNextGoodInfo(motherInfo, uid, curFavorGid);
      const durInfo = await this.one(sql`select starttime, endtime, isSpeed from mem_marry_during
        where uid = ${uid} and hid = ${phpIntval(motherInfo.hid)}`);
      if (durInfo !== false) {
        motherInfo.isSpeed = durInfo.isSpeed;
        motherInfo.leaveDuringTime = Math.max(phpIntval(durInfo.endtime) - now, 0);
        if (now >= phpIntval(durInfo.endtime)) {
          // 更新到可接生阶段
          await sql`update mem_marry_hero_favor set state = '3' where uid = ${uid}
            and hid = ${phpIntval(motherInfo.hid)}`.execute(this.scope.db);
          motherInfo.state = 3;
        }
      } else {
        motherInfo.isSpeed = 0;
        motherInfo.leaveDuringTime = 0;
      }
      ret.push(motherInfo);
    }
    return ret;
  }

  /** MarrySystemFunc.php:367 getMadamLeavingTime：怀孕剩余时间，到点把状态推到 3。 */
  @GlobalCommand()
  async getMadamLeavingTime(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const motherHid = phpIntval(param[0]);
    const motherInfo = await this.one(
      sql`select * from mem_marry_during where uid = ${uid} and hid = ${motherHid}`,
    );
    if (motherInfo === false) throw GameError.lang('marrySystem.madam_not_exist');
    const now = phpNum(await this.cell(sql`select unix_timestamp()`));
    motherInfo.leaveDuringTime = Math.max(phpIntval(motherInfo.endtime) - now, 0);
    if (now >= phpIntval(motherInfo.endtime)) {
      // 更新到可接生阶段
      await sql`update mem_marry_hero_favor set state = '3' where uid = ${uid}
        and hid = ${phpIntval(motherInfo.hid)}`.execute(this.scope.db);
    }
    return [motherInfo];
  }

  /** MarrySystemFunc.php:267 checkRoomCount：房间是否够用，并把夫人状态推到 3。 */
  @GlobalCommand()
  async checkRoomCount(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const motherHid = phpIntval(param[0]);
    await this.vivifyMarry(uid);
    const roomCount = phpNum(
      await this.cell(sql`select roomcount from sys_user_marry where uid = ${uid}`),
    );
    let childCount = phpNum(
      await this.cell(sql`select count(1) from sys_user_child where uid = ${uid}`),
    );
    if (phpEmpty(childCount)) childCount = 1; // 原版这里兜底成 1（不是 0）

    await sql`update mem_marry_hero_favor set state = '3' where uid = ${uid} and hid = ${motherHid}`.execute(
      this.scope.db,
    );

    const isEnough = roomCount > childCount;
    const newMotherInfo = await this.one(
      sql`select * from mem_marry_hero_favor where uid = ${uid} and hid = ${motherHid}`,
    );
    return [isEnough, newMotherInfo];
  }

  /** MarrySystemFunc.php:385 addMadamFavor：送好感礼品，favor+2；88/98 触发怀孕（3 天）。 */
  @GlobalCommand()
  async addMadamFavor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const type = phpIntval(param[0]);
    const madamHid = phpIntval(param[1]);
    const madamInfo = await this.one(
      sql`select * from mem_marry_hero_favor where uid = ${uid} and hid = ${madamHid}`,
    );
    const now = phpNum(await this.cell(sql`select unix_timestamp()`));
    if (type !== 1 && type !== 2) throw GameError.lang('marrySystem.child_type_error');
    if (madamInfo === false) throw GameError.lang('marrySystem.madam_not_exist');
    if (!phpLooseEquals(madamInfo.state, 1) && !phpLooseEquals(madamInfo.state, 0)) {
      throw GameError.lang('marrySystem.madam_status_error');
    }
    if (phpIntval(madamInfo.favor) >= 100) throw GameError.lang('marrySystem.madam_favor_full');
    if (phpIntval(madamInfo.coolingEndtime) > now) {
      throw GameError.lang('marrySystem.madam_in_cooling');
    }
    const curFavor = phpIntval(madamInfo.favor);
    const gid = this.gidByFavor(curFavor);
    const goodCnt = await this.cell(
      sql`select count from sys_goods where uid = ${uid} and gid = ${gid}`,
    );
    const goodName = await this.cell(sql`select name from cfg_goods where gid = ${gid}`);
    if (phpEmpty(goodCnt) || phpIntval(goodCnt) < 1) {
      throw GameError.lang('marry.lack_gift', goodName);
    }
    if (curFavor === 80 && phpLooseEquals(madamInfo.state, 0)) {
      throw GameError.lang('marry.can_not_send_gift');
    }
    if (curFavor === 88 || curFavor === 98) {
      // 怀孕
      if (!phpLooseEquals(madamInfo.state, 1)) throw GameError.lang('waigua.invalid');
      await sql`update mem_marry_hero_favor set state = '2' where uid = ${uid} and hid = ${madamHid}`.execute(
        this.scope.db,
      );
      await sql`insert into mem_marry_during (uid, hid, starttime, endtime)
        values (${uid}, ${madamHid}, unix_timestamp(), unix_timestamp() + 259200)`.execute(
        this.scope.db,
      );
    }

    await this.goods.addGoods(uid, gid, -1, 826);
    await sql`update mem_marry_hero_favor set favor = LEAST(favor + 2, 100)
      where uid = ${uid} and hid = ${madamHid}`.execute(this.scope.db);

    const newMadamInfo = (await this.one(
      sql`select * from mem_marry_hero_favor where uid = ${uid} and hid = ${madamHid}`,
    )) as Row;
    const nextGid = this.gidByFavor(curFavor + 2);
    await this.addNextGoodInfo(newMadamInfo, uid, nextGid);

    return [type, this.lang.t('marrySystem.add_good_succ'), newMadamInfo];
  }

  /** MarrySystemFunc.php:458 getMadamFavorInfo：好感与冷却信息 + 下一档礼品。 */
  @GlobalCommand()
  async getMadamFavorInfo(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const madamHid = phpIntval(param[0]);
    const madamInfo = await this.one(
      sql`select * from mem_marry_hero_favor where uid = ${uid} and hid = ${madamHid}`,
    );
    const now = phpNum(await this.cell(sql`select unix_timestamp()`));
    if (madamInfo === false) throw GameError.lang('marrySystem.madam_not_exist');

    const leaveTime = Math.max(phpIntval(madamInfo.coolingEndtime) - now, 0);
    madamInfo.leaveCoolTime = leaveTime;

    const curGid = this.gidByFavor(phpIntval(madamInfo.favor));
    await this.addNextGoodInfo(madamInfo, uid, curGid);

    return [madamInfo];
  }

  // ───────────────────────────── 亲子与培养 ─────────────────────────────

  /** MarrySystemFunc.php:41 loadMarryChild：`[房间数, 孩子列表]`。 */
  @GlobalCommand()
  async loadMarryChild(ctx: CommandContext): Promise<unknown[]> {
    return this.childRows(ctx.uid);
  }

  private async childRows(uid: number): Promise<unknown[]> {
    await this.vivifyMarry(uid);
    const rCount = await this.cell(sql`select roomcount from sys_user_marry where uid = ${uid}`);
    const childInfos = await this.rows(sql`select s.*, m.mHid as motherHid, m.state,
        (select name from cfg_marry_mother_hero where hid = m.mHid) as motherName
      from sys_user_child s, mem_marry_relation m
      where s.hid = m.shid and s.uid = m.uid and s.uid = ${uid} order by s.hid asc`);
    return [rCount, childInfos];
  }

  /** MarrySystemFunc.php:52 loadChildCulture：进入培养界面（房间号校验 + 培养丹余量）。 */
  @GlobalCommand()
  async loadChildCulture(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.cultureRows(ctx.uid, phpIntval(param[0]), phpIntval(param[1]));
  }

  private async cultureRows(uid: number, roomIndex: number, hid: number): Promise<unknown[]> {
    const roomIdArr = [1, 2, 3];
    if (!roomIdArr.includes(roomIndex)) throw GameError.lang('marrySystem.room_num_error');

    const childInfo = await this.one(
      sql`select * from sys_user_child where uid = ${uid} and hid = ${hid}`,
    );
    if (childInfo === false) throw GameError.lang('marrySystem.child_not_exist');
    if (phpIntval(childInfo.out_hid) > 0) {
      throw GameError.lang('marrySystem.child_has_finish_culture');
    }

    await this.vivifyMarry(uid);
    const curHasOpenRoom = phpNum(
      await this.cell(sql`select roomcount from sys_user_marry where uid = ${uid}`),
    );
    if (roomIndex > curHasOpenRoom) throw GameError.lang('marrySystem.room_not_open');

    const goodInfo = await this.one(sql`select *, (select count from sys_goods
        where gid = '12059' and uid = ${uid}) as goodCnt
      from cfg_goods where gid = '12059'`);
    return [roomIndex, goodInfo === false ? null : goodInfo, childInfo];
  }

  /** MarrySystemFunc.php:78 deleteSpecialChild：周游列国（600 铜钱送走孩子换安慰礼包）。 */
  @GlobalCommand()
  async deleteSpecialChild(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const hid = phpIntval(param[0]);
    const childInfo = await this.one(
      sql`select * from sys_user_child where uid = ${uid} and hid = ${hid}`,
    );
    if (childInfo === false) throw GameError.lang('marrySystem.child_not_exist');
    if (phpIntval(childInfo.out_hid) > 0) throw GameError.lang('marrySystem.can_not_throw');

    if (
      !(await this.check(
        sql`select 1 from sys_goods where uid = ${uid} and gid = '152' and count >= 600`,
      ))
    ) {
      throw GameError.lang('marrySystem.core_not_enough');
    }

    await this.scope.transaction(async () => {
      await this.goods.addGoods(uid, 152, -600, 826);
      await sql`delete from sys_user_child where uid = ${uid} and hid = ${hid}`.execute(
        this.scope.db,
      );
      await sql`update mem_marry_relation set state = '1' where shid = ${hid} and uid = ${uid}`.execute(
        this.scope.db,
      );
      await sql`insert into log_child_status (hid, uid, out_hid, state, time)
        values (${hid}, ${uid}, ${phpIntval(childInfo.out_hid)}, '1', unix_timestamp())
        on duplicate key update state = '1', time = unix_timestamp()`.execute(this.scope.db);
      // 给玩家增加安慰礼包
      await this.goods.addGoods(uid, 50320, 1, 826);
    });

    return [this.lang.t('marrySystem.throw_child_succ'), await this.childRows(uid)];
  }

  /** MarrySystemFunc.php:101 completeCulture：按培养加值生成 herotype 10001 的子将入城。 */
  @GlobalCommand()
  async completeCulture(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const hid = phpIntval(param[0]);
    const heroInfo = await this.one(
      sql`select * from sys_user_child where uid = ${uid} and hid = ${hid}`,
    );
    if (heroInfo === false) throw GameError.lang('marrySystem.child_not_exist');
    this.resetCalcHeroAttr(heroInfo);

    const lastCid = phpIntval(
      await this.cell(sql`select lastcid from sys_user where uid = ${uid}`),
    );
    const heroName = addslashes(phpString(heroInfo.name));

    // 套用原来将领的头像图片
    const face =
      phpIntval(heroInfo.sex) === 0 ? this.random.mtRand(1, 9) : this.random.mtRand(1001, 1070);

    await this.scope.transaction(async () => {
      await sql`insert into sys_city_hero (uid, name, sex, face, cid, level, exp, command_base,
          affairs_base, bravery_base, wisdom_base, loyalty, herotype)
        values (${uid}, ${heroName}, ${phpIntval(heroInfo.sex)}, ${face}, ${lastCid}, '1', '0',
          ${phpNum(heroInfo.command)}, ${phpNum(heroInfo.affairs)}, ${phpNum(heroInfo.bravery)},
          ${phpNum(heroInfo.wisdom)}, '300', '10001')`.execute(this.scope.db);
      const newHid = phpIntval(await this.cell(sql`select last_insert_id()`));
      await sql`insert into mem_hero_blood (hid) values (${newHid})`.execute(this.scope.db);
      await sql`update sys_user_child set out_hid = ${newHid} where uid = ${uid} and hid = ${hid}`.execute(
        this.scope.db,
      );
      await sql`update mem_marry_relation set state = '4' where uid = ${uid} and shid = ${hid}`.execute(
        this.scope.db,
      );
      await sql`insert into log_child_status (hid, uid, out_hid, state, time)
        values (${hid}, ${uid}, ${newHid}, '4', unix_timestamp())
        on duplicate key update out_hid = ${newHid}, state = '4', time = unix_timestamp()`.execute(
        this.scope.db,
      );
    });

    return [this.lang.t('marrySystem.finish_culture'), await this.childRows(uid)];
  }

  /** MarrySystemFunc.php:137 changeChildName：只能改一次，敏感词与 PHP 同一套校验。 */
  @GlobalCommand()
  async changeChildName(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const hid = phpIntval(param[0]);
    let newName = phpTrim(param[1]);

    const heroInfo = await this.one(
      sql`select * from sys_user_child where uid = ${uid} and hid = ${hid}`,
    );
    if (heroInfo === false) throw GameError.lang('marrySystem.child_not_exist');
    if (phpIntval(heroInfo.is_change) > 0) throw GameError.lang('marrySystem.modify_name_once');
    if (mbStrlen(newName) > 4 /* MAX_HERO_NAME */) {
      throw GameError.lang('changeHeroName.name_too_long');
    } else if (newName.includes("'") || newName.includes('\\')) {
      throw GameError.lang('changeHeroName.invalid_char');
    } else if (newName.length === 0) {
      throw GameError.lang('changeHeroName.input_valid_name');
    }
    const lowername = newName.toLowerCase();
    if (
      await this.check(sql`select * from cfg_baned_name where instr(${lowername}, \`name\`) > 0`)
    ) {
      throw GameError.lang('changeHeroName.invalid_char');
    }

    newName = addslashes(newName);
    await this.scope.transaction(async () => {
      await sql`update sys_user_child set name = ${newName}, is_change = '1'
        where uid = ${uid} and hid = ${hid}`.execute(this.scope.db);
      if (phpIntval(heroInfo.out_hid) > 0) {
        await sql`update sys_city_hero set name = ${newName}
          where hid = ${phpIntval(heroInfo.out_hid)} and herotype = '10001'`.execute(this.scope.db);
      }
    });

    return [this.lang.t('shachange.change_success'), await this.childRows(uid)];
  }

  /** MarrySystemFunc.php:168 startCulture：消耗培养丹（12059），按加值总和掷成功率，
   *  成功再掷属性（1–4）与点数（70/25/5 → 1/2/3）。 */
  @GlobalCommand()
  async startCulture(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const hid = phpIntval(param[0]);
    const curRoomIndex = phpIntval(param[1]);

    const heroInfo = await this.one(
      sql`select * from sys_user_child where uid = ${uid} and hid = ${hid}`,
    );
    if (heroInfo === false) throw GameError.lang('marrySystem.child_not_exist');
    if (
      !(await this.check(
        sql`select 1 from sys_goods where uid = ${uid} and gid = '12059' and count >= 1`,
      ))
    ) {
      throw GameError.lang('marrySystem.chengzhandan_good_not_enough');
    }

    await this.goods.addGoods(uid, 12059, -1, 826);
    // 计算培养成功的概率
    let succRate = 0;
    const succRand = this.random.mtRand(1, 100);
    let cultureSucc = false;
    const currentTotal =
      phpIntval(heroInfo.command_add) +
      phpIntval(heroInfo.affairs_add) +
      phpIntval(heroInfo.bravery_add) +
      phpIntval(heroInfo.wisdom_add);
    if (currentTotal <= 100) {
      succRate = 80;
    } else if (currentTotal <= 200) {
      succRate = 60;
    } else if (currentTotal <= 300) {
      succRate = 20;
    } else if (currentTotal > 300) {
      succRate = 5;
    }
    if (succRand <= succRate) cultureSucc = true;

    let attrid = 0;
    let addValue = 0;
    if (cultureSucc) {
      // 计算属性类型和对应增加值
      attrid = this.random.mtRand(1, 4);
      const addValueRate = this.random.mtRand(1, 100);
      if (addValueRate <= 70) {
        addValue = 1;
      } else if (addValueRate <= 95) {
        addValue = 2;
      } else {
        addValue = 3;
      }
      const column =
        attrid === 1
          ? sql`command_add`
          : attrid === 2
            ? sql`affairs_add`
            : attrid === 3
              ? sql`bravery_add`
              : sql`wisdom_add`;
      await sql`update sys_user_child set ${column} = ${column} + ${addValue}
        where uid = ${uid} and hid = ${hid}`.execute(this.scope.db);
    }
    await sql`insert into log_child_culture (uid, hid, attid, value, time)
      values (${uid}, ${hid}, ${attrid}, ${addValue}, unix_timestamp())`.execute(this.scope.db);

    return [cultureSucc, [attrid, addValue], await this.cultureRows(uid, curRoomIndex, hid)];
  }

  /** MarrySystemFunc.php:229 openChildRoom：第 2/3 间各 200/400 元宝，封顶 3 间。 */
  @GlobalCommand()
  async openChildRoom(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    await this.vivifyMarry(uid);
    const curRoomInfo = await this.one(sql`select * from sys_user_marry where uid = ${uid}`);
    const userHasOpenCount = phpIntval(curRoomInfo === false ? undefined : curRoomInfo.roomcount);
    if (userHasOpenCount >= 3) throw GameError.lang('marrySystem.all_room_open');

    const needCost = userHasOpenCount === 1 ? 200 : 400;

    if (!(await this.checkMoney(uid, needCost))) {
      throw GameError.lang('buyGoods.no_enough_YuanBao');
    }
    await this.rewards.addMoney(uid, -needCost, 826);

    await sql`update sys_user_marry set roomcount = LEAST(roomcount + 1, 3) where uid = ${uid}`.execute(
      this.scope.db,
    );

    return this.childRows(uid);
  }

  /** MarrySystemFunc.php:245 doSpeedFeta：500 元宝减 77760s，每次怀孕限一次。 */
  @GlobalCommand()
  async doSpeedFeta(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const motherHid = phpIntval(param[0]);

    const now = phpNum(await this.cell(sql`select unix_timestamp()`));
    const heroInfo = await this.one(sql`select d.* from mem_marry_during d, mem_marry_hero_favor f
      where d.uid = f.uid and d.hid = f.hid and f.state = '2' and d.hid = ${motherHid}
      and f.uid = ${uid}`);
    if (heroInfo === false) throw GameError.lang('marrySystem.not_in_during');
    if (phpIntval(heroInfo.endtime) <= now) throw GameError.lang('marrySystem.during_has_finish');
    if (phpIntval(heroInfo.isSpeed) > 0) throw GameError.lang('marrySystem.has_speed');

    if (!(await this.checkMoney(uid, 500))) throw GameError.lang('buyGoods.no_enough_YuanBao');
    await this.rewards.addMoney(uid, -500, 826);

    const reducetime = 77760; // 72*3600*0.3
    await sql`update mem_marry_during set endtime = endtime - ${reducetime}, isSpeed = '1'
      where uid = ${uid} and hid = ${motherHid}`.execute(this.scope.db);

    const newMotherInfo = await this.one(
      sql`select * from mem_marry_during where uid = ${uid} and hid = ${motherHid}`,
    );
    if (newMotherInfo === false) throw GameError.lang('marrySystem.not_in_during');
    newMotherInfo.leaveDuringTime = Math.max(phpIntval(newMotherInfo.endtime) - now, 0);
    return [newMotherInfo];
  }

  /** MarrySystemFunc.php:285 getMadamChild：接生（200 铜钱或 180 元宝），roll 基础属性与名字。 */
  @GlobalCommand()
  async getMadamChild(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const type = phpIntval(param[0]);
    const motherHid = phpIntval(param[1]);

    if (type !== 1 && type !== 2) throw GameError.lang('marrySystem.child_type_error');
    const motherInfo = await this.one(sql`select c.*, m.* from cfg_marry_mother_hero c,
      mem_marry_hero_favor m where c.hid = m.hid and m.uid = ${uid} and m.hid = ${motherHid}`);
    if (motherInfo === false) throw GameError.lang('marrySystem.madam_not_exist');

    if (phpIntval(motherInfo.count) >= 2) throw GameError.lang('marrySystem.only_two_child');

    const durInfo = await this.one(
      sql`select * from mem_marry_during where uid = ${uid} and hid = ${phpIntval(motherInfo.hid)}`,
    );
    if (durInfo === false) throw GameError.lang('marrySystem.not_in_during_status');
    const now = phpNum(await this.cell(sql`select unix_timestamp()`));
    if (phpIntval(durInfo.endtime) > phpIntval(now)) {
      throw GameError.lang('marrySystem.in_during');
    }

    let curChildCount = phpNum(
      await this.cell(sql`select count(1) from sys_user_child where uid = ${uid}`),
    );
    if (phpEmpty(curChildCount)) curChildCount = 0;
    await this.vivifyMarry(uid);
    const curRoomCount = phpNum(
      await this.cell(sql`select roomcount from sys_user_marry where uid = ${uid}`),
    );
    if (curChildCount >= curRoomCount) throw GameError.lang('marrySystem.room_not_enough');

    if (type === 1) {
      // 铜钱
      const count = await this.cell(
        sql`select count from sys_goods where uid = ${uid} and gid = '152'`,
      );
      if (phpEmpty(count) || phpIntval(count) < 200) {
        throw GameError.lang('blackMarket.no_enough_copper');
      }
      await this.goods.addGoods(uid, 152, -200, 826);
    } else {
      // 元宝
      if (!(await this.checkMoney(uid, 180))) throw GameError.lang('buyGoods.no_enough_YuanBao');
      await this.rewards.addMoney(uid, -180, 826);
    }

    // 准备出生：基础属性 roll 20–30 加母亲四维的两成。
    const command = Math.floor(this.random.mtRand(20, 30) + phpIntval(motherInfo.command) * 0.2);
    const affaris = Math.floor(this.random.mtRand(20, 30) + phpIntval(motherInfo.affairs) * 0.2);
    const bravery = Math.floor(this.random.mtRand(20, 30) + phpIntval(motherInfo.bravery) * 0.2);
    const wisdom = Math.floor(this.random.mtRand(20, 30) + phpIntval(motherInfo.wisdom) * 0.2);
    const upgrade = this.random.mtRand(2, 5); // 基础成长值

    const sex = this.random.mtRand(0, 1); // 0女1男
    const face = sex === 0 ? this.random.mtRand(6, 10) : this.random.mtRand(1, 5);
    // 生成随机名字（原版 sex==0 取 boyname、sex==1 取 girlname——反着写的怪癖照抄）；
    // order by rand() 是差分里逐例固定的随机列（计谋先例）。
    let name: string;
    const xing = phpString(
      await this.cell(sql`select name from mem_cfg_firstname order by rand() limit 1`),
    );
    if (sex === 0) {
      const manName = phpString(
        await this.cell(sql`select name from mem_cfg_boyname order by rand() limit 1`),
      );
      name = xing + manName;
    } else {
      const womanName = phpString(
        await this.cell(sql`select name from mem_cfg_girlname order by rand() limit 1`),
      );
      name = xing + womanName;
    }
    name = addslashes(name);
    let qixin = 0;
    let wenpo = 0;
    if (phpIntval(durInfo.isSpeed) > 0) qixin = 2;
    if (type === 2) wenpo = 1;

    // 出生
    await this.scope.transaction(async () => {
      await sql`insert into sys_user_child (uid, name, sex, face, command_base, affairs_base,
          bravery_base, wisdom_base, qixin_multip, wenpo_multip, upgrade_value)
        values (${uid}, ${name}, ${sex}, ${face}, ${command}, ${affaris}, ${bravery}, ${wisdom},
          ${qixin}, ${wenpo}, ${upgrade})`.execute(this.scope.db);
      const childHid = phpIntval(await this.cell(sql`select last_insert_id()`));
      await sql`update mem_marry_hero_favor set count = LEAST(count + 1, 2), state = '1'
        where uid = ${uid} and hid = ${motherHid}`.execute(this.scope.db);
      await sql`insert into mem_marry_relation (uid, mHid, shid)
        values (${uid}, ${motherHid}, ${childHid})`.execute(this.scope.db);
      await sql`insert into log_child_status (hid, uid, out_hid, state, time)
        values (${childHid}, ${uid}, '0', '0', unix_timestamp())
        on duplicate key update state = '0', time = unix_timestamp()`.execute(this.scope.db);
      // 增加冷却时间 8 小时
      await sql`update mem_marry_hero_favor set coolingEndtime = unix_timestamp() + 28800,
        state = '1' where uid = ${uid} and hid = ${motherHid}`.execute(this.scope.db);
      await sql`delete from mem_marry_during where uid = ${uid} and hid = ${motherHid}`.execute(
        this.scope.db,
      );
    });

    const userName = await this.cell(sql`select name from sys_user where uid = ${uid}`);
    const informMsg = this.lang.t('marrySystem.child_out_inform', userName);
    await this.users.sendSysInform({
      type: 0,
      inuse: 1,
      starttime: 0,
      endtime: 300,
      interval: 1800,
      scrollcount: 1,
      color: 16247152,
      msg: informMsg,
    });

    const msg = this.lang.t('marrySystem.child_out_msg');
    const motherFavorInfo = await this.one(
      sql`select * from mem_marry_hero_favor where uid = ${uid} and hid = ${motherHid}`,
    );

    return [msg, motherFavorInfo];
  }
}
