import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { BuildingInfoService } from '../city/building-info.service';
import { HotelRules } from '../city/hotel-rules.service';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules, isActHero } from '../core/hero-rules.service';
import { phpIntval, phpNum } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
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
}
