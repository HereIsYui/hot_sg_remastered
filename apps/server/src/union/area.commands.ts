import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { cid2wid } from '../core/city-rules.service';
import { phpEmpty, phpIntval, phpString } from '../core/php';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** UnionFunc.php: union influence views and the self-union map data. */
@Injectable()
export class AreaCommands {
  constructor(private readonly scope: DbScope) {}

  /** `[]`: this union's yellow areas. */
  @GlobalCommand()
  async getSelfUnionArea(ctx: CommandContext): Promise<unknown[]> {
    const unionid = await this.unionid(ctx.uid);
    await this.requireUnion(unionid);
    return [await this.provinceCityOwner(), await this.unionArea(unionid)];
  }

  /** `[]`: mutually friendly unions' green areas. */
  @GlobalCommand()
  async getFriendlyUnionArea(ctx: CommandContext): Promise<unknown[]> {
    const unionid = await this.unionid(ctx.uid);
    await this.requireUnion(unionid);
    const targets = await this.rows(
      sql<Row>`select target from sys_union_relation where unionid = ${unionid} and type = 0`,
    );
    const areas: unknown[] = [];
    for (const target of targets) {
      const id = phpIntval(target.target);
      const mutual = await this.check(
        sql<Row>`select 1 as v from sys_union_relation where unionid = ${id} and target = ${unionid} and type = 0`,
      );
      if (mutual) areas.push(...(await this.unionArea(id)));
    }
    return targets.length === 0 ? [] : [await this.provinceCityOwner(), areas];
  }

  /** `[]`: hostile unions' red areas. */
  @GlobalCommand()
  async getHostileUnionArea(ctx: CommandContext): Promise<unknown[]> {
    const unionid = await this.unionid(ctx.uid);
    await this.requireUnion(unionid);
    const targets = await this.rows(
      sql<Row>`select target from sys_union_relation where unionid = ${unionid} and type = 2`,
    );
    const areas: unknown[] = [];
    for (const target of targets) areas.push(...(await this.unionArea(phpIntval(target.target))));
    return targets.length === 0 ? [] : [await this.provinceCityOwner(), areas];
  }

  /** `[unionid]`: another union's blue area and marks. */
  @GlobalCommand()
  async getOtherUnionArea(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const unionid = phpIntval(param[0]);
    const union = await this.requireUnion(unionid);
    return [
      union.name,
      await this.provinceCityOwner(),
      await this.unionMarkCity(ctx.uid),
      'blue',
      unionid,
      await this.unionArea(unionid),
    ];
  }

  /** `[]`: the caller's current-union city marks after expiry pruning. */
  @GlobalCommand()
  async getUnionMarkCity(ctx: CommandContext): Promise<unknown[]> {
    return this.unionMarkCity(ctx.uid);
  }

  /** `[]`: full self-union map data. */
  @GlobalCommand()
  async getSelfUnionInfo(ctx: CommandContext): Promise<unknown[]> {
    const unionid = await this.unionid(ctx.uid);
    const friendly = await this.rows(
      sql<Row>`select target from sys_union_relation where unionid = ${unionid} and type = 0`,
    );
    const friends: Row[] = [];
    for (const target of friendly) {
      const id = phpIntval(target.target);
      if (
        !(await this.check(
          sql<Row>`select 1 as v from sys_union_relation where unionid = ${id} and target = ${unionid} and type = 0`,
        ))
      )
        continue;
      const union = await this.requireUnion(id);
      friends.push({ ...union, areas: await this.areaString(id, [2]) });
    }
    const hostile = await this.rows(
      sql<Row>`select target from sys_union_relation where unionid = ${unionid} and type = 2`,
    );
    const enemies: Row[] = [];
    for (const target of hostile) {
      const id = phpIntval(target.target);
      const union = await this.requireUnion(id);
      const areas = await this.areaString(id, [2]);
      // The original's `$hostieU` typo leaves `areas` absent for hostile unions with no cities.
      enemies.push(areas === '' ? union : { ...union, areas });
    }
    const union = await this.row(sql<Row>`select * from sys_union where id = ${unionid} limit 1`);
    if (union) union.areas = await this.areaString(unionid, [2, 3]);
    const cities = await this.rows(
      sql<Row>`select * from sys_city where uid = ${ctx.uid} order by type desc`,
    );
    return [
      await this.provinceCityOwner(),
      await this.unionMarkCity(ctx.uid),
      friends,
      enemies,
      union ?? {},
      cities,
    ];
  }

