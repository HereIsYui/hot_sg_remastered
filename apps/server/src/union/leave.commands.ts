import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules, cid2wid, wid2cid } from '../core/city-rules.service';
import { phpIntval, phpNum, phpString } from '../core/php';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';
import { UnionRules } from './union-rules.service';

type Row = Record<string, unknown>;

/** UnionFunc.php::leaveUnion: membership exit and the final-member dissolution. */
@Injectable()
export class LeaveCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly rules: UnionRules,
    private readonly users: UserRules,
    private readonly cities: CityRules,
    private readonly lang: LangService,
  ) {}

  @GlobalCommand()
  async leaveUnion(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const user = await this.row(
      sql<Row>`select name, union_id, union_pos from sys_user where uid = ${uid}`,
    );
    const unionid = phpIntval(user?.union_id);
    const unionpos = phpIntval(user?.union_pos);
    if (unionid === 0) throw GameError.lang('leaveUnion.you_belongTo_none_union');
    const union = await this.row(sql<Row>`select * from sys_union where id = ${unionid}`);
    if (!union) throw GameError.lang('leaveUnion.your_union_is_out');
    const luoyangUid = phpIntval(
      await this.cell(sql<Row>`select uid as v from sys_luoyang_info limit 1`),
    );
    if (luoyangUid === uid) throw GameError.lang('luoyang.cannot_leave_union');
    const trades = await this.rows(sql<Row>`select distinct cid from sys_city_trade
      where unionid = ${unionid} and cid in (select cid from sys_city where uid = ${uid})`);
    if (trades.length > 0) {
      const places = trades.map((row) => {
        const cid = phpIntval(row.cid);
        return `[${cid % 1000},${Math.floor(cid / 1000)}]`;
      });
      throw GameError.lang('union.market_has_resource', places.join('  '));
    }

    if (phpIntval(union.leader) === uid) {
      const count = phpNum(
        await this.cell(sql<Row>`select member as v from sys_union where id = ${unionid}`),
      );
      if (count > 1) throw GameError.lang('leaveUnion.chief_cant_leave');
      await this.rules.canUserLeaveUnion(uid);
      await this.scope.transaction(async () => {
        await sql`update sys_user set union_id = 0, union_pos = 0 where uid = ${uid}`.execute(
          this.scope.db,
        );
        await sql`delete from sys_union where id = ${unionid}`.execute(this.scope.db);
        await sql`delete from sys_union_relation where unionid = ${unionid} or target = ${unionid}`.execute(
          this.scope.db,
        );
        await sql`delete from sys_union_event where unionid = ${unionid}`.execute(this.scope.db);
        await sql`delete from sys_union_invite where unionid = ${unionid}`.execute(this.scope.db);
        await sql`delete from sys_union_apply where unionid = ${unionid}`.execute(this.scope.db);
        await sql`delete from huangjin_task_log_union where unionid = ${unionid}`.execute(
          this.scope.db,
        );
        await sql`delete from sys_union_city where unionid = ${unionid}`.execute(this.scope.db);
        await this.rules.notifyUnionChange(uid, unionid, 0);
      });
    } else {
      if (unionpos === 5) throw GameError.lang('leaveUnion.official_cant_leave');
      await this.scope.transaction(async () => {
        await this.rules.notifyUnionChange(uid, unionid, 0);
        await sql`update sys_user set union_id = 0, union_pos = 0 where uid = ${uid}`.execute(
          this.scope.db,
        );
        await sql`update sys_union set member = member - 1 where id = ${unionid}`.execute(
          this.scope.db,
        );
        const famouscity = phpNum(
          await this.cell(
            sql<Row>`select count(*) as v from sys_city where uid = ${uid} and type > 0 and type < 5`,
          ),
        );
        if (famouscity > 0) {
          await sql`update sys_union_city set count = greatest(0, count - ${famouscity}) where unionid = ${unionid}`.execute(
            this.scope.db,
          );
        }
        const cities = await this.rows(sql<Row>`select cid from sys_city where uid = ${uid}`);
        const fieldcids: number[] = [];
        for (const city of cities) {
          const fields = await this.rows(
            sql<Row>`select wid from mem_world where ownercid = ${phpIntval(city.cid)}`,
          );
          fieldcids.push(...fields.map((field) => wid2cid(field.wid)));
        }
        if (fieldcids.length > 0) {
          await sql`update sys_troops set state = 1, endtime = pathtime + unix_timestamp(),
            starttime = unix_timestamp() where targetcid in (${sql.join(fieldcids)})
            and state = 4 and task < 6 and uid <> ${uid} and uid > 0`.execute(this.scope.db);
        }
        for (const city of cities) await this.cities.updateCityResourceAdd(phpIntval(city.cid));
        const troops = await this.rows(sql<Row>`select id, cid, targetcid from sys_troops
          where uid = ${uid} and state = 4 and task <= 6`);
        for (const troop of troops) {
          const wid = cid2wid(phpIntval(troop.targetcid));
          const owneruid = phpIntval(
            await this.cell(sql<Row>`select c.uid as v from sys_city c, mem_world m
              where m.wid = ${wid} and m.ownercid = c.cid`),
          );
          if (owneruid !== uid) {
            await sql`update sys_troops set state = 1, endtime = pathtime + unix_timestamp(),
              starttime = unix_timestamp() where id = ${phpIntval(troop.id)}`.execute(
              this.scope.db,
            );
            await this.cities.updateCityResourceAdd(phpIntval(troop.cid));
          }
        }
        await this.users.updateUnionRank(unionid);
      });
    }
    await this.rules.addUnionEvent(
      unionid,
      1,
      this.lang.t('leaveUnion.addUnionEvent', phpString(user?.name)),
    );
    if (
      await this.check(
        sql<Row>`select 1 as v from mem_union_remove where uid = ${uid} and unionid = ${unionid}`,
      )
    ) {
      await sql`delete from mem_union_remove where uid = ${uid} and unionid = ${unionid}`.execute(
        this.scope.db,
      );
    }
    return [];
  }

  private async rows(query: RawBuilder<Row>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows;
  }

  private async row(query: RawBuilder<Row>): Promise<Row | undefined> {
    return (await this.rows(query))[0];
  }

  private async cell(query: RawBuilder<Row>): Promise<unknown> {
    const row = await this.row(query);
    return row ? Object.values(row)[0] : undefined;
  }

  private async check(query: RawBuilder<Row>): Promise<boolean> {
    return (await this.rows(query)).length > 0;
  }
}
