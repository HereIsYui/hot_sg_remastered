import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { CityRules, wid2cid } from '../core/city-rules.service';
import { OwnershipService } from '../core/ownership.service';
import { phpIntval, phpLooseEquals } from '../core/php';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** common.php WT_*: the wild terrains above 平地 and what a level of each adds to production. */
const FIELD_BONUS: Record<
  number,
  { column: 'food' | 'wood' | 'rock' | 'iron'; base: number; per: number }
> = {
  2: { column: 'rock', base: 3, per: 2 },
  3: { column: 'wood', base: 3, per: 2 },
  4: { column: 'food', base: 2, per: 1 },
  5: { column: 'iron', base: 3, per: 2 },
  6: { column: 'food', base: 5, per: 3 },
  7: { column: 'food', base: 3, per: 2 },
};

/** sys_troops.state */
const TroopState = { Going: 0, Back: 1, Waiting: 2, Battle: 3, Stationed: 4 } as const;

/** The 官府's 附属野地 commands of CityFunc.php and TroopFunc.php::callBackTroop. */
@Injectable()
export class FieldCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly ownership: OwnershipService,
    private readonly cityRules: CityRules,
  ) {}

  /** `[cid]`: the city's fields with the troop gathering on each. */
  @GlobalCommand()
  async getCityField(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const cid = phpIntval(param[0]);
    await this.ownership.checkCityOwner(cid, ctx.uid);
    return this.cityField(cid);
  }

  /** `[wid]` → `[stationed troops, gathering or false]`. */
  @GlobalCommand()
  async getFieldDetail(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    return this.fieldDetail(phpIntval(param[0]));
  }

  /** `[cid, wid]`: gives up a field no troop is heading to, fighting on or holding. */
  @GlobalCommand()
  async discardField(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const cid = phpIntval(param[0]);
    const wid = phpIntval(param[1]);
    await this.ownership.checkCityOwner(cid, ctx.uid);
    return this.scope.transaction(async () => {
      const owner = await this.cell(sql`select ownercid from mem_world where wid = ${wid}`);
      if (!phpLooseEquals(owner ?? null, cid)) {
        throw GameError.lang('gatherFieldResult.not_your_field');
      }
      if (
        await this.check(sql`select id from sys_troops where targetcid = ${wid2cid(wid)}
          and state in (2, 3, 4) and uid > 0`)
      ) {
        throw GameError.lang('gatherFieldResult.cant_dismiss_with_army');
      }
      const db = this.scope.db;
      await sql`update mem_world set ownercid = 0 where wid = ${wid}`.execute(db);
      await sql`delete from sys_gather where wid = ${wid}`.execute(db);
      await this.updateFieldResourceAdd(cid);
      return this.cityField(cid);
    });
  }

  /**
   * `[troopid, wid]`: sends the player's troop home. The original answered with the detail of
   * the field numbered like the troop; the field asked about is returned instead.
   */
  @GlobalCommand()
  async callBackFieldTroop(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    await this.scope.transaction(() => this.callBackTroop(ctx.uid, phpIntval(param[0])));
    return this.fieldDetail(phpIntval(param[1]));
  }

  /**
   * `[cid, troopid, wid]`: sends another player's troop off the field. The original let anyone
   * name any field; the field has to belong to the player's city `cid`.
   */
  @GlobalCommand()
  async kickBackFieldTroop(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const cid = phpIntval(param[0]);
    const troopid = phpIntval(param[1]);
    const wid = phpIntval(param[2]);
    await this.ownership.checkCityOwner(cid, ctx.uid);
    const targetcid = wid2cid(wid);
    await this.scope.transaction(async () => {
      const owner = await this.cell(sql`select ownercid from mem_world where wid = ${wid}`);
      if (
        !phpLooseEquals(owner ?? null, cid) ||
        !(await this.check(sql`select 1 from sys_troops where id = ${troopid} and task = 1
          and targetcid = ${targetcid} and state = 4`))
      ) {
        throw GameError.lang('kickBackFieldTroop.army_not_exist');
      }
      await sql`update sys_troops set state = 1, endtime = pathtime + unix_timestamp(),
          starttime = unix_timestamp() where id = ${troopid}`.execute(this.scope.db);
      await this.cityRules.updateCityResourceAdd(cid);
    });
    return this.fieldDetail(wid);
  }

  /** TroopFunc.php::callBackTroop: turns a troop around; gathering troops stay. */
  private async callBackTroop(uid: number, troopid: number): Promise<void> {
    const db = this.scope.db;
    if (await this.check(sql`select 1 from sys_gather where troopid = ${troopid}`)) {
      throw GameError.lang('callBackTroop.gather');
    }
    const troop = await this.row(
      sql`select * from sys_troops where id = ${troopid} and uid = ${uid}`,
    );
    if (!troop) throw GameError.lang('callBackTroop.invalid_army');
    const state = phpIntval(troop.state);
    if (state === TroopState.Going && phpIntval(troop.noback) > 0) {
      throw GameError.lang('callBackTroop.on_back');
    }
    if (state === TroopState.Going) {
      await sql`update sys_troops set state = 1,
          endtime = unix_timestamp() - starttime + unix_timestamp(), starttime = unix_timestamp()
        where id = ${troopid}`.execute(db);
    } else if (state === TroopState.Stationed || state === TroopState.Waiting) {
      await sql`update sys_troops set state = 1, endtime = pathtime + unix_timestamp(),
          starttime = unix_timestamp() where id = ${troopid}`.execute(db);
      await this.cityRules.updateCityResourceAdd(phpIntval(troop.cid));
      await this.cityRules.updateCityResourceAdd(phpIntval(troop.targetcid));
      const hid = phpIntval(troop.hid);
      if (hid > 0) await sql`update sys_city_hero set state = 2 where hid = ${hid}`.execute(db);
    } else if (state === TroopState.Battle) {
      throw GameError.lang('callBackTroop.army_in_battle');
    } else if (state === TroopState.Back) {
      throw GameError.lang('callBackTroop.army_on_way_back');
    }
  }

  private async cityField(cid: number): Promise<unknown[]> {
    return this.rows(sql`select m.*, g.troopid from mem_world m
      left join sys_gather g on g.wid = m.wid where m.ownercid = ${cid} and m.type > 0`);
  }

  private async fieldDetail(wid: number): Promise<unknown[]> {
    const troops = await this.rows(sql`select t.*, u.name as username, h.name as heroname
      from sys_user u, sys_troops t left join sys_city_hero h on h.hid = t.hid
      where t.uid = u.uid and t.targetcid = ${wid2cid(wid)} and t.state = 4 and t.uid > 0`);
    const gather = await this.row(sql`select * from sys_gather where wid = ${wid}`);
    return [troops, gather ?? false];
  }

  /** CityFunc.php::updateFieldResourceAdd: the production bonus of the city's fields. */
  private async updateFieldResourceAdd(cid: number): Promise<void> {
    const add = { food: 0, wood: 0, rock: 0, iron: 0 };
    const fields = await this.rows(
      sql`select type, level from mem_world where type > 1 and ownercid = ${cid}`,
    );
    for (const field of fields) {
      const level = phpIntval(field.level);
      const bonus = FIELD_BONUS[phpIntval(field.type)];
      if (level > 0 && bonus) add[bonus.column] += bonus.base + bonus.per * level;
    }
    await sql`update sys_city_res_add set field_food_add = ${add.food},
        field_wood_add = ${add.wood}, field_rock_add = ${add.rock}, field_iron_add = ${add.iron}
      where cid = ${cid}`.execute(this.scope.db);
    await this.cityRules.updateCityResourceAdd(cid);
  }

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  private async row(query: RawBuilder<unknown>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  private async cell(query: RawBuilder<unknown>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : undefined;
  }

  private async check(query: RawBuilder<unknown>): Promise<boolean> {
    return (await this.rows(query)).length > 0;
  }
}
