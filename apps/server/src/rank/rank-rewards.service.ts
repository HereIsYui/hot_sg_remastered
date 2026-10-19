import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { phpNum, phpString } from '../core/php';
import { phpTime } from '../core/php-time';
import { RandomService } from '../core/random.service';
import { DbScope } from '../db/database.module';

type Row = Record<string, unknown>;

/** Famous heroes given to the top three of 新人王: 王双, 纪灵, 杨任. */
const NEW_KING_NPCS: Record<number, number> = { 1: 88, 2: 291, 3: 632 };
/** 龙渊装备箱子 */
const NEW_KING_BOX = 8887;
/** 联盟礼包 */
const UNION_GIFT = 8894;
/** 战场礼包 */
const BATTLE_GIFT = 8893;
/** 汉室勋章 (a thing, not goods) */
const HAN_MEDAL = 30000;
/** The log reason addGoods / addThings record for these rewards. */
const REWARD_LOG_TYPE = 3;
const DAY = 86400;

/** The opening events and weekly rewards of ReportCron.php, paid from the rankings. */
@Injectable()
export class RankRewards {
  constructor(
    private readonly scope: DbScope,
    private readonly goods: GoodsRules,
    private readonly heroes: HeroRules,
    private readonly random: RandomService,
  ) {}

  /**
   * ReportCron.php::check_user_act: sys_user_act id 1 tracks the opening events; seven days
   * after it starts the 新人王 rewards go out, three days after that the 联盟排行 rewards.
   */
  async checkUserAct(): Promise<void> {
    const act = (await this.rows(sql`select * from sys_user_act where id = 1`))[0];
    const now = phpTime();
    const state = phpNum(act?.state);
    const con = phpNum(act?.con);
    const time = phpNum(act?.time);
    if (state === 1 && con === 0 && time < now - DAY * 7) {
      await sql`update sys_user_act set state = 2, con = 1, time = ${now}
        where id = 1`.execute(this.scope.db);
      await this.getUserNewKing();
    }
    if (state === 2 && con === 1 && time < now - DAY * 3) {
      await sql`update sys_user_act set state = 3, con = 3, time = ${now}
        where id = 1`.execute(this.scope.db);
      await this.getUserUnionKing();
    }
  }

  /** ReportCron.php::GetUserNewKing: the top three lords get a famous hero and 9/7/5 boxes. */
  async getUserNewKing(): Promise<void> {
    const ranks = await this.rows(sql`select * from rank_user_level where \`rank\` < 4`);
    for (const r of ranks) {
      const uid = phpNum(r.uid);
      const type = phpNum(r.rank);
      const cid = (
        await this.rows(sql`select cid from sys_city
        where type = 5 and uid = ${uid}`)
      )[0]?.cid;
      await this.creatNewHero(uid, phpString(cid), NEW_KING_NPCS[type] ?? 0, type);
      await this.goods.addGoods(uid, NEW_KING_BOX, 9 - type * 2, REWARD_LOG_TYPE);
    }
  }

  /** ReportCron.php::GetUserUnionKing: every member of the top three unions gets 5/3/1 gifts. */
  async getUserUnionKing(): Promise<void> {
    const ranks = await this.rows(sql`select * from rank_union where \`rank\` < 4`);
    for (const r of ranks) {
      const count = 7 - 2 * phpNum(r.rank);
      const members = await this.rows(sql`select uid, name from sys_user
        where union_id = ${r.uid}`);
      for (const m of members) {
        await this.goods.addGoods(phpNum(m.uid), UNION_GIFT, count, REWARD_LOG_TYPE);
      }
    }
  }

  /**
   * ReportCron.php::GetUserBattleKing: the week's top ten in honour get 100000..10000 honour; the
   * top three instead get 200000/150000/100000 plus 3/2/1 gifts and 15/10/5 汉室勋章.
   */
  async getUserBattleKing(): Promise<void> {
    const ranks = await this.rows(sql`select * from rank_battle_week
      where \`rank\` < 11 and week > 0`);
    for (const r of ranks) {
      const uid = phpNum(r.uid);
      const rank = phpNum(r.rank);
      let honour = 110000 - rank * 10000;
      if (rank < 4) {
        honour = 250000 - rank * 50000;
        await this.goods.addGoods(uid, BATTLE_GIFT, 4 - rank, REWARD_LOG_TYPE);
        await this.goods.addThings(uid, HAN_MEDAL, 20 - rank * 5, REWARD_LOG_TYPE);
      }
      await sql`update sys_user set honour = honour + ${honour}
        where uid = ${uid}`.execute(this.scope.db);
    }
  }

  /**
   * ReportCron.php::CreatNewHero: a copy of NPC hero `npcid` at a random 90-95% (rank 1) or
   * 80-85% (other ranks) of its attributes; the original's `case 2 or 3` matches any rank but 0.
   */
  private async creatNewHero(uid: number, cid: string, npcid: number, type: number): Promise<void> {
    const db = this.scope.db;
    const npc = (
      await this.rows(sql`select * from cfg_npc_hero where npcid = ${npcid} limit 1`)
    )[0];
    let heroCommand = phpNum(
      (
        await this.rows(sql`select command_base from sys_city_hero where npcid = ${npcid} limit 1`)
      )[0]?.command_base,
    );
    if (npcid <= 1032 && npcid >= 1027) heroCommand = this.random.mtRand(80, 100);
    else if (npcid === 1033) heroCommand = 108;

    let rates = [0, 0, 0];
    let commandRate = 0;
    if (type === 1) {
      rates = [this.random.mtRand(90, 95), this.random.mtRand(90, 95), this.random.mtRand(90, 95)];
      commandRate = 50;
    } else if (type !== 0) {
      rates = [this.random.mtRand(80, 85), this.random.mtRand(80, 85), this.random.mtRand(80, 85)];
      commandRate = 30;
    }
    const [affairsRate, braveryRate, wisdomRate] = rates as [number, number, number];
    const affairs = Math.floor(phpNum(npc?.affairs_base) * (affairsRate / 100));
    const bravery = Math.floor(phpNum(npc?.bravery_base) * (braveryRate / 100));
    const wisdom = Math.floor(phpNum(npc?.wisdom_base) * (wisdomRate / 100));
    const command = Math.floor(heroCommand * (commandRate / 100));
    const herotype = 20250 + type * 1000;
    const inserted = await sql`insert into sys_city_hero (uid, name, sex, face, cid, state, level,
        exp, affairs_base, bravery_base, wisdom_base, command_base, affairs_add, bravery_add,
        wisdom_add, loyalty, herotype)
      values (${uid}, ${phpString(npc?.name)}, ${phpString(npc?.sex)}, ${phpString(npc?.face)},
        ${cid}, 0, 1, 0, ${affairs}, ${bravery}, ${wisdom}, ${command}, 0, 0, 0, 100,
        ${herotype})`.execute(db);
    const hid = Number(inserted.insertId);
    const forcemax = 100 + Math.floor(bravery / 3);
    const energymax = 100 + Math.floor(wisdom / 3);
    await sql`insert into mem_hero_blood (hid, \`force\`, force_max, energy, energy_max)
      values (${hid}, ${forcemax}, ${forcemax}, ${energymax}, ${energymax})`.execute(db);
    await this.heroes.regenerateNewHeroAttri(uid, hid);
    await this.heroes.updateCityHeroChange(uid, cid);
  }

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }
}
