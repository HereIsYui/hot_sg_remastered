import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { CityInfoService } from '../city/city-info.service';
import { GameError } from '../common/game-error';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { OwnershipService } from '../core/ownership.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum } from '../core/php';
import { RandomService } from '../core/random.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { TaskRewards } from '../task/task-rewards.service';

type Row = Record<string, unknown>;

/** 技能领悟书: one per new random skill. */
const GOODS_RESET_SKILL = 10668;
/** Skill book slots without any bought, the most there can be, and 10 more for 50 元宝. */
const SHELF_DEFAULT = 100;
const SHELF_MAX = 500;
const SHELF_PRICE = 50;
/** log_money reason of more skill book slots. */
const LOG_SHELF = 31;
/** Gold a book sells for, per level. */
const BOOK_PRICE = 5000;
/** Books (cfg_book.id) that change their city's production. */
const PRODUCTION_BOOKS = new Set([8, 9, 10, 11, 12, 13]);

/** HeroSkillFunc.php: a hero's skill, the books that strengthen it, and the book shelf. */
@Injectable()
export class SkillCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly info: CityInfoService,
    private readonly cityRules: CityRules,
    private readonly goods: GoodsRules,
    private readonly heroes: HeroRules,
    private readonly ownership: OwnershipService,
    private readonly rewards: TaskRewards,
    private readonly random: RandomService,
  ) {}

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async row(query: RawBuilder<unknown>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  private async cell(query: RawBuilder<unknown>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : false;
  }

  /** `[]`: `[slots, books not worn]`. */
  @GlobalCommand()
  async loadUserValidSkillBook(ctx: CommandContext): Promise<unknown[]> {
    const { uid } = ctx;
    const books = await this.rows(sql`select *, a.id as xid from sys_user_book a
      left join cfg_book b on a.bid = b.skill and a.level = b.level
      where a.uid = ${uid} and a.hid = 0 order by a.id`);
    const shelf = await this.cell(sql`select num from sys_user_bookshelfnum where uid = ${uid}`);
    return [phpEmpty(shelf) ? SHELF_DEFAULT : shelf, books];
  }

  /** `[]`: 10 more book slots for 50 元宝; answers `[slots]`. */
  @GlobalCommand()
  async AddSkillBookShelf(ctx: CommandContext): Promise<unknown[]> {
    const { uid } = ctx;
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const money = await this.cell(sql`select money from sys_user where uid = ${uid}`);
      if (phpIntval(money) < SHELF_PRICE) {
        throw GameError.lang('add_bookShelfNum.no_enough_YuanBao');
      }
      const current = await this.cell(sql`select num from sys_user_bookshelfnum
        where uid = ${uid}`);
      if (phpIntval(current) >= SHELF_MAX) {
        throw GameError.lang('add_bookShelfNum.armor_column_full');
      }
      await this.rewards.addMoney(uid, -SHELF_PRICE, LOG_SHELF);
      await sql`insert into sys_user_bookshelfnum (uid, num) values (${uid}, ${SHELF_DEFAULT + 10})
        on duplicate key update num = num + 10`.execute(db);
      return [await this.cell(sql`select num from sys_user_bookshelfnum where uid = ${uid}`)];
    });
  }

  /** `[cid, id]`: a book not worn for 5000 gold per level; answers `[id, cid, gold]`. */
  @GlobalCommand()
  async sellBook(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const id = phpIntval(param[1]);
    return this.scope.transaction(async () => {
      await this.ownership.checkCityExist(cid, uid);
      const book = await this.row(sql`select * from sys_user_book
        where id = ${id} and uid = ${uid} and hid = 0`);
      if (!book) throw GameError.lang('book.no_skill_book');
      await sql`delete from sys_user_book
        where id = ${id} and uid = ${uid} and hid = 0`.execute(this.scope.db);
      await this.cityRules.addCityResources(cid, 0, 0, 0, 0, phpNum(book.level) * BOOK_PRICE);
      const gold = await this.cell(sql`select gold from mem_city_resource where cid = ${cid}`);
      return [id, cid, gold];
    });
  }

  /** `[skill]`: the books of one skill not worn, for the hero's book slot. */
  @GlobalCommand()
  async loadUserSkillBook(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const skill = phpIntval(param[0]);
    return [
      await this.rows(sql`select a.*, b.name, b.level, b.skill, b.attr_type, b.attr, b.description
        from sys_user_book a left join cfg_book b on a.bid = b.id and a.level = b.level
        where b.skill = ${skill} and a.uid = ${ctx.uid} and a.hid = 0 order by a.id`),
    ];
  }

  /**
   * `[hid]`: `[hid, 1, skill rows, worn book id, 0]` (the book id only when one is worn), or
   * `[hid, 0]` for a hero without a skill.
   */
  @GlobalCommand()
  async getHeroSkill(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const hid = phpIntval(param[0]);
    const ret: unknown[] = [hid];
    const skill = await this.row(sql`select * from sys_hero_skill where hid = ${hid}`);
    const book = await this.row(sql`select * from sys_user_book where hid = ${hid}`);
    if (skill) {
      const skills = book
        ? await this.rows(sql`select a.*, b.level from cfg_book a
            left join sys_user_book b on a.skill = b.bid
            where b.hid = ${hid} and b.level = a.level limit 1`)
        : await this.rows(sql`select * from sys_hero_skill s
            left join cfg_book c on s.skill = c.skill where s.hid = ${hid} order by c.level`);
      ret.push(1, skills);
      if (book) ret.push(book.id);
    }
    ret.push(0);
    return ret;
  }

  /** `[cid, hid]`: 领悟, a random new skill for a 技能领悟书; answers `[hid, skill rows]`. */
  @GlobalCommand()
  async resetHeroSkill(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const hid = phpIntval(param[1]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const hero = await this.row(sql`select * from sys_city_hero
        where uid = ${uid} and hid = ${hid}`);
      if (hero && !phpLooseEquals(hero.state, 0)) throw GameError.lang('book.hero_not_free');
      if (!hero) throw GameError.lang('book.not_your_hero');
      const count = await this.cell(sql`select count from sys_goods
        where gid = ${GOODS_RESET_SKILL} and uid = ${uid}`);
      if (phpEmpty(count)) throw GameError.raw(`not_enough_goods${GOODS_RESET_SKILL}`);
      if (await this.row(sql`select 1 from sys_user_book where hid = ${hid}`)) {
        throw GameError.lang('book.cannot_reset_skill');
      }

      let skillId: unknown = 0;
      let rate = this.random.mtRand(1, 100);
      for (const skill of await this.rows(sql`select * from cfg_skill_rate`)) {
        rate -= phpIntval(skill.rate);
        if (rate <= 0) {
          skillId = skill.skill_id;
          break;
        }
      }
      if (await this.row(sql`select * from sys_hero_skill where hid = ${hid}`)) {
        await sql`update sys_hero_skill set skill = ${skillId} where hid = ${hid}`.execute(db);
      } else {
        await sql`insert into sys_hero_skill (hid, skill) values (${hid}, ${skillId})`.execute(db);
      }
      await this.goods.reduceGoods(uid, GOODS_RESET_SKILL, 1);
      return [
        hid,
        await this.rows(sql`select * from sys_hero_skill s
          left join cfg_book c on s.skill = c.skill where s.hid = ${hid} order by c.level limit 1`),
      ];
    });
  }

  /** `[hid, id, cid]`: wears a book of the hero's skill; answers `[hid, heroes, book rows]`. */
  @GlobalCommand()
  async setHeroBook(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const hid = phpIntval(param[0]);
    const id = phpIntval(param[1]);
    const cid = phpIntval(param[2]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      await this.freeHero(uid, hid);
      const book = await this.row(
        sql`select * from sys_user_book where uid = ${uid} and id = ${id}`,
      );
      if (!book) throw GameError.lang('book.no_book');
      if (!phpEmpty(book.hid)) {
        const name = await this.cell(sql`select name from sys_city_hero where hid = ${book.hid}`);
        throw GameError.lang('book.on_hero', name);
      }
      if (await this.row(sql`select * from sys_user_book where uid = ${uid} and hid = ${hid}`)) {
        throw GameError.lang('book.hero_has_book');
      }
      const usable = await this.cell(sql`select a.id from cfg_book a, sys_hero_skill b
        where a.skill = b.skill and b.hid = ${hid} limit 1`);
      if (phpEmpty(usable) || !phpLooseEquals(usable, book.bid)) {
        throw GameError.lang('book.skill_tobo_book');
      }
      if (PRODUCTION_BOOKS.has(phpIntval(book.bid))) {
        await this.cityRules.updateCityResourceAdd(cid);
      }
      await sql`update sys_user_book set hid = ${hid} where id = ${id}`.execute(db);
      const heroes = await this.heroChanged(uid, hid, cid);
      const level = await this.cell(sql`select level from sys_user_book
        where hid = ${hid} and id = ${id}`);
      return [
        hid,
        heroes,
        await this.rows(sql`select * from cfg_book c left join sys_user_book s on s.bid = c.skill
          where s.hid = ${hid} and s.level = c.level and s.level = ${level}`),
      ];
    });
  }

  /** `[hid, id, cid]`: takes the hero's book off; answers `[hid, heroes, a book row]`. */
  @GlobalCommand()
  async moveHeroBook(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const hid = phpIntval(param[0]);
    const id = phpIntval(param[1]);
    const cid = phpIntval(param[2]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      await this.freeHero(uid, hid);
      const book = await this.row(
        sql`select * from sys_user_book where uid = ${uid} and id = ${id}`,
      );
      if (!book) throw GameError.lang('book.no_book');
      const worn = await this.row(sql`select * from sys_user_book
        where uid = ${uid} and hid = ${hid} and bid = ${book.bid}`);
      if (!worn) throw GameError.lang('book.hero_no_book');
      if (PRODUCTION_BOOKS.has(phpIntval(book.bid))) {
        await this.cityRules.updateCityResourceAdd(cid);
      }
      await sql`update sys_user_book set hid = 0 where id = ${id}`.execute(db);
      const heroes = await this.heroChanged(uid, hid, cid);
      return [
        hid,
        heroes,
        await this.rows(sql`select * from sys_user_book s
          left join cfg_book c on s.bid = c.skill and s.hid = ${hid}
          where s.uid = ${uid} order by s.id, c.level limit 1`),
      ];
    });
  }

  /** The hero must be the user's own and free. */
  private async freeHero(uid: number, hid: number): Promise<void> {
    const hero = await this.row(sql`select uid, state from sys_city_hero where hid = ${hid}`);
    if (hero && !phpEmpty(hero.state)) throw GameError.lang('book.hero_not_free');
    if (!hero || !phpLooseEquals(hero.uid, uid)) throw GameError.lang('book.not_your_hero');
  }

  private async heroChanged(uid: number, hid: number, cid: number): Promise<Row[]> {
    await this.heroes.regenerateHeroAttri(uid, hid);
    await this.heroes.updateCityHeroChange(uid, cid);
    return this.info.heroInfo(uid, cid);
  }
}
