import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { BuildingInfoService } from '../city/building-info.service';
import { HotelRules } from '../city/hotel-rules.service';
import { GAME_SPEED_RATE } from '../city/technic-rules.service';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { Building, CityRules, cid2wid, wid2cid } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules, isActHero } from '../core/hero-rules.service';
import { phpIntval, phpNum } from '../core/php';
import { RandomService } from '../core/random.service';
import { ReportService } from '../core/report.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { DialogCommand, type CommandContext } from '../gateway/decorators';
import { DefaultBoxService, SRC_RECRUIT_HERO } from '../goods/default-box.service';
import { TaskRewards } from '../task/task-rewards.service';

type Row = Record<string, unknown>;

/** 招贤榜: refreshes the 客栈's whole list. */
const GOODS_ZHAOXIANBANG = 23;
/** Task goals of hiring a hero and of using a 招贤榜. */
const GOAL_RECRUIT = 84;
const GOAL_ZHAOXIANBANG = 89;
/** 可造之材: a hero hired with a base attribute of 80 or more. */
const ACHIEVEMENT_TALENT = 35;
const TALENT_BASE = 80;
/** Event hero types above this may have a per-player cap (cfg_recruit_hero.userhavecnt). */
const CAPPED_HERO_TYPE = 10;

/** 市井传闻 and 鉴定宝藏 open at 客栈 level 5. */
const RUMOR_MIN_LEVEL = 5;
/** 结交 needs a 爵位 (nobility) of at least 2 (上造). */
const LIONIZE_MIN_NOBILITY = 2;
/** 结交 fee is the hero's level × this. */
const LIONIZE_GOLD_PER_LEVEL = 500;
/** 结交 slots: 2 by default, 5 while a 求贤诏 buff (buftype 22) runs. */
const LIONIZE_SLOTS = 2;
const LIONIZE_SLOTS_BUFFED = 5;
const QIUXIANZHAO_BUFTYPE = 22;
/** sys_lionize.state: 0 befriended / 1 pursuing / 2 own / 3 captive. */
const LIONIZE_STATE_FRIEND = 1;
/** 市井传闻 block length at 客栈 level 1; level n refreshes n× as often. */
const RUMOR_BLOCK_SECONDS = 3600;
const TIMEZONE_OFFSET = 8 * 3600;
/** 搜索消息 costs 1000 黄金, 更多传闻 costs 100. */
const SEARCH_RUMOR_GOLD = 1000;
const MORE_RUMOR_GOLD = 100;
/** 鉴宝图: the item treasureIdentify consumes. */
const GOODS_TREASURE_MAP = 118;
/** sys_report.title of a 市井传闻 ask and a 宝藏鉴定. */
const REPORT_TITLE_RUMOR = 19;
const REPORT_TITLE_TREASURE = 31;
/** cfg_act.type of the 鉴定宝藏活动; openDefaultBox srctype for it. */
const ACT_TREASURE = 2101;
const SRC_TREASURE_ACT = 2100;
/** Task goals finished along the way. */
const GOAL_JIEJIAO = 999;
const TASK_JIEJIAO = 331;
const GOAL_SEARCH_RUMOR = 367;
/** logUserAction reasons: 结交 7, 记录传闻任务 8, 询问详情 9. */
const ACTION_JIEJIAO = 7;
const ACTION_RECORD_TASK = 8;
const ACTION_ASK_DETAIL = 9;
/** A treasure map's lifetime (24h). */
const TREASURE_MAP_TTL = 86400;

