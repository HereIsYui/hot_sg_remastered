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

/** HeroFunc.php::isHeroInCity: free, city chief, general or adviser. */
function isHeroInCity(state: unknown): boolean {
  return [0, 1, 7, 8].some((s) => phpLooseEquals(state, s));
}

/** The `sid in (...)` list the client sends as `"sid,sid,..."`. */
function sidList(ids: unknown): RawBuilder<unknown> {
  return sql.join(phpString(ids).split(',').map(phpIntval));
}

/** ArmorFunc.php: a hero's gear, equipping, repairing (黄金) and renovating (元宝 or 礼金). */
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
