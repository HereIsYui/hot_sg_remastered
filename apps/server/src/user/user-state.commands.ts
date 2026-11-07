import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRelocation } from '../core/city-relocation.service';
import { cid2wid, wid2cid } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { phpEmpty, phpIntval, phpLooseEquals, phpNum } from '../core/php';
import { RandomService } from '../core/random.service';
import { UserProtection } from '../core/user-protection.service';
import { makeTimeLeft } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

@Injectable()
export class UserStateCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly goods: GoodsRules,
    private readonly random: RandomService,
    private readonly relocation: CityRelocation,
    private readonly protection: UserProtection,
    private readonly lang: LangService,
  ) {}
  private async rows(q: RawBuilder<unknown>): Promise<Record<string, unknown>[]> {
    return (await q.execute(this.scope.db)).rows as Record<string, unknown>[];
  }
  private async row(q: RawBuilder<unknown>) {
    return (await this.rows(q))[0];
  }
  private async cell(q: RawBuilder<unknown>): Promise<unknown> {
    const row = await this.row(q);
    return row ? Object.values(row)[0] : false;
  }
  private async run(q: RawBuilder<unknown>): Promise<void> {
    await q.execute(this.scope.db);
  }
  private async special(cid: number) {
    const type = await this.cell(sql`select is_special from sys_city where cid=${cid}`);
    if (
      (await this.row(sql`select cid from cfg_soldier_special_city where cid=${cid}`)) &&
      phpIntval(type) !== 2
    )
      throw GameError.lang('spacialcity.not_move_city');
  }
  @GlobalCommand()
  async changeCityPosition(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const original = phpIntval(param[0]),
      cid = phpIntval(param[1]),
      uid = ctx.uid;
    let province = original === 0 ? this.random.mtRand(1, 18) : original;
    await this.special(cid);
    const count = () =>
      this.cell(
        sql`select count(*) from mem_world where type=1 and ownercid=0 and province=${province}`,
      );
    let free = phpNum(await count());
    if (free === 0) {
      if (original === 0)
        for (let i = 0; i < 10 && free === 0; i++) {
          province = this.random.mtRand(1, 18);
          free = phpNum(await count());
        }
      if (free === 0) throw GameError.lang('changeCityPosition.province_is_full');
    }
    let wid: unknown = false;
    for (let i = 0; i < 10 && phpEmpty(wid); i++)
      wid = await this.cell(
        sql`select wid from mem_world where type=1 and province=${province} and ownercid=0 and state=0 order by rand() limit 1`,
      );
    if (phpEmpty(wid)) throw GameError.lang('changeCityPosition.invalid_target_city');
    if (!(await this.goods.checkGoodsCount(uid, 24, 1)))
      throw GameError.lang('changeCityPosition.no_QianChengLing');
    if (!(await this.row(sql`select uid from sys_city where uid=${uid} and cid=${cid}`)))
      throw GameError.lang('waigua.invalid');
    const target = wid2cid(wid);
    await this.relocation.move(uid, cid, target);
    await this.goods.reduceGoods(uid, 24, 1);
    return [target];
  }
  @GlobalCommand()
  async changeCityPositionPointing(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const x = phpIntval(param[0]),
      y = phpIntval(param[1]),
      cid = phpIntval(param[2]),
      uid = ctx.uid;
    if (x < 0 || y < 0 || x > 500 || y > 500)
      throw GameError.lang('changeCityPosition.invalid_target_city');
    const target = y * 1000 + x;
    if (!(await this.goods.checkGoodsCount(uid, 82, 1)))
      throw GameError.lang('changeCityPosition.no_adv_QianChengLing');
    if (!(await this.row(sql`select uid from sys_city where uid=${uid} and cid=${cid}`)))
      throw GameError.lang('waigua.invalid');
    await this.special(cid);
    await this.relocation.move(uid, cid, target);
    await this.run(
      sql`insert into mem_city_schedule(cid,last_adv_move) values(${target},unix_timestamp()) on duplicate key update last_adv_move=unix_timestamp()`,
    );
    await this.goods.reduceGoods(uid, 82, 1);
    return [target];
  }
  @GlobalCommand()
  async loadMianZhanEndTime(ctx: CommandContext): Promise<unknown[]> {
    const end = await this.cell(
      sql`select endtime from mem_user_buffer where uid=${ctx.uid} and buftype=7`,
    );
    await this.cell(sql`select value from mem_state where state=197`);
    const count = await this.cell(
      sql`select count from sys_user_action_log where action='usemianzhan' and uid=${ctx.uid} limit 1`,
    );
    return [end, phpNum(count) > 1 ? 1 : count];
  }
  @GlobalCommand()
  async useLiJianFu(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const x = phpIntval(param[0]),
      y = phpIntval(param[1]),
      gid = phpIntval(param[2]),
      uid = ctx.uid;
    if (x < 0 || y < 0 || x > 500 || y > 500)
      throw GameError.lang('changeCityPosition.invalid_target_city_for_nocity');
    const target = y * 1000 + x;
    if (!(await this.row(sql`select * from sys_city where cid=${target}`)))
      throw GameError.lang('changeCityPosition.invalid_target_city_for_lijian');
    if (!(await this.goods.checkGoodsCount(uid, gid, 1)))
      throw GameError.lang('changeCityPosition.no_adv_lijianfu');
    const union = await this.cell(sql`select union_id from sys_user where uid=${uid}`);
    const heroes = await this.rows(
      sql`select hid from sys_city_hero hero,sys_user user where hero.cid=${target} and user.union_id!=${union} and user.uid=hero.uid`,
    );
    if (!heroes.length) throw GameError.lang('changeCityPosition.invalid_target_city_for_lijian');
    this.random.randRange(0, heroes.length - 1); // Original draws a target but omits its WHERE clause.
    const reduce = ({ 160035: 1, 160036: 3, 160037: 5 } as Record<number, number>)[gid];
    await this.goods.reduceGoods(uid, gid, 1, 7);
    // Unknown gids generated invalid SQL in PHP; do not silently turn them into a valid zero reduction.
    await this.run(
      sql`update sys_city_hero set loyalty=loyalty-${reduce === undefined ? sql.raw('') : reduce}`,
    );
    return [this.lang.t('changeCityPosition.lijian_succ')];
  }
  @GlobalCommand()
  async allowPK(ctx: CommandContext): Promise<void> {
    await this.run(
      sql`insert into sys_allowpk(uid,allow) values(${ctx.uid},1) on duplicate key update allow=1`,
    );
  }
  @GlobalCommand()
  async changeUserState(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const idx = phpIntval(param[0]),
      day = phpIntval(param[1]),
      uid = ctx.uid;
    if (idx < 0 || idx > 3) throw GameError.lang('sendCommand.command_not_found');
    const target = idx === 1 || idx === 3 ? 2 : idx === 2 ? 6 : 0;
    if (target === 6) return this.vacation(uid, day);
    const state = await this.cell(sql`select state from sys_user where uid=${uid}`);
    const end = await this.cell(
      sql`select vacend from sys_user_state where uid=${uid} and vacend>unix_timestamp()`,
    );
    if (target === 0 && !phpEmpty(end)) {
      const delta = await this.cell(
        sql`select vacstart+86400*2-unix_timestamp() from sys_user_state where uid=${uid}`,
      );
      if (!phpEmpty(delta) && phpNum(delta) > 0)
        throw GameError.lang(
          'changeUserState.vacation_cant_dismiss',
          makeTimeLeft(this.lang, phpNum(delta)),
        );
      const duration = phpNum(
        await this.cell(
          sql`select unix_timestamp()-vacstart as durTime from sys_user_state where uid=${uid}`,
        ),
      );
      await this.run(
        sql`update mem_user_buffer set endtime=unix_timestamp()+${Math.floor((duration * 0.2) / 8)} where uid=${uid} and buftype=913`,
      );
      await this.run(sql`update sys_user_state set vacend=unix_timestamp() where uid=${uid}`);
      await this.run(
        sql`update mem_city_resource a,sys_city b set a.vacation=0,a.lastupdate=unix_timestamp() where a.cid=b.cid and b.uid=${uid}`,
      );
      return [];
    }
    if (phpLooseEquals(state, 0) && target === 0)
      throw GameError.lang('changeUserState.no_need_recovery');
    if (phpLooseEquals(state, 2) && target === 2) await this.protection.use(uid, idx);
    else if (phpLooseEquals(state, 0) && target === 2) {
      await this.checkWar(uid, 'mianzhan', true);
      await this.protection.use(uid, idx);
    } else if (phpLooseEquals(state, 2) && target === 0) {
      await this.run(sql`delete from mem_user_buffer where uid=${uid} and buftype=7`);
      await this.run(
        sql`insert into mem_user_buffer(uid,buftype,endtime) values(${uid},8,unix_timestamp()+10800) on duplicate key update endtime=unix_timestamp()+10800`,
      );
      await this.run(sql`update sys_user set state=0 where uid=${uid}`);
      await this.run(
        sql`insert into log_action_time(uid,name,time) values(${uid},'jiechumianzhan',unix_timestamp())`,
      );
    }
    return [
      target,
      [
        await this.rows(
          sql`select * from sys_goods g join cfg_goods f on f.gid=g.gid where g.uid=${uid} and g.count>0 order by f.group,f.gid`,
        ),
        await this.rows(
          sql`select * from sys_things t join cfg_things f on f.tid=t.tid and t.tid not in (104001) where t.uid=${uid} and t.count>0 order by f.position`,
        ),
      ],
    ];
  }
  private failVacation(key: string): never {
    throw GameError.raw(
      this.lang.t(`changeUserState.${key}`) + this.lang.t('changeUserState.xiujia'),
    );
  }
  private async checkWar(uid: number, suffix: string, normal: boolean): Promise<void> {
    const cities = await this.rows(
      sql`select cid from sys_city where uid=${uid} ${normal ? sql`and type=0` : sql``}`,
    );
    for (const city of cities)
      if (
        await this.row(
          sql`select * from mem_world where wid=${cid2wid(phpIntval(city.cid))} and state=1`,
        )
      )
        throw GameError.raw(
          this.lang.t('changeUserState.some_city_in_war') +
            this.lang.t(`changeUserState.${suffix}`),
        );
  }
  private async vacation(uid: number, day: number): Promise<unknown[]> {
    if (day < 2 || day > 99) throw GameError.lang('changeUserState.vacation_limit');
    if (await this.row(sql`select uid from sys_troops where uid=${uid}`))
      this.failVacation('army_out');
    if (await this.row(sql`select uid from sys_technic where uid=${uid} and state=1`))
      this.failVacation('technic_upgrading');
    const cities = await this.rows(sql`select cid,type from sys_city where uid=${uid}`);
    if (!cities.length) throw GameError.lang('changeUserState.no_city');
    const cids = cities.map((c) => phpIntval(c.cid));
    if (
      await this.row(sql`select id from sys_building where cid in (${sql.join(cids)}) and state<>0`)
    )
      this.failVacation('building_upgrading');
    if (await this.row(sql`select id from sys_city_draftqueue where cid in (${sql.join(cids)})`))
      this.failVacation('soldier_queue');
    if (
      await this.row(sql`select id from sys_city_reinforcequeue where cid in (${sql.join(cids)})`)
    )
      this.failVacation('defence_queue');
    for (const cid of cids)
      if (await this.row(sql`select * from mem_world where wid=${cid2wid(cid)} and state=1`))
        this.failVacation('some_city_in_war');
    const pass = await this.cell(sql`select passtype from sys_user where uid=${uid}`);
    const cost = day * 5 + (pass === 'tw' ? 10 : 20);
    if (cost > phpNum(await this.cell(sql`select money from sys_user where uid=${uid}`)))
      throw GameError.lang('sys.not_enough_money');
    const cooling = await this.row(
      sql`select bufparam,endtime,endtime-unix_timestamp() as lefttime from mem_user_buffer where uid=${uid} and buftype=23`,
    );
    if (cooling)
      throw GameError.lang(
        'changeUserState.wait_to_use_XiuJia',
        cooling.bufparam,
        makeTimeLeft(this.lang, phpNum(cooling.lefttime)),
      );
    const last = await this.cell(sql`select vacend from sys_user_state where uid=${uid}`);
    if (!phpEmpty(last) && !phpLooseEquals(last, 0))
      throw GameError.lang('changeUserState.not_process_XiuJia');
    for (const cid of cids) {
      await this.run(
        sql`update sys_troops set state=1,endtime=pathtime+unix_timestamp(),starttime=unix_timestamp() where targetcid=${cid} and state=4 and task=1 and cid<>${cid}`,
      );
      const fields = await this.rows(
        sql`select wid from mem_world where ownercid=${cid} and type>1`,
      );
      if (fields.length) {
        // PHP quotes the entire comma list: MySQL compares this as the first numeric cid.
        const list = fields.map((f) => wid2cid(f.wid)).join(',');
        await this.run(
          sql`update sys_troops set state=1,endtime=pathtime+unix_timestamp(),starttime=unix_timestamp() where targetcid in (${list}) and task=1 and state=4 and cid<>${cid}`,
        );
      }
    }
    const duration = day * 86400;
    await this.run(
      sql`insert into sys_user_state(uid,vacstart,vacend) values(${uid},unix_timestamp(),unix_timestamp()+${duration}) on duplicate key update vacstart=unix_timestamp(),vacend=unix_timestamp()+${duration}`,
    );
    await this.run(sql`update mem_city_resource set vacation=1 where cid in (${sql.join(cids)})`);
    await this.run(sql`update sys_user set money=GREATEST(money-${cost},0) where uid=${uid}`);
    await this.run(
      sql`insert into log_money(uid,count,time,type) values(${uid},${-cost},unix_timestamp(),75)`,
    );
    const total = duration + Math.floor((duration * 0.2) / 8);
    await this.run(
      sql`insert into mem_user_buffer(uid,buftype,endtime) values(${uid},913,unix_timestamp()+${total}) on duplicate key update endtime=unix_timestamp()+${total}`,
    );
    return [6, duration];
  }
}