/** The 客栈 commands of HotelFunc.php. */
@Injectable()
export class HotelCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly info: BuildingInfoService,
    private readonly hotel: HotelRules,
    private readonly cityRules: CityRules,
    private readonly goods: GoodsRules,
    private readonly heroes: HeroRules,
    private readonly tasks: TaskRules,
    private readonly rewards: TaskRewards,
    private readonly boxes: DefaultBoxService,
    private readonly users: UserRules,
    private readonly report: ReportService,
    private readonly random: RandomService,
  ) {}

  private async row(query: RawBuilder<unknown>): Promise<Row | undefined> {
    return (await query.execute(this.scope.db)).rows[0] as Row | undefined;
  }

  private async cell(query: RawBuilder<unknown>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : false;
  }

  /**
   * `[id]`: hires the offered hero for its gold into a free 招贤馆 slot. An event hero may
   * come with a gift, announced after the 客栈 info.
   */
  @DialogCommand()
  async recruitHero(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid, cid } = ctx;
    const id = phpIntval(param[0]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const recruit = await this.row(sql`select * from sys_recruit_hero
        where cid = ${cid} and id = ${id}`);
      let actMessage: string | false = false;
      if (recruit) {
        if (!(await this.hotel.cityHasHeroPosition(uid, cid))) {
          throw GameError.lang('recruitHero.hotel_level_low');
        }
        const gold = await this.cell(sql`select gold from mem_city_resource where cid = ${cid}`);
        if (phpNum(recruit.gold_need) > phpNum(gold)) {
          throw GameError.lang('recruitHero.no_enough_gold');
        }
        if (phpNum(recruit.herotype) > CAPPED_HERO_TYPE) {
          const config = await this.row(sql`select * from cfg_recruit_hero
            where herotype = ${recruit.herotype}`);
          const cap = phpNum(config?.userhavecnt);
          const owned = await this.cell(sql`select count(*) from sys_city_hero
            where uid = ${uid} and herotype = ${recruit.herotype}`);
          if (cap > 0 && cap <= phpIntval(owned)) {
            throw GameError.lang('recruitHero.already_Have_One', cap, recruit.name);
          }
        }

        await this.cityRules.addCityResources(cid, 0, 0, 0, 0, -phpNum(recruit.gold_need));
        const inserted = await sql`insert into sys_city_hero (uid, name, sex, face, cid, state,
            level, exp, affairs_base, bravery_base, wisdom_base, command_base, affairs_add,
            bravery_add, wisdom_add, command_add_on, loyalty, herotype)
          values (${uid}, ${recruit.name}, ${recruit.sex}, ${recruit.face}, ${cid}, 0,
            ${recruit.level}, ${recruit.exp}, ${recruit.affairs_base}, ${recruit.bravery_base},
            ${recruit.wisdom_base}, ${recruit.command_base}, ${recruit.affairs_add},
            ${recruit.bravery_add}, ${recruit.wisdom_add}, ${recruit.command_add},
            ${recruit.loyalty}, ${recruit.herotype})`.execute(db);
        const hid = Number(inserted.insertId);
        const level = phpNum(recruit.level);
        const forceMax =
          100 +
          Math.floor(level / 5) +
          Math.floor((phpNum(recruit.bravery_base) + phpNum(recruit.bravery_add)) / 3);
        const energyMax =
          100 +
          Math.floor(level / 5) +
          Math.floor((phpNum(recruit.wisdom_base) + phpNum(recruit.wisdom_add)) / 3);
        await sql`insert into mem_hero_blood (hid, \`force\`, force_max, energy, energy_max)
          values (${hid}, 100, ${forceMax}, 100, ${energyMax})`.execute(db);

        actMessage = await this.recruitHeroAct(uid, cid, recruit.herotype);
        await sql`delete from sys_recruit_hero where id = ${id}`.execute(db);
        await this.heroes.updateCityHeroChange(uid, cid);
        await this.tasks.completeTask(uid, GOAL_RECRUIT);
        if (
          phpNum(recruit.affairs_base) >= TALENT_BASE ||
          phpNum(recruit.bravery_base) >= TALENT_BASE ||
          phpNum(recruit.wisdom_base) >= TALENT_BASE
        ) {
          await this.rewards.finishAchievement(uid, ACHIEVEMENT_TALENT);
        }
      }
      const ret = await this.info.hotelInfo(uid, cid);
      if (actMessage) ret.push(this.lang.t('act.msg_tip', actMessage));
      return ret;
    });
  }

  /** `[]`: a 招贤榜 refreshes the whole list at the next look. */
  @DialogCommand()
  async resetRecruitHero(ctx: CommandContext): Promise<unknown[]> {
    const { uid, cid } = ctx;
    return this.scope.transaction(async () => {
      if (!(await this.goods.checkGoods(uid, GOODS_ZHAOXIANBANG))) {
        throw GameError.raw(`not_enough_goods${GOODS_ZHAOXIANBANG}`);
      }
      await sql`update mem_city_schedule set last_reset_recruit = 0
        where cid = ${cid}`.execute(this.scope.db);
      await this.tasks.completeTask(uid, GOAL_ZHAOXIANBANG);
      await this.goods.reduceGoods(uid, GOODS_ZHAOXIANBANG, 1);
      return this.info.hotelInfo(uid, cid);
    });
  }

  /** ActFunc.php::checkAndDoRecruitHeroAct: an event hero hired while its event runs. */
  private async recruitHeroAct(
    uid: number,
    cid: number,
    herotype: unknown,
  ): Promise<string | false> {
    if (!isActHero(herotype)) return false;
    const rate = await this.cell(sql`select rate from cfg_act
      where actid in (select actid from cfg_recruit_hero where herotype = ${herotype})
        and unix_timestamp() between starttime and endtime limit 1`);
    if (!phpNum(rate)) return false;
    return this.boxes.openEvent(uid, cid, phpIntval(herotype), SRC_RECRUIT_HERO);
  }

  // ------------------------------------------------------------------ 结交名将

  /**
   * `[]`: the 结交名将 list — every row in sys_lionize for this player joined to the npc hero's
   * introduction, its live location and the master's friendship, then the whole sys_lionize
   * table and whether 游说 is closed. Answers `[myRows, allRows, persuadeClosed]`.
   */
  @DialogCommand()
  async getJiejiaoHero(ctx: CommandContext): Promise<unknown[]> {
    const { uid } = ctx;
    const mine = await this.rows(sql`select a.*, b.name as npcname, c.introduce, d.state,
        d.friend, e.friend as npcstate
      from sys_lionize d
      left join cfg_npc_hero c on d.npcid = c.npcid
      left join sys_city_hero a on c.npcid = a.npcid
      left join sys_user b on a.uid = b.uid
      left join sys_lionize e on b.uid = e.uid and a.npcid = e.npcid
      where d.uid = ${uid}`);
    const all = await this.rows(sql`select * from sys_lionize`);
    return [mine, all, (await this.isPersuadeClose()) ? 1 : 0];
  }

  /**
   * `[rumorId]`: before 结交, resolves the rumor's hero and the gold it costs (level × 500).
   * Answers `[hid, goldNeed]`.
   */
  @DialogCommand()
  async tryLionizeHero(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const id = phpIntval(param[0]);
    const hid = phpIntval(await this.cell(sql`select typeid from sys_city_rumor where id = ${id}`));
    const hero = await this.row(sql`select * from sys_city_hero where hid = ${hid}`);
    const goldNeed = phpNum(hero?.level) * LIONIZE_GOLD_PER_LEVEL;
    return [hid, goldNeed];
  }

  /**
   * `[hid]`: 结交 a famous hero — spends the city's gold and marks sys_lionize state 1 with a
   * starting friendship of 10. Requires a free 结交 slot (2, or 5 with a 求贤诏 buff) and a 爵位
   * of at least 上造. Throws the success message (the original signals 结交 that way).
   */
  @DialogCommand()
  async lionizeHero(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid, cid } = ctx;
    const hid = phpIntval(param[0]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      if (
        phpIntval(await this.cell(sql`select npcid from sys_city_hero where hid = ${hid}`)) === 0
      ) {
        throw GameError.lang('recruitHero.not_hero');
      }

      const buffEnd = await this.cell(sql`select endtime from mem_user_buffer
        where uid = ${uid} and buftype = ${QIUXIANZHAO_BUFTYPE} and endtime > unix_timestamp()`);
      const buffed = phpNum(buffEnd) > 0;
      const limit = buffed ? LIONIZE_SLOTS_BUFFED : LIONIZE_SLOTS;
      const used = phpNum(
        await this.cell(sql`select count(*) from sys_lionize
          where uid = ${uid} and state = ${LIONIZE_STATE_FRIEND}`),
      );
      if (used >= limit) {
        if (buffed) throw GameError.lang('recruitHero.no_site');
        throw GameError.raw('ask_to_use_qiuxianzhao');
      }

      const myState = await this.cell(sql`select state from sys_lionize
        where uid = ${uid} and npcid = ${hid}`);
      if (phpNum(myState) !== 0) throw GameError.lang('recruitHero.need_not');

      const hero = await this.row(sql`select * from sys_city_hero where hid = ${hid}`);
      const goldNeed = phpNum(hero?.level) * LIONIZE_GOLD_PER_LEVEL;
      const cityGold = await this.cell(sql`select gold from mem_city_resource where cid = ${cid}`);
      if (goldNeed > phpNum(cityGold)) throw GameError.lang('recruitHero.no_enough_gold');

      const nobility = await this.users.bufferNobility(
        uid,
        await this.cell(sql`select nobility from sys_user where uid = ${uid}`),
      );
      if (nobility < LIONIZE_MIN_NOBILITY) throw GameError.lang('recruitHero.no_enough_nobility');

      await this.cityRules.addCityResources(cid, 0, 0, 0, 0, -goldNeed);
      await sql`insert into sys_lionize (uid, npcid, friend, state) values (${uid}, ${hid}, 10, 1)
        on duplicate key update friend = 10, state = 1`.execute(db);
      await this.tasks.completeTask(uid, GOAL_JIEJIAO);
      await this.tasks.completeTaskWithTaskid(uid, TASK_JIEJIAO);
      await this.users.logUserAction(uid, ACTION_JIEJIAO);
      throw GameError.lang('recruitHero.jiejiao_succ');
    });
  }

  /**
   * `[hid]`: 断交 — drops the friendship and any name-hero task group. An 自己人 (state 2) or
   * 俘虏 (state 3) cannot be dropped. Answers `[message]`.
   */
  @DialogCommand()
  async onCancelFriend(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const hid = phpIntval(param[0]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const state = phpNum(
        await this.cell(sql`select state from sys_lionize where uid = ${uid} and npcid = ${hid}`),
      );
      if (state === 2) throw GameError.lang('cancelHeroFriend.cancel_fail_zijiren');
      if (state === 3) throw GameError.lang('cancelHeroFriend.cancel_fail_fulu');

      const taskGroup = hid * 10 + 20001;
      await sql`delete from sys_hero_task where uid = ${uid} and \`group\` = ${taskGroup}`.execute(
        db,
      );
      await sql`insert into log_lionize (uid, npcid, \`type\`, \`count\`, \`time\`)
        select uid, npcid, 17, 0, unix_timestamp() from sys_lionize
        where uid = ${uid} and npcid = ${hid}`.execute(db);
      await sql`delete from sys_lionize where uid = ${uid} and npcid = ${hid}`.execute(db);
      return [this.lang.t('cancelHeroFriend.cancel_succ')];
    });
  }

  /** HotelFunc.php::isPersuadeClose: 游说 is off on servers opened after 2011-07-27. */
  private async isPersuadeClose(): Promise<boolean> {
    const openTime = await this.cell(sql`select value from mem_state where state = 6`);
    return phpNum(openTime) > 1311696000;
  }

  // ------------------------------------------------------------------ 市井传闻

  /**
   * `[]`: the 市井传闻 list. Needs 客栈 level 5. Each elapsed block (1h ÷ level) drops the oldest
   * rumor and refills to the 客栈's level with a random famous-hero rumor. Answers the rows.
   */
  @DialogCommand()
  async getRumorList(ctx: CommandContext): Promise<unknown[]> {
    const { uid, cid } = ctx;
    return this.scope.transaction(async () => {
      const level = await this.hotelLevelOfLastCity(uid);
      if (level < RUMOR_MIN_LEVEL) throw GameError.lang('getRumor.hotel_level_low');
      await this.refreshRumors(cid, level);
      return this.rows(sql`select * from sys_city_rumor where cid = ${cid} order by id desc`);
    });
  }

  /** HotelFunc.php's block refresh of sys_city_rumor. */
  private async refreshRumors(cid: number, hotellevel: number): Promise<void> {
    const db = this.scope.db;
    const lastReset = phpNum(
      await this.cell(sql`select last_reset_rumor from mem_city_schedule where cid = ${cid}`),
    );
    if (lastReset === 0) {
      await sql`insert into mem_city_schedule (cid, last_reset_rumor) values (${cid}, unix_timestamp())
        on duplicate key update last_reset_rumor = unix_timestamp()`.execute(db);
    }
    const now = phpNum(await this.cell(sql`select unix_timestamp()`));
    const blocksize = RUMOR_BLOCK_SECONDS / GAME_SPEED_RATE / hotellevel;
    const delta =
      Math.floor((now + TIMEZONE_OFFSET) / blocksize) -
      Math.floor((lastReset + TIMEZONE_OFFSET) / blocksize);
    if (delta <= 0) return;
    await sql`delete from sys_city_rumor where cid = ${cid} order by id limit ${delta}`.execute(db);
    const count = phpNum(
      await this.cell(sql`select count(*) from sys_city_rumor where cid = ${cid}`),
    );
    for (let i = count; i < hotellevel; i++) await this.generateHeroRumor(cid);
    await sql`update mem_city_schedule set last_reset_rumor = unix_timestamp()
      where cid = ${cid}`.execute(db);
  }

  /** HotelFunc.php::generateHeroRumor: a random hero not already rumoured in this city. */
  private async generateHeroRumor(cid: number): Promise<void> {
    const existing = await this.cell(sql`select group_concat(typeid) from sys_city_rumor
      where cid = ${cid} and type = 0`);
    const rumor = phpNum(existing)
      ? await this.row(sql`select * from cfg_rumor_hero
          where npcid not in (${sql.raw(String(existing))}) order by rand() limit 1`)
      : await this.row(sql`select * from cfg_rumor_hero order by rand() limit 1`);
    if (rumor) await this.addHeroRumor(cid, phpIntval(rumor.npcid), phpNum(rumor.price));
  }

  private async addHeroRumor(cid: number, npcid: number, price: number): Promise<void> {
    const name = await this.cell(sql`select name from cfg_npc_hero where npcid = ${npcid}`);
    await sql`insert into sys_city_rumor (cid, name, type, typeid, price)
      values (${cid}, ${name === false ? '' : name}, 0, ${npcid}, ${price})`.execute(this.scope.db);
  }

  /**
   * `[rumorId]`: reads one rumor's detail header (whether the hero is locatable and the gold a
   * 询问详情 would cost). Only the famous-hero branch is self-contained; a 任务物品 / 军队 rumor
   * depends on the world-map task system of a later stage. Answers the original's array.
   */
  @DialogCommand()
  async getRumor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const id = phpIntval(param[0]);
    const rumor = await this.row(sql`select * from sys_city_rumor where id = ${id}`);
    if (!rumor) throw GameError.lang('getRumor.never_heard');
    if (phpNum(rumor.type) !== 0) {
      throw new Error(
        `getRumor(type=${phpNum(rumor.type)}): 任务物品/军队 rumor needs the world-map task system (not ported)`,
      );
    }
    const ret: unknown[] = [rumor];
    const info = await this.row(sql`select * from cfg_npc_hero where npcid = ${rumor.typeid}`);
    ret.push(info);
    const hero = await this.row(sql`select * from sys_city_hero where npcid = ${rumor.typeid}`);
    if (!hero) {
      ret.push(this.lang.t('getRumor.dont_know_where_he_is'));
      ret.push(false);
    } else {
      const place = await this.posDescription(phpIntval(hero.cid));
      ret.push(this.lang.t('getRumor.pay_for_hero', rumor.name, place, rumor.price));
      ret.push(true);
    }
    ret.push(true);
    return ret;
  }

  /** `[]`: spends 100 黄金 to reset the 市井传闻 refresh clock, then returns the fresh list. */
  @DialogCommand()
  async moreRumor(ctx: CommandContext): Promise<unknown[]> {
    const { uid, cid } = ctx;
    return this.scope.transaction(async () => {
      const gold = await this.cell(sql`select gold from mem_city_resource where cid = ${cid}`);
      if (phpNum(gold) < MORE_RUMOR_GOLD) throw GameError.lang('moreRumor.no_enough_gold');
      await sql`update mem_city_resource set gold = gold - ${MORE_RUMOR_GOLD}
        where cid = ${cid}`.execute(this.scope.db);
      await sql`update mem_city_schedule set last_reset_rumor = 0
        where cid = ${cid}`.execute(this.scope.db);
      const level = await this.hotelLevelOfLastCity(uid);
      await this.refreshRumors(cid, level);
      return this.rows(sql`select * from sys_city_rumor where cid = ${cid} order by id desc`);
    });
  }

  /**
   * `[name]`: spends 1000 黄金 to search for a named hero (the 任务物品 / 军队 searches depend on
   * the world-map task system of a later stage and are left unported). Replaces that many of the
   * oldest rumors. Answers the fresh list.
   */
  @DialogCommand()
  async searchRumor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid, cid } = ctx;
    const input = String(param[0] ?? '').trim();
    if (input === '') throw GameError.lang('searchRumor.input_name_to_seartch');
    return this.scope.transaction(async () => {
      const level = phpNum(
        await this.cell(sql`select level from sys_building
          where cid = ${cid} and bid = ${Building.Hotel} limit 1`),
      );
      if (level <= 0) throw GameError.lang('searchRumor.no_hotel_built');
      const gold = await this.cell(sql`select gold from mem_city_resource where cid = ${cid}`);
      if (phpNum(gold) < SEARCH_RUMOR_GOLD) throw GameError.lang('searchRumor.no_enough_gold');

      const heroes = await this.rows(sql`select r.* from cfg_rumor_hero r, cfg_npc_hero n
        where r.npcid = n.npcid and n.name like ${'%' + input + '%'} order by rand() limit ${level}`);
      // The 任务物品 / 军队 branches need the world-map task tables of a later stage.
      if (heroes.length <= 0) throw GameError.lang('searchRumor.no_useful_info');

      await sql`delete from sys_city_rumor where cid = ${cid} order by id
        limit ${heroes.length}`.execute(this.scope.db);
      for (const rumor of heroes) {
        await this.addHeroRumor(cid, phpIntval(rumor.npcid), phpNum(rumor.price));
      }
      await sql`update mem_city_schedule set last_reset_rumor = unix_timestamp()
        where cid = ${cid}`.execute(this.scope.db);
      await sql`update mem_city_resource set gold = gold - ${SEARCH_RUMOR_GOLD}
        where cid = ${cid}`.execute(this.scope.db);
      await this.tasks.completeTask(uid, GOAL_SEARCH_RUMOR);
      return this.rows(sql`select * from sys_city_rumor where cid = ${cid} order by id desc`);
    });
  }

  /**
   * `[rumorId, paytype]`: pays 元宝 (0) or 礼金 (1) to learn a famous hero's exact location,
   * granting the hero's 画像 (thing 20000+npcid) and filing a 市井传闻 report. The 任务物品 branch
   * depends on the world-map task system of a later stage. Answers the original's array.
   */
  @DialogCommand()
  async askDetail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid, cid } = ctx;
    const id = phpIntval(param[0]);
    const paytype = phpIntval(param[1]);
    if (paytype !== 0 && paytype !== 1) throw GameError.lang('buyGoods.invalid_pay_type');
    const rumor = await this.row(sql`select * from sys_city_rumor where id = ${id}`);
    if (!rumor) throw GameError.lang('askDetail.never_heard');
    if (phpNum(rumor.type) !== 0) {
      throw new Error(
        `askDetail(type=${phpNum(rumor.type)}): 任务物品 rumor needs the world-map task system (not ported)`,
      );
    }
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const user = await this.row(sql`select money, gift from sys_user where uid = ${uid}`);
      const price = phpNum(rumor.price);
      if (paytype === 0 && phpNum(user?.money) < price)
        throw GameError.lang('askDetail.no_enough_YuanBao');
      if (paytype === 1 && phpNum(user?.gift) < price)
        throw GameError.lang('askDetail.no_enough_Gift');

      const hero = await this.row(sql`select * from sys_city_hero where npcid = ${rumor.typeid}`);
      if (!hero) throw GameError.lang('askDetail.no_info_of_hero');
      const heroInfo = await this.row(
        sql`select * from cfg_npc_hero where npcid = ${rumor.typeid}`,
      );
      const ret: unknown[] = [rumor, heroInfo];

      const place = await this.posDescription(phpIntval(hero.cid));
      const msg = this.lang.t('askDetail.hero_location', rumor.name, place);
      ret.push(msg);
      ret.push(false);
      ret.push(true);

      // 画像 (thing 20000+npcid) lets the player later find and capture the hero.
      const tid = phpIntval(heroInfo?.npcid) + 20000;
      if (paytype === 0) await this.rewards.addMoney(uid, -price, 90);
      else await this.rewards.addGift(uid, -price, 90);
      await sql`insert into sys_things (uid, tid, count) values (${uid}, ${tid}, 1)
        on duplicate key update \`count\` = 1`.execute(db);

      let report = String(heroInfo?.name ?? '');
      if (!this.empty(heroInfo?.zi)) report += this.lang.t('askDetail.word') + String(heroInfo?.zi);
      report += '。' + String(heroInfo?.introduce ?? '') + '<br/>' + msg;
      await this.report.sendReport(uid, REPORT_TITLE_RUMOR, cid, cid, report);
      await this.users.logUserAction(uid, ACTION_ASK_DETAIL);
      return ret;
    });
  }

  /**
   * `[rumorId]`: records a famous hero rumor as a 捉将 task pair (tids 20000+/30000+npcid). The
   * 任务物品 branch depends on cfg_thing_task of a later stage. Throws the success message.
   */
  @DialogCommand()
  async recordTask(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const id = phpIntval(param[0]);
    const rumor = await this.row(sql`select * from sys_city_rumor where id = ${id}`);
    if (rumor && phpNum(rumor.type) === 0) {
      const npcid = phpIntval(rumor.typeid);
      const taskid1 = 20000 + npcid;
      const taskid2 = 30000 + npcid;
      return this.scope.transaction(async () => {
        const db = this.scope.db;
        if (
          await this.exists(sql`select uid from sys_user_task where uid = ${uid}
            and (tid = ${taskid1} or tid = ${taskid2}) and state = 0`)
        ) {
          throw GameError.lang('recordTask.task_already_recorded');
        }
        const owner = await this.cell(sql`select uid from sys_city_hero where hid = ${npcid}`);
        if (phpNum(owner) === uid) throw GameError.lang('recordTask.npc_hero_exist');
        const taskCount = phpNum(
          await this.cell(sql`select count(distinct(t.\`group\`)) from sys_user_task u, cfg_task t
            where u.tid = t.id and u.uid = ${uid} and u.state = 0 and u.tid > 20000 and u.tid < 40000`),
        );
        if (taskCount >= 25) throw GameError.lang('recordTask.task_list_full');
        await sql`delete a from sys_user_goal a, cfg_task_goal b where a.uid = ${uid}
          and a.gid = b.id and (b.tid = ${taskid1} or b.tid = ${taskid2})`.execute(db);
        await sql`insert into sys_user_task (uid, tid, state) values (${uid}, ${taskid1}, 0)
          on duplicate key update state = 0`.execute(db);
        await sql`insert into sys_user_task (uid, tid, state) values (${uid}, ${taskid2}, 0)
          on duplicate key update state = 0`.execute(db);
        await this.users.logUserAction(uid, ACTION_RECORD_TASK);
        throw GameError.lang('recordTask.task_record_succ');
      });
    }
    if (rumor && phpNum(rumor.type) === 1) {
      throw new Error('recordTask(type=1): 任务物品 cfg_thing_task not ported');
    }
    throw GameError.lang('recordTask.no_rumor_to_record');
  }

  // ------------------------------------------------------------------ 鉴定宝藏

  /**
   * `[paytype]`: spends a 鉴宝图 (thing 118) to mark a random non-plain wild field within 100
   * cells as a treasure site for 24h, filing a 宝藏鉴定 report. An event may add a gift. Throws
   * the success message. (The original's 元宝/礼金 cost is commented out upstream, so paytype is
   * unused here too.)
   */
  @DialogCommand()
  async treasureIdentify(ctx: CommandContext): Promise<unknown[]> {
    const { uid, cid } = ctx;
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      if (!(await this.goods.checkGoods(uid, GOODS_TREASURE_MAP))) {
        throw GameError.raw(`not_enough_goods${GOODS_TREASURE_MAP}`);
      }

      // 100 cells (10×10 blocks) around the city's own block.
      const y10 = Math.floor(Math.floor(cid / 1000) / 10);
      const x10 = Math.floor((cid % 1000) / 10);
      const wstart = (y10 * 100 + x10) * 100;
      const wend = wstart + 100;
      const worlds = await this.rows(sql`select type, wid from mem_world
        where wid > ${wstart} and wid < ${wend} and province <= 13 and type > 1 and level > 0`);
      if (worlds.length === 0) throw GameError.lang('treasure.has_not');

      const pick = worlds[this.random.mtRand(0, worlds.length - 1)];
      if (!pick) throw GameError.lang('treasure.has_not');
      const targetcid = wid2cid(pick.wid);
      await this.goods.reduceGoods(uid, GOODS_TREASURE_MAP, 1);
      await sql`insert into mem_treasure_map (uid, cid, endtime)
        values (${uid}, ${targetcid}, unix_timestamp() + ${TREASURE_MAP_TTL})`.execute(db);

      const x = targetcid % 1000;
      const y = Math.floor(targetcid / 1000);
      const fieldName = this.lang.t(`fileName.${phpIntval(pick.type)}`);
      const endAt = await this.makeEndTime(
        phpNum(await this.cell(sql`select unix_timestamp() + ${TREASURE_MAP_TTL}`)),
      );
      let msg = this.lang.t('treasure.report', fieldName, x, y, endAt);

      let actMsg = await this.treasureIdentifyAct(uid, cid);
      if (actMsg) {
        actMsg = this.lang.t('treasure.act_msg', actMsg);
        msg += '<br/><br/>' + actMsg;
        actMsg = '\n' + actMsg;
      }
      await this.report.sendReport(uid, REPORT_TITLE_TREASURE, cid, cid, msg);
      throw GameError.raw(this.lang.t('treasure.succ') + (actMsg || ''));
    });
  }

  /** ActFunc.php::checkAndDoTreasureIdentifyAct: a 鉴定宝藏活动 gift roll. */
  private async treasureIdentifyAct(uid: number, cid: number): Promise<string | false> {
    const act = await this.row(sql`select actid, rate from cfg_act where type = ${ACT_TREASURE}
      and unix_timestamp() between starttime and endtime limit 1`);
    if (!act) return false;
    if (this.random.mtRand(1, 100) > phpNum(act.rate)) return false;
    return this.boxes.openEvent(uid, cid, phpIntval(act.actid), SRC_TREASURE_ACT);
  }

  // ------------------------------------------------------------------ helpers

  /** utils.php::getPosDescription: the place name and [x,y] of a cid. */
  private async posDescription(cid: number): Promise<string> {
    const worldType = phpIntval(
      await this.cell(sql`select type from mem_world where wid = ${cid2wid(cid)}`),
    );
    let name: unknown;
    if (worldType === 0) {
      name = await this.cell(sql`select name from sys_city where cid = ${cid}`);
    } else {
      name = await this.cell(sql`select name from cfg_world_type where type = ${worldType}`);
    }
    return `${name === false ? '' : name}[${cid % 1000},${Math.floor(cid / 1000)}]`;
  }

  /** utils.php::MakeEndTime: formats a unix time as `Y年M月D日 H:i:s` via MySQL. */
  private async makeEndTime(endtime: number): Promise<string> {
    const fmt =
      '%Y' +
      this.lang.t('MakeEndTime.year') +
      '%m' +
      this.lang.t('MakeEndTime.month') +
      '%d' +
      this.lang.t('MakeEndTime.day') +
      ' %H:%i:%s';
    const value = await this.cell(sql`select from_unixtime(${endtime}, ${fmt})`);
    return value === false ? '' : String(value);
  }

  /** The 客栈 level of the player's current city (lastcid), 0 if none. */
  private async hotelLevelOfLastCity(uid: number): Promise<number> {
    return phpNum(
      await this.cell(sql`select b.level from sys_building b, sys_user u
        where b.cid = u.lastcid and b.bid = ${Building.Hotel} and u.uid = ${uid} limit 1`),
    );
  }

  private async exists(query: RawBuilder<unknown>): Promise<boolean> {
    return (await this.row(query)) !== undefined;
  }

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private empty(v: unknown): boolean {
    return v === undefined || v === null || v === '' || v === 0 || v === '0' || v === false;
  }
}
