import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules, LORD_HERO_TYPE } from '../core/hero-rules.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import type { Row } from './task-goals.service';

/** Log reason codes of the task rewards (log_goods / log_things / log_armor, log_money / log_gift). */
export const TASK_LOG_TYPE = 4;
export const TASK_MONEY_LOG_TYPE = 60;

/** Battlefield gear, whose grant can open battlefields (utils.php::updateBattleOpenState). */
const BATTLE_ARMOR = { min: 20000, max: 31000 };

/** Gear that comes with a title (utils.php::sendDesignation). */
const ARMOR_DESIGNATIONS: Record<number, number> = { 12018: 24, 12016: 25 };

/** Achievements for reaching a nobility (giveResource type 18). */
const NOBILITY_ACHIEVEMENTS: Record<number, number> = { 1: 37, 5: 38, 11: 39 };

/** NPC and system accounts below this uid never get achievements. */
const FIRST_PLAYER_UID = 897;

/** cfg_achivement.open_time */
const AchievementOpen = { AfterNewbie: 1, AfterHuangJin: 2 } as const;

/** The reward grants and goal deductions of TaskFunc.php (giveReward, reduceGoal and helpers). */
@Injectable()
export class TaskRewards {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cities: CityRules,
    private readonly goods: GoodsRules,
    private readonly heroes: HeroRules,
    private readonly users: UserRules,
    private readonly random: RandomService,
  ) {}

  /** giveReward: grants one cfg_task_reward row; with `withMessage`, returns its broadcast text. */
  async giveReward(
    uid: number,
    cid: unknown,
    reward: Row,
    withMessage = false,
    logType = TASK_LOG_TYPE,
    moneyLogType = TASK_MONEY_LOG_TYPE,
  ): Promise<string> {
    const type = phpIntval(reward.type);
    const count = phpNum(reward.count);
    switch (phpIntval(reward.sort)) {
      case 1:
        return this.giveResource(uid, cid, type, count, moneyLogType, withMessage);
      case 2:
        if (type === 0) {
          await this.addGift(uid, count, moneyLogType);
          return withMessage ? this.lang.t('resPackage.gain_yuanbao', count) : '';
        }
        await this.goods.addGoods(uid, type, count, logType);
        return withMessage ? this.gained('gain_goods', 'cfg_goods', 'gid', type, count) : '';
      case 3: {
        const sid = type === 0 ? this.random.mtRand(1, 12) : type;
        await this.giveArmy(cid, sid, count);
        return withMessage ? this.gained('gain_soldier', 'cfg_soldier', 'sid', sid, count) : '';
      }
      case 4:
        await this.giveDefence(cid, type, count);
        return withMessage ? this.gained('gain_defence', 'cfg_defence', 'did', type, count) : '';
      case 5:
        await this.goods.addThings(uid, type, count, logType);
        return withMessage ? this.gained('gain_things', 'cfg_things', 'tid', type, count) : '';
      case 6:
        await this.addArmor(uid, type, count, logType);
        return withMessage ? this.gained('gain_armor', 'cfg_armor', 'id', type, count) : '';
      case 10:
        return this.giveTask(uid, type);
      case 11:
        return this.giveTasks(uid, type);
      default:
        return '';
    }
  }

  /** giveResource. The battle-net scores (500-502) went to a remote server that does not exist. */
  async giveResource(
    uid: number,
    cid: unknown,
    type: number,
    count: number,
    moneyLogType = TASK_MONEY_LOG_TYPE,
    withMessage = false,
  ): Promise<string> {
    const db = this.scope.db;
    const n = String(count);
    const cityAdd = async (column: string, key: string) => {
      await sql`update mem_city_resource set ${sql.ref(column)} = ${sql.ref(column)} + ${n}
        where cid = ${cid}`.execute(db);
      return withMessage ? this.lang.t(`resPackage.${key}`, count) : '';
    };
    switch (type) {
      case 1:
        return cityAdd('gold', 'gain_gold');
      case 2:
        return cityAdd('food', 'gain_food');
      case 3:
        return cityAdd('wood', 'gain_wood');
      case 4:
        return cityAdd('rock', 'gain_rock');
      case 5:
        return cityAdd('iron', 'gain_iron');
      case 6:
        return cityAdd('people', 'gain_people');
      case 7: {
        const msg = withMessage
          ? this.lang.t(
              'resPackage.gain_morale',
              await this.cell(sql`select least(100 - morale, ${n}) from mem_city_resource
                where cid = ${cid}`),
            )
          : '';
        await sql`update mem_city_resource set morale = least(100, morale + ${n}),
            people_stable = people_max * least(100, morale + ${n}) * 0.01
          where cid = ${cid}`.execute(db);
        return msg;
      }
      case 8:
        await sql`update mem_city_resource set complaint = greatest(0, complaint + ${n})
          where cid = ${cid}`.execute(db);
        return '';
      case 9: {
        const msg = withMessage
          ? this.lang.t(
              'resPackage.gain_prestige',
              await this.cell(sql`select greatest(100 - morale, ${n}) from mem_city_resource
                where cid = ${cid}`),
            )
          : '';
        await sql`update sys_user set prestige = prestige + ${n}, warprestige = warprestige + ${n}
          where uid = ${uid}`.execute(db);
        return msg;
      }
      case 17:
        await sql`update sys_user set officepos = greatest(officepos, ${n})
          where uid = ${uid}`.execute(db);
        return withMessage
          ? this.lang.t(
              'resPackage.gain_officepos',
              await this.cell(sql`select name from cfg_office_pos where id = ${n}`),
            )
          : '';
      case 18: {
        await sql`update sys_user set nobility = greatest(nobility, ${n})
          where uid = ${uid}`.execute(db);
        const msg = withMessage
          ? this.lang.t(
              'resPackage.gain_nobility',
              await this.cell(sql`select name from cfg_nobility where id = ${n}`),
            )
          : '';
        const achievement = count >= 14 ? count + 26 : NOBILITY_ACHIEVEMENTS[count];
        if (achievement !== undefined) await this.finishAchievement(uid, achievement);
        return msg;
      }
      case 19:
        await this.addGift(uid, count, moneyLogType);
        return withMessage ? this.lang.t('resPackage.gain_yuanbao', count) : '';
      case 20:
        await this.addMoney(uid, count, 54);
        return '';
      case 22:
        await this.addMoney(uid, count, 57);
        return '';
      case 122:
        await this.addMoney(uid, count, moneyLogType);
        return '';
      case 30:
        await sql`update sys_user set honour = honour + ${n} where uid = ${uid}`.execute(db);
        return '';
      default:
        return '';
    }
  }

  /** reduceGoal: takes what a goal with `reduce` set asked for. */
  async reduceGoal(uid: number, cid: unknown, goal: Row): Promise<void> {
    const type = phpIntval(goal.type);
    const count = phpNum(goal.count);
    switch (phpIntval(goal.sort)) {
      case 1:
        await this.giveResource(uid, cid, type, -count);
        break;
      case 2:
        await this.goods.addGoods(uid, type, -count, TASK_LOG_TYPE);
        break;
      case 3:
        await this.giveArmy(cid, type, -count);
        break;
      case 4:
        await this.giveDefence(cid, type, -count);
        break;
      case 5:
        await this.goods.addThings(uid, type, -count, TASK_LOG_TYPE);
        break;
      case 6:
        await this.cutArmor(uid, type, count);
        break;
      case 101:
        await sql`insert into temp_act_event (uid, type, eid, count)
          values (${uid}, 101, ${type}, ${-count})
          on duplicate key update count = count - ${count}`.execute(this.scope.db);
        break;
      case 203:
        throw new Error('reduceGoal(203): 备战洛阳 not ported');
      case 201: {
        const heroes = await this.rows(sql`select hid from sys_city_hero where uid = ${uid}
          and herotype = ${type} and state = 0 order by level limit ${count}`);
        for (const hero of heroes) await this.deleteHero(uid, hero.hid);
        break;
      }
    }
  }

  /** TaskFunc.php::cutArmor: removes `count` unequipped pieces of a gear type. */
  async cutArmor(uid: number, armorid: unknown, count: number): Promise<void> {
    const db = this.scope.db;
    await sql`delete from sys_user_armor where uid = ${uid} and armorid = ${armorid} and hid = 0
      limit ${count}`.execute(db);
    await sql`insert into log_armor (uid, armorid, count, time, type)
      values (${uid}, ${armorid}, ${-count}, unix_timestamp(), ${TASK_LOG_TYPE})`.execute(db);
  }

  /** TaskFunc.php::cutArmorBySid: removes one piece of gear. */
  async cutArmorBySid(uid: number, armorid: unknown, sid: unknown): Promise<void> {
    const db = this.scope.db;
    await sql`delete from sys_user_armor where uid = ${uid} and sid = ${sid} and hid = 0`.execute(
      db,
    );
    await sql`insert into log_armor (uid, armorid, count, time, type)
      values (${uid}, ${armorid}, -1, unix_timestamp(), ${TASK_LOG_TYPE})`.execute(db);
  }

  /** HeroFunc.php::deleteHero: a free, non-lord hero leaves for the wild. */
  async deleteHero(uid: number, hid: unknown): Promise<void> {
    const hero = await this.row(sql`select * from sys_city_hero
      where uid = ${uid} and hid = ${hid} limit 1`);
    if (!hero) throw GameError.lang('dismissHero.cant_dissmiss_this');
    if (!phpLooseEquals(hero.state, 0)) throw GameError.lang('dismissHero.only_dissmiss_free_hero');
    if (phpIntval(hero.herotype) === LORD_HERO_TYPE) {
      throw GameError.lang('dismissHero.king_hero_can_not_delete');
    }
    await this.deleteHeroBaseAdd(hero.hid);
    await this.heroes.throwHeroToField({ ...hero, hid: phpIntval(hero.hid) });
    await this.heroes.updateCityHeroChange(uid, hero.cid);
  }

  /** utils.php::giveTask: hands out a task, starting its counters. Returns the task name. */
  async giveTask(uid: number, tid: number): Promise<string> {
    const db = this.scope.db;
    await sql`insert into sys_user_task (uid, tid, state) values (${uid}, ${tid}, 0)
      on duplicate key update state = state`.execute(db);
    await this.startCounters(uid, tid);
    return phpString(await this.cell(sql`select name from cfg_task where id = ${tid}`));
  }

  /** utils.php::giveTasks: every task of a group. Returns the group name. */
  async giveTasks(uid: number, groupId: number): Promise<string> {
    const db = this.scope.db;
    const tasks = await this.rows(sql`select id from cfg_task where \`group\` = ${groupId}`);
    for (const task of tasks) {
      await sql`insert into sys_user_task (uid, tid, state) values (${uid}, ${task.id}, 0)
        on duplicate key update state = state`.execute(db);
    }
    for (const task of tasks) await this.startCounters(uid, task.id);
    return phpString(await this.cell(sql`select name from cfg_task_group where id = ${groupId}`));
  }

  /** Zeroed sys_user_goal rows for the task's counting goals (sorts 50 and 80). */
  async startCounters(uid: number, tid: unknown): Promise<void> {
    const goals = await this.rows(sql`select id from cfg_task_goal
      where tid = ${tid} and sort in (50, 80)`);
    for (const goal of goals) {
      await sql`insert into sys_user_goal (uid, gid, currentcount) values (${uid}, ${goal.id}, 0)
        on duplicate key update currentcount = currentcount`.execute(this.scope.db);
    }
  }

  /** utils.php::addMoney: 元宝, with spending also summed per day. */
  async addMoney(uid: number, money: number, type: number): Promise<void> {
    if (money === 0) return;
    const db = this.scope.db;
    await sql`insert into log_money (uid, count, time, type)
      values (${uid}, ${money}, unix_timestamp(), ${type})`.execute(db);
    await sql`update sys_user set money = money + ${money} where uid = ${uid}`.execute(db);
    if (money < 0) {
      await sql`insert into log_day_money (day, money)
        values (unix_timestamp() - ((unix_timestamp() + 28800) % 86400), ${money})
        on duplicate key update money = money + ${money}`.execute(db);
    }
  }

  /** utils.php::addGift: 礼金. */
  async addGift(uid: number, gift: number, type: number): Promise<void> {
    if (gift === 0) return;
    const db = this.scope.db;
    await sql`insert into log_gift (uid, count, time, type)
      values (${uid}, ${gift}, unix_timestamp(), ${type})`.execute(db);
    await sql`update sys_user set gift = gift + ${gift} where uid = ${uid}`.execute(db);
  }

  /** utils.php::finishAchivement */
  async finishAchievement(uid: number, id: number): Promise<void> {
    if (uid < FIRST_PLAYER_UID) return;
    if (await this.check(sql`select 1 from cfg_achivement where id = ${id} and state = '0'`))
      return;
    if (
      await this.check(sql`select 1 from sys_user_achivement
        where uid = ${uid} and achivement_id = ${id}`)
    ) {
      return;
    }
    const openTime = phpIntval(
      await this.cell(sql`select open_time from cfg_achivement where id = ${id}`),
    );
    if (openTime === AchievementOpen.AfterNewbie) {
      const state = await this.cell(sql`select state from sys_user where uid = ${uid}`);
      if (!phpLooseEquals(state, 0)) return;
    } else if (openTime === AchievementOpen.AfterHuangJin) {
      const state = await this.cell(sql`select value from mem_state where state = 5`);
      if (!phpLooseEquals(state, 1)) return;
    }
    const db = this.scope.db;
    await sql`insert into sys_user_achivement (uid, achivement_id, time)
      values (${uid}, ${id}, unix_timestamp())`.execute(db);
    const cfg = await this.row(sql`select union_inform, system_inform, name, point
      from cfg_achivement where id = ${id}`);
    await sql`update sys_user set achivement_count = achivement_count + 1,
        achivement_point = achivement_point + ${phpNum(cfg?.point)}
      where uid = ${uid}`.execute(db);
    const user = await this.row(sql`select name, union_id from sys_user where uid = ${uid}`);
    const msg = this.lang.t('Achivement.congrats', user?.name, cfg?.name);
    if (phpLooseEquals(cfg?.union_inform, 1)) {
      for (const table of ['sys_union_event', 'mem_union_event']) {
        await sql`insert into ${sql.table(table)} (unionid, type, content, evttime)
          values (${user?.union_id}, 11, ${msg}, unix_timestamp())`.execute(db);
      }
    }
    if (phpLooseEquals(cfg?.system_inform, 1)) {
      await this.users.sendSysInform({
        type: 0,
        inuse: 1,
        starttime: 0,
        endtime: 600,
        interval: 50000,
        scrollcount: 1,
        color: 49151,
        msg,
      });
    }
  }

  private async giveArmy(cid: unknown, sid: number, count: number): Promise<void> {
    const db = this.scope.db;
    await sql`insert into sys_city_soldier (cid, sid, count) values (${cid}, ${sid}, ${count})
      on duplicate key update count = count + ${count}`.execute(db);
    await sql`insert into log_city_soldier (cid, sid, uid, count, type)
      values (${cid}, ${sid}, 0, ${count}, 6)
      on duplicate key update count = count + ${count}`.execute(db);
    await this.cities.updateCityResourceAdd(phpIntval(cid));
  }

  private async giveDefence(cid: unknown, did: number, count: number): Promise<void> {
    await sql`insert into sys_city_defence (cid, did, count) values (${cid}, ${did}, ${count})
      on duplicate key update count = count + ${count}`.execute(this.scope.db);
  }

  /** utils.php::addArmor at strength level 0. */
  private async addArmor(uid: number, armorid: number, count: number, logType: number) {
    if (count === 0) return;
    if (armorid >= BATTLE_ARMOR.min && armorid <= BATTLE_ARMOR.max) {
      throw new Error(`addArmor(${armorid}): battlefield opening not ported`);
    }
    const db = this.scope.db;
    const armor = await this.row(sql`select * from cfg_armor where id = ${armorid}`);
    const strongValue = await this.cell(sql`select strong_value from cfg_strong_probability
      where level = 0`);
    for (let i = 0; i < count; i++) {
      await sql`insert into sys_user_armor
          (uid, armorid, hp, hp_max, hid, strong_level, strong_value, combine_level)
        values (${uid}, ${armor?.id ?? ''}, ${phpNum(armor?.ori_hp_max) * 10},
          ${armor?.ori_hp_max ?? ''}, 0, 0, ${phpEmpty(strongValue) ? 0 : strongValue}, 0)`.execute(
        db,
      );
    }
    const did = ARMOR_DESIGNATIONS[armorid];
    if (
      did !== undefined &&
      !(await this.check(sql`select 1 from sys_user_designation
        where uid = ${uid} and did = ${did}`))
    ) {
      await sql`insert into sys_user_designation (did, uid, ison, state)
        values (${did}, ${uid}, 0, 1)`.execute(db);
    }
    await sql`insert into log_armor (uid, armorid, count, time, type)
      values (${uid}, ${armor?.id ?? ''}, ${count}, unix_timestamp(), ${logType})`.execute(db);
  }

  /** HeroFunc.php::deleteHeroBaseAdd: undoes the hero's attribute bonuses. */
  private async deleteHeroBaseAdd(hid: unknown): Promise<void> {
    const db = this.scope.db;
    const row = await this.row(sql`select sum(command_base_add_on) as command,
        sum(affairs_base_add_on) as affairs, sum(bravery_base_add_on) as bravery,
        sum(wisdom_base_add_on) as wisdom
      from sys_city_hero_base_add where hid = ${hid}`);
    await sql`update sys_city_hero set bravery_base = bravery_base - ${phpIntval(row?.bravery)},
        wisdom_base = wisdom_base - ${phpIntval(row?.wisdom)},
        affairs_base = affairs_base - ${phpIntval(row?.affairs)},
        command_base = command_base - ${phpIntval(row?.command)}
      where hid = ${hid}`.execute(db);
    await sql`delete from sys_city_hero_base_add where hid = ${hid}`.execute(db);
    await sql`update mem_hero_buffer set endtime = unix_timestamp() where hid = ${hid}`.execute(db);
    await sql`insert into log_act (uid, actid, sort, type, count, log_type, time)
      select 0, ${hid}, 2, gid, 1, ${TASK_LOG_TYPE}, unix_timestamp() from cfg_goods
      where gid between 10150 and 10155`.execute(db);
  }

  /** `获得了【名称*数量】` from the item's config table. */
  private async gained(
    key: string,
    table: string,
    idColumn: string,
    id: number,
    count: number,
  ): Promise<string> {
    let name = phpString(
      await this.cell(sql`select name from ${sql.table(table)} where ${sql.ref(idColumn)} = ${id}`),
    );
    if (count > 0) name = `${name}*${count}`;
    return this.lang.t(`resPackage.${key}`, name);
  }

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

  private async check(query: RawBuilder<unknown>): Promise<boolean> {
    return (await this.rows(query)).length > 0;
  }
}
