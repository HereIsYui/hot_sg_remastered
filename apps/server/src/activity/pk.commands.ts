import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { RewardRules } from '../core/reward-rules.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { TaskRewards } from '../task/task-rewards.service';

type Row = Record<string, unknown>;

/** PKFunc.php:4. Blood is energy * RATE, so one energy point is RATE hit points. */
const RATE = 50;

/** 军令, one per campaign battle, buyable with 元宝 and granted 10 on first login. */
const JUNLING_GID = 19200;
/** 五铢钱, displayed by the campaign dialog but not spendable (the branch is commented out). */
const WUZHU_GID = 10195;

/** PKFunc.php:227 getPkGid: battle X's drop item for flag 0 普通 / 1 精英. */
function pkGid(battleId: number, flag: number): number {
  return 18000 + battleId * 10 + flag;
}

/** PKFunc.php:9 initHeroState: the arena stats a hero fights with. */
interface HeroState {
  hid: number;
  sex: number;
  blood: number;
  attackValue: number;
  defenceValue: number;
  baoji: number;
  poji: number;
  gedang: number;
  shanbi: number;
  standIndex: unknown;
}

/** PKFunc.php:9-35. */
function initHeroState(hero: Row): HeroState {
  const i = (key: string) => phpIntval(hero[key]);
  const capped = (value: number) => Math.min(Math.max(value, 10), 3000);
  return {
    hid: i('hid'),
    sex: i('sex'),
    blood: Math.max(i('energy') * RATE, 500),
    attackValue: Math.max(i('bravery') * 10, 10),
    defenceValue: Math.max(i('wisdom') * 10, 10),
    baoji: capped(i('bravery')),
    poji: capped(i('command')),
    gedang: capped(i('affair')),
    shanbi: capped(i('wisdom')),
    standIndex: hero.standIndex,
  };
}

/** PKFunc.php:40 PKDamage. */
function pkDamage(attackValue: number, defenceValue: number): number {
  return Math.trunc(attackValue * (1 - defenceValue / (defenceValue + 2000)));
}

/** `empty($hero)` for a combatant slot: a hero row is truthy, `false`/`undefined` are not. */
function heroMissing(hero: MaybeHero): hero is false | undefined {
  return hero === false || hero === undefined;
}

/** PKFunc.php:48 isTrigger: value is the per-20000 chance. All four triggers are rolled, in this
 * baoji → poji → shanbi → gedang order, even when a later branch ignores them. */
function isTrigger(random: RandomService, value: number): boolean {
  return random.mtRand(1, 20000) <= value;
}

/** PKFunc.php:60 battleComute: one blow. flag=1 marks a 暴击/破击/闪避/格挡 blow; attack/resist
 * encode which side's animation plays (2 critical, 1 block, 0 plain, resist 2 = dodged). */
function battleComute(
  random: RandomService,
  attacker: HeroState,
  resister: HeroState,
  num: number,
): Row {
  let attckAttack = phpIntval(attacker.attackValue);
  const resistBlood = phpIntval(resister.blood);
  const resistDefence = phpIntval(resister.defenceValue);
  let isBoji = isTrigger(random, attacker.baoji);
  const isPoji = isTrigger(random, attacker.poji);
  const isShanbi = isTrigger(random, resister.shanbi);
  let isGedang = isTrigger(random, resister.gedang);
  if (isShanbi) isGedang = false; // 两者不能同时出现
  if (isPoji) isBoji = false;

  const curRet: Row = {};
  if (isShanbi) {
    attckAttack = 0;
    if (isPoji) {
      curRet.flag = 1;
      curRet.attack = 2;
      curRet.resist = 2;
    } else if (isBoji) {
      curRet.flag = 1;
      curRet.attack = 1;
      curRet.resist = 2;
    } else {
      curRet.flag = 1;
      curRet.attack = 0;
      curRet.resist = 2;
    }
  } else if (isGedang) {
    if (isPoji) {
      curRet.flag = 1;
      curRet.attack = 2;
      curRet.resist = 1;
    } else if (isBoji) {
      attckAttack *= 0.75;
      curRet.flag = 1;
      curRet.attack = 1;
      curRet.resist = 1;
    } else {
      attckAttack *= 0.5;
      curRet.flag = 1;
      curRet.attack = 0;
      curRet.resist = 1;
    }
  } else {
    if (isPoji) {
      attckAttack *= 2;
      curRet.flag = 1;
      curRet.attack = 2;
      curRet.resist = 0;
    } else if (isBoji) {
      attckAttack *= 1.5;
      curRet.flag = 1;
      curRet.attack = 1;
      curRet.resist = 0;
    } else {
      curRet.flag = 0;
      curRet.attack = 0;
      curRet.resist = 0;
    }
  }
  let damage = pkDamage(attckAttack, resistDefence);
  damage = Math.max(1, damage);
  const blood = resistBlood > damage ? resistBlood - damage : 0;
  resister.blood = blood;
  curRet.damage = damage;
  curRet.blood = blood;
  curRet.attackhid = attacker.hid;
  curRet.resisthid = resister.hid;
  curRet.attacksex = attacker.sex;
  curRet.resistsex = resister.sex;
  curRet.battleId = num;
  curRet.attackStandIndex = attacker.standIndex;
  curRet.resistStandIndex = resister.standIndex;
  return curRet;
}

