import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { DbScope } from '../db/database.module';
import { cid2wid, wid2cid } from './city-rules.service';
import { HeroRules, type ThrownHero } from './hero-rules.service';
import { phpIntval, phpNum } from './php';
import { UserRules } from './user-rules.service';

/** utils.php::doChangeCityPosition; unlike battle relocation, preserves the city's queues/resources. */
@Injectable()
export class CityRelocation {
  constructor(
    private readonly scope: DbScope,
    private readonly heroes: HeroRules,
    private readonly users: UserRules,
    private readonly lang: LangService,
  ) {}

  async move(uid: number, cid: number, targetcid: number): Promise<void> {
    const cell = async (q: RawBuilder<unknown>) =>
      Object.values((await q.execute(this.scope.db)).rows[0] ?? {})[0] ?? false;
    const check = async (q: RawBuilder<unknown>) =>
      (await q.execute(this.scope.db)).rows.length > 0;
    for (const q of [
      sql`select uid from sys_troops where uid=${uid} and cid=${cid}`,
      sql`select uid from sys_troops where uid=${uid} and startcid=${cid}`,
      sql`select uid from sys_luoyang_troops where uid=${uid} and startcid=${cid}`,
    ]) {
      if (await check(q)) throw GameError.lang('changeCityPosition.has_army_outside');
    }
    const fields = (
      await sql<{ wid: unknown }>`select wid from mem_world where ownercid=${cid}`.execute(
        this.scope.db,
      )
    ).rows;
    if (fields.length) {
      const cids = fields.map((f) => wid2cid(f.wid));
      if (
        await check(
          sql`select uid from sys_troops where targetcid in (${sql.join(cids)}) and state=4 and uid<>${uid} and uid>0`,
        )
      )
        throw GameError.lang('changeCityPosition.has_ally_force');
      if (
        await check(
          sql`select uid from sys_troops where targetcid in (${sql.join(cids)}) and state=4 and uid=${uid} and cid<>${cid}`,
        )
      )
        throw GameError.lang('changeCityPosition.has_other_city_force');
    }
    const wid = cid2wid(cid),
      targetwid = cid2wid(targetcid);
    if (phpNum(await cell(sql`select state from mem_world where wid=${wid}`)) === 1)
      throw GameError.lang('changeCityPosition.city_in_battle');
    const type = phpNum(await cell(sql`select type from sys_city where cid=${cid}`));
    if (type > 0 && type !== 5) throw GameError.lang('changeCityPosition.cant_move_great_city');
    if (await check(sql`select cid from sys_city where cid=${targetcid}`))
      throw GameError.lang('changeCityPosition.invalid_target_city');
    const province = await cell(sql`select province from mem_world where wid=${targetwid}`);
    if (
      !(await check(
        sql`select type from mem_world where wid=${targetwid} and type=1 and state=0 and ownercid=0`,
      ))
    )
      throw GameError.lang('changeCityPosition.invalid_target_city');
    const run = async (q: RawBuilder<unknown>) => {
      await q.execute(this.scope.db);
    };
    await run(
      sql`insert into log_move_city(time,uid,fromcid,tocid) values(unix_timestamp(),${uid},${cid},${targetcid})`,
    );
    const heroes = (
      await sql<
        Record<string, unknown>
      >`select * from sys_city_hero where cid=${targetcid}`.execute(this.scope.db)
    ).rows;
    for (const hero of heroes) await this.heroes.throwHeroToField(hero as unknown as ThrownHero);
    if (await check(sql`select * from cfg_soldier_special_city where cid=${cid} and type=4`))
      await run(
        sql`update cfg_soldier_special_city set cid=${targetcid} where cid=${cid} and type=4`,
      );
    await run(sql`update sys_city_trade set cid=${targetcid} where cid=${cid} and state=0`);
    await run(sql`update sys_city set cid=${targetcid} where cid=${cid}`);
    await run(sql`update sys_city set province=${province} where cid=${targetcid}`);
    await run(sql`update mem_world set ownercid=0 where ownercid=${cid} and type>0`);
    await run(sql`update mem_world set type=1,ownercid=0 where wid=${wid}`);
    await run(sql`update mem_world set type=0,ownercid=${targetcid} where wid=${targetwid}`);
    await run(sql`update sys_user set lastcid=${targetcid} where uid=${uid}`);
    const transfer = async (table: string) => {
      await run(sql`delete from ${sql.table(table)} where cid=${targetcid}`);
      await run(sql`update ${sql.table(table)} set cid=${targetcid} where cid=${cid}`);
    };
    for (const table of [
      'sys_building',
      'mem_building_destroying',
      'mem_building_upgrading',
      'mem_technic_upgrading',
      'sys_city_technic',
    ])
      await transfer(table);
    await run(sql`update sys_technic set cid=${targetcid} where cid=${cid}`);
    for (const table of [
      'mem_city_buffer',
      'sys_city_soldier',
      'sys_city_draftqueue',
      'mem_city_draft',
      'mem_city_wounded',
      'mem_city_captive',
      'mem_city_lamster',
    ])
      await transfer(table);
    await run(sql`update sys_city_trade set cid=${targetcid} where cid=${cid}`);
    await run(sql`update sys_city_trade set buycid=${targetcid} where buycid=${cid}`);
    for (const table of ['sys_city_defence', 'sys_city_reinforcequeue', 'mem_city_reinforce'])
      await transfer(table);
    await run(sql`update sys_city_hero set cid=${targetcid} where cid=${cid} and uid=${uid}`);
    await transfer('sys_city_tactics');
    await run(sql`update sys_troops set task=1,state=1 where cid=${targetcid}`);
    await run(sql`update sys_troops set cid=${targetcid} where cid=${cid}`);
    await run(sql`update sys_luoyang_troops set startcid=${targetcid} where startcid=${cid}`);
    await run(sql`delete from sys_city_res_add where cid=${targetcid}`);
    await run(
      sql`update sys_city_res_add set cid=${targetcid},resource_changing=1,field_food_add=0,field_wood_add=0,field_rock_add=0,field_iron_add=0 where cid=${cid}`,
    );
    for (const table of ['mem_city_resource', 'mem_city_schedule']) await transfer(table);
    await run(sql`update sys_battle set cid=${targetcid} where cid=${cid}`);
    for (const table of ['sys_city_rumor', 'sys_recruit_hero']) await transfer(table);
    await run(sql`update sys_hero_expr set cid=${targetcid} where cid=${cid}`);
    await run(sql`update mem_city_autotrans set tocid=${targetcid} where tocid=${cid}`);
    await run(sql`update mem_city_autotrans set fromcid=${targetcid} where fromcid=${cid}`);
    if (phpIntval(await cell(sql`select value from mem_state where state=197`)) === 60) {
      const from = phpNum(await cell(sql`select province from mem_world where wid=${wid}`));
      const to = phpNum(await cell(sql`select province from mem_world where wid=${targetwid}`));
      if ((from === 1) !== (to === 1)) {
        const name = await cell(sql`select name from sys_user where uid=${uid}`);
        // Original looks up the old cid after moving when leaving 司隶.
        const city = await cell(
          sql`select name from sys_city where cid=${from === 1 ? cid : targetcid}`,
        );
        const args: unknown[] = [name, city, cid % 1000, Math.floor(cid / 1000)];
        if (from === 1) args.push(await cell(sql`select name from cfg_province where id=${to}`));
        args.push(targetcid % 1000, Math.floor(targetcid / 1000));
        await this.users.sendSysInform({
          type: 0,
          inuse: 1,
          starttime: 0,
          endtime: 300,
          interval: 1800,
          scrollcount: 1,
          color: 49151,
          msg: this.lang.t(`changeCityPosition.${from === 1 ? 'out' : 'in'}_sili`, ...args),
        });
      }
    }
  }
}
