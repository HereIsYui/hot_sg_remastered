import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { HotelRules } from '../city/hotel-rules.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import type { Row } from '../task/task-goals.service';

/** getWuhunByHid's five quality thresholds. */
export function wuhunGid(hid: number, roll: number): number {
  return (
    hid +
    (roll <= 60 ? 110000 : roll <= 90 ? 120000 : roll <= 97 ? 130000 : roll <= 99 ? 140000 : 150000)
  );
}
export function cardQuality(roll: number): number {
  return roll > 999 ? 1 : roll > 989 ? 2 : roll >= 889 ? 3 : 4;
}

@Injectable()
export class WuhunCardCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly heroes: HeroRules,
    private readonly users: UserRules,
    private readonly random: RandomService,
    private readonly hotel: HotelRules,
    private readonly cities: CityRules,
  ) {}

  @GlobalCommand()
  async genWuHunBySuipian(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.scope.transaction(async () => {
      const uid = ctx.uid,
        gid = phpIntval(param[0]),
        banner = !phpEmpty(param[1]);
      if (banner && !(await this.goods.checkGoods(uid, 148)))
        throw GameError.raw('not_enough_goods148');
      const count = banner ? 1 : 10;
      if (!(await this.goods.checkGoodsCount(uid, gid, count)))
        throw GameError.lang('useGoods.not_enough_wuHunSuiPian');
      await this.goods.reduceGoods(uid, gid, count);
      if (banner) await this.goods.reduceGoods(uid, 148, 1);
      // PHP evaluates the random roll even when the banner guarantees success.
      const success = this.random.mtRand(1, 100) <= 70 || banner;
      if (success)
        await this.goods.addGoods(uid, wuhunGid(gid - 100000, this.random.mtRand(1, 100)), 1, 0);
      await this.users.logUserAction(uid, 10);
      return [
        gid,
        0,
        this.lang.t(
          success ? 'useGoods.genWuHunBySuipian_succ' : 'useGoods.genWuHunBySuipian_fail',
        ),
      ];
    });
  }

  @GlobalCommand()
  async genWuHunByRumor(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.scope.transaction(async () => {
      const uid = ctx.uid,
        tid = phpIntval(param[0]);
      if (!(await this.goods.checkGoods(uid, 149))) throw GameError.raw('not_enough_goods149');
      if (
        phpNum(
          await this.cell(sql`select count from sys_things where uid = ${uid} and tid = ${tid}`),
        ) < 1
      )
        throw GameError.lang('useGoods.no_this_rumor');
      await this.goods.reduceGoods(uid, 149, 1);
      // The portrait is deliberately retained, and PHP's undefined $gid is null.
      const hid = tid - 20000,
        fragment = this.random.mtRand(1, 100) <= 90;
      await this.goods.addGoods(
        uid,
        fragment ? 100000 + hid : wuhunGid(hid, this.random.mtRand(1, 100)),
        1,
        0,
      );
      await this.users.logUserAction(uid, 11);
      return [
        null,
        0,
        this.lang.t(
          fragment ? 'useGoods.genWuHunByRumor_getsuipian' : 'useGoods.genWuHunByRumor_getwuhun',
        ),
      ];
    });
  }

  @GlobalCommand()
  async afterUseShenMiChuanYinFu(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.scope.transaction(async () => {
      // addslashes in PHP only escapes the SQL literal: bound parameters preserve the raw text.
      await this.users.sendSysInform({
        type: 0,
        inuse: 1,
        starttime: 0,
        endtime: 300,
        interval: 60,
        scrollcount: 1,
        color: 49151,
        msg: phpString(param[0]),
      });
      // No server-side answer / ownership / replay validation in PHP.
      await this.goods.addGoods(ctx.uid, 150, 1, 9);
      return [];
    });
  }

  async useQuestion(uid: number): Promise<Row | null> {
    if (!(await this.goods.checkGoods(uid, 147)))
      throw GameError.lang('useShenMiChuanYinFu.no_ShenMiChuanYinFu');
    const questions = await this.rows(sql`select * from sys_question q`);
    const selected = this.random.randRange(0, questions.length - 1);
    await this.goods.reduceGoods(uid, 147, 1);
    return questions[selected] ?? null;
  }

  async useWuHun(uid: number, hid: number, gid: number): Promise<string> {
    const npcid = (gid - 110000) % 10000;
    const mul = [0.6, 0.7, 0.8, 0.95, 1.1][Math.trunc((gid - 110000) / 10000)] ?? 0;
    if (!(await this.goods.checkGoods(uid, gid)))
      throw GameError.lang(
        'wuhun.no_wuhun',
        await this.cell(sql`select name from cfg_goods where gid = ${gid}`),
      );
    const hero =
      (await this.row(
        sql`select * from sys_city_hero where uid = ${uid} and hid = ${hid} limit 1`,
      )) ?? {};
    const buftype = gid - 25;
    const buffer = await this.row(
      sql`select * from mem_hero_buffer where hid = ${hid} and buftype = ${buftype}`,
    );
    if (buffer) {
      await sql`update mem_hero_buffer set endtime = endtime + 86400 where hid = ${hid} and buftype = ${buftype}`.execute(
        this.scope.db,
      );
      await this.heroes.updateCityHeroChange(uid, phpIntval(hero.cid));
      await this.goods.reduceGoods(uid, gid, 1);
      return this.lang.t('useGoods.usewuhun_suc');
    }
    if (phpNum(hero.state) !== 0) throw GameError.lang('wuhun.only_wuhun_free_hero');
    const row = await this.row(sql`select ${mul} * b.affairs_base - a.affairs_base as affairs,
      ${mul} * b.bravery_base - a.bravery_base as bravery, ${mul} * b.wisdom_base - a.wisdom_base as wisdom
      from sys_city_hero a, cfg_npc_hero b where a.hid = ${hid} and b.npcid = ${npcid}`);
    const affairs = phpIntval(phpNum(row?.affairs)),
      bravery = phpIntval(phpNum(row?.bravery)),
      wisdom = phpIntval(phpNum(row?.wisdom));
    const command =
      Math.trunc(
        phpNum(
          await this.cell(sql`select command_base from sys_city_hero where npcid = ${npcid}`),
        ) * mul,
      ) - phpNum(await this.cell(sql`select command_base from sys_city_hero where hid = ${hid}`));
    await sql`insert into sys_city_hero_base_add (hid, uid, affairs_base_add_on, bravery_base_add_on, wisdom_base_add_on, command_base_add_on, type)
      values (${hid}, ${uid}, ${affairs}, ${bravery}, ${wisdom}, ${command}, 2)`.execute(
      this.scope.db,
    );
    await sql`update sys_city_hero set affairs_base = affairs_base + ${affairs}, bravery_base = bravery_base + ${bravery},
      wisdom_base = wisdom_base + ${wisdom}, command_base = command_base + ${command} where hid = ${hid}`.execute(
      this.scope.db,
    );
    await sql`delete from mem_hero_buffer where hid = ${hid} and buftype > 109975 and buftype < 159975`.execute(
      this.scope.db,
    );
    await sql`insert into mem_hero_buffer (hid, buftype, endtime) values (${hid}, ${buftype}, unix_timestamp() + 86400)`.execute(
      this.scope.db,
    );
    await this.heroes.updateCityHeroChange(uid, phpIntval(hero.cid));
    await this.goods.reduceGoods(uid, gid, 1);
    await this.heroes.regenerateHeroAttri(uid, hid);
    return this.lang.t('useGoods.usewuhun_suc');
  }

  private async checkCardsOpen(): Promise<void> {
    const state = phpNum(await this.cell(sql`select value from mem_state where state = 197`));
    if (state !== 60 && state !== 55555555) throw GameError.lang('goods.not_available');
  }

  @GlobalCommand()
  async mixCard(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const result = await this.scope.transaction(async () => {
      try {
        await this.checkCardsOpen();
        const uid = ctx.uid;
        if (param.length < 2) throw GameError.lang('useGoods.hero_card_5');
        const original = phpIntval(param[0]),
          color = Math.floor((original - 200000) / 10000),
          heroId = original % 10000;
        if (color === 1) throw GameError.lang('useGoods.hero_card_6');
        const roll = this.random.mtRand(1, 100);
        for (const value of param.slice(1)) {
          const gid = phpIntval(value);
          if (!(await this.goods.checkGoods(uid, gid)))
            throw GameError.lang('useGoods.no_this_good');
          await this.goods.reduceGoods(uid, gid, 1, 251);
        }
        if (roll >= 4 * (param.length - 1)) return [this.lang.t('useGoods.hero_card_2')];
        if (!(await this.goods.checkGoods(uid, original)))
          throw GameError.lang('useGoods.no_this_good');
        await this.goods.reduceGoods(uid, original, 1, 251);
        await this.goods.addGoods(uid, original - 10000, 1, 250);
        const name = phpString(
          await this.cell(sql`select name from cfg_npc_hero where npcid = ${heroId} limit 1`),
        );
        const card = name + this.lang.t(`useGoods.hero_card.${color - 1}`);
        if (color === 2) await this.cardAnnouncement(uid, 'useGoods.hero_card_12', card);
        return [this.lang.t('useGoods.hero_card_3') + card];
      } catch (error) {
        // PHP commits each deduction: a missing later material/original retains earlier costs.
        // Return rule failures through the transaction, then report them after commit.
        if (error instanceof GameError) return error;
        throw error;
      }
    });
    if (result instanceof GameError) throw result;
    return result;
  }

  @GlobalCommand()
  async multiUseCard(ctx: CommandContext, _param: unknown[]): Promise<unknown[]> {
    return this.scope.transaction(async () => {
      await this.checkCardsOpen();
      const uid = ctx.uid,
        count = Math.min(
          100,
          phpNum(
            await this.cell(sql`select count from sys_goods where gid = 250 and uid = ${uid}`),
          ),
        );
      // Map retains PHP's first-seen quality order.
      const counts = new Map<number, number>();
      for (let i = 0; i < count; i++) {
        const card = await this.useOneHeroCard(uid);
        if (card) counts.set(card[0], (counts.get(card[0]) ?? 0) + 1);
      }
      let sum = 0,
        text = '';
      for (const [quality, n] of counts) {
        sum += n;
        text +=
          n + this.lang.t('useGoods.hero_card_9') + this.lang.t(`useGoods.hero_card.${quality}`);
      }
      if (counts.has(1)) await this.cardAnnouncement(uid, 'useGoods.hero_card_11');
      return [this.lang.t('useGoods.hero_card_10', sum, text)];
    });
  }

  async giveMeHeroCard(uid: number): Promise<string> {
    await this.checkCardsOpen();
    const card = await this.useOneHeroCard(uid);
    if (!card) throw GameError.lang('useGoods.no_this_good');
    const name = await this.cell(sql`select name from cfg_npc_hero where npcid = ${card[1]}`);
    if (card[0] === 1) await this.cardAnnouncement(uid, 'useGoods.hero_card_11');
    return this.lang.t('useGoods.hero_card_1', name, this.lang.t(`useGoods.hero_card.${card[0]}`));
  }

  private async useOneHeroCard(uid: number): Promise<[number, number] | false> {
    const quality = cardQuality(this.random.mtRand(1, 1005));
    const part = await this.cell(sql`select value from mem_state where state = 250`);
    const hero = await this.row(
      sql`select hid, name from cfg_hero_card_schedule where part != 0 and part <= ${part} order by rand() limit 1`,
    );
    const hid = phpIntval(hero?.hid);
    if (!(await this.goods.checkGoods(uid, 250))) return false;
    await this.goods.reduceGoods(uid, 250, 1);
    await this.goods.addGoods(uid, 200000 + quality * 10000 + hid, 1, 3);
    return [quality, hid];
  }

  private async cardAnnouncement(uid: number, key: string, card?: string): Promise<void> {
    const name = await this.cell(sql`select name from sys_user where uid = ${uid}`);
    const msg = this.lang.t(key, name, card);
    await sql`insert into sys_inform (type, inuse, starttime, endtime, \`interval\`, scrollcount, color, msg)
      values (0, 1, unix_timestamp(), unix_timestamp() + 60, 0, 1, 15627776, ${msg})`.execute(
      this.scope.db,
    );
  }

  async generateHero4Card(uid: number, cid: number, gid: number): Promise<string> {
    await this.checkCardsOpen();
    if (!(await this.hotel.cityHasHeroPosition(uid, cid)))
      throw GameError.lang('recruitHero.hotel_level_low');
    if (
      phpNum(
        await this.cell(
          sql`select count(1) from sys_city_hero where uid = ${uid} and herotype >= 21250 and herotype <= 24250`,
        ),
      ) >= 5
    )
      throw GameError.lang('useGoods.hero_card_7');
    const npcid = gid % 10000,
      quality = Math.floor((gid - 200000) / 10000);
    const hero =
      (await this.row(sql`select * from cfg_npc_hero where npcid = ${npcid} limit 1`)) ?? {};
    let command = phpNum(
      await this.cell(sql`select command_base from sys_city_hero where npcid = ${npcid} limit 1`),
    );
    if (npcid >= 1027 && npcid <= 1032) command = this.random.randRange(80, 100);
    else if (npcid === 1033) command = 108;
    const min = [0, 90, 80, 70, 60][quality] ?? 0;
    const affairs = Math.floor(
      (phpNum(hero.affairs_base) * this.random.mtRand(min, min + 5)) / 100,
    );
    const bravery = Math.floor(
      (phpNum(hero.bravery_base) * this.random.mtRand(min, min + 5)) / 100,
    );
    const wisdom = Math.floor((phpNum(hero.wisdom_base) * this.random.mtRand(min, min + 5)) / 100);
    command = Math.floor((command * ([0, 50, 30, 15, 5][quality] ?? 0)) / 100);
    if (!(await this.goods.checkGoods(uid, gid))) throw GameError.lang('useGoods.no_this_good');
    await this.goods.reduceGoods(uid, gid, 1);
    const result =
      await sql`insert into sys_city_hero (uid, name, sex, face, cid, state, level, exp,
      affairs_base, bravery_base, wisdom_base, command_base, affairs_add, bravery_add, wisdom_add, loyalty, herotype)
      values (${uid}, ${hero.name}, ${hero.sex}, ${hero.face}, ${cid}, 0, 1, 0, ${affairs}, ${bravery}, ${wisdom}, ${command}, 0, 0, 0, 100, ${20250 + quality * 1000})`.execute(
        this.scope.db,
      );
    const hid = Number(result.insertId),
      force = 100 + Math.floor(bravery / 3),
      energy = 100 + Math.floor(wisdom / 3);
    await sql`insert into mem_hero_blood (hid, \`force\`, force_max, energy, energy_max) values (${hid}, ${force}, ${force}, ${energy}, ${energy})`.execute(
      this.scope.db,
    );
    await this.heroes.regenerateHeroAttri(uid, hid);
    await this.heroes.updateCityHeroChange(uid, cid);
    return (
      phpString(hero.name) + ':' + this.lang.t(`useGoods.hero_card_4.${this.random.mtRand(1, 3)}`)
    );
  }

  async useArmyOrder(uid: number, cid: number, gid: number): Promise<string> {
    await this.checkCardsOpen();
    if (!(await this.goods.checkGoods(uid, gid))) throw GameError.lang('useGoods.no_this_good');
    await this.goods.reduceGoods(uid, gid, 1);
    const sid = [8, 10, 12, 11][gid - 251]!;
    await sql`insert into sys_city_soldier (cid, sid, count) values (${cid}, ${sid}, 500)
      on duplicate key update count = count + 500`.execute(this.scope.db);
    await sql`insert into log_city_soldier (cid, sid, uid, count, type) values (${cid}, ${sid}, 0, 500, 9)
      on duplicate key update count = count + 500`.execute(this.scope.db);
    await this.cities.updateCityResourceAdd(cid);
    await this.users.updateUserPrestige(uid);
    return this.lang.t('useGoods.hero_card_8');
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
}
