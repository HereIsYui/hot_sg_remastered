import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { CityInfoService } from '../city/city-info.service';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules, LORD_HERO_TYPE } from '../core/hero-rules.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** log_goods / log_act reason of an item spent on a hero. */
const LOG_LARGESS = 7;
/** sys_city_hero_base_add.type and log_act.log_type of an attribute pill (吃药). */
const ENHANCE_LOG_TYPE = 4;
/** Growth tasks completed by the old-style 星符 gids. */
const TASK_WUQU = 300;
const TASK_WENQU = 301;
const TASK_ZHIDUOXIN = 302;

/** HeroFunc.php::isHeroInCity: free, city chief, general or adviser. */
function isHeroInCity(state: unknown): boolean {
  return [0, 1, 7, 8].some((s) => phpLooseEquals(state, s));
}

/**
 * GoodsFunc.php::enhanceHero's switch: the attribute a pill raises, per copy, and the lifetime
 * cap per hero. 10150/10151 (体力/精力) raise nothing (the health/energy branch is commented out
 * in the original) and are unreachable from praiseHero, but stay part of the switch.
 */
const ENHANCE_PILLS: Record<
  number,
  { attr?: 'command' | 'affairs' | 'bravery' | 'wisdom'; amount?: number; maxLimit: number }
> = {
  10150: { maxLimit: 100 },
  10151: { maxLimit: 100 },
  10152: { attr: 'command', amount: 1, maxLimit: 50 },
  10153: { attr: 'affairs', amount: 1, maxLimit: 50 },
  10154: { attr: 'wisdom', amount: 1, maxLimit: 50 },
  10155: { attr: 'bravery', amount: 1, maxLimit: 50 },
  19202: { attr: 'bravery', amount: 2, maxLimit: 50 },
  19203: { attr: 'affairs', amount: 2, maxLimit: 50 },
  19204: { attr: 'command', amount: 2, maxLimit: 50 },
  19205: { attr: 'wisdom', amount: 2, maxLimit: 50 },
};

/**
 * HeroFunc.php::checkGoodsRepeatUse: the six 赤壁 item families (下品/中品/上品) that cannot
 * coexist. `base` is the old-style buff that blocks the whole family — 八卦阵图 and 陷阵战鼓
 * check a user buffer, the other four check a hero buffer.
 */
const REPEAT_USE_GROUPS: {
  gids: [number, number, number];
  family: string;
  base?: { userBuffer?: number; heroBuffer?: number };
}[] = [
  { gids: [160026, 160027, 160028], family: 'baguazheng', base: { userBuffer: 7 } },
  { gids: [160029, 160030, 160031], family: 'xianzhenzhangu', base: { userBuffer: 6 } },
  // PHP reverses the 虎符 family: 160042 replaces 160040/160041.
  { gids: [160042, 160041, 160040], family: 'hufu', base: { heroBuffer: 1 } },
  { gids: [160043, 160044, 160045], family: 'wenquxin', base: { heroBuffer: 2 } },
  { gids: [160046, 160047, 160048], family: 'zhuiduoxin', base: { heroBuffer: 4 } },
  { gids: [160049, 160050, 160051], family: 'wuquxin', base: { heroBuffer: 3 } },
];