/** A combatant slot: a hero row, or the `false` a missing sql_fetch_one becomes (PKFunc.php:401). */
type MaybeHero = Row | false | undefined;

/**
 * PKFunc.php:151 startUserPK: the 3v3 round engine — front heroes duel until one side's queue
 * empties; a survivor is unshifted back with energy = leftover blood / RATE. `speed >=` decides
 * who strikes first (the user's hero on a tie). PHP's `empty($attackHero)` break skips that
 * pair's report entry entirely, so a missing row yields no `report` key at all.
 */
function startUserPK(
  random: RandomService,
  attackUser: MaybeHero[],
  resistUser: MaybeHero[],
): unknown {
  if (phpEmpty(attackUser) || phpEmpty(resistUser)) return [];
  const copy = (hero: MaybeHero): MaybeHero =>
    typeof hero === 'object' && hero !== null ? { ...hero } : hero;
  const attackQueue = attackUser.map(copy);
  const resistQueue = resistUser.map(copy);
  const report: Row[][] = [];
  let totalBattle = 0;
  while (!phpEmpty(attackQueue) && !phpEmpty(resistQueue)) {
    const attackHero = attackQueue.shift()!;
    const resistHero = resistQueue.shift()!;
    const battleRet: Row[] = [];
    if (heroMissing(attackHero) || heroMissing(resistHero)) break;
    let attacker: HeroState;
    let resister: HeroState;
    if (phpNum(attackHero.speed) >= phpNum(resistHero.speed)) {
      attacker = initHeroState(attackHero);
      resister = initHeroState(resistHero);
    } else {
      attacker = initHeroState(resistHero);
      resister = initHeroState(attackHero);
    }
    while (attacker.blood > 0 && resister.blood > 0) {
      totalBattle++;
      battleRet.push(battleComute(random, attacker, resister, totalBattle));
      if (resister.blood === 0) {
        if (phpLooseEquals(attackHero.hid, attacker.hid)) {
          attackHero.energy = Math.trunc(attacker.blood / RATE);
          attackQueue.unshift(attackHero);
        } else if (phpLooseEquals(resistHero.hid, attacker.hid)) {
          resistHero.energy = Math.trunc(attacker.blood / RATE);
          resistQueue.unshift(resistHero);
        }
        break;
      }
      totalBattle++;
      battleRet.push(battleComute(random, resister, attacker, totalBattle));
      if (attacker.blood === 0) {
        if (phpLooseEquals(attackHero.hid, resister.hid)) {
          attackHero.energy = Math.trunc(resister.blood / RATE);
          attackQueue.unshift(attackHero);
        } else if (phpLooseEquals(resistHero.hid, resister.hid)) {
          resistHero.energy = Math.trunc(resister.blood / RATE);
          resistQueue.unshift(resistHero);
        }
        break;
      }
    }
    report.push(battleRet);
  }
  const ret: Row = {};
  if (report.length > 0) ret.report = report;
  ret.totalNum = totalBattle;
  ret.endflag = 1;
  ret.winer = phpEmpty(resistQueue) ? 1 : 0;
  return ret;
}

