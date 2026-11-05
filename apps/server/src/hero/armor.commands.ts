import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { CityInfoService } from '../city/city-info.service';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules, LORD_HERO_TYPE } from '../core/hero-rules.service';
import { OwnershipService } from '../core/ownership.service';
import { phpCompare, phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { DefaultBoxService } from '../goods/default-box.service';
import { TaskRewards } from '../task/task-rewards.service';

type Row = Record<string, unknown>;

/** 洛神玉佩: each one worn with its special active raises the loyalty cap. */
const LUOSHEN_PENDANT = 12010;
const CHILD_HERO_TYPE = 10001;
/** 炼化鼎, one per deified set. */
const GOODS_DEIFY = 155;
/** log_money / log_gift reason of a renovation. */
const LOG_RENOVATE = 100;
/** log_user_action of a deified set. */
const ACTION_DEIFY = 13;
/** 君主 gear (15000-15999) fits only the lord. */
const LORD_ARMOR_MIN = 15000;
const LORD_ARMOR_MAX = 16000;
/** ID_BUILDING_MARKET: selling gear needs a level 5 市场. */
const BUILDING_MARKET = 13;
/** 神兵鉴符, used up by activating a special. */
const GOODS_SPECIAL_KEY = 10522;
/** 末日之刃: its special can be re-rolled. */
const MORIZHIREN = 12016;
const GOODS_STRONG_ORB = 205;
const GOODS_HIGH_STRONG_ORB = 11170;
/** 装备碎片 (a sys_things tid). */
const THINGS_ARMOR_CHIP = 10400;
/** 11th-level gems drop to their 10th-level gid, which is not gid - 1. */
const ELEVENTH_GEM_DOWN: Record<number, number> = {
  17500: 309,
  17505: 319,
  17510: 329,
  17515: 339,
  17520: 349,
  17525: 359,
  17530: 369,
  17535: 379,
};
/** log_armor types and log reasons of the gear store. */
const LOG_ARMOR_SOLD = 9;
const LOG_ARMOR_CHAIJIE = 11;
const LOG_THINGS_CHAIJIE = 9;
const LOG_GOODS_CHAIJIE = 23;
/** `0704` is octal as a PHP argument (log_goods) but decimal inside the log_armor SQL text. */
const LOG_GOODS_ANALYZE = 0o704;
const LOG_ARMOR_ANALYZE = 704;
const ACTION_CHAIJIE = 24;
/** cfg_act type of the 回收装备 event is 6400 + the armor type; its gift box srctype. */
const ACT_ARMOR_RECYCLE = 6400;
const SRC_ARMOR_ACT = 6000;
/** loadUserActivedArmor type 1 (upgrading): the sets that can be upgraded. */
const UPGRADABLE_TIES = ['12003', '10008', '11002', '12006', '12007'];
/** multipAnalyzeArmor: the 强化宝珠 chance (out of 0..100) and count by armor type. */
const ANALYZE_REWARD: Record<string, [number, number]> = {
  1: [30, 1],
  2: [50, 1],
  3: [70, 1],
  4: [65, 2],
  5: [100, 5],
  6: [100, 10],
};
/** Some blue 君主 sets (15000-15032) analyze at only 30%. */
const LORD_BLUE_MIN = 15000;
const LORD_BLUE_MAX = 15032;

/** HeroFunc.php::isHeroInCity: free, city chief, general or adviser. */
function isHeroInCity(state: unknown): boolean {
  return [0, 1, 7, 8].some((s) => phpLooseEquals(state, s));
}

/**
 * ArmorFunc.php::getSuipian: 装备碎片 for a broken piece, one per 10 weighted points of its
 * level (x4), 统帅 (x2), 内政 (x4), 勇武 (x8), 智谋 (x4) and 速度 (x3), rounded up.
 */
export function armorChips(cfg: Row | undefined): number {
  const weights: Record<number, number> = { 1: 2, 2: 4, 3: 8, 4: 4, 11: 3 };
  let value = phpNum(cfg?.hero_level) * 4;
  const parts = phpString(cfg?.attribute).split(',');
  const length = phpNum(parts.shift());
  for (let i = 0; i < length; i++) {
    const item = phpIntval(parts.shift());
    const num = phpNum(parts.shift());
    value += num * (weights[item] ?? 0);
  }
  return value === 0 ? 1 : phpIntval(Math.ceil(value / 10));
}

/** The `sid in (...)` list the client sends as `"sid,sid,..."`. */
function sidList(ids: unknown): RawBuilder<unknown> {
  return sql.join(phpString(ids).split(',').map(phpIntval));
}

/**
 * ArmorFunc.php: a hero's gear, equipping, repairing (黄金) and renovating (元宝 or 礼金), and
 * the 装备仓库 (selling, breaking up, analyzing, activating specials).
 */
@Injectable()
export class ArmorCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly info: CityInfoService,
    private readonly cityRules: CityRules,
    private readonly goods: GoodsRules,
    private readonly heroes: HeroRules,
    private readonly users: UserRules,
    private readonly ownership: OwnershipService,
    private readonly rewards: TaskRewards,
    private readonly random: RandomService,
    private readonly boxes: DefaultBoxService,
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

  /** `[hid]` */
  @GlobalCommand()
  async getHeroArmor(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.heroArmor(phpIntval(param[0]));
  }

  /** `[part]`: the player's unworn gear of one part, for the change dialog. */
  @GlobalCommand()
  async loadUserPartArmor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const part = phpIntval(param[0]);
    const armors = await this.rows(sql`select * from sys_user_armor a, cfg_armor c
      where a.uid = ${ctx.uid} and a.hid = 0 and c.id = a.armorid and c.part = ${part}
      order by a.strong_level desc, a.combine_level desc`);
    return [await this.addSpecial(armors), ...(await this.otherInfo(armors, -1))];
  }

  /** `[hid, sid, spart]`: the piece replaces whatever the hero wore there. */
  @GlobalCommand()
  async equipArmor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const [hid, sid, spart] = param;
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const armor = await this.row(sql`select * from sys_user_armor u
        left join cfg_armor c on c.id = u.armorid where u.sid = ${sid} and u.uid = ${uid}`);
      if (!phpLooseEquals(armor?.part ?? null, Math.floor(phpNum(spart) / 10))) {
        throw GameError.lang('equipArmor.not_right_part');
      }
      if (!armor) throw GameError.lang('equipArmor.arm_not_exist');
      if (!phpLooseEquals(armor.hid, 0)) throw GameError.lang('equipArmor.arm_in_use');
      if (Math.ceil(phpNum(armor.hp) / 10) <= 0) throw GameError.lang('equipArmor.no_hp_max');
      const hero = await this.ownHero(uid, hid);
      const armorid = phpIntval(armor.armorid);
      if (
        phpIntval(hero.herotype) !== LORD_HERO_TYPE &&
        armorid >= LORD_ARMOR_MIN &&
        armorid < LORD_ARMOR_MAX
      ) {
        throw GameError.lang('equipArmor.hero_type_wrong');
      }
      if (phpCompare(armor.hero_level, hero.level) > 0) {
        throw GameError.lang('equipArmor.level', armor.hero_level);
      }
      if (
        armorid >= 12001 &&
        armorid <= 12008 &&
        phpNum(hid) >= 1030 &&
        !(await this.heroes.checkHeroLevel(uid, 6, 50))
      ) {
        throw GameError.lang('equipment.must_be_npchero');
      }

      const old = await this.row(sql`select * from sys_hero_armor h
        left join cfg_armor c on c.id = h.armorid where h.hid = ${hid} and h.spart = ${spart}`);
      if (old) {
        await sql`update sys_user_armor set hid = 0 where sid = ${old.sid}`.execute(db);
      }
      await sql`update sys_user_armor set hid = ${hid} where sid = ${sid}`.execute(db);
      await sql`insert into sys_hero_armor (hid, spart, sid, armorid)
        values (${hid}, ${spart}, ${sid}, ${armor.armorid})
        on duplicate key update sid = ${sid}, armorid = ${armor.armorid}`.execute(db);
      if (phpLooseEquals(hero.state, 1)) {
        await this.cityRules.updateCityResourceAdd(phpIntval(hero.cid));
      }
      await this.checkLoyaltyAdd(hid);
      await this.heroes.regenerateHeroAttri(uid, phpIntval(hid));
      return this.heroReply(phpIntval(hid));
    });
  }

  /** `[hid, spart]` */
  @GlobalCommand()
  async offloadArmor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const hid = phpIntval(param[0]);
    const spart = phpIntval(param[1]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const armor = await this.row(sql`select * from sys_hero_armor h
        left join sys_user_armor u on u.sid = h.sid left join cfg_armor c on c.id = u.armorid
        where h.hid = ${hid} and h.spart = ${spart}`);
      if (!armor) throw GameError.lang('equipArmor.arm_not_exist');
      const hero = await this.ownHero(uid, hid);
      await sql`update sys_user_armor set hid = 0 where sid = ${armor.sid}`.execute(db);
      await sql`delete from sys_hero_armor where hid = ${hid} and spart = ${spart}`.execute(db);
      await this.checkLoyaltyAdd(hid);
      await this.heroes.regenerateHeroAttri(uid, hid);
      if (phpLooseEquals(hero.state, 1)) {
        await this.cityRules.updateCityResourceAdd(phpIntval(hero.cid));
      }
      return this.heroReply(hid);
    });
  }

  /** `[hid]` */
  @GlobalCommand()
  async offloadAllArmor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const hid = phpIntval(param[0]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const hero = await this.ownHero(uid, hid);
      await sql`update sys_user_armor set hid = 0 where hid = ${hid}`.execute(db);
      await sql`delete from sys_hero_armor where hid = ${hid}`.execute(db);
      await this.checkLoyaltyAdd(hid);
      await this.heroes.regenerateHeroAttri(uid, hid);
      if (phpLooseEquals(hero.state, 1)) {
        await this.cityRules.updateCityResourceAdd(phpIntval(hero.cid));
      }
      return this.heroReply(hid);
    });
  }

  /**
   * `[cid, sid]`: 100 黄金 per missing durability point; the maximum drops by a tenth of the
   * repaired amount (at least 1). Answers `[sid, hp_max, cid, gold]`.
   */
  @GlobalCommand()
  async repairArmor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const sid = phpIntval(param[1]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      await this.ownership.checkCityOwner(cid, uid);
      const armor = await this.row(sql`select * from sys_user_armor
        where sid = ${sid} and uid = ${uid}`);
      if (!armor) throw GameError.lang('equipArmor.arm_not_exist');
      const hp = Math.ceil(phpNum(armor.hp) / 10);
      let hpMax = phpNum(armor.hp_max);
      if (hp < 0) throw GameError.lang('repairArmor.no_hp_max');
      const goldNeed = (hpMax - hp) * 100;
      if (goldNeed <= 0) throw GameError.lang('repairArmor.no_need');
      await this.checkCityGold(cid, goldNeed);
      hpMax = Math.max(0, hpMax - Math.max(1, Math.ceil((hpMax - hp) / 10)));
      await sql`update sys_user_armor set hp = ${hpMax * 10}, hp_max = ${hpMax}
        where sid = ${sid}`.execute(db);
      await this.payGold(cid, goldNeed);
      if (!phpLooseEquals(armor.hid, 0)) {
        await this.heroes.regenerateHeroAttri(uid, phpIntval(armor.hid));
      }
      return [sid, hpMax, cid, await this.cityGold(cid)];
    });
  }

  /** `[cid, hid, "sid,sid,..."]`: answers `[hid, cid, gold]`. */
  @GlobalCommand()
  async repairAllArmor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const type = phpIntval(param[1]);
    const ids = param[2];
    if (phpEmpty(ids)) throw GameError.lang('equipArmor.arm_not_exist');
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      await this.ownership.checkCityOwner(cid, uid);
      const armors = await this.rows(sql`select * from sys_user_armor u
        left join cfg_armor c on c.id = u.armorid where u.uid = ${uid} and u.sid in (${sidList(ids)})`);
      let goldNeed = 0;
      for (const armor of armors) {
        const hp = Math.ceil(phpNum(armor.hp) / 10);
        if (hp < 0) throw GameError.lang('repairArmor.no_hp_max');
        goldNeed += (Math.max(0, phpNum(armor.hp_max)) - hp) * 100;
      }
      if (goldNeed <= 0) throw GameError.lang('repairArmor.no_need');
      await this.checkCityGold(cid, goldNeed);
      for (const armor of armors) {
        const hp = Math.ceil(phpNum(armor.hp) / 10);
        let hpMax = phpNum(armor.hp_max);
        hpMax = Math.max(0, hpMax - Math.max(1, Math.ceil((hpMax - hp) / 10)));
        await sql`update sys_user_armor set hp = ${hpMax * 10}, hp_max = ${hpMax}
          where sid = ${armor.sid}`.execute(db);
      }
      await this.payGold(cid, goldNeed);
      const first = armors[0];
      if (first && !phpLooseEquals(first.hid, 0)) {
        await this.heroes.regenerateHeroAttri(uid, phpIntval(first.hid));
      }
      return [type, cid, await this.cityGold(cid)];
    });
  }

  /** `[sid]`: back to the original maximum durability for 元宝. */
  @GlobalCommand()
  renovateArmor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.renovateOne(ctx.uid, phpIntval(param[0]), false);
  }

  /** `[sid]`: the same for 礼金. */
  @GlobalCommand()
  renovateArmorWithGift(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.renovateOne(ctx.uid, phpIntval(param[0]), true);
  }

  /** `[hid or type, "sid,sid,..."]` */
  @GlobalCommand()
  renovateAllArmor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.renovateAll(ctx.uid, phpIntval(param[0]), param[1], false);
  }

  /** `[hid or type, "sid,sid,..."]` */
  @GlobalCommand()
  renovateAllArmorWithGift(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.renovateAll(ctx.uid, param[0], param[1], true);
  }

  /**
   * `[hid]`: every piece of the hero's complete set gets one random 炼化 attribute, replacing
   * earlier ones, for one 炼化鼎.
   */
  @GlobalCommand()
  async deifyArmor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const hid = phpIntval(param[0]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const state = await this.cell(sql`select state from sys_city_hero where hid = ${hid}`);
      if (!phpEmpty(state) && !isHeroInCity(state)) {
        throw GameError.lang('deifyArmor.not_in_city');
      }
      let done = false;
      let tieNames = '';
      for (const tie of await this.wornTies(hid)) {
        if (phpCompare(tie.armed, tie.count) < 0) continue;
        if (phpEmpty(tie.tieid) || phpLooseEquals(tie.tieid, 0)) continue;
        const armors = await this.tieArmors(hid, tie.tieid);
        const count = await this.cell(sql`select count from sys_goods
          where uid = ${uid} and gid = ${GOODS_DEIFY}`);
        if ((phpEmpty(count) ? 0 : phpNum(count)) < 1) {
          throw GameError.raw(`not_enough_goods${GOODS_DEIFY}#1`);
        }
        const choices = await this.rows(sql`select * from cfg_tie_deify_attribute
          where tieid = ${tie.tieid}`);
        for (const armor of armors) {
          await sql`delete from sys_user_tie_deify_attribute where sid = ${armor.sid}`.execute(db);
        }
        done = true;
        if (tieNames !== '') tieNames += ',';
        tieNames += phpString(tie.name);
        for (const armor of armors) {
          const choice: Row = choices[this.random.mtRand(0, choices.length - 1)] ?? {};
          const low = phpIntval(choice.low);
          const high = phpIntval(choice.high);
          const value = this.random.mtRand(Math.min(low, high), Math.max(low, high));
          await sql`insert into sys_user_tie_deify_attribute (attid, sid, value)
            values (${choice.attid}, ${armor.sid}, ${value})
            on duplicate key update value = ${value}`.execute(db);
        }
        await this.goods.reduceGoods(uid, GOODS_DEIFY, 1);
        break;
      }
      if (!done) throw GameError.lang('deifyArmor.failure');
      await this.heroes.regenerateHeroAttri(uid, hid);
      const reply = [this.lang.t('deifyArmor.success', tieNames), ...(await this.heroReply(hid))];
      await this.users.logUserAction(uid, ACTION_DEIFY);
      return reply;
    });
  }

  /** The 装备仓库: `[armor_column, armors, ...otherInfo]` of every unworn piece. */
  @GlobalCommand()
  async loadUserArmor(ctx: CommandContext): Promise<unknown[]> {
    const armors = await this.rows(sql`select * from sys_user_armor a
      left join cfg_armor c on c.id = a.armorid where a.uid = ${ctx.uid} and a.hid = 0
      order by a.strong_level desc, a.combine_level desc`);
    return this.storeReply(ctx.uid, armors);
  }

  /**
   * `[type]`: the activated unworn pieces the blacksmith picks from (0, 2), or for upgrading (1)
   * those of the upgradable sets; any other type lists nothing.
   */
  @GlobalCommand()
  async loadUserActivedArmor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const type = param[0] ?? null;
    const base = sql`select * from sys_user_armor a left join cfg_armor c on c.id = a.armorid
      where a.uid = ${ctx.uid}`;
    const order = sql`order by a.strong_level desc, a.combine_level desc`;
    let armors: Row[];
    if (phpLooseEquals(type, 0) || phpLooseEquals(type, 2)) {
      armors = await this.rows(sql`${base} and a.hid = 0 and embed_holes != '' ${order}`);
    } else if (phpLooseEquals(type, 1)) {
      armors = await this.rows(sql`${base} and c.tieid in (${sql.join(UPGRADABLE_TIES)})
        and a.hid = 0 and embed_holes != '' ${order}`);
    } else {
      // addSpecialArr walks the unset list; legacy's error handler turns the warning into a reply.
      throw GameError.raw('Invalid argument supplied for foreach()');
    }
    return this.storeReply(ctx.uid, armors);
  }

  /** `[sid]`: the 神兵鉴符 row with the player's count. */
  @GlobalCommand()
  async loadActiveArmorSpecialGoods(ctx: CommandContext): Promise<unknown[]> {
    const goods = await this.row(sql`select c.*, ifnull(g.count, 0) as count from cfg_goods c
      left join sys_goods g on c.gid = g.gid and g.uid = ${ctx.uid}
      where c.gid = ${GOODS_SPECIAL_KEY}`);
    return [goods ?? false];
  }

  /**
   * `[sid]`: one 神兵鉴符 activates the piece's special; 末日之刃 may be re-rolled and gets a
   * random effect. Answers `[[armor], message]`.
   */
  @GlobalCommand()
  async activeArmorSpecial(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const sid = phpIntval(param[0]);
    return this.scope.transaction(async () => {
      const armor = await this.row(sql`select a.*, c.* from sys_user_armor a
        left join cfg_armor c on c.id = a.armorid where a.uid = ${uid} and a.sid = ${sid}`);
      if (!armor) throw GameError.lang('equipArmor.arm_not_exist');
      if (!phpLooseEquals(armor.active_special, 0) && !phpLooseEquals(armor.armorid, MORIZHIREN)) {
        throw GameError.lang('active_special.already_active');
      }
      if (!(await this.goods.checkGoods(uid, GOODS_SPECIAL_KEY))) {
        throw GameError.lang('active_special.not_enough_goods');
      }
      await this.goods.reduceGoods(uid, GOODS_SPECIAL_KEY, 1);
      await sql`update sys_user_armor set active_special = 1
        where uid = ${uid} and sid = ${sid}`.execute(this.scope.db);
      armor.active_special = 1;
      const extra = phpLooseEquals(armor.armorid, MORIZHIREN)
        ? await this.activeMorizhiren(sid)
        : '';
      return [await this.addSpecial([armor]), this.lang.t('active_special.success') + extra];
    });
  }

  /**
   * `[cid, sid]`: the piece is recycled for 黄金 (500 per point of value) in a city with a
   * level 5 市场. Answers `[sid, cid, gold]` and the 回收装备 event gift, if any.
   */
  @GlobalCommand()
  async sellArmor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const cid = phpIntval(param[0]);
    const sid = phpIntval(param[1]);
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const market = await this.cell(sql`select level from sys_building
        where cid = ${cid} and bid = ${BUILDING_MARKET}`);
      if (market === false || phpNum(market) < 5) {
        throw GameError.lang('sellArmor.market_level_low');
      }
      const nobility = await this.cell(sql`select nobility from sys_user where uid = ${uid}`);
      if ((await this.users.bufferNobility(uid, nobility)) < 1) {
        throw GameError.lang('sellArmor.nobility_low');
      }
      const armor = await this.row(sql`select * from sys_user_armor u, cfg_armor c
        where u.sid = ${sid} and u.uid = ${uid} and c.id = u.armorid`);
      if (!armor) throw GameError.lang('equipArmor.arm_not_exist');
      if (phpLooseEquals(armor.part, 12)) {
        for (const pearl of phpString(armor.embed_pearls).split(',')) {
          if (phpNum(pearl) > 0) throw GameError.lang('sellArmor.exist_zuoji_embed');
        }
      }
      const hp = Math.ceil(phpNum(armor.hp) / 10);
      const oriHpMax = phpNum(armor.ori_hp_max);
      // PHP's division by zero yields false, which floors to 0.
      const times = Math.max(1, oriHpMax === 0 ? 0 : Math.floor(hp / oriHpMax));
      const goldAdd = phpIntval(times * phpNum(armor.value)) * 500;
      await sql`update mem_city_resource set gold = gold + ${goldAdd}
        where cid = ${cid}`.execute(db);
      await sql`insert into log_selled_armor (sid, uid, armorid, hp, hp_max, hid, strong_level,
          strong_value, embed_pearls, embed_holes, deified, time)
        (select sid, uid, armorid, hp, hp_max, hid, strong_level, strong_value, embed_pearls,
          embed_holes, deified, unix_timestamp() from sys_user_armor where sid = ${sid})`.execute(
        db,
      );
      await sql`delete from sys_user_armor where sid = ${sid}`.execute(db);
      await sql`insert into log_armor (uid, armorid, count, time, type)
        values (${uid}, ${armor.armorid}, -1, unix_timestamp(), ${LOG_ARMOR_SOLD})`.execute(db);
      const reply: unknown[] = [sid, cid, await this.cityGold(cid)];
      const msg = await this.armorRecycleAct(uid, phpNum(armor.type));
      if (msg) reply.push(msg);
      return reply;
    });
  }

  /**
   * `[sid]`: an activated piece breaks into 装备碎片, 强化宝珠 for its strengthening and (half
   * the time each) its gems or the gems a level down. Answers `[message]`.
   */
  @GlobalCommand()
  async zhuangbeichaijie(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    const sid = phpIntval(param[0]);
    return this.scope.transaction(async () => {
      const armor = await this.row(sql`select * from sys_user_armor a
        left join cfg_armor ca on ca.id = a.armorid where a.sid = ${sid} and a.uid = ${uid} limit 1`);
      if (!armor) throw GameError.lang('equipArmor.arm_not_exist');
      if (!phpLooseEquals(armor.hid, 0)) throw GameError.lang('equipArmor.arm_in_use');
      if (phpEmpty(armor.embed_holes)) throw GameError.lang('equipArmor.can_not_chaijie');
      if (phpLooseEquals(armor.part, 12)) throw GameError.lang('equipArmor.horse');

      const cfg = await this.row(sql`select hero_level, attribute from cfg_armor
        where id = ${armor.armorid}`);
      const chips = armorChips(cfg);
      let itemstr = this.lang.t('equipArmor.armor_chip') + chips;
      await this.goods.addThings(uid, THINGS_ARMOR_CHIP, chips, LOG_THINGS_CHAIJIE);

      let orbs = 0;
      let highOrbs = 0;
      const strongLevel = phpNum(armor.strong_level);
      if (strongLevel > 0) {
        const probability = await this.rows(sql`select * from cfg_strong_probability
          order by level`);
        const perLevel = (i: number) => {
          const suc = phpNum(probability[i - 1]?.suc_value);
          return suc === 0 ? 0 : 100.0 / suc;
        };
        for (let i = 1; i <= Math.min(strongLevel, 10); i++) orbs += Math.floor(perLevel(i));
        for (let i = 11; i <= strongLevel; i++) highOrbs += Math.floor(perLevel(i) * 0.2);
      }
      const items = new Map<number, number>();
      if (orbs > 0) items.set(GOODS_STRONG_ORB, orbs);
      if (highOrbs > 0) items.set(GOODS_HIGH_STRONG_ORB, highOrbs);
      const bump = (gid: number, extra: () => number) =>
        items.set(gid, items.get(gid) ? items.get(gid)! + extra() : 1);
      if (phpString(armor.embed_pearls) !== '') {
        for (const pearl of phpString(armor.embed_pearls).split(',')) {
          const gid = phpIntval(pearl);
          let level: number;
          if (gid >= 300 && gid <= 379) level = (gid % 10) + 1;
          else if (gid >= 17500 && gid <= 17539) level = (gid % 5) + 11;
          else continue;
          if (this.random.mtRand(0, 99) < 50) {
            bump(gid, () => 1);
          } else if (ELEVENTH_GEM_DOWN[gid] !== undefined) {
            bump(ELEVENTH_GEM_DOWN[gid], () => this.random.mtRand(1, 2));
          } else if (level > 1) {
            bump(gid - 1, () => this.random.mtRand(1, 2));
          }
        }
      }

      await this.rewards.cutArmorBySid(uid, armor.armorid, sid, LOG_ARMOR_CHAIJIE);
      for (const [gid, count] of items) {
        if (count === 0) continue;
        const good = await this.row(sql`select * from cfg_goods where gid = ${gid}`);
        if (!good) continue;
        itemstr += `, ${phpString(good.name)} ${count}`;
        await this.goods.addGoods(uid, gid, count, LOG_GOODS_CHAIJIE);
      }
      const msg =
        this.lang.t('equipArmor.get_sth_from_chaijie') +
        itemstr +
        this.lang.t('equipArmor.get_sth_from_chaijie_end');
      await this.users.logUserAction(uid, ACTION_CHAIJIE);
      return [msg];
    });
  }

  /**
   * `[sid, ...]`: each unworn piece is analyzed away, giving 强化宝珠 by chance and type.
   * Answers `[message]`.
   */
  @GlobalCommand()
  async multipAnalyzeArmor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const { uid } = ctx;
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const load = (sid: unknown) =>
        this.row(sql`select a.*, c.* from sys_user_armor a
          left join cfg_armor c on c.id = a.armorid where a.uid = ${uid} and a.sid = ${phpString(sid)}`);
      for (const sid of param) {
        const armor = await load(sid);
        if (!armor) throw GameError.lang('equipArmor.Multip_arm_not_exist');
        if (phpIntval(armor.hid) > 0) throw GameError.lang('equipArmor.can_not_on_hero');
      }
      let count = 0;
      let reward: Row | undefined;
      for (const sid of param) {
        const armor = (await load(sid)) ?? {};
        const type = phpString(armor.type);
        const armorId = phpIntval(armor.armorid);
        const rate = this.random.mtRand(0, 100);
        reward = await this.row(sql`select * from cfg_goods where gid = ${GOODS_STRONG_ORB}`);
        const rule = ANALYZE_REWARD[type];
        if (!rule) throw GameError.lang('analyzeArmor.type_not_exist');
        const [chance, n] =
          type === '4' && armorId >= LORD_BLUE_MIN && armorId <= LORD_BLUE_MAX ? [30, 2] : rule;
        if (rate <= chance) {
          await this.goods.addGoods(uid, GOODS_STRONG_ORB, n, LOG_GOODS_ANALYZE);
          count += n;
        }
        await sql`delete from sys_user_armor where sid = ${phpString(sid)}`.execute(db);
        await sql`delete from sys_user_tie_deify_attribute where sid = ${phpString(sid)}`.execute(
          db,
        );
        await sql`insert into log_armor (uid, armorid, count, time, type)
          values (${uid}, ${armor.armorid}, -1, unix_timestamp(), ${LOG_ARMOR_ANALYZE})`.execute(
          db,
        );
      }
      const msg =
        count === 0
          ? this.lang.t('analyzeArmor.analyze_succ')
          : this.lang.t('analyzeArmor.analyze_succ_reward', reward?.name, count);
      return [msg];
    });
  }

  /** `[armor_column, armors, ...otherInfo]` of the store lists. */
  private async storeReply(uid: number, armors: Row[]): Promise<unknown[]> {
    const column = await this.cell(sql`select armor_column from sys_user where uid = ${uid}`);
    return [column, await this.addSpecial(armors), ...(await this.otherInfo(armors, -1))];
  }

  /** ArmorFunc.php::activeMorizhiren: re-rolls 末日之刃's effect, answering its text. */
  private async activeMorizhiren(sid: number): Promise<string> {
    const db = this.scope.db;
    const roll = this.random.mtRand(1, 100);
    const type = roll >= 96 ? 4 : roll >= 86 ? 3 : roll >= 81 ? 2 : 1;
    await sql`delete from sys_armor_addon where sid = ${sid}`.execute(db);
    await sql`delete from sys_armor_special where sid = ${sid}`.execute(db);
    let msg: string;
    if (type === 1) {
      const attack = this.random.mtRand(0, 1) === 1;
      const value = this.random.mtRand(1, 10);
      const attid = attack ? 10008 : 10009;
      msg = this.lang.t(
        attack ? 'active_special.attack_success' : 'active_special.defence_success',
        value,
        '%',
      );
      await sql`insert into sys_armor_addon (sid, attid, value) values (${sid}, ${attid}, ${value})
        on duplicate key update attid = ${attid}, value = ${value}`.execute(db);
    } else if (type === 4) {
      await sql`insert into sys_armor_addon (sid, attid, value) values (${sid}, 11, 1)
        on duplicate key update attid = 11, value = 1`.execute(db);
      msg = this.lang.t('morizhiren.add_speed');
    } else if (type === 2) {
      msg = this.lang.t('morizhiren.add_health');
    } else {
      msg = this.lang.t('morizhiren.add_degrade_building_level');
    }
    await sql`insert into sys_armor_special (sid, type) values (${sid}, ${type})`.execute(db);
    return msg;
  }

  /** ActFunc.php::checkAndDoArmorRecycleAct: the 回收装备 event's gift for a sold piece. */
  private async armorRecycleAct(uid: number, armorType: number): Promise<string | false> {
    const act = await this.row(sql`select actid, rate from cfg_act
      where type = ${phpIntval(armorType + ACT_ARMOR_RECYCLE)}
        and starttime <= unix_timestamp() and endtime >= unix_timestamp() limit 1`);
    if (!act) return false;
    if (phpNum(act.rate) < this.random.mtRand(1, 100)) return false;
    return this.boxes.openEvent(uid, 0, phpIntval(act.actid), SRC_ARMOR_ACT);
  }

  /** The hero to change gear on: the player's own, in one of its cities. */
  private async ownHero(uid: number, hid: unknown): Promise<Row> {
    const hero = await this.row(sql`select * from sys_city_hero where hid = ${hid}`);
    if (!hero || !isHeroInCity(hero.state) || !phpLooseEquals(hero.uid, uid)) {
      throw GameError.lang('equipArmor.hero_state_wrong');
    }
    return hero;
  }

  private async renovateOne(uid: number, sid: number, byGift: boolean): Promise<unknown[]> {
    return this.scope.transaction(async () => {
      const armor = await this.row(sql`select * from sys_user_armor u
        left join cfg_armor c on c.id = u.armorid where u.sid = ${sid} and u.uid = ${uid}`);
      if (!armor) throw GameError.lang('equipArmor.arm_not_exist');
      await this.payRenovation(uid, this.renovateCost(armor), byGift, async () => {
        await this.restoreDurability(armor);
        if (!phpLooseEquals(armor.hid, 0)) {
          await this.heroes.regenerateHeroAttri(uid, phpIntval(armor.hid));
        }
      });
      return [sid];
    });
  }

  private async renovateAll(
    uid: number,
    type: unknown,
    ids: unknown,
    byGift: boolean,
  ): Promise<unknown[]> {
    if (phpEmpty(ids)) throw GameError.lang('equipArmor.arm_not_exist');
    return this.scope.transaction(async () => {
      const armors = await this.rows(sql`select * from sys_user_armor u
        left join cfg_armor c on c.id = u.armorid where u.uid = ${uid} and u.sid in (${sidList(ids)})`);
      const cost = armors.reduce((sum, armor) => sum + this.renovateCost(armor), 0);
      await this.payRenovation(uid, cost, byGift, async () => {
        for (const armor of armors) await this.restoreDurability(armor);
        const first = armors[0];
        if (first && !phpLooseEquals(first.hid, 0)) {
          await this.heroes.regenerateHeroAttri(uid, phpIntval(first.hid));
        }
      });
      return [type];
    });
  }

  /** The lost maximum, plus a tenth of the missing durability. */
  private renovateCost(armor: Row): number {
    const hp = Math.ceil(phpNum(armor.hp) / 10);
    const hpMax = phpNum(armor.hp_max);
    return phpNum(armor.ori_hp_max) - hpMax + Math.ceil((hpMax - hp) / 10);
  }

  /** 元宝 are paid before the repair, 礼金 after it. */
  private async payRenovation(
    uid: number,
    cost: number,
    byGift: boolean,
    renovate: () => Promise<void>,
  ): Promise<void> {
    if (cost <= 0) throw GameError.lang('renovateArmor.no_need');
    const column = sql.raw(byGift ? 'gift' : 'money');
    const owned = await this.cell(sql`select ${column} from sys_user where uid = ${uid}`);
    if (phpEmpty(owned) || phpNum(owned) < cost) {
      throw GameError.lang(byGift ? 'renovateArmor.no_gift' : 'renovateArmor.no_money');
    }
    if (byGift) {
      await renovate();
      await this.rewards.addGift(uid, -cost, LOG_RENOVATE);
    } else {
      await this.rewards.addMoney(uid, -cost, LOG_RENOVATE);
      await renovate();
    }
  }

  private async restoreDurability(armor: Row): Promise<void> {
    const ori = phpNum(armor.ori_hp_max);
    await sql`update sys_user_armor set hp = ${ori * 10}, hp_max = ${ori}
      where sid = ${armor.sid}`.execute(this.scope.db);
  }

  private async checkCityGold(cid: number, need: number): Promise<void> {
    const gold = await this.cell(sql`select gold from mem_city_resource where cid = ${cid}`);
    if (gold === false || need > phpNum(gold)) throw GameError.lang('repairArmor.no_gold');
  }

  private async payGold(cid: number, gold: number): Promise<void> {
    await sql`update mem_city_resource set gold = greatest(0, gold - ${gold})
      where cid = ${cid}`.execute(this.scope.db);
  }

  private async cityGold(cid: number): Promise<number> {
    return phpIntval(
      Math.floor(
        phpNum(await this.cell(sql`select gold from mem_city_resource where cid = ${cid}`)),
      ),
    );
  }

  /** ArmorFunc.php::checkLoyaltyAdd: the loyalty cap without the pendants taken off. */
  private async checkLoyaltyAdd(hid: unknown): Promise<void> {
    const count = phpNum(
      await this.cell(sql`select count(*) from sys_user_armor a, sys_hero_armor b
        where a.sid = b.sid and b.hid = ${hid} and b.armorid = ${LUOSHEN_PENDANT}
          and a.active_special = 1`),
    );
    const herotype = await this.cell(sql`select herotype from sys_city_hero where hid = ${hid}`);
    const base = phpIntval(herotype) === CHILD_HERO_TYPE ? 300 : 100;
    const max = count === 1 ? base + 20 : count === 2 ? base + 50 : base;
    await sql`update sys_city_hero set loyalty = least(loyalty, ${max})
      where hid = ${hid}`.execute(this.scope.db);
  }

  /** `[heroDetail, heroArmor]`, the reply of every gear change. */
  private async heroReply(hid: number): Promise<unknown[]> {
    return [await this.info.heroDetail(hid), await this.heroArmor(hid)];
  }

  /**
   * ArmorFunc.php::doGetHeroArmor: `[hid, armors, setComplete, setDeified, attributes,
   * embedGoods, ties, tieAttributes, deify, fusion]`.
   */
  private async heroArmor(hid: number): Promise<unknown[]> {
    const armors = await this.rows(sql`select * from sys_hero_armor h
      left join sys_user_armor u on u.sid = h.sid and u.hid = h.hid
      left join cfg_armor c on c.id = u.armorid where h.hid = ${hid}`);
    const [complete, deified] = await this.deifyArmorCheck(hid);
    return [
      hid,
      await this.addSpecial(armors),
      complete,
      deified,
      ...(await this.otherInfo(armors, hid)),
    ];
  }

  /** `[armors, ...otherInfo]` with no hero: the reply shape of every smithy / barn armor list. */
  async armorListReply(armors: Row[]): Promise<unknown[]> {
    return [await this.addSpecial(armors), ...(await this.otherInfo(armors, -1))];
  }

  /** The tables after the armor list that `Global.dealWithOtherInfoOfArmor` caches. */
  private async otherInfo(armors: Row[], hid: number): Promise<unknown[]> {
    return [
      await this.armorAttributes(armors),
      await this.embedGoods(armors),
      await this.tieInfo(armors, hid),
      await this.tieAttributes(armors),
      await this.deifyAttributes(armors),
      await this.fusionAttributes(armors),
    ];
  }

  /** ArmorFunc.php::addSpecialArr: the special effect of activated pieces (末日之刃 etc.). */
  private async addSpecial(armors: Row[]): Promise<Row[]> {
    const out: Row[] = [];
    for (const armor of armors) {
      const tmp = { ...armor };
      const special = await this.row(sql`select * from sys_armor_special where sid = ${armor.sid}`);
      if (special) {
        const addon = await this.row(sql`select * from sys_armor_addon where sid = ${armor.sid}`);
        if (addon) {
          tmp.specialAttid = addon.attid;
          tmp.specialValue = addon.value;
        } else if (phpLooseEquals(special.type, 2)) {
          tmp.specialAttid = '-1';
          tmp.specialValue = this.lang.t('armor.morizhiren_special_1');
        } else if (phpLooseEquals(special.type, 3)) {
          tmp.specialAttid = '-2';
          tmp.specialValue = this.lang.t('armor.morizhiren_special_2');
        }
      }
      out.push(tmp);
    }
    return out;
  }

  /** Each worn set with the number of its pieces still holding durability. */
  private wornTies(hid: number): Promise<Row[]> {
    return this.rows(sql`select t.*, count(t.tieid) as armed from sys_hero_armor ha
      left join sys_user_armor ua on ua.sid = ha.sid left join cfg_armor a on a.id = ua.armorid
      left join cfg_tie t on t.tieid = a.tieid where ha.hid = ${hid} and ua.hp > 0
      group by t.tieid`);
  }

  private tieArmors(hid: number, tieid: unknown): Promise<Row[]> {
    return this.rows(sql`select * from sys_user_armor ua left join cfg_armor a on a.id = ua.armorid
      where ua.hp > 0 and ua.hid = ${hid} and a.tieid = ${tieid}`);
  }

  /**
   * ArmorFunc.php::deifyArmorCheck: `[a set is complete, it is already deified]`, looking at
   * the first complete set only.
   */
  private async deifyArmorCheck(hid: number): Promise<[boolean, boolean]> {
    let complete = false;
    let deified = false;
    for (const tie of await this.wornTies(hid)) {
      if (phpCompare(tie.armed, tie.count) < 0) continue;
      if (phpEmpty(tie.tieid) || phpLooseEquals(tie.tieid, 0)) continue;
      for (const armor of await this.tieArmors(hid, tie.tieid)) {
        const count = await this.cell(sql`select count(*) from sys_user_tie_deify_attribute
          where sid = ${armor.sid}`);
        if (phpNum(count) > 0) {
          deified = true;
          break;
        }
      }
      complete = true;
      break;
    }
    return [complete, deified];
  }

  /** ArmorFunc.php::getArmorNewAttribute: `[armorid, rows, ...]`. */
  private async armorAttributes(armors: Row[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const armor of armors) {
      out.push(
        armor.armorid,
        await this.rows(sql`select aa.*, ca.name from cfg_armor_attribute aa
          left join cfg_attribute ca on ca.attid = aa.attid where armorid = ${armor.armorid}`),
      );
    }
    return out;
  }

  /** ArmorFunc.php::getArmorEmbedGoods: the cfg_goods rows of every embedded pearl. */
  private async embedGoods(armors: Row[]): Promise<Row[]> {
    const gids = armors
      .map((a) => a.embed_pearls)
      .filter((p) => !phpEmpty(p))
      .flatMap((p) => phpString(p).split(',').map(phpIntval));
    if (gids.length === 0) return [];
    return this.rows(sql`select * from cfg_goods where gid in (${sql.join(gids)})`);
  }

  private armorIds(armors: Row[]): unknown[] {
    return armors.map((a) => a.id).filter((id) => !phpEmpty(id));
  }

  /** ArmorFunc.php::getTieInfo: the worn sets (with counts), or every set of the list (-1). */
  private async tieInfo(armors: Row[], hid: number): Promise<Row[]> {
    if (hid !== -1) return this.wornTies(hid);
    const ids = this.armorIds(armors);
    if (ids.length === 0) return [];
    return this.rows(sql`select distinct t.*, 0 as armed from cfg_tie t
      left join cfg_armor a on t.tieid = a.tieid where a.tieid > 0 and a.id in (${sql.join(ids)})`);
  }

  /** ArmorFunc.php::getTieArmorAttribute */
  private async tieAttributes(armors: Row[]): Promise<Row[]> {
    const ids = this.armorIds(armors);
    if (ids.length === 0) return [];
    return this.rows(sql`select distinct ta.tieid, ta.value, ta.precond, ca.*
      from cfg_tie_attribute ta left join cfg_tie t on t.tieid = ta.tieid
      left join cfg_armor a on ta.tieid = a.tieid left join cfg_attribute ca on ca.attid = ta.attid
      where a.tieid > 0 and a.id in (${sql.join(ids)})`);
  }

  /** ArmorFunc.php::getDeifyAttribute: `[sid, rows, ...]`. */
  private async deifyAttributes(armors: Row[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const armor of armors) {
      out.push(
        armor.sid,
        await this.rows(sql`select tda.*, ca.name from sys_user_tie_deify_attribute tda
          left join cfg_attribute ca on tda.attid = ca.attid where tda.sid = ${armor.sid}`),
      );
    }
    return out;
  }

  /** ArmorFunc.php::getFusionAttribute: `[found, sid, rows or [0, 1, 0, 0], ...]`. */
  private async fusionAttributes(armors: Row[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const armor of armors) {
      const rows = await this.rows(sql`select concat(c.level, ',', c.attr) as combineAttr
        from cfg_armor_level_attr c left join sys_user_armor s on s.combine_level = c.level
        where s.sid = ${armor.sid}`);
      if (rows.length === 0) out.push(0, armor.sid, [0, 1, 0, 0]);
      else out.push(1, armor.sid, rows);
    }
    return out;
  }
}