/** Direct item rewards keep largessHeroWithGid's distinct validation and buff durations. */
@Injectable()
export class HeroItemCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly info: CityInfoService,
    private readonly goods: GoodsRules,
    private readonly heroes: HeroRules,
    private readonly tasks: TaskRules,
  ) {}

  @GlobalCommand()
  async loadHeroGoods(): Promise<Row[]> {
    return this.rows(sql<Row>`select gid, name, description, value from cfg_goods
      where gid = 116 or (gid >= 26 and gid <= 29) or (gid >= 10152 and gid <= 10155)
        or (gid >= 160040 and gid <= 160051) or (gid >= 160023 and gid <= 160031)
        or gid = 19082 or gid = 19083 or (gid >= 19202 and gid <= 19205)`);
  }

  /** [unusedFunctionName, cid, hid, gid], also called by useGoods. */
  @GlobalCommand()
  async largessHeroWithGid(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const cid = phpIntval(param[1]);
    const hid = phpIntval(param[2]);
    const gid = phpIntval(param[3]);
    return this.scope.transaction(async () => {
      const hero = await this.cityHero(uid, cid, hid);
      if (!hero) throw GameError.lang('largessHero.cant_find_hero');
      if (!isHeroInCity(hero.state)) throw GameError.lang('largessHero.cant_largess_out_hero');
      let msg: string | undefined;
      if ((gid >= 10150 && gid <= 10155) || (gid >= 19202 && gid <= 19205)) {
        msg = await this.enhanceHero(uid, hid, gid);
        if (!msg?.includes(this.lang.t('act.msg_tip', ''))) msg = undefined;
      } else {
        const count = await this.cell(
          sql<Row>`select count from sys_goods where uid = ${uid} and gid = ${gid}`,
        );
        if (phpEmpty(count) || phpNum(count) <= 0) throw GameError.raw(`not_enough_goods${gid}`);
        await this.checkGoodsRepeatUse(uid, gid, hid);
        await this.checkOtherConflictGoods(gid, hid);
        await this.goods.addGoods(uid, gid, -1, LOG_LARGESS);
        const chibi = (gid >= 160040 && gid <= 160051) || (gid >= 160023 && gid <= 160031);
        const duration = chibi ? 3600 : 86400;
        await sql`insert into mem_hero_buffer (hid, buftype, endtime)
          values (${hid}, ${chibi ? gid : gid - 25}, unix_timestamp() + ${duration})
          on duplicate key update endtime = greatest(endtime, unix_timestamp()) + ${duration}`.execute(
          this.scope.db,
        );
        await this.heroes.regenerateHeroAttri(uid, hid);
        if ([26, 27, 160043, 160044, 160045].includes(gid)) {
          const chief = await this.cell(sql<Row>`select chiefhid from sys_city where cid = ${cid}`);
          if (!phpEmpty(chief) && phpLooseEquals(chief, hid) && cid) {
            await sql`update sys_city_res_add set resource_changing = 1 where cid = ${cid}`.execute(
              this.scope.db,
            );
          }
        }
      }
      if (gid === 28) await this.tasks.completeTaskWithTaskid(uid, TASK_WUQU);
      else if (gid === 27) await this.tasks.completeTaskWithTaskid(uid, TASK_WENQU);
      else if (gid === 29) await this.tasks.completeTaskWithTaskid(uid, TASK_ZHIDUOXIN);
      const ret: unknown[] = await this.info.heroInfo(uid, cid);
      if (msg) ret.push(msg);
      return ret;
    });
  }

  /**
   * HeroFunc.php::checkGoodsRepeatUse — the 赤壁 families: the family's old-style buff blocks
   * every member; tuples follow PHP's replacement priority (strongest first).
   */
  private async checkGoodsRepeatUse(uid: number, gid: number, hid: number): Promise<void> {
    const db = this.scope.db;
    for (const group of REPEAT_USE_GROUPS) {
      const [low, mid, high] = group.gids;
      if (gid !== low && gid !== mid && gid !== high) continue;
      if (group.base?.userBuffer !== undefined) {
        if (
          await this.check(sql`select 1 from mem_user_buffer
            where uid = ${uid} and buftype = ${group.base.userBuffer}`)
        ) {
          throw GameError.lang(`HeroFunc.${group.family}1`);
        }
      }
      if (group.base?.heroBuffer !== undefined) {
        if (
          await this.check(sql`select 1 from mem_hero_buffer
            where hid = ${hid} and buftype = ${group.base.heroBuffer}`)
        ) {
          throw GameError.lang(`HeroFunc.${group.family}1`);
        }
      }
      if (gid === high) {
        if (
          await this.check(
            sql`select 1 from mem_hero_buffer where hid = ${hid} and buftype = ${mid}`,
          )
        ) {
          throw GameError.lang(`HeroFunc.${group.family}2`);
        }
        if (
          await this.check(
            sql`select 1 from mem_hero_buffer where hid = ${hid} and buftype = ${low}`,
          )
        ) {
          throw GameError.lang(`HeroFunc.${group.family}3`);
        }
      }
      if (gid === mid) {
        if (
          await this.check(
            sql`select 1 from mem_hero_buffer where hid = ${hid} and buftype = ${high}`,
          )
        ) {
          await sql`delete from mem_hero_buffer where hid = ${hid} and buftype = ${high}`.execute(
            db,
          );
        }
        if (
          await this.check(
            sql`select 1 from mem_hero_buffer where hid = ${hid} and buftype = ${low}`,
          )
        ) {
          throw GameError.lang(`HeroFunc.${group.family}4`);
        }
      }
      if (gid === low) {
        const order = low === 160042 || low >= 160046 ? [high, mid] : [mid, high];
        for (const buftype of order) {
          if (
            await this.check(
              sql`select 1 from mem_hero_buffer where hid = ${hid} and buftype = ${buftype}`,
            )
          ) {
            await sql`delete from mem_hero_buffer where hid = ${hid} and buftype = ${buftype}`.execute(
              db,
            );
          }
        }
      }
    }
  }

  /** HeroFunc.php::checkOhterConflictGoods: the old 星符 replace their 赤壁 counterparts. */
  private async checkOtherConflictGoods(gid: number, hid: number): Promise<void> {
    const groups: Record<number, number[]> = {
      26: [160040, 160041, 160042],
      27: [160043, 160044, 160045],
      28: [160049, 160050, 160051],
      29: [160046, 160047, 160048],
    };
    const buftypes = groups[gid];
    if (!buftypes) return;
    const inList = sql.join(
      buftypes.map((b) => sql`${b}`),
      sql`, `,
    );
    if (
      await this.check(sql`select 1 from mem_hero_buffer
        where buftype in (${inList}) and hid = ${hid}`)
    ) {
      await sql`delete from mem_hero_buffer where buftype in (${inList}) and hid = ${hid}`.execute(
        this.scope.db,
      );
    }
  }

  /**
   * GoodsFunc.php::enhanceHero: an attribute pill adds to the hero's base attributes, at most
   * `maxLimit` copies per hero counted over log_act (since the hero last changed owner). Answers
   * the MSG_ACTTIP text on failure and nothing on success; a lord hero is a hard throw.
   */
  private async enhanceHero(uid: number, hid: number, gid: number): Promise<string | undefined> {
    const db = this.scope.db;
    if (hid <= 0 || gid < 10150 || (gid > 10155 && gid < 19202) || gid > 19205) {
      return this.tip('useLuBanGoods.invalid_param');
    }
    const count = await this.cell(
      sql<Row>`select count from sys_goods where uid = ${uid} and gid = ${gid}`,
    );
    if (phpNum(count) <= 0) return this.tip('useLuBanGoods.no_enough_goods');
    const heroType = await this.cell(
      sql<Row>`select herotype from sys_city_hero where hid = ${hid}`,
    );
    if (phpLooseEquals(heroType, LORD_HERO_TYPE)) {
      throw GameError.lang('user_hero.cannot_use_goods');
    }
    // 这之前将领是别人的
    const startTime = phpNum(
      await this.cell(sql<Row>`select max(time) from log_act
        where uid <> ${uid} and actid = ${hid} and sort = 2 and type = ${gid} and log_type = ${ENHANCE_LOG_TYPE}`),
    );
    const totalUsed = phpNum(
      await this.cell(sql<Row>`select sum(count) from log_act
        where uid = ${uid} and actid = ${hid} and sort = 2 and type = ${gid} and log_type = ${ENHANCE_LOG_TYPE}
          and time >= ${startTime + 1}`),
    );
    const pill = ENHANCE_PILLS[gid];
    const add: Record<'command' | 'affairs' | 'bravery' | 'wisdom', number> = {
      command: 0,
      affairs: 0,
      bravery: 0,
      wisdom: 0,
    };
    if (pill?.attr) add[pill.attr] = pill.amount ?? 0;
    if (pill && totalUsed >= pill.maxLimit) {
      return this.tip('enhanceHero.exceedMaxLimit');
    }
    await sql`insert into sys_city_hero_base_add (uid, hid, bravery_base_add_on,
        wisdom_base_add_on, affairs_base_add_on, command_base_add_on, type)
      values (${uid}, ${hid}, ${add.bravery}, ${add.wisdom}, ${add.affairs}, ${add.command}, ${ENHANCE_LOG_TYPE})`.execute(
      db,
    );
    await sql`update sys_city_hero set bravery_base = bravery_base + ${add.bravery},
        wisdom_base = wisdom_base + ${add.wisdom}, affairs_base = affairs_base + ${add.affairs},
        command_base = command_base + ${add.command}
      where hid = ${hid}`.execute(db);
    await sql`insert into log_act (uid, actid, sort, type, count, log_type, time)
      values (${uid}, ${hid}, 2, ${gid}, 1, ${ENHANCE_LOG_TYPE}, unix_timestamp())`.execute(db);
    await this.goods.addGoods(uid, gid, -1, LOG_LARGESS);
    await this.heroes.regenerateHeroAttri(uid, hid);
    const cid = await this.cell(
      sql<Row>`select cid from sys_city where chiefhid = ${hid} and uid = ${uid}`,
    );
    if (!phpEmpty(cid)) {
      await sql`update sys_city_res_add set resource_changing = 1 where cid = ${cid}`.execute(db);
    }
    return undefined;
  }

  /** `sprintf($GLOBALS['act']['msg_tip'], $text)`: the tip marker the client filters on. */
  private tip(key: string): string {
    return this.lang.t('act.msg_tip', this.lang.t(key));
  }

  private cityHero(uid: number, cid: number, hid: number): Promise<Row | undefined> {
    return this.row(sql<Row>`select * from sys_city_hero
      where cid = ${cid} and uid = ${uid} and hid = ${hid}`);
  }

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async row(query: RawBuilder<Row>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : false;
  }

  private async check(query: RawBuilder<Row>): Promise<boolean> {
    return (await this.rows(query)).length > 0;
  }
}
