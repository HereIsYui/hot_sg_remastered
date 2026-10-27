import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { phpIntval, phpNum } from '../core/php';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** UnionFunc.php: union-city, donation and position initialization. */
@Injectable()
export class CityCommands {
  constructor(private readonly scope: DbScope) {}

  /** `[]`: the member and their union buildings. */
  @GlobalCommand()
  async loadUnionChiefCityInfo(ctx: CommandContext): Promise<unknown[]> {
    const user = await this.row(
      sql<Row>`select union_id, union_pos from sys_user where uid = ${ctx.uid}`,
    );
    const buildings = await this
      .rows(sql<Row>`select * from cfg_union_building_upgrade a, sys_union_building b
      where a.bid = b.bid and a.level = b.level and b.unionid = ${phpIntval(user?.union_id)}
      order by a.open desc`);
    return [user ?? {}, buildings];
  }

  /** `[]`: the donation panel, resetting yesterday's counters and creating its row. */
  @GlobalCommand()
  async donateGoodsInitData(ctx: CommandContext): Promise<unknown[]> {
    const uid = ctx.uid;
    const user = await this.row(
      sql<Row>`select union_id, union_pos from sys_user where uid = ${uid}`,
    );
    const unionid = phpIntval(user?.union_id);
    const day = phpNum(await this.cell(sql<Row>`select unix_timestamp(substr(now(), 1, 10)) as v`));
    if (
      await this.check(
        sql<Row>`select 1 as v from sys_user_donate where uid = ${uid} and unionid = ${unionid} and time < ${day}`,
      )
    ) {
      await sql`update sys_user_donate set duihuan = 0, curnum = 0 where uid = ${uid} and unionid = ${unionid}`.execute(
        this.scope.db,
      );
    }
    const heroLevel = phpNum(
      await this.cell(
        sql<Row>`select level as v from sys_city_hero where uid = ${uid} and herotype = 1000`,
      ),
    );
    const buildingLevel = phpNum(
      await this.cell(
        sql<Row>`select level as v from sys_union_building where unionid = ${unionid} and bid = 1`,
      ),
    );
    const maxNum = Math.trunc(heroLevel / 5) * 3 + Math.trunc(buildingLevel / 5);
    const goodsNum = phpNum(
      await this.cell(
        sql<Row>`select count as v from sys_goods where gid = 19210 and uid = ${uid}`,
      ),
    );
    let info = await this.row(
      sql<Row>`select * from sys_user_donate where uid = ${uid} and unionid = ${unionid}`,
    );
    if (!info) {
      await sql`insert into sys_user_donate (uid, unionid) values (${uid}, ${unionid})`.execute(
        this.scope.db,
      );
      info = await this.row(
        sql<Row>`select * from sys_user_donate where uid = ${uid} and unionid = ${unionid}`,
      );
    }
    return [{ ...(info ?? {}), heroLevel, goodsNum: goodsNum <= 0 ? 0 : goodsNum, maxNum }];
  }

  /** `[]`: the position-upgrade panel and its next donation threshold. */
  @GlobalCommand()
  async updatePositionInitData(ctx: CommandContext): Promise<unknown[]> {
    const union = await this.row(
      sql<Row>`select union_id, union_pos from sys_user where uid = ${ctx.uid}`,
    );
    const unionid = phpIntval(union?.union_id);
    const donate = await this.row(
      sql<Row>`select * from sys_user_donate where uid = ${ctx.uid} and unionid = ${unionid}`,
    );
    const next = phpIntval(union?.union_pos) + 1;
    const minDonate = await this
      .cell(sql<Row>`select min(a.donate) as v from sys_user_donate a, sys_user b
      where a.uid = b.uid and a.unionid = b.union_id and b.union_id = ${unionid} and b.union_pos = ${next}`);
    const need = next === 1 ? 100 : next === 2 ? 500 : next === 3 ? 1000 : next === 4 ? 5000 : 0;
    return [
      {
        ...(donate ?? {}),
        ...(union ?? {}),
        nextLevel: phpNum(minDonate) >= need ? phpNum(minDonate) + 1 : need,
      },
    ];
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
