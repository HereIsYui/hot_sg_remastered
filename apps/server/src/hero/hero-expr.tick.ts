import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { LangService } from '../common/lang.service';
import { sprintf } from '../common/sprintf';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { ReportService } from '../core/report.service';
import { DbScope } from '../db/database.module';
import { TickHandler, TickOrder } from '../tick/tick.decorator';

type Row = Record<string, unknown>;

/** HeroExprinc.php: sys_report.title for 将领历练结束 / 君主历练. */
const RT_HEROEXPR_END = 46;
const RT_KING_EXPR = 46;
/** NPC id boundaries from HeroExprinc.php. */
const NPC_UID_END = 897;
const NPC_HID_END = 1026;
/** addMoney reason 121: carried gold returned on an early-return expr. */
const MONEY_REFUND_CARRY = 121;
/** addUserGoods reason 10: a 历练 reward. */
const LOG_EXPR_GOODS = 10;

/**
 * HeroExpr.php::checkHeroExpr, the 将领历练 slot of the settlement loop (cfg_js.php
 * HandleHeroHexprs). Finishes every expr whose time is up: ordinary heroes gain base experience
 * and may trigger 奇遇 events; the 君主将 (sys_king_expr) gets its own 缘份 reward roll.
 */
@Injectable()
export class HeroExprTick {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly report: ReportService,
    private readonly random: RandomService,
  ) {}

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async cell(query: RawBuilder<unknown>): Promise<unknown> {
    const row = (await this.rows(query))[0];
    return row ? Object.values(row)[0] : false;
  }

  private t(key: string, ...args: unknown[]): string {
    return this.lang.t(key, ...args);
  }

  @TickHandler(TickOrder.HeroExpr)
  async checkHeroExpr(): Promise<void> {
    await this.ordinaryHeroExpr();
    await this.moranchHeroExpr();
  }

  /** HeroExpr.php::ordinaryHeroExpr: normal heroes whose expr ended; state 0 finishes with the
   * reward roll, state 1 (cancelled) only refunds gold and adds a small experience bonus. */
  private async ordinaryHeroExpr(): Promise<void> {
    const list = await this.rows(sql`select * from sys_hero_expr
      where endtime < unix_timestamp() and state in (0, 1) order by endtime`);
    for (const heroExp of list) {
      await this.scope.transaction(() => this.finishOne(heroExp));
    }
  }

  private async finishOne(heroExp: Row): Promise<void> {
    const db = this.scope.db;
    const hid = phpNum(heroExp.hid);
    const id = heroExp.id;
    if (phpNum(heroExp.state) === 0) {
      await this.finishHeroExpr(heroExp);
    } else {
      const carrymoney = phpNum(heroExp.carrymoney);
      await this.addMoney(phpNum(heroExp.uid), carrymoney, MONEY_REFUND_CARRY);
      const hours = phpNum(heroExp.hours);
      const expAdd = phpNum(heroExp.exp_add) + 10 * this.random.randRange(hours, 2 * hours);
      if (expAdd > 0) {
        await sql`update sys_city_hero set exp = exp + ${expAdd} where hid = ${hid}`.execute(db);
      }
    }
    await sql`delete from sys_hero_expr where id = ${id}`.execute(db);
    await sql`update sys_city_hero set state = 0 where hid = ${hid}`.execute(db);
  }

  /** HeroExpr.php::finishHeroExpr: base experience plus the three 奇遇 rolls, then one report. */
  private async finishHeroExpr(heroExp: Row): Promise<void> {
    const uid = phpNum(heroExp.uid);
    const cid = phpNum(heroExp.cid);
    const hid = phpNum(heroExp.hid);
    const hours = phpNum(heroExp.hours);
    const type = phpNum(heroExp.type);
    const hero = (await this.rows(sql`select * from sys_city_hero where hid = ${hid}`))[0] ?? {};
    const expAdd = this.getHeroBaseExp(type, phpNum(hero.level), hours);
    await sql`update sys_city_hero set exp = exp + ${expAdd} where hid = ${hid}`.execute(
      this.scope.db,
    );
    let report = await this.getReportHead(type, phpString(hero.name), hours, expAdd);
    report += await this.baseEvents(heroExp);
    report += await this.heroFightEvents(heroExp);
    report += await this.commonExprEvents(heroExp);
    await this.report.sendReport(uid, RT_HEROEXPR_END, cid, cid, report);
  }

  /** HeroExpr.php::getHeroBaseExp. */
  private getHeroBaseExp(type: number, level: number, hours: number): number {
    if (type === 1) return hours * level * 600 + this.random.mtRand(1, 1000);
    if (type === 2) return hours * level * 1200 + this.random.mtRand(1, 1000);
    return 0;
  }

  /** HeroExpr.php::getTypeName. */
  private async getTypeName(type: number): Promise<string> {
    return phpString(
      await this.cell(sql`select name from cfg_hero_expr_types where type = ${type}`),
    );
  }

  /** HeroExpr.php::getReportHead. */
  private async getReportHead(
    type: number,
    name: string,
    hours: number,
    expAdd: number,
  ): Promise<string> {
    const typeName = await this.getTypeName(type);
    let report = `${this.t('heroExpr.type_name', typeName)}<br/>`;
    report += this.t('heroExpr.experience', name, typeName, hours, expAdd);
    return `${report}<br/>`;
  }

  /**
   * HeroExpr.php::baseEvents: the 修身养性 / 闯荡江湖 exclusive 奇遇, happening with a chance that
   * grows with the booked hours; one reward is drawn by its rate weight.
   */
  private async baseEvents(heroExp: Row): Promise<string> {
    const hours = phpNum(heroExp.hours);
    if (this.random.mtRand(1, 100) >= 25 + hours * hours * 1.2) return '';
    let type = phpNum(heroExp.type);
    if (type !== 1 && type !== 2) type = 1;
    const reward = await this.pickReward(
      sql`select * from cfg_hero_expr_reward where type = ${type}`,
      sql`select sum(rate) from cfg_hero_expr_reward where type = ${type}`,
    );
    if (!reward) return '';
    return this.baseEventsHappen(heroExp, reward);
  }

  private async baseEventsHappen(heroExp: Row, reward: Row): Promise<string> {
    const hero = (await this.heroRow(heroExp)) ?? {};
    switch (phpNum(reward.sort)) {
      case 1:
        return this.addHeroExp(heroExp, hero, reward);
      case 2:
        return this.addHeroLoyalty(heroExp, hero, reward);
      case 3:
        return this.addExprRes(heroExp, hero, reward);
      case 4:
        return this.addExprGoods(heroExp, hero, reward);
      case 5:
        return this.addExprPearls(heroExp, reward);
      case 6:
        return this.addHeroBaseAddOn(heroExp, hero, reward);
      case 7:
        return this.addExprSoldier(heroExp, hero, reward);
      default:
        return '';
    }
  }

  /** HeroExpr.php::heroFightEvents: a 30% 将领切磋; the reward table depends on the PK result. */
  private async heroFightEvents(heroExp: Row): Promise<string> {
    if (this.random.mtRand(1, 100) > 30) return '';
    const arr = await this.getRandFightResult(
      phpNum(heroExp.uid),
      phpNum(heroExp.hid),
      phpNum(heroExp.type),
    );
    const reward = await this.pickReward(
      sql`select * from cfg_hero_expr_reward where type = 3 and win = ${arr.result}`,
      sql`select sum(rate) from cfg_hero_expr_reward where type = 3 and win = ${arr.result}`,
    );
    if (!reward) return '';
    return this.heroFightEventHappen(heroExp, reward, arr);
  }

  private async heroFightEventHappen(heroExp: Row, reward: Row, arr: FightResult): Promise<string> {
    const hero = (await this.heroRow(heroExp)) ?? {};
    switch (phpNum(reward.sort)) {
      case 1:
        return this.addHeroBaseAddOn(heroExp, hero, reward, arr);
      case 2:
        return this.addHeroOtherAttr(heroExp, hero, reward, arr);
      case 3:
        return this.addHeroArmorHp(heroExp, reward, arr);
      case 4:
        return this.addHeroLoyalty(heroExp, hero, reward, arr);
      default:
        return '';
    }
  }

  /** HeroExpr.php::commonExprEvents: the public 奇遇 (type 4). */
  private async commonExprEvents(heroExp: Row): Promise<string> {
    if (this.random.mtRand(1, 100) > 30 + this.random.mtRand(1, 30)) return '';
    const reward = await this.pickReward(
      sql`select * from cfg_hero_expr_reward where type = 4`,
      sql`select sum(rate) from cfg_hero_expr_reward where type = 4`,
    );
    if (!reward) return '';
    return this.commonExprEventHappen(heroExp, reward);
  }

  private async commonExprEventHappen(heroExp: Row, reward: Row): Promise<string> {
    switch (phpNum(reward.sort)) {
      case 1:
        return this.commonGoodsEvent(heroExp, reward);
      case 2:
      case 3:
      case 4:
      case 7:
        return this.specialGoodsEvent(heroExp, reward);
      case 5:
        return this.pearlsExchangeEvent(heroExp, reward);
      case 6:
        return this.strongArmorEvent(heroExp, reward);
      case 8:
        return this.reduceSoldierDraftTime(heroExp, reward);
      default:
        return '';
    }
  }

  // --- 修身养性 / 闯荡江湖 reward branches -------------------------------------------------

  /** HeroExpr.php::addHeroExp: evaluates `reward.details` (an expression using `E`=base exp). */
  private async addHeroExp(heroExp: Row, hero: Row, reward: Row): Promise<string> {
    const exp = this.getHeroBaseExp(
      phpNum(heroExp.type),
      phpNum(hero.level),
      phpNum(heroExp.hours),
    );
    const details = phpString(reward.details).replace(/E/g, String(exp));
    let addCount = phpIntval(await this.cell(sql`select ${sql.raw(details)}`));
    if (phpEmpty(addCount)) addCount = 0;
    const userName = await this.userName(heroExp);
    await sql`update sys_city_hero set exp = exp + ${addCount}
      where hid = ${phpNum(heroExp.hid)}`.execute(this.scope.db);
    const msg = `${phpString(reward.name)}<br/>`;
    if (phpNum(reward.inform) === 1) {
      await this.sendSysInform(
        this.t(
          'heroExpr.hero_experience',
          userName,
          hero.name,
          await this.getTypeName(phpNum(heroExp.type)),
          exp + addCount,
        ),
      );
    }
    return msg;
  }

  /** HeroExpr.php::addHeroLoyalty: clamps to 0..100 and announces a gain of 20 or more. */
  private async addHeroLoyalty(
    heroExp: Row,
    hero: Row,
    reward: Row,
    arr: FightResult = emptyFight(),
  ): Promise<string> {
    let addCount = phpNum(reward.details);
    const loyalty = phpNum(hero.loyalty);
    if (loyalty + phpNum(reward.details) >= 100) addCount = 100 - loyalty;
    else if (loyalty + phpNum(reward.details) < 0) addCount = -loyalty;
    if (phpEmpty(addCount)) addCount = 0;
    if (Math.abs(addCount) > 0) {
      await sql`update sys_city_hero set loyalty = loyalty + ${addCount}
        where hid = ${phpNum(heroExp.hid)}`.execute(this.scope.db);
    }
    let msg = '';
    const type = phpNum(reward.type);
    if (type === 1 || type === 2) msg = `${sprintf(phpString(reward.name), addCount)}<br/>`;
    else if (type === 3)
      msg = `${sprintf(phpString(reward.name), arr.userName, arr.heroName)}<br/>`;
    const userName = await this.userName(heroExp);
    if (addCount >= 20) {
      await this.sendSysInform(
        this.t(
          'heroExpr.hero_loyalty',
          userName,
          hero.name,
          await this.getTypeName(phpNum(heroExp.type)),
          addCount,
        ),
      );
    }
    return msg;
  }

  /** HeroExpr.php::addExprRes: a random resource, clamped at 0. */
  private async addExprRes(heroExp: Row, hero: Row, reward: Row): Promise<string> {
    const res =
      (
        await this.rows(sql`select * from cfg_name
        where name in ('food','wood','rock','iron','gold') order by rand() limit 1`)
      )[0] ?? {};
    const col = phpString(res.name);
    await sql`update mem_city_resource
      set ${sql.ref(col)} = greatest(0, ${sql.ref(col)} + ${phpString(reward.details)})
      where cid = ${phpNum(heroExp.cid)}`.execute(this.scope.db);
    const userName = await this.userName(heroExp);
    const msg = `${sprintf(phpString(reward.name), phpString(res.value))}<br/>`;
    if (phpNum(reward.inform) === 1) {
      await this.sendSysInform(
        this.t(
          'heroExpr.hero_goodslist',
          userName,
          hero.name,
          await this.getTypeName(phpNum(heroExp.type)),
          res.value,
          reward.details,
        ),
      );
    }
    return msg;
  }

  /** HeroExpr.php::addExprGoods: a shop item near the reward's price band. */
  private async addExprGoods(heroExp: Row, hero: Row, reward: Row): Promise<string> {
    let goodsValue = phpNum(reward.details);
    const userName = await this.userName(heroExp);
    if (goodsValue > 100) goodsValue = this.random.mtRand(50, 100);
    let goodsId = await this.cell(sql`select gid from cfg_shop
      where onsale = 1 and rebate != 1 and pack = 1 and \`group\` in (0,1,2,3,4)
        and price between ${goodsValue} - 20 and ${goodsValue} + 20 order by rand() limit 1`);
    if (phpEmpty(goodsId)) {
      goodsId = await this.cell(sql`select gid from cfg_shop
        where onsale = 1 and rebate != 1 and pack = 1 and \`group\` in (0,1,2,3,4)
          and price > ${goodsValue} order by price limit 1`);
    }
    if (phpEmpty(goodsId)) {
      goodsId = await this.cell(sql`select gid from cfg_shop
        where onsale = 1 and rebate != 1 and pack = 1 and \`group\` in (0,1,2,3,4)
          and price < ${goodsValue} order by price desc limit 1`);
    }
    if (phpEmpty(goodsId)) return '';
    const goodsName = phpString(
      await this.cell(sql`select name from cfg_goods where gid = ${goodsId}`),
    );
    await this.goods.addGoods(phpNum(heroExp.uid), phpNum(goodsId), 1, LOG_EXPR_GOODS);
    const msg = `${sprintf(phpString(reward.name), goodsName)}<br/>`;
    if (phpNum(reward.inform) === 1) {
      await this.sendSysInform(
        this.t(
          'heroExpr.hero_goods',
          userName,
          hero.name,
          await this.getTypeName(phpNum(heroExp.type)),
          goodsName,
        ),
      );
    }
    return msg;
  }

  /** HeroExpr.php::addExprPearls: a random 宝珠 from cfg_hero_expr_goods type 2. */
  private async addExprPearls(heroExp: Row, reward: Row): Promise<string> {
    const list = await this.rows(sql`select gid, name from cfg_hero_expr_goods where type = 2`);
    if (list.length === 0) return '';
    const goods = list[this.random.mtRand(0, list.length - 1)]!;
    await this.goods.addGoods(phpNum(heroExp.uid), phpNum(goods.gid), 1, LOG_EXPR_GOODS);
    const hero = (await this.heroRow(heroExp)) ?? {};
    const userName = await this.userName(heroExp);
    const msg = `${sprintf(phpString(reward.name), phpString(goods.name))}<br/>`;
    if (phpNum(reward.inform) === 1) {
      await this.sendSysInform(
        this.t(
          'heroExpr.hero_goods',
          userName,
          hero.name,
          await this.getTypeName(phpNum(heroExp.type)),
          goods.name,
        ),
      );
    }
    return msg;
  }

  /** HeroExpr.php::addHeroBaseAddOn: applies the base-attribute change string. */
  private async addHeroBaseAddOn(
    heroExp: Row,
    hero: Row,
    reward: Row,
    arr: FightResult = emptyFight(),
  ): Promise<string> {
    const userName = await this.userName(heroExp);
    const tempStr = await this.addHeroAttribute(heroExp, reward);
    const type = phpNum(reward.type);
    let msg = '';
    if (type === 1 || type === 2) msg = `${phpString(reward.name)}<br/>`;
    else if (type === 3)
      msg = `${sprintf(phpString(reward.name), arr.userName, arr.heroName)}<br/>`;
    if (phpNum(reward.inform) === 1) {
      await this.sendSysInform(
        this.t(
          'heroExpr.hero_attribute',
          userName,
          hero.name,
          await this.getTypeName(phpNum(heroExp.type)),
          tempStr,
        ),
      );
    }
    return msg;
  }

  /** HeroExpr.php::addExprSoldier: a random soldier type 4-8. */
  private async addExprSoldier(heroExp: Row, hero: Row, reward: Row): Promise<string> {
    const userName = await this.userName(heroExp);
    const sid = this.random.mtRand(4, 8);
    await sql`insert into sys_city_soldier (cid, sid, count)
      values (${phpNum(heroExp.cid)}, ${sid}, ${phpString(reward.details)})
      on duplicate key update count = count + ${phpString(reward.details)}`.execute(this.scope.db);
    const soldierName = phpString(
      await this.cell(sql`select name from cfg_soldier where sid = ${sid}`),
    );
    const msg = `${sprintf(phpString(reward.name), soldierName, phpString(reward.details))}<br/>`;
    if (phpNum(reward.inform) === 1) {
      await this.sendSysInform(
        this.t(
          'heroExpr.add_soldiers',
          userName,
          hero.name,
          await this.getTypeName(phpNum(heroExp.type)),
          soldierName,
          reward.details,
        ),
      );
    }
    return msg;
  }

  /**
   * HeroExpr.php::addHeroAttribute: parses "n,type,value,..." and applies to the hero's base
   * attributes plus a sys_city_hero_base_add ledger row; returns a 攻防内政 summary string.
   */
  private async addHeroAttribute(heroExp: Row, reward: Row): Promise<string> {
    const add = { bravery: 0, wisdom: 0, affairs: 0, command: 0, attack: 0, defence: 0 };
    let tempStr = '';
    const attrs = phpString(reward.details).split(',');
    const n = phpNum(attrs[0]);
    for (let i = 0; i < n; i++) {
      const t = phpNum(attrs[2 * i + 1]);
      const value = phpNum(attrs[2 * i + 2]);
      let attid: number;
      if (t === 1) {
        add.bravery += value;
        attid = 3;
      } else if (t === 2) {
        add.wisdom += value;
        attid = 4;
      } else if (t === 3) {
        add.affairs += value;
        attid = 2;
      } else if (t === 4) {
        add.command += value;
        attid = 1;
      } else if (t === 5) {
        add.attack += value;
        attid = 8;
      } else if (t === 6) {
        add.defence += value;
        attid = 9;
      } else {
        continue;
      }
      const attrName = phpString(
        await this.cell(sql`select name from cfg_attribute where attid = ${attid}`),
      );
      const running =
        t === 1
          ? add.bravery
          : t === 2
            ? add.wisdom
            : t === 3
              ? add.affairs
              : t === 4
                ? add.command
                : t === 5
                  ? add.attack
                  : add.defence;
      tempStr += attrName + running;
    }
    await this.insertHeroBaseAdd(phpNum(heroExp.hid), phpNum(heroExp.uid), add);
    return tempStr;
  }

  // --- 将领切磋 reward branches -----------------------------------------------------------

  /** HeroExpr.php::addHeroOtherAttr: 体力 / 精力 and their maximums. */
  private async addHeroOtherAttr(
    heroExp: Row,
    hero: Row,
    reward: Row,
    arr: FightResult,
  ): Promise<string> {
    let force = 0;
    let forceMax = 0;
    let energy = 0;
    let energyMax = 0;
    let tempStr = '';
    const attrs = phpString(reward.details).split(',');
    const n = phpNum(attrs[0]);
    const userName = await this.userName(heroExp);
    let msg = '';
    const hid = phpNum(heroExp.hid);
    for (let i = 0; i < n; i++) {
      const t = phpNum(attrs[2 * i + 1]);
      const value = phpNum(attrs[2 * i + 2]);
      if (t === 1) {
        const blood = (await this.rows(sql`select * from mem_hero_blood where hid = ${hid}`))[0];
        force += phpIntval(phpNum(blood?.force_max) * 0.01 * value);
        tempStr += (await this.attrName(5)) + force;
      } else if (t === 2) {
        forceMax += value;
        tempStr += (await this.attrName(5)) + forceMax;
      } else if (t === 3) {
        const blood = (await this.rows(sql`select * from mem_hero_blood where hid = ${hid}`))[0];
        energy += phpIntval(phpNum(blood?.energy_max) * 0.01 * value);
        tempStr += (await this.attrName(6)) + energy;
      } else if (t === 4) {
        energyMax += value;
        tempStr += (await this.attrName(6)) + energyMax;
      }
      await this.addHeroBlood(hid, force, forceMax, energy, energyMax);
      msg = `${sprintf(phpString(reward.name), arr.userName, arr.heroName)}<br/>`;
      if (phpNum(reward.inform) === 1) {
        await this.sendSysInform(
          this.t(
            'heroExpr.hero_attribute',
            userName,
            hero.name,
            await this.getTypeName(phpNum(heroExp.type)),
            tempStr,
          ),
        );
      }
    }
    return msg;
  }

  /** HeroExpr.php::addHeroArmorHp: nudges every worn piece's durability. */
  private async addHeroArmorHp(heroExp: Row, reward: Row, arr: FightResult): Promise<string> {
    const value = phpNum(reward.details);
    const hid = phpNum(heroExp.hid);
    const armors = await this.rows(sql`select * from sys_user_armor where hid = ${hid}`);
    for (const armor of armors) {
      let addCount = phpNum(armor.hp_max) * 0.1 * value;
      if (phpNum(armor.hp) + addCount > phpNum(armor.hp_max) * 10) {
        addCount = phpNum(armor.hp_max) * 10 - phpNum(armor.hp);
      } else if (phpNum(armor.hp) + addCount < 0) {
        addCount = -phpNum(armor.hp);
      }
      await sql`update sys_user_armor set hp = hp + ${addCount}
        where hid = ${hid} and sid = ${armor.sid}`.execute(this.scope.db);
    }
    return `${sprintf(phpString(reward.name), arr.userName, arr.heroName)}<br/>`;
  }

  /** HeroExpr.php::getRandFightResult: picks a random opponent and resolves a PK. */
  private async getRandFightResult(uid: number, hid: number, type: number): Promise<FightResult> {
    const maxHid = phpNum(await this.cell(sql`select max(hid) from sys_city_hero where uid != 0`));
    const tempHid = this.random.mtRand(1, maxHid || 1);
    const tempHero =
      (
        await this.rows(sql`select * from sys_city_hero
        where hid >= ${tempHid} and uid != 0 and uid != ${uid} limit 1`)
      )[0] ?? {};
    let tempUserName = phpString(
      await this.cell(sql`select name from sys_user where uid = ${phpNum(tempHero.uid)}`),
    );
    if (phpEmpty(tempUserName)) tempUserName = '???';

    const mine =
      (
        await this.rows(sql`select a.energy,
        b.bravery_base + b.bravery_add + b.bravery_add_on as bravery,
        b.wisdom_base + b.wisdom_add + b.wisdom_add_on as wisdom
      from mem_hero_blood a, sys_city_hero b where a.hid = b.hid and b.hid = ${hid}`)
      )[0] ?? {};
    let b = (phpNum(mine.bravery) + phpNum(mine.wisdom)) * 0.1 * phpNum(mine.energy);
    if (b <= 0) b = 1;
    const myValue = (phpNum(mine.bravery) * phpNum(mine.bravery)) / b;

    const theirs =
      (
        await this.rows(sql`select bravery_base + bravery_add + bravery_add_on as bravery,
        wisdom_base + wisdom_add + wisdom_add_on as wisdom
      from sys_city_hero where hid = ${phpNum(tempHero.hid)}`)
      )[0] ?? {};
    let tempEnergy = phpNum(
      await this.cell(sql`select energy from mem_hero_blood where hid = ${phpNum(tempHero.hid)}`),
    );
    if (phpEmpty(tempEnergy)) tempEnergy = 100;
    let b2 = (phpNum(theirs.bravery) + phpNum(theirs.wisdom)) * 0.1 * tempEnergy;
    if (b2 <= 0) b2 = 1;
    const otherValue = (phpNum(theirs.bravery) * phpNum(theirs.bravery)) / b2;
    const rate = phpIntval((100 * myValue) / (myValue + otherValue));
    return {
      userName: tempUserName,
      heroName: phpString(tempHero.name),
      result: this.getRandWin(rate, type),
    };
  }

  /** HeroExpr.php::getRandWin: clamps the win rate by expr type, then rolls. */
  private getRandWin(rateIn: number, type: number): number {
    let rate = rateIn;
    if (type === 1) rate = Math.min(75, Math.max(25, rate));
    else if (type === 2) rate = Math.min(80, Math.max(40, rate));
    return this.random.mtRand(1, 100) < rate ? 1 : 0;
  }

  // --- 公共奇遇 reward branches (deferred rewards the player claims via finishCommonExpr) ----

  /** HeroExpr.php::commonGoodsEvent: queues a pack of common goods to claim within 7 days. */
  private async commonGoodsEvent(heroExp: Row, reward: Row): Promise<string> {
    if (!(await this.isLimited(phpNum(heroExp.uid), phpNum(reward.id), phpNum(reward.total)))) {
      return '';
    }
    const info = await this.getExprCommonGoods();
    const id = await this.insertReward(heroExp, 1, info.curValue, info.goodsList);
    let msg = sprintf(phpString(reward.name), info.curValue, info.str, info.sumValue);
    msg += `${this.t('heroExpr.ok_url', id)}<br/>`;
    return msg;
  }

  /** HeroExpr.php::reduceSoldierDraftTime: queues a 造兵加速 reward. */
  private async reduceSoldierDraftTime(heroExp: Row, reward: Row): Promise<string> {
    if (!(await this.isLimited(phpNum(heroExp.uid), phpNum(reward.id), phpNum(reward.total)))) {
      return '';
    }
    const money = this.random.mtRand(phpNum(reward.minnum), phpNum(reward.maxnum));
    const id = await this.insertReward(
      heroExp,
      phpNum(reward.sort),
      money,
      phpString(reward.details),
    );
    return `${sprintf(phpString(reward.name), money)}${this.t('heroExpr.ok_url', id)}<br/>`;
  }

  /** HeroExpr.php::specialGoodsEvent: queues a special / equipment / attribute / 好感 reward. */
  private async specialGoodsEvent(heroExp: Row, reward: Row): Promise<string> {
    if (phpNum(reward.sort) === 7 && phpNum(heroExp.hid) > NPC_HID_END) return '';
    if (!(await this.isLimited(phpNum(heroExp.uid), phpNum(reward.id), phpNum(reward.total)))) {
      return '';
    }
    const money = this.random.mtRand(phpNum(reward.minnum), phpNum(reward.maxnum));
    const id = await this.insertReward(
      heroExp,
      phpNum(reward.sort),
      money,
      phpString(reward.details),
    );
    return `${sprintf(phpString(reward.name), money)}${this.t('heroExpr.ok_url', id)}<br/>`;
  }

  /** HeroExpr.php::getExprCommonGoods: 1-5 random common goods (type 1) at 85-95% of their value. */
  private async getExprCommonGoods(): Promise<{
    sumValue: number;
    curValue: number;
    str: string;
    goodsList: string;
  }> {
    const rows = await this.rows(sql`select * from cfg_hero_expr_goods where type = 1`);
    this.shuffle(rows);
    const count = this.random.mtRand(1, 5);
    let str = '';
    let goodsList = '';
    let sumValue = 0;
    for (let i = 0; i < count && rows.length > 0; i++) {
      const row = rows.shift()!;
      str += `${phpString(row.name)}*1,`;
      goodsList += `${phpString(row.gid)},`;
      sumValue += phpNum(row.value);
    }
    const curValue = phpIntval(sumValue * 0.01 * this.random.mtRand(85, 95));
    return { sumValue, curValue, str, goodsList };
  }

  /** HeroExpr.php::pearlsExchangeEvent: queues a 宝珠 swap of equal value. */
  private async pearlsExchangeEvent(heroExp: Row, reward: Row): Promise<string> {
    if (!(await this.isLimited(phpNum(heroExp.uid), phpNum(reward.id), phpNum(reward.total)))) {
      return '';
    }
    const fromPearls = await this.rows(sql`select * from cfg_goods
      where gid between 301 and 380 and value >= 200`);
    this.shuffle(fromPearls);
    const fromPearl = fromPearls.shift();
    if (!fromPearl) return '';
    const toPearls = await this.rows(sql`select * from cfg_goods
      where gid between 301 and 380 and value = ${fromPearl.value} and gid != ${fromPearl.gid}`);
    this.shuffle(toPearls);
    const toPearl = toPearls.shift();
    if (!toPearl) return '';
    const money = this.random.mtRand(phpNum(reward.minnum), phpNum(reward.maxnum));
    const details = `${phpString(fromPearl.gid)},${phpString(toPearl.gid)}`;
    const id = await this.insertReward(heroExp, phpNum(reward.sort), money, details);
    let msg = sprintf(
      phpString(reward.name),
      money,
      phpString(fromPearl.name),
      phpString(toPearl.name),
    );
    msg += `${this.t('heroExpr.ok_url', id)}<br/>`;
    return msg;
  }

  /** HeroExpr.php::strongArmorEvent: queues a 装备强化 reward for a strengthenable piece. */
  private async strongArmorEvent(heroExp: Row, reward: Row): Promise<string> {
    if (!(await this.isLimited(phpNum(heroExp.uid), phpNum(reward.id), phpNum(reward.total)))) {
      return '';
    }
    const armor = await this.getCanStrongArmor(phpNum(heroExp.hid));
    if (!armor) return '';
    const money = this.random.mtRand(phpNum(reward.minnum), phpNum(reward.maxnum));
    const id = await this.insertReward(
      heroExp,
      phpNum(reward.sort),
      money,
      phpString(armor.armorId),
    );
    let msg = sprintf(phpString(reward.name), money, armor.armorName);
    msg += `${this.t('heroExpr.ok_url', id)}<br/>`;
    return msg;
  }

  /** HeroExpr.php::getCanStrongArmor: a random worn piece whose strong_level is 0-9. */
  private async getCanStrongArmor(
    hid: number,
  ): Promise<{ armorId: unknown; armorName: string } | null> {
    if (phpEmpty(hid)) return null;
    const armors = await this.rows(sql`select b.* from sys_hero_armor a, sys_user_armor b
      where a.sid = b.sid and b.strong_level between 0 and 9 and a.hid = ${hid}`);
    if (armors.length === 0) return null;
    const armor = armors[this.random.mtRand(0, armors.length - 1)]!;
    const armorName = phpString(
      await this.cell(sql`select name from cfg_armor where id = ${armor.armorid}`),
    );
    return { armorId: armor.sid, armorName };
  }

  /** HeroExpr.php::isLimited: caps how often a public reward is granted per player. */
  private async isLimited(uid: number, rewardId: number, count: number): Promise<boolean> {
    if (phpEmpty(count)) return true;
    const arr = (
      await this.rows(sql`select * from sys_user_expr_reward
      where uid = ${uid} and rewardid = ${rewardId}`)
    )[0];
    if (arr && count <= phpIntval(arr.count)) return false;
    await sql`insert into sys_user_expr_reward (uid, rewardid, count) values (${uid}, ${rewardId}, 1)
      on duplicate key update count = count + 1`.execute(this.scope.db);
    return true;
  }

  // --- 君主历练 (sys_king_expr) -----------------------------------------------------------

  /** HeroExpr.php::MoranchHeroExpr: each 君主历练 whose time is up rolls its 缘份/物品 reward. */
  private async moranchHeroExpr(): Promise<void> {
    const list = await this.rows(sql`select * from sys_king_expr
      where endtime < unix_timestamp() and state in (0, 1) order by endtime`);
    for (const heroExp of list) {
      await this.scope.transaction(() => this.finishKing(heroExp));
    }
  }

  private async finishKing(heroExp: Row): Promise<void> {
    const db = this.scope.db;
    const uid = phpNum(heroExp.uid);
    const cid = phpNum(heroExp.cid);
    const hid = phpNum(heroExp.hid);
    const id = heroExp.id;
    let msg = '历练完成你没找到自己的红颜知己！';
    await sql`delete from sys_king_expr where id = ${id}`.execute(db);
    await sql`update sys_city_hero set state = 0 where hid = ${hid}`.execute(db);
    if (phpNum(heroExp.state) === 0) {
      msg = await this.moranchExpGoods(uid, phpNum(heroExp.hours));
    }
    await this.report.sendReport(uid, RT_KING_EXPR, cid, cid, msg);
  }

  /** HeroExpr.php::MoranchExpGoods: a drop roll weighted by the booked hours (gooodrate). */
  private async moranchExpGoods(uid: number, gooodrate: number): Promise<string> {
    let mycontent = '</br>';
    const numrun = this.kingRoll(gooodrate);
    if (numrun <= 50) return mycontent + this.t('heroExpr.nothings');

    let content = sprintf(this.t('report.moranchtitle'), '君主历练收获！');
    content += sprintf(this.t('report.title_body'), '物品名称', '数量');
    let gid1: number;
    let gid2 = 0;
    if (numrun > 60 && numrun < 85) {
      gid1 = this.random.mtRand(1, 5);
      await this.goods.addGoods(uid, 12065, 1, 0);
      if (numrun > 72 && numrun < 81) gid2 = this.random.mtRand(1, 12);
      mycontent += await this.getYuanFen(uid);
    } else {
      gid1 = this.random.mtRand(1, 12);
      if (numrun > 84 && numrun < 95) gid2 = this.random.mtRand(1, 12);
    }
    const first = KING_GOODS[gid1] ?? KING_GOODS[12]!;
    let count = this.random.mtRand(1, 8);
    await this.goods.addGoods(uid, first.gid, count, 0);
    content += sprintf(this.t('report.title_body'), first.name, count);
    if (gid2) {
      count = this.random.mtRand(3, 10);
      if (gid2 === gid1) gid2 = gid2 > 6 ? this.random.mtRand(1, 6) : this.random.mtRand(7, 12);
      const second = KING_GOODS[gid2] ?? KING_GOODS[12]!;
      await this.goods.addGoods(uid, second.gid, count, 0);
      content += sprintf(this.t('report.title_body'), second.name, count);
    }
    content += this.t('report.title_end');
    return mycontent + content;
  }

  private kingRoll(gooodrate: number): number {
    const floor = { 1: 0, 2: 31, 3: 41, 4: 51, 5: 61, 6: 71, 7: 81 }[gooodrate as 1] ?? 91;
    return this.random.mtRand(floor, 100);
  }

  /** HeroExpr.php::getYuanFen: pairs the king with a 美女 NPC when he holds enough 红玫瑰. */
  private async getYuanFen(uid: number): Promise<string | 0> {
    const gid = 12065; // 红玫瑰
    const count = phpNum(
      await this.cell(sql`select count from sys_goods where gid = ${gid} and uid = ${uid}`),
    );
    if (count <= 0) return 0;
    const candidates = await this.rows(sql`select hid from cfg_marry_mother_hero
      where count <= ${count}`);
    if (candidates.length === 0) return 0;
    const hid = phpNum(candidates[this.random.mtRand(0, candidates.length - 1)]!.hid);
    let needCount = phpNum(
      await this.cell(sql`select count from cfg_marry_mother_hero where hid = ${hid}`),
    );
    if (phpEmpty(needCount)) needCount = 1;
    const already = await this.cell(sql`select hid from sys_king_expr_reward
      where hid = ${hid} and uid = ${uid}`);
    if (!phpEmpty(already)) return 0;
    const wife = await this.cell(sql`select hid from mem_marry_hero_favor
      where hid = ${hid} and uid = ${uid}`);
    if (!phpEmpty(wife)) return 0;
    await sql`insert into sys_king_expr_reward (uid, hid, time, getFlag)
      values (${uid}, ${hid}, unix_timestamp(), 0)`.execute(this.scope.db);
    const id = await this.cell(sql`select last_insert_id()`);
    if (phpEmpty(await this.cell(sql`select * from sys_user_marry where uid = ${uid}`))) {
      await sql`update sys_user_marry set roomcount = 1 where uid = ${uid}`.execute(this.scope.db);
    }
    const girlfriendName = phpString(
      await this.cell(sql`select name from cfg_marry_mother_hero where hid = ${hid}`),
    );
    let msg = this.t('heroExpr.things', girlfriendName, needCount);
    msg += `${this.t('heroExpr.ok_url1', id)}<br/>`;
    return msg;
  }

  // --- shared helpers ---------------------------------------------------------------------

  private heroRow(heroExp: Row): Promise<Row | undefined> {
    return this.rows(sql`select * from sys_city_hero where hid = ${phpNum(heroExp.hid)}`).then(
      (r) => r[0],
    );
  }

  private async userName(heroExp: Row): Promise<string> {
    return phpString(
      await this.cell(sql`select name from sys_user where uid = ${phpNum(heroExp.uid)}`),
    );
  }

  private async attrName(attid: number): Promise<string> {
    return phpString(await this.cell(sql`select name from cfg_attribute where attid = ${attid}`));
  }

  /** Draws one reward from a `type` table weighted by `rate`, like the PHP `curRate` loop. */
  private async pickReward(
    rowsQuery: RawBuilder<unknown>,
    sumQuery: RawBuilder<unknown>,
  ): Promise<Row | null> {
    const rewards = (await rowsQuery.execute(this.scope.db)).rows as Row[];
    const sumRate = phpNum(await this.cell(sumQuery));
    if (sumRate <= 0) return null;
    let curRate = this.random.mtRand(1, sumRate);
    for (const reward of rewards) {
      curRate -= phpNum(reward.rate);
      if (curRate <= 0) return reward;
    }
    return null;
  }

  /** HeroExpr.php::insertHeroBaseAdd. */
  private async insertHeroBaseAdd(
    hid: number,
    uid: number,
    add: {
      bravery: number;
      wisdom: number;
      affairs: number;
      command: number;
      attack: number;
      defence: number;
    },
  ): Promise<void> {
    const db = this.scope.db;
    await sql`insert into sys_city_hero_base_add (uid, hid, bravery_base_add_on,
        wisdom_base_add_on, affairs_base_add_on, command_base_add_on, type)
      values (${uid}, ${hid}, ${add.bravery}, ${add.wisdom}, ${add.affairs}, ${add.command}, 1)`.execute(
      db,
    );
    await sql`update sys_city_hero
      set bravery_base = greatest(0, bravery_base + ${add.bravery}),
        wisdom_base = greatest(0, wisdom_base + ${add.wisdom}),
        affairs_base = greatest(0, affairs_base + ${add.affairs}),
        command_base = greatest(0, command_base + ${add.command}),
        attack_add_on = greatest(0, attack_add_on + ${add.attack}),
        defence_add_on = greatest(0, defence_add_on + ${add.defence})
      where hid = ${hid}`.execute(db);
  }

  /** HeroExpr.php::addHeroBlood. */
  private async addHeroBlood(
    hid: number,
    force: number,
    forceMax: number,
    energy: number,
    energyMax: number,
  ): Promise<void> {
    await sql`update mem_hero_blood
      set \`force\` = greatest(20, least(force_max, \`force\` + ${force})),
        force_max = force_max + ${forceMax},
        energy = greatest(0, least(energy_max, energy + ${energy})),
        energy_max = energy_max + ${energyMax}
      where hid = ${hid}`.execute(this.scope.db);
  }

  /** HeroExpr.php::sendSysInform: a scrolling 跑马灯 message for 60 seconds. */
  private async sendSysInform(msg: string): Promise<void> {
    await sql`insert into sys_inform (type, inuse, starttime, endtime, \`interval\`, scrollcount,
        color, msg)
      values (0, 1, unix_timestamp(), unix_timestamp() + 60, 0, 1, 49151, ${msg})`.execute(
      this.scope.db,
    );
  }

  /** The common sys_hero_expr_reward insert used by every public-奇遇 branch; returns its id. */
  private async insertReward(
    heroExp: Row,
    sort: number,
    money: number,
    details: string,
  ): Promise<unknown> {
    await sql`insert into sys_hero_expr_reward (uid, cid, hid, type, sort, money, details, endtime)
      values (${phpNum(heroExp.uid)}, ${phpNum(heroExp.cid)}, ${phpNum(heroExp.hid)},
        ${phpNum(heroExp.type)}, ${sort}, ${money}, ${details}, unix_timestamp() + 604800)`.execute(
      this.scope.db,
    );
    return this.cell(sql`select last_insert_id()`);
  }

  /** PHP `shuffle()` in place via the injected RNG. */
  private shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.random.mtRand(0, i);
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
  }

  /** addMoney for the cancelled-expr refund (same as the command's). */
  private async addMoney(uid: number, money: number, type: number): Promise<void> {
    if (money === 0 || uid <= NPC_UID_END) return;
    const db = this.scope.db;
    await sql`insert into log_money (uid, count, time, type)
      values (${uid}, ${money}, unix_timestamp(), ${type})`.execute(db);
    await sql`update sys_user set money = money + ${money} where uid = ${uid}`.execute(db);
  }
}

interface FightResult {
  userName: string;
  heroName: string;
  result: number;
}

function emptyFight(): FightResult {
  return { userName: '', heroName: '', result: 0 };
}

/** HeroExpr.php::MoranchExpGoods goods table, keyed by the 1-12 roll. */
const KING_GOODS: Record<number, { gid: number; name: string }> = {
  1: { gid: 12065, name: '红玫瑰' },
  2: { gid: 12066, name: '如意香囊' },
  3: { gid: 12067, name: '兰花簪' },
  4: { gid: 12068, name: '鸳鸯玉佩' },
  5: { gid: 12069, name: '同心结' },
  6: { gid: 10957, name: '初级成长卷' },
  7: { gid: 10958, name: '中级成长卷' },
  8: { gid: 10961, name: '孙子兵法' },
  9: { gid: 12161, name: '凤羽' },
  10: { gid: 12158, name: '龙骨玉' },
  11: { gid: 12159, name: '寒冰玄铁' },
  12: { gid: 10959, name: '高级成长卷' },
};
