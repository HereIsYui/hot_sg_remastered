import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpNum } from '../core/php';
import { RandomService } from '../core/random.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;
const RATES = [0, 5000, 1500, 500, 300, 100, 50, 25, 10, 5, 1];
const LIMITS = [0, 1, 10, 20, 30, 40, 50, 60, 70, 80, 100];
const GUARANTEES = [0, 1, 5, 20, 30, 50, 100, 300, 500, 1000, 3000];

/** HeroFunc::loadKingTactic and GoodsFunc::addUserLevelTimes/addUserLevel. */
@Injectable()
export class KingCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly goods: GoodsRules,
    private readonly random: RandomService,
  ) {}

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async cell(query: RawBuilder<unknown>): Promise<unknown> {
    const row = (await this.rows(query))[0];
    return row ? Object.values(row)[0] : false;
  }

  private async book(uid: number): Promise<Row | undefined> {
    return (
      await this.rows(sql`select c.*, s.count from cfg_goods c
      left join sys_goods s on c.gid = s.gid and s.uid = ${uid} where c.gid = 10961`)
    )[0];
  }

  @GlobalCommand()
  async loadKingTactic(ctx: CommandContext): Promise<unknown[]> {
    const book = (await this.book(ctx.uid)) ?? {};
    if (phpEmpty(book.count)) book.count = 0;
    const level = await this.cell(sql`select level from sys_user_level where uid = ${ctx.uid}`);
    return [book, phpEmpty(level) ? 0 : level];
  }

  @GlobalCommand()
  async addUserLevelTimes(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    // PHP does not intval the requested count: fractional positive counts round up in the loop.
    const times = phpNum(param[0]);
    return this.scope.transaction(async () => {
      if (!(await this.goods.checkGoodsCount(uid, 10961, times)) || phpEmpty(param[0])) {
        throw GameError.lang('good.not_enough_goods83');
      }
      const current = await this.cell(sql`select level from sys_user_level where uid = ${uid}`);
      if (phpNum(current) >= 10) throw GameError.lang('user_hero.user_level');
      let error: string | undefined;
      for (let i = 0; i < times; i++) {
        error = await this.addUserLevel(uid);
        if (error) break;
      }
      const target = await this.cell(sql`select level from sys_user_level where uid = ${uid}`);
      const book = await this.book(uid);
      const improved = phpNum(target) > phpNum(current);
      const message = error
        ? (improved ? this.lang.t('user_hero.upgrade_success') : '') + error
        : this.lang.t(improved ? 'user_hero.upgrade_success' : 'user_hero.upgrade_fail');
      return [book ?? false, target, message];
    });
  }

  private async addUserLevel(uid: number): Promise<string | undefined> {
    const user = (
      await this.rows(sql`select level, count from sys_user_level where uid = ${uid}`)
    )[0];
    const current = phpIntval(user?.level);
    const used = phpIntval(user?.count);
    if (current >= 10) return this.lang.t('user_hero.user_level');
    const target = current + 1;
    const king = await this.cell(
      sql`select level from sys_city_hero where uid = ${uid} and herotype = 1000`,
    );
    if (phpNum(king) < LIMITS[target]!) return this.lang.t('user_hero.limit_level');
    // rand() is evaluated even when the guarantee is met.
    const success =
      this.random.randRange(1, 10000) <= RATES[target]! || used >= GUARANTEES[target]! - 1;
    if (success) {
      await sql`insert into sys_user_level (uid, level, time, count)
        values (${uid}, ${target}, unix_timestamp(), 0)
        on duplicate key update level = ${target}, time = unix_timestamp(), count = 0`.execute(
        this.scope.db,
      );
      await sql`insert into log_user_level_add values (${uid}, ${current}, ${target}, unix_timestamp())`.execute(
        this.scope.db,
      );
      const command = [1, 3, 5, 7].includes(target) ? 10 : 0;
      const bravery = [3, 5, 7].includes(target) ? 10 : 0;
      const wisdom = [5, 7].includes(target) ? 10 : 0;
      const affairs = target === 7 ? 10 : 0;
      if (target === 9)
        await sql`update sys_city_hero set speed_add_on = speed_add_on + 10 where uid = ${uid} and herotype = 1000 limit 1`.execute(
          this.scope.db,
        );
      await sql`update sys_city_hero set command_base = command_base + ${command}, bravery_base = bravery_base + ${bravery}, affairs_base = affairs_base + ${affairs}, wisdom_base = wisdom_base + ${wisdom} where uid = ${uid} and herotype = 1000 limit 1`.execute(
        this.scope.db,
      );
    } else {
      await sql`insert into sys_user_level (uid, level, time, count)
        values (${uid}, ${current}, unix_timestamp(), 1)
        on duplicate key update time = unix_timestamp(), count = count + 1`.execute(this.scope.db);
    }
    await this.goods.reduceGoods(uid, 10961, 1);
    if (success) {
      const did = ({ 6: 20, 8: 21, 9: 22, 10: 23 } as Record<number, number>)[target];
      if (
        did &&
        phpEmpty(
          await this.cell(
            sql`select 1 from sys_user_designation where uid = ${uid} and did = ${did}`,
          ),
        )
      ) {
        await sql`insert into sys_user_designation (did, uid, ison, state) values (${did}, ${uid}, 0, 1)`.execute(
          this.scope.db,
        );
      }
    }
    return undefined;
  }
}
