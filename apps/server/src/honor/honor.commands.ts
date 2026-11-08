import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { CityInfoService } from '../city/city-info.service';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules, LORD_HERO_TYPE } from '../core/hero-rules.service';
import { phpCompare, phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
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

/**
 * 君主荣誉: the monarch detail and designation commands of UserFunc.php, the battle-medal
 * exchange of BattleFunc.php and the praise (嘉赏) of HeroFunc.php.
 */
@Injectable()
export class HonorCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly info: CityInfoService,
    private readonly goods: GoodsRules,
    private readonly heroes: HeroRules,
    private readonly tasks: TaskRules,
    private readonly users: UserRules,
  ) {}

  /**
   * UserFunc.php::loadUserDetail — `[uid]`: one player's card for the monarch panel (nobility
   * already raised by any 推恩令 buff). A missing player answers `{nobility}`: the original's
   * offset assignment auto-vivifies its `false` fetch into a one-entry array.
   */
  @GlobalCommand()
  async loadUserDetail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const useruid = phpIntval(param[0]);
    const row = await this.row(sql<Row>`select u.uid as userid, u.\`name\`, u.\`sex\`, u.\`face\`,
        u.\`passport\`, u.\`union_id\`, u.\`union_pos\`, u.\`officepos\`, u.\`nobility\`,
        un.\`name\` as \`union\`, r.\`rank\`, r.\`prestige\`, r.\`city\`, r.\`people\`
      from sys_user u
      left join sys_union un on un.\`id\` = u.\`union_id\`
      left join rank_user r on u.\`uid\` = r.\`uid\`
      where u.\`uid\` = ${useruid}`);
    const nobility = await this.users.bufferNobility(useruid, row?.nobility);
    return [{ ...(row ?? {}), nobility }];
  }

  /**
   * UserFunc.php::loadUserDetailInfo: the extra monarch-panel data of the session user — total
   * population, hero count, account state, 免战 end time, and the city list.
   */
  @GlobalCommand()
  async loadUserDetailInfo(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    return [
      await this.cell(sql<Row>`select sum(m.people) from mem_city_resource m, sys_city c
        where m.cid = c.cid and c.uid = ${uid}`),
      await this.cell(sql<Row>`select count(*) from sys_city_hero where uid = ${uid}`),
      await this.cell(sql<Row>`select state from sys_user where uid = ${uid}`),
      await this.cell(
        sql<Row>`select endtime from mem_user_buffer where uid = ${uid} and buftype = 7`,
      ),
      await this.users.userCities(uid),
    ];
  }

  /**
   * UserFunc.php::changeUserDesignation — `[curDesigId, preDesigId]`: switch the worn 称号
   * (-1 takes the current one off and answers `['', 0]`).
   */
  @GlobalCommand()
  async changeUserDesignation(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    let curDesigId = phpIntval(param[0]);
    const preDesigId = phpIntval(param[1]);
    let curDesigName: unknown = undefined;
    await this.scope.transaction(async () => {
      const db = this.scope.db;
      if (curDesigId === -1) {
        // 玩家卸掉称号: the designation must still be on the player and active.
        const curExist = await this.row(sql<Row>`select * from sys_user_designation
          where uid = ${uid} and did = ${preDesigId} and state > 0`);
        if (phpEmpty(curExist)) throw GameError.lang('designation.offDesignation_not_exist');
        await sql`update sys_user_designation set ison = 0 where uid = ${uid}`.execute(db);
        curDesigName = '';
        curDesigId = 0;
      } else {
        // 先判断新称号是否还在玩家身上
        const curExist = await this.row(sql<Row>`select * from sys_user_designation
          where uid = ${uid} and did = ${curDesigId}`);
        if (phpEmpty(curExist)) throw GameError.lang('designation.designation_not_exist');
        await sql`update sys_user_designation set ison = 0 where uid = ${uid}`.execute(db);
        await sql`update sys_user_designation set ison = 1
          where uid = ${uid} and did = ${curDesigId}`.execute(db);
        curDesigName = await this.cell(
          sql<Row>`select name from cfg_designation where did = ${curDesigId}`,
        );
      }
    });
    return [curDesigName, curDesigId];
  }

  /**
   * BattleFunc.php::medalChange — `[count, medalTypeId]`: exchange campaign medals for 汉室勋章
   * (tid 30000) at 20/10/12 per copy. The original interpolates `$count` into its SQL, so the
   * writes bind the string form and let MySQL coerce it like the quoted literal did.
   */
  @GlobalCommand()
  async medalChange(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const count = param[0];
    const medalTypeId = param[1];
    // 20平定黄巾勋章=1汉室勋章, 10袁军官渡勋章=1汉室勋章, 12曹军官渡勋章=1汉室勋章
    const nameAndType = await this.row(sql<Row>`select a.name, b.type
      from cfg_things a, cfg_battle_field b
      where a.tid = ${phpString(medalTypeId)} and a.battleBelong = b.id`);
    const mName = nameAndType ? nameAndType.name : undefined;
    const radio = phpLooseEquals(medalTypeId, 30003)
      ? 12
      : phpLooseEquals(nameAndType?.type, 0)
        ? 20
        : 10;
    const medalinfo = await this.row(sql<Row>`select * from sys_things
      where tid = ${phpString(medalTypeId)} and uid = ${uid}`);
    if (!medalinfo) throw GameError.lang('buyGoods.no_medal', mName, count);
    if (phpIntval(medalinfo.count) < radio * phpIntval(count)) {
      throw GameError.lang('buyGoods.no_medal', mName, count);
    }
    const needMedal = radio * phpIntval(count);
    await this.scope.transaction(async () => {
      const db = this.scope.db;
      const hsMedal = await this.row(sql<Row>`select * from sys_things
        where uid = ${uid} and tid = 30000`);
      if (phpEmpty(hsMedal)) {
        // 更新汉室勋章的数量
        await sql`insert into sys_things (uid, tid, count)
          values (${uid}, 30000, ${phpString(count)})`.execute(db);
      } else {
        await sql`update sys_things set count = count + ${phpString(count)}
          where uid = ${uid} and tid = 30000`.execute(db);
      }
      await sql`update sys_things set count = count - ${needMedal}
        where uid = ${uid} and tid = ${phpString(medalTypeId)}`.execute(db);
    });
    return [];
  }

  /**
   * BattleFunc.php::getMedalRecord: the player's stock of every campaign medal (tid 30000-30010).
   * `select *` over the join keeps the cfg_things columns for the duplicated `tid`, as the
   * original's assoc fetch did.
   */
  @GlobalCommand()
  async getMedalRecord(ctx: CommandContext): Promise<Row[]> {
    // 30000~30003 tid: 汉室勋章 平定黄巾勋章 袁军官渡勋章 曹军官渡勋章
    return this.rows(sql<Row>`select * from sys_things as A, cfg_things as B
      where A.uid = ${ctx.uid} and A.tid = B.tid and A.tid >= 30000 and A.tid <= 30010`);
  }

  /**
   * HeroFunc.php::praiseHero — `[funcName, cid, hid, gid]` (the client prefixes the command name
   * into the arguments). The gid picks the branch: the 赤壁 goods use newPraiseHero, the old
   * families are re-indexed into oldPraiseHero, and anything else answers null like the original
   * falling off the end.
   */
  @GlobalCommand()
  async praiseHero(ctx: CommandContext, param: unknown[]): Promise<unknown> {
    const gid = param[3];
    const n = phpNum(gid);
    if ((n >= 160040 && n <= 160051) || (n >= 160023 && n <= 160031)) {
      // 周科科新添加的: 对于新加的物品使用的处理
      return this.newPraiseHero(ctx.uid, param);
    }
    if (
      (n > 25 && n < 30) ||
      n === 116 ||
      (n <= 10155 && n >= 10152) ||
      (n >= 19082 && n <= 19083) ||
      (n >= 19202 && n <= 19205)
    ) {
      // 原封不动的按原来的处理: map the gid onto the old list position
      const index = gidToOldIndex(gid);
      return this.oldPraiseHero(ctx.uid, [param[0], param[1], param[2], index]);
    }
    return undefined;
  }

  /** HeroFunc.php::newPraiseHero: the 赤壁 goods become a one-hour hero buffer named by the gid. */
  private async newPraiseHero(uid: number, param: unknown[]): Promise<Row[]> {
    void param[0]; // $funcitonname
    const cid = phpIntval(param[1]);
    const hid = phpIntval(param[2]);
    const gid = phpIntval(param[3]);
    const buftype = gid;
    const hero = await this.cityHero(uid, cid, hid);
    if (!hero) throw GameError.lang('largessHero.cant_find_hero');
    else if (!isHeroInCity(hero.state)) throw GameError.lang('pairse.cant_largess_out_hero');
    if (phpIntval(hero.herotype) === LORD_HERO_TYPE) {
      // 君主将不能进行嘉赏
      throw GameError.lang('useGoods.king_cannot_use');
    }
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      await this.checkGoodsRepeatUse(uid, gid, hid);
      const goodCount = await this.cell(
        sql<Row>`select count from sys_goods where uid = ${uid} and gid = ${gid}`,
      );
      if (phpEmpty(goodCount) || phpNum(goodCount) <= 0) {
        throw GameError.raw(`not_enough_goods${gid}`);
      }
      await this.goods.addGoods(uid, gid, -1, LOG_LARGESS);
      await sql`insert into mem_hero_buffer (hid, buftype, endtime)
        values (${hid}, ${buftype}, unix_timestamp() + 3600)
        on duplicate key update endtime = greatest(endtime, unix_timestamp()) + 3600`.execute(db);
      await this.heroes.regenerateHeroAttri(uid, hid);
      return this.info.heroInfo(uid, cid);
    });
  }

  /** HeroFunc.php::oldPraiseHero: the pre-赤壁 families keyed by their old list index. */
  private async oldPraiseHero(uid: number, param: unknown[]): Promise<unknown[]> {
    void param[0]; // $funcitonname
    const cid = phpIntval(param[1]);
    const hid = phpIntval(param[2]);
    const typeidx = param[3];
    const hero = await this.cityHero(uid, cid, hid);
    if (!hero) throw GameError.lang('largessHero.cant_find_hero');
    if (phpIntval(hero.herotype) === LORD_HERO_TYPE) {
      // 君主将不能进行嘉赏
      throw GameError.lang('useGoods.king_cannot_use');
    }
    if (!isHeroInCity(hero.state)) throw GameError.lang('pairse.cant_largess_out_hero');
    let msg: unknown = undefined; // only the pill branch produces a MSG_ACTTIP reply
    await this.scope.transaction(async () => {
      const db = this.scope.db;
      if (phpCompare(typeidx, 5) < 0) {
        // 虎符, 文曲星符, 武曲星符, 智多星符, 猛油火罐
        let gid = phpNum(typeidx) + 26;
        if (phpLooseEquals(typeidx, 4)) gid = 116;
        const hufu = await this.cell(
          sql<Row>`select count from sys_goods where uid = ${uid} and gid = ${gid}`,
        );
        if (phpEmpty(hufu) || phpNum(hufu) <= 0) throw GameError.raw(`not_enough_goods${gid}`);
        await this.checkOtherConflictGoods(gid, hid);
        await this.goods.addGoods(uid, gid, -1, LOG_LARGESS);
        let buftype = phpNum(typeidx) + 1;
        if (phpLooseEquals(typeidx, 4)) buftype = 91;
        await sql`insert into mem_hero_buffer (hid, buftype, endtime)
          values (${hid}, ${buftype}, unix_timestamp() + 86400)
          on duplicate key update endtime = greatest(endtime, unix_timestamp()) + 86400`.execute(
          db,
        );
        if (phpCompare(typeidx, 2) < 0) {
          // 如果是虎符或文曲星，而且将领是城守的话，要重新算资源加成
          const chiefhid = await this.cell(
            sql<Row>`select chiefhid from sys_city where cid = ${cid}`,
          );
          if (!phpEmpty(chiefhid) && phpLooseEquals(chiefhid, hid)) {
            if (!phpEmpty(cid)) {
              await sql`update sys_city_res_add set resource_changing = 1 where cid = ${cid}`.execute(
                db,
              );
            }
          }
        }
        await this.heroes.regenerateHeroAttri(uid, hid);
        // 完成成长任务
        if (gid === 28) await this.tasks.completeTaskWithTaskid(uid, TASK_WUQU);
        else if (gid === 27) await this.tasks.completeTaskWithTaskid(uid, TASK_WENQU);
        else if (gid === 29) await this.tasks.completeTaskWithTaskid(uid, TASK_ZHIDUOXIN);
      } else if (phpNum(typeidx) >= 19057 && phpNum(typeidx) <= 19058) {
        // 马鞭 / 汗血马鞭
        const gid = phpNum(typeidx) + 25;
        const buftype = phpNum(typeidx);
        if (!(await this.goods.checkGoods(uid, gid))) {
          throw GameError.lang('good.not_enough_goods83');
        }
        await this.checkSpecialCondition(hid, gid, [19057, 19058]);
        await sql`insert into mem_hero_buffer (hid, buftype, endtime)
          values (${hid}, ${buftype}, unix_timestamp() + 3600)
          on duplicate key update endtime = greatest(endtime, unix_timestamp()) + 3600`.execute(db);
        await this.goods.addGoods(uid, gid, -1, LOG_LARGESS);
        await this.heroes.regenerateHeroAttri(uid, hid);
      } else {
        // 一级/二级丹药: 两个东西未启用 (typeidx 9)
        let gid = phpNum(typeidx) - 8 + 10155;
        if (phpNum(typeidx) >= 10 && phpNum(typeidx) <= 13) {
          gid = phpNum(typeidx) - 8 + 19200;
        }
        if (phpIntval(hero.herotype) === LORD_HERO_TYPE) {
          throw GameError.lang('useGoods.king_cannot_use');
        }
        msg = await this.enhanceHero(uid, hid, gid);
        const tip = this.lang.t('act.msg_tip', '');
        if (!(typeof msg === 'string' && msg.includes(tip))) msg = false;
      }
    });
    const ret: unknown[] = await this.info.heroInfo(uid, cid);
    if (msg) ret.push(msg);
    return ret;
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
   * HeroFunc.php::checkSpecialCondition: 马鞭 needs a grade-4/5 mount, 汗血马鞭 grade 5, and an
   * existing speed buff is cleared first — the plain 马鞭 refuses while a 汗血马鞭 buff is on.
   */
  private async checkSpecialCondition(hid: number, gid: number, buftypes: number[]): Promise<void> {
    const db = this.scope.db;
    const now = phpNum(await this.cell(sql<Row>`select unix_timestamp()`));
    const horseType = await this.cell(sql<Row>`select c.type from cfg_armor c
      left join sys_hero_armor s on c.\`id\` = s.armorid
      where s.hid = ${hid} and s.spart = 120`);
    if (gid === 19082) {
      // 马鞭
      if (phpEmpty(horseType) || (!phpLooseEquals(horseType, 4) && !phpLooseEquals(horseType, 5))) {
        throw GameError.lang('HeroFunc.armorType_is_wrong');
      }
    } else if (gid === 19083) {
      // 汗血马鞭
      if (phpEmpty(horseType) || !phpLooseEquals(horseType, 5)) {
        throw GameError.lang('HeroFunc.armorType_is_wrong');
      }
    }
    for (const buftype of buftypes) {
      // 清除掉原来的效果
      const result = await this.row(sql<Row>`select * from mem_hero_buffer
        where hid = ${hid} and buftype = ${buftype} and endtime >= ${now}`);
      if (result) {
        // 如果玩家已经使用了汗血马鞭再使用马鞭道具就不让玩家使用
        if (phpLooseEquals(result.buftype, 19058) && gid === 19082) {
          throw GameError.lang('HeroFunc.mabian');
        }
        await sql`delete from mem_hero_buffer
          where hid = ${hid} and buftype = ${result.buftype} limit 1`.execute(db);
      }
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

/** HeroFunc.php::gidToOldIndex: the old list position oldPraiseHero expects, -1 otherwise. */
function gidToOldIndex(gid: unknown): number {
  switch (phpNum(gid)) {
    case 26:
      return 0;
    case 27:
      return 1;
    case 28:
      return 2;
    case 29:
      return 3;
    case 116:
      return 4;
    case 10152:
      return 5;
    case 10153:
      return 6;
    case 10154:
      return 7;
    case 10155:
      return 8;
    case 19082:
      return 19057;
    case 19083:
      return 19058;
    case 19202:
      return 10;
    case 19203:
      return 11;
    case 19204:
      return 12;
    case 19205:
      return 13;
    default:
      return -1;
  }
}