/**
 * PKFunc.php — the 过关斩将 (征战) half: the standalone 3v3 hero-round campaign ladder.
 * Its engine shares nothing with the army battle system (BattleFunc / mem_battle);
 * startPK / allowPK / getPVPBattleInfo belong to the battlefield families, not here.
 */
@Injectable()
export class PkCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly random: RandomService,
    private readonly goods: GoodsRules,
    private readonly users: UserRules,
    private readonly rewards: TaskRewards,
    private readonly rewardRules: RewardRules,
  ) {}

  /** PKFunc.php:452 loadCampaignInitData. */
  @GlobalCommand()
  async loadCampaignInitData(ctx: CommandContext): Promise<unknown> {
    return this.scope.transaction(async () => {
      const ret: unknown[] = [];
      let levelInfo = await this.row(
        sql<Row>`select normal, special from sys_pk_user where uid = ${ctx.uid}`,
      );
      if (!levelInfo) {
        await sql`insert into sys_pk_user (uid, normal, special) values (${ctx.uid}, 1, 1)`.execute(
          this.scope.db,
        );
        levelInfo = await this.row(
          sql<Row>`select normal, special from sys_pk_user where uid = ${ctx.uid}`,
        );
      }
      ret.push(levelInfo ?? false);
      const heroColumns = sql<Row>`b.battleid, b.levelid, a.hero_level, a.user_level, b.hid,
        c.face, c.sex, c.flag, c.name, b.area, c.energy, c.energy_add, c.command_base,
        c.command_add, c.affair_base, c.affair_add, c.bravery_base, c.bravery_add,
        c.wisdom_base, c.wisdom_add, c.speed_base, c.speed_add,
        floor((c.bravery_base + c.bravery_add) * 5 + (c.energy + c.energy_add) * 10 +
          c.wisdom_base + c.wisdom_add) as battle`;
      const heroQuery = (type: number) => sql<Row>`select ${heroColumns}
        from cfg_pk_battle a, cfg_pk_level b, cfg_pk_hero c
        where a.id = b.battleid and b.hid = c.hid and b.type = ${type}
        order by b.battleid, b.levelid, b.area`;
      ret.push(await this.rows(heroQuery(0)));
      ret.push(await this.rows(heroQuery(1)));
      const rewards: Row[] = [];
      for (const battle of await this.rows(sql<Row>`select id from cfg_pk_battle order by id`)) {
        const battleId = phpIntval(battle.id);
        rewards.push({
          battleid: battle.id,
          flag: 0,
          goods:
            (await this.row(sql<Row>`select * from cfg_goods where gid = ${pkGid(battleId, 0)}`)) ??
            false,
        });
        rewards.push({
          battleid: battle.id,
          flag: 1,
          goods:
            (await this.row(sql<Row>`select * from cfg_goods where gid = ${pkGid(battleId, 1)}`)) ??
            false,
        });
      }
      ret.push(rewards);
      const goods: Row = {};
      const junling = await this.row(
        sql<Row>`select * from sys_goods where uid = ${ctx.uid} and gid = ${JUNLING_GID}`,
      );
      // a missing row reads as null (PHP array offset on bool), unlike fetch_one_cell's false
      goods.junling = junling ? junling.count : null;
      if (!junling) {
        // 首次送玩家10个军令 (PKFunc.php:486)
        await this.goods.addGoods(ctx.uid, JUNLING_GID, 10, 5);
        goods.junling = 10;
      }
      goods.wuzhuqian = await this.cell(
        sql<Row>`select count as v from sys_goods where uid = ${ctx.uid} and gid = ${WUZHU_GID}`,
      );
      ret.push(goods);
      ret.push(await this.rows(sql<Row>`select id, description from cfg_pk_battle order by id`));
      return ret;
    });
  }

  /** PKFunc.php:371 getOneBattleRet: one ladder fight — 3 chosen heroes vs the level's NPCs. */
  @GlobalCommand()
  async getOneBattleRet(ctx: CommandContext, param: unknown[]): Promise<unknown> {
    return this.scope.transaction(async () => {
      if (param.length < 4) throw GameError.lang('useMojiaGoods.invalid_param');
      if (!(await this.goods.checkGoods(ctx.uid, JUNLING_GID))) {
        // PKFunc.php:376 — the 军令 message reuses the 迁城文案 verbatim.
        throw GameError.lang('changeCityPosition.no_adv_lijianfu');
      }
      const shifted = [...param];
      const battleId = phpIntval(shifted.shift());
      const battleFlag = phpIntval(shifted.shift());
      const battleLevel = phpIntval(shifted.shift());
      const battleHids = shifted.shift();
      await this.checkUserLevel(ctx.uid, battleId, battleFlag);
      await this.checkUserPassLevel(ctx.uid, battleId, battleLevel, battleFlag);
      // PHP count() of a scalar is 1, so a non-array 4th argument fails the check below.
      if ((Array.isArray(battleHids) ? battleHids.length : 1) < 3) {
        throw GameError.lang('useMojiaGoods.invalid_param');
      }
      const hidQueue = [...(battleHids as unknown[])];
      const heroId1 = phpIntval(hidQueue.shift());
      const heroId2 = phpIntval(hidQueue.shift());
      const heroId3 = phpIntval(hidQueue.shift());
      const checkNum = phpNum(
        await this.cell(sql<Row>`select count(*) as v from sys_city_hero
          where uid = ${ctx.uid} and hid in (${heroId1}, ${heroId2}, ${heroId3})`),
      );
      if (checkNum !== 3) throw GameError.lang('heroPk.no_hero_info');
      const userHero = async (hid: number, standIndex: number) =>
        this.row(sql<Row>`select a.hid, a.sex, \`force\` as energy, ${standIndex} as standIndex,
          command_base + command_add_on as command,
          affairs_base + affairs_add + affairs_add_on as affair,
          bravery_base + bravery_add + bravery_add_on as bravery,
          wisdom_base + wisdom_add + wisdom_add_on as wisdom,
          speed_add_on as speed
          from sys_city_hero a, mem_hero_blood b where a.hid = b.hid and a.hid = ${hid}`);
      const npcHero = async (area: number, standIndex: number) => {
        const npcHid = await this.cell(sql<Row>`select hid as v from cfg_pk_level
          where battleid = ${battleId} and levelid = ${battleLevel} and type = ${battleFlag}
          and area = ${area}`);
        // A missing level row read `hid=` and died in PearDB; bound as 0 instead (no level seeds
        // hid 0 fights — the pass-level gate never reaches a level without cfg rows).
        return this.row(sql<Row>`select hid, sex, energy + energy_add as energy,
          ${standIndex} as standIndex,
          command_base + command_add as command, affair_base + affair_add as affair,
          bravery_base + bravery_add as bravery, wisdom_base + wisdom_add as wisdom,
          speed_base + speed_add as speed
          from cfg_pk_hero where hid = ${phpIntval(npcHid)}`);
      };
      const ret: unknown[] = [
        startUserPK(
          this.random,
          [
            (await userHero(heroId1, 11)) ?? false,
            (await userHero(heroId2, 12)) ?? false,
            (await userHero(heroId3, 13)) ?? false,
          ],
          [
            (await npcHero(1, 21)) ?? false,
            (await npcHero(2, 22)) ?? false,
            (await npcHero(3, 23)) ?? false,
          ],
        ),
      ];
      // 扣掉一个军令 — charged even for a lost fight.
      await this.goods.reduceGoods(ctx.uid, JUNLING_GID, 1);
      // 发放奖励
      const battle = ret[0];
      let reward: unknown = '';
      if (phpLooseEquals((battle as Row).winer, 1)) {
        reward = await this.sendUserReward(ctx.uid, battleId, battleLevel, battleFlag);
      }
      // PHP vivifies an empty engine result into an object when the reward key lands on it.
      const result: Row = Array.isArray(battle) ? {} : (battle as Row);
      result.reward = reward;
      return [result];
    });
  }

  /** PKFunc.php:424 getPkFirstReward: claim a chapter's first-pass top-three prize. */
  @GlobalCommand()
  async getPkFirstReward(ctx: CommandContext, param: unknown[]): Promise<unknown> {
    return this.scope.transaction(async () => {
      const battleId = phpIntval(param.shift());
      const flag = phpIntval(param.shift());
      const rankId = phpIntval(param.shift());
      if (
        !(await this.check(sql`select 1 as one from cfg_pk_first
          where uid = ${ctx.uid} and battleid = ${battleId} and rankid = ${rankId} and type = ${flag}`))
      ) {
        throw GameError.lang('useMojiaGoods.invalid_param');
      }
      if (
        await this.check(sql`select 1 as one from cfg_pk_first
          where uid = ${ctx.uid} and battleid = ${battleId} and rankid = ${rankId} and type = ${flag}
          and time > 1`)
      ) {
        throw GameError.lang('king.has_get_reward');
      }
      const reward = phpString(
        await this.cell(sql<Row>`select reward as v from cfg_pk_first
          where uid = ${ctx.uid} and battleid = ${battleId} and type = ${flag} and rankid = ${rankId}`),
      );
      const ret: unknown[] = [];
      ret.push(
        await this.rewardRules.parseAndAddReward(ctx.uid, reward, {
          goods: 5,
          armor: 5,
          things: 5,
          money: 65,
        }),
      );
      await sql`update cfg_pk_first set time = unix_timestamp() where uid = ${ctx.uid}
        and battleid = ${battleId} and rankid = ${rankId} and type = ${flag}`.execute(
        this.scope.db,
      );
      return ret;
    });
  }

  /** PKFunc.php:497 loadPKRewardRank: a chapter's first-pass top three, parsed for the client. */
  @GlobalCommand()
  async loadPKRewardRank(ctx: CommandContext, param: unknown[]): Promise<unknown> {
    const battleId = phpIntval(param.shift());
    const battleType = phpIntval(param.shift());
    const rankRewardFrontThree = await this.rows(sql<Row>`select * from cfg_pk_first
      where battleid = ${battleId} and type = ${battleType} order by rankid asc limit 3`);
    for (const rank of rankRewardFrontThree) {
      if (!phpEmpty(rank.uid)) {
        rank.userName = await this.cell(
          sql<Row>`select name as v from sys_user where uid = ${rank.uid}`,
        );
        const time = phpNum(rank.passtime);
        rank.formatTime = await this.cell(sql<Row>`select from_unixtime(${time}) as v`);
      }
      const rewardArr = phpString(rank.reward).split(',');
      if (phpLooseEquals(rewardArr[1], 0)) {
        // 奖励为物品
        const gid = phpIntval(rewardArr[2]);
        rank.rewardType = 0;
        rank.rewardGood =
          (await this.row(sql<Row>`select * from cfg_goods where gid = ${gid}`)) ?? false;
        rank.rewardCount = rewardArr[3] ?? null;
      } else {
        // 奖品为装备
        const armorid = phpIntval(rewardArr[2]);
        rank.rewardType = 1;
        rank.rewardGood =
          (await this.row(sql<Row>`select * from cfg_armor where id = ${armorid}`)) ?? false;
        rank.rewardCount = rewardArr[3] ?? null;
      }
    }
    return [rankRewardFrontThree];
  }

  /** PKFunc.php:537 regetCampaignMaxData: the floors reached, refetched after a fight. */
  @GlobalCommand()
  async regetCampaignMaxData(ctx: CommandContext): Promise<unknown> {
    const userBattleInfo = await this.row(
      sql<Row>`select normal, special from sys_pk_user where uid = ${ctx.uid}`,
    );
    const junlin = await this.cell(
      sql<Row>`select count as v from sys_goods where uid = ${ctx.uid} and gid = ${JUNLING_GID}`,
    );
    const wuzhuqian = await this.cell(
      sql<Row>`select count as v from sys_goods where uid = ${ctx.uid} and gid = ${WUZHU_GID}`,
    );
    return [userBattleInfo ?? false, junlin, wuzhuqian];
  }

  /** PKFunc.php:548 buyJunlingFunc: 军令 at 5 元宝 each, stock capped at 100. */
  @GlobalCommand()
  async buyJunlingFunc(ctx: CommandContext, param: unknown[]): Promise<unknown> {
    return this.scope.transaction(async () => {
      const type = phpIntval(param.shift()); // 0是元宝，1是五珠钱
      const count = phpIntval(param.shift());
      const price = 5;
      if (type !== 0) throw GameError.lang('buyGoods.invalid_pay_type');
      if (count <= 0) throw GameError.lang('buyGoods.invalid_amount');
      const needCost = count * price;
      // utils.php::checkMoney
      const money = await this.cell(
        sql<Row>`select money as v from sys_user where uid = ${ctx.uid}`,
      );
      if (phpEmpty(money) || phpNum(money) < needCost) {
        throw GameError.lang('buyGoods.no_enough_YuanBao');
      }
      // 验证下玩家拥有的最多军令数量为100个
      const currentCount = await this.cell(
        sql<Row>`select count as v from sys_goods where uid = ${ctx.uid} and gid = ${JUNLING_GID}`,
      );
      const maxBuyCount = phpEmpty(currentCount) ? 100 : 100 - phpIntval(currentCount);
      if (count > maxBuyCount) throw GameError.lang('buyGoods.junling_max_count', maxBuyCount);
      const ret: unknown[] = [type, phpIntval(currentCount) + count];
      if (type === 0) {
        await this.rewards.addMoney(ctx.uid, 0 - needCost, type);
        ret.push(await this.cell(sql<Row>`select money as v from sys_user where uid = ${ctx.uid}`));
      }
      await this.goods.addGoods(ctx.uid, JUNLING_GID, count, 0);
      return ret;
    });
  }

  /** PKFunc.php:607 getAllHeroByUid: the campaign (and arena) hero picker, 10 per page by 勇气. */
  @GlobalCommand()
  async getAllHeroByUid(ctx: CommandContext, param: unknown[]): Promise<unknown> {
    const hasSelectedHidArr = param.shift();
    const page = phpIntval(param.shift());
    if (!Array.isArray(hasSelectedHidArr) || page <= 0) {
      throw GameError.lang('useMojiaGoods.invalid_param');
    }
    const selected = hasSelectedHidArr;
    const hidStr = selected.map((value) => phpString(value)).join(',');
    const listQuery = (limit: number, offset: number, exclude: boolean) =>
      sql<Row>`select h.*, (h.bravery_base + h.bravery_add + h.bravery_add_on) as heroBravery, m.*
        from sys_city_hero h, mem_hero_blood m where h.hid = m.hid and h.uid = ${ctx.uid}
        ${
          exclude && selected.length
            ? sql`and h.hid not in (${sql.join(
                selected.map((value) => sql`${value}`),
                sql`, `,
              )})`
            : sql``
        }
        and h.herotype <> 1000 order by heroBravery desc, h.hid limit ${offset}, ${limit}`;
    const kingHero = () =>
      this.row(sql<Row>`select * from sys_city_hero h left join mem_hero_blood m on m.hid = h.hid
        where h.uid = ${ctx.uid} and herotype = 1000`);
    if (page === 1) {
      if (phpEmpty(hidStr)) {
        // 君主将需要加载到第一页的第一个
        return [await this.rows(listQuery(9, 0, false)), page, (await kingHero()) ?? false];
      }
      const kingHid = await this.cell(
        sql<Row>`select hid as v from sys_city_hero where uid = ${ctx.uid} and herotype = 1000`,
      );
      if (selected.some((value) => phpLooseEquals(kingHid, value))) {
        return [await this.rows(listQuery(10, 0, true)), page];
      }
      return [await this.rows(listQuery(9, 0, true)), page, (await kingHero()) ?? false];
    }
    return [await this.rows(listQuery(10, (page - 1) * 10, phpEmpty(hidStr) ? false : true)), page];
  }

  // ---- internals (not whitelisted) ----

  /** PKFunc.php:215 checkFirstPass: fills the chapter's first-pass ranks 1-3, skipping repeats. */
  private async checkFirstPass(uid: number, battleId: number, flag: number): Promise<void> {
    const uid1 = await this.cell(sql<Row>`select uid as v from cfg_pk_first
      where battleid = ${battleId} and type = ${flag} and rankid = 1`);
    const uid2 = await this.cell(sql<Row>`select uid as v from cfg_pk_first
      where battleid = ${battleId} and type = ${flag} and rankid = 2`);
    if (
      await this.check(sql`select 1 as one from cfg_pk_first
        where battleid = ${battleId} and type = ${flag} and rankid = 1 and uid = 0`)
    ) {
      await sql`update cfg_pk_first set uid = ${uid}, passtime = unix_timestamp()
        where battleid = ${battleId} and type = ${flag} and rankid = 1`.execute(this.scope.db);
    } else if (
      (await this.check(sql`select 1 as one from cfg_pk_first
        where battleid = ${battleId} and type = ${flag} and rankid = 2 and uid = 0`)) &&
      !phpLooseEquals(uid, uid1)
    ) {
      await sql`update cfg_pk_first set uid = ${uid}, passtime = unix_timestamp()
        where battleid = ${battleId} and type = ${flag} and rankid = 2`.execute(this.scope.db);
    } else if (
      (await this.check(sql`select 1 as one from cfg_pk_first
        where battleid = ${battleId} and type = ${flag} and rankid = 3 and uid = 0`)) &&
      !phpLooseEquals(uid, uid1) &&
      !phpLooseEquals(uid, uid2)
    ) {
      await sql`update cfg_pk_first set uid = ${uid}, passtime = unix_timestamp()
        where battleid = ${battleId} and type = ${flag} and rankid = 3`.execute(this.scope.db);
    }
  }

  /**
   * PKFunc.php:240 sendUserReward: the drop item rolls only on a 3 of mt_rand(1,10) (:245); a
   * chapter's final floor additionally pays the cfg_pk_reward chest and books the first pass.
   */
  private async sendUserReward(
    uid: number,
    battleId: number,
    battleLevel: number,
    battleFlag: number,
  ): Promise<unknown[]> {
    const ret: Row[] = [];
    let msg = '';
    let chest = false;
    let gid = pkGid(battleId, battleFlag);
    if (this.random.mtRand(1, 10) !== 3) gid = 0;
    if (gid > 0) {
      await this.goods.addGoods(uid, gid, 1, 1);
      ret.push({
        flag: 0,
        info: (await this.row(sql<Row>`select * from cfg_goods where gid = ${gid}`)) ?? false,
        count: 1,
      });
      msg += `${phpString(
        await this.cell(sql<Row>`select name as v from cfg_goods where gid = ${gid}`),
      )}*1,`;
    }
    if (!(await this.check(sql`select 1 as one from sys_pk_user where uid = ${uid}`))) {
      await sql`insert into sys_pk_user (uid, normal, special) values (${uid}, 1, 1)`.execute(
        this.scope.db,
      );
    }
    // 第一次通关奖励
    const passId = phpNum(
      await this.cell(
        battleFlag === 1
          ? sql<Row>`select special as v from sys_pk_user where uid = ${uid}`
          : sql<Row>`select normal as v from sys_pk_user where uid = ${uid}`,
      ),
    );
    const passBattleId = Math.trunc(passId / 100);
    const tmpLevel = Math.trunc(passId % 100);
    const maxLevel = phpNum(
      await this.cell(sql<Row>`select max(levelid) as v from cfg_pk_level
        where battleid = ${battleId} and type = ${battleFlag}`),
    );
    if (
      battleId === passBattleId &&
      phpLooseEquals(maxLevel, tmpLevel + 1) &&
      phpLooseEquals(battleLevel, maxLevel)
    ) {
      const armors = await this.rows(sql<Row>`select rewardid, count from cfg_pk_reward
        where battleid = ${passBattleId} and type = ${battleFlag} and rewardtype = 1`);
      for (const armor of armors) {
        const armorid = phpIntval(armor.rewardid);
        await this.rewards.addArmor(uid, armorid, phpIntval(armor.count), 1);
        ret.push({
          flag: 1,
          info: (await this.row(sql<Row>`select * from cfg_armor where id = ${armorid}`)) ?? false,
          count: armor.count,
        });
        msg += `${phpString(
          await this.cell(sql<Row>`select name as v from cfg_armor where id = ${armorid}`),
        )}*${phpString(armor.count)},`;
      }
      const goodses = await this.rows(sql<Row>`select rewardid, count from cfg_pk_reward
        where battleid = ${passBattleId} and type = ${battleFlag} and rewardtype = 0`);
      for (const goods of goodses) {
        const rewardGid = phpIntval(goods.rewardid);
        await this.goods.addGoods(uid, rewardGid, phpIntval(goods.count), 1);
        ret.push({
          flag: 0,
          info:
            (await this.row(sql<Row>`select * from cfg_goods where gid = ${rewardGid}`)) ?? false,
          count: goods.count,
        });
        msg += `${phpString(
          await this.cell(sql<Row>`select name as v from cfg_goods where gid = ${rewardGid}`),
        )}*${phpString(goods.count)},`;
      }
      chest = true;
      // 看下是否首次通关
      await this.checkFirstPass(uid, battleId, battleFlag);
    }
    // 更新通关最大值
    const newId = battleId * 100 + battleLevel;
    if (battleFlag === 0 && newId > passId) {
      await sql`update sys_pk_user set normal = ${newId} where uid = ${uid}`.execute(this.scope.db);
    } else if (battleFlag === 1 && newId > passId) {
      await sql`update sys_pk_user set special = ${newId} where uid = ${uid}`.execute(
        this.scope.db,
      );
    }
    // 通关提示
    if (msg.length > 2) {
      msg = msg.slice(0, -1);
      const username = await this.cell(sql<Row>`select name as v from sys_user where uid = ${uid}`);
      const battlename = await this.cell(
        sql<Row>`select battlename as v from cfg_pk_battle where id = ${battleId}`,
      );
      const str = this.lang.t('userPK.pass_battle_info', username, battlename, msg);
      await this.users.sendSysInform({
        type: 0,
        inuse: 1,
        starttime: 0,
        endtime: 600,
        interval: 50000,
        scrollcount: 1,
        color: chest ? 15627776 : 49151,
        msg: str,
      });
    }
    return ret;
  }

  /** PKFunc.php:351 checkUserLevel: 普通 gates on the lord hero, 精英 on 修为. */
  private async checkUserLevel(uid: number, battleId: number, flag: number): Promise<void> {
    if (flag === 0) {
      const heroLevel = await this.cell(sql<Row>`select level as v from sys_city_hero
        where uid = ${uid} and herotype = 1000`);
      const needLevel = await this.cell(
        sql<Row>`select hero_level as v from cfg_pk_battle where id = ${battleId}`,
      );
      if (phpNum(heroLevel) < phpNum(needLevel)) {
        throw GameError.lang('heroPk.hero_level_low');
      }
    } else {
      const userLevel = await this.cell(
        sql<Row>`select level as v from sys_user_level where uid = ${uid}`,
      );
      const needLevel = await this.cell(
        sql<Row>`select user_level as v from cfg_pk_battle where id = ${battleId}`,
      );
      if (phpNum(userLevel) < phpNum(needLevel)) {
        throw GameError.lang('heroPk.user_level_low');
      }
    }
  }

  /** PKFunc.php:321 checkUserPassLevel: no skipping chapters or floors. */
  private async checkUserPassLevel(
    uid: number,
    battleId: number,
    battleLevel: number,
    battleFlag: number,
  ): Promise<void> {
    const passId = phpNum(
      await this.cell(
        battleFlag === 1
          ? sql<Row>`select special as v from sys_pk_user where uid = ${uid}`
          : sql<Row>`select normal as v from sys_pk_user where uid = ${uid}`,
      ),
    );
    const passBattleId = Math.trunc(passId / 100);
    const tmpLevel = Math.trunc(passId % 100);
    const maxLevel = phpNum(
      await this.cell(sql<Row>`select max(levelid) as v from cfg_pk_level
        where battleid = ${battleId} and type = ${battleFlag}`),
    );
    if (battleId === passBattleId) {
      if (battleLevel > maxLevel || battleLevel > tmpLevel + 1) {
        throw GameError.lang('sendCommand.command_exception');
      }
    } else if (battleId === passBattleId + 1) {
      if (battleLevel > 1) throw GameError.lang('sendCommand.command_exception');
    } else if (battleId > passBattleId + 1) {
      throw GameError.lang('sendCommand.command_exception');
    }
  }

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async row(query: RawBuilder<Row>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  /** sql_fetch_one_cell: false when the query has no rows (lib/database.php:606). */
  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : false;
  }

  /** sql_check: the query matched at least one row. */
  private async check(query: RawBuilder<Row>): Promise<boolean> {
    return (await this.rows(query)).length > 0;
  }
}