  /** `[]`: the client's alternate entry for getSelfUnionInfo. */
  @GlobalCommand()
  async getSelfUnionInfo2(ctx: CommandContext): Promise<unknown[]> {
    return this.getSelfUnionInfo(ctx);
  }

  private async unionid(uid: number): Promise<number> {
    return phpIntval(
      await this.cell(sql<Row>`select union_id as v from sys_user where uid = ${uid}`),
    );
  }

  private async requireUnion(unionid: number): Promise<Row> {
    const union = await this.row(sql<Row>`select * from sys_union where id = ${unionid}`);
    if (!union) throw GameError.lang('getUnionArea.no_this_union');
    return union;
  }

  private async unionArea(unionid: number): Promise<unknown[]> {
    const areas = await this
      .rows(sql<Row>`select c.cid from sys_city c join sys_user u on c.uid = u.uid
      where c.type = 2 and u.union_id = ${unionid}`);
    const ret: unknown[] = [];
    for (const area of areas) {
      const wid = cid2wid(phpIntval(area.cid));
      const row = await this.row(
        sql<Row>`select concat(province, '_', jun) as provincejun from mem_world where wid = ${wid} limit 1`,
      );
      ret.push(row ?? false);
    }
    return ret;
  }

  private async areaString(unionid: number, types: number[]): Promise<string> {
    const cities = await this
      .rows(sql<Row>`select c.cid from sys_city c join sys_user u on u.uid = c.uid
      join sys_union un on u.union_id = un.id where c.type in (${sql.join(types)}) and un.id = ${unionid}`);
    const areas: string[] = [];
    for (const city of cities) {
      const wid = cid2wid(phpIntval(city.cid));
      areas.push(
        phpString(
          await this.cell(
            sql<Row>`select concat(province, '_', jun) as v from mem_world where wid = ${wid}`,
          ),
        ),
      );
    }
    return areas.join(',');
  }

  private async provinceCityOwner(): Promise<Row[]> {
    const cities = await this.rows(sql<Row>`select c.province, c.type, c.cid, c.name as cityname,
      u.uid, u.union_id, u.name as username from sys_city c left join sys_user u on c.uid = u.uid
      where type >= 3 and type < 5 order by c.province`);
    for (const city of cities) {
      const unionid = phpIntval(city.union_id);
      const unionname = await this.cell(
        sql<Row>`select name as v from sys_union where id = ${unionid}`,
      );
      city.unionname = '';
      if (phpEmpty(unionname) || unionname === '') {
        if (unionid === 0 && phpIntval(city.uid) <= 1000) city.unionname = city.username;
      } else {
        city.unionname = unionname;
      }
    }
    return cities;
  }

  private async unionMarkCity(uid: number): Promise<Row[]> {
    const unionid = await this.unionid(uid);
    const marks = await this.rows(
      sql<Row>`select * from sys_union_mark where unionid = ${unionid}`,
    );
    for (const mark of marks) {
      const owneruid = phpIntval(
        await this.cell(sql<Row>`select uid as v from sys_city where cid = ${phpIntval(mark.cid)}`),
      );
      if (owneruid > 1000) {
        const targetunionid = phpIntval(
          await this.cell(sql<Row>`select union_id as v from sys_user where uid = ${owneruid}`),
        );
        if (
          !(await this.check(
            sql<Row>`select 1 as v from sys_union_relation where unionid = ${unionid} and target = ${targetunionid} and type = 2`,
          ))
        ) {
          await sql`update sys_union_mark set endtime = 0 where id = ${phpIntval(mark.id)}`.execute(
            this.scope.db,
          );
        }
      }
    }
    await sql`delete from sys_union_mark where endtime < unix_timestamp()`.execute(this.scope.db);
    return this.rows(sql<Row>`select * from sys_union_mark where unionid = ${unionid}`);
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
