import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { cid2wid } from '../core/city-rules.service';
import { phpEmpty, phpIntval, phpLooseEquals, addslashes } from '../core/php';
import { makeTimeLeft } from '../core/user-rules.service';
import { MailService } from '../core/mail.service';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** HeroExprinc.php: uids at or below this are NPC accounts. */
const NPC_UID_END = 897;
/** sys_city.type for 洛阳 (the capital); its owner comes from log_luoyang_belong, not sys_city. */
const LUOYANG_CID = 215265;
/** sys_favourites cap per user, and sys_union_mark cap per union. */
const FAV_MAX = 10;
const MARK_MAX = 20;
/** 48h life of a union mark. */
const MARK_TTL = 48 * 3600;
/** sys_union_relation.type: 0 友好, 1 中立, 2 敌对; an 8h grace after a declaration. */
const WAR_GRACE = 8 * 3600;

/**
 * WorldFunc.php query / utility commands: the 500x500 world map (`getBlockData`,
 * `getWorldCityInfo`, `getWorldFieldInfo`, `getMapCity`), the 官府 政令 counter
 * (`getGovernInfo`), invasion eligibility (`checkCanInvade`), union marks (`markCity`),
 * and the campaign favourites (`addFavourites` / `getFavouritesList` / `deleteFavourites` /
 * `setFavouritesComments`). Response shapes mirror the PHP exactly so the world-map client
 * reads them unchanged.
 *
 * The action commands `createCityFromLand`, `governOthers`, `startWar`, `unionAssit` and
 * `mergeCity` are left for a later wave; see `world-stub.commands.ts`.
 */
@Injectable()
export class WorldCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly mail: MailService,
  ) {}

  /**
   * `[[block, ...]]`: for each 100-tile block, `[blockStart, "<offset>:type:ownercid:state:level:
   * province:jun, ..."]`, then the player's union marks. Expired marks are pruned first.
   */
  @GlobalCommand()
  async getBlockData(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    await this.clearMark(ctx.uid);
    const blocks = Array.isArray(param[0]) ? (param[0] as unknown[]) : [];
    const ret: unknown[] = [];
    for (const block of blocks) {
      const start = phpIntval(block) * 100;
      const end = start + 100;
      const concat = await this.cell(
        sql`select group_concat((wid - ${start}), ':', type, ':', ownercid, ':', state, ':',
          level, ':', province, ':', jun) from mem_world where wid >= ${start} and wid < ${end}`,
      );
      ret.push([start, concat ?? null]);
    }
    let unionid = phpIntval(
      await this.cell(sql`select union_id from sys_user where uid = ${ctx.uid}`),
    );
    if (phpEmpty(unionid)) unionid = 0;
    const marks = await this.rows(sql`select * from sys_union_mark where unionid = ${unionid}`);
    return [ret, marks];
  }

  /**
   * `[count, cid, ...]`: the named cities with owner / union info, each tagged with a `flag`
   * (0 self, 1 ally, 2 friendly, 3 neutral, 4 enemy, 5 free-to-take, 6 personal war, 7 no flag,
   * 8 union war pending). 洛阳's owner is overlaid from log_luoyang_belong.
   */
  @GlobalCommand()
  async getWorldCityInfo(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const rest = [...param];
    const count = phpIntval(rest.shift());
    if (count <= 0) return [];
    const cids: number[] = [];
    for (let i = 0; i < count; i++) cids.push(phpIntval(rest.shift()));
    return this.worldCityInfo(ctx.uid, cids);
  }

  private async worldCityInfo(uid: number, cids: number[]): Promise<Row[]> {
    if (cids.length === 0) return [];
    const now = phpIntval(await this.cell(sql`select unix_timestamp()`));
    const list = await this.rows(sql`select c.cid, c.type as citytype, c.is_special as is_special,
        c.province as provinceId, c.name as cityname, u.uid, u.name as username, u.passport,
        u.flagchar, u.union_id, n.name as unionname, u.prestige, u.state as userstate,
        u.face as userface, u.sex as usersex
      from sys_city c, sys_user u left join sys_union n on u.union_id = n.id
      where c.cid in (${sql.join(cids)}) and c.uid = u.uid`);
    const user = await this.row(sql`select * from sys_user where uid = ${uid}`);
    for (const city of list) {
      city.flag = await this.cityFlag(uid, now, city, user);
      if (phpIntval(city.cid) === LUOYANG_CID) {
        const startTime = await this.assignStartTime();
        const luoyang = await this.row(
          sql`select * from log_luoyang_belong where time >= ${startTime}`,
        );
        if (!phpEmpty(luoyang)) await this.overlayLuoyang(city, phpIntval(luoyang!.uid));
      }
    }
    return list;
  }

  /** The 小旗 flag for one city against the viewer, following WorldFunc.php exactly. */
  private async cityFlag(
    uid: number,
    now: number,
    city: Row,
    user: Row | undefined,
  ): Promise<number> {
    const myUnion = phpIntval(user?.union_id);
    if (phpLooseEquals(city.uid, user?.uid)) return 0;
    if (phpLooseEquals(city.union_id, myUnion) && phpIntval(city.union_id) > 0) return 1;
    const relation = await this.row(
      sql`select * from sys_union_relation where unionid = ${myUnion}
        and target = ${phpIntval(city.union_id)}`,
    );
    if (!phpEmpty(relation)) {
      const type = phpIntval(relation!.type);
      if (type === 0) return 2;
      if (type === 1) return 3;
      if (type === 2) {
        if (now - phpIntval(relation!.time) > WAR_GRACE) return 4;
        return this.warFlag(uid, now, city, 8);
      }
      return this.takeOrWarFlag(uid, now, city);
    }
    return this.takeOrWarFlag(uid, now, city);
  }

  /** NPC / 特殊城 are free to take (5); otherwise fall to the personal-war check. */
  private async takeOrWarFlag(uid: number, now: number, city: Row): Promise<number> {
    const citytype = phpIntval(city.citytype);
    if (phpIntval(city.uid) < NPC_UID_END || (citytype > 0 && citytype !== 5)) return 5;
    return this.warFlag(uid, now, city, 7);
  }

  /**
   * Resolves the personal-war flag: 6 when a 单挑宣战 is live, 8 while a union war is still in its
   * pending (state 0) window, else `fallback` (7 when no flag applies, 8 for the enemy-grace path).
   */
  private async warFlag(uid: number, _now: number, city: Row, fallback: number): Promise<number> {
    const targetuid = phpIntval(city.uid);
    if (
      await this.check(sql`select * from mem_user_trickwar where endtime > unix_timestamp()
        and ((uid = ${uid} and targetuid = ${targetuid})
          or (uid = ${targetuid} and targetuid = ${uid}))`)
    ) {
      return 6;
    }
    const inwar = await this.row(
      sql`select * from mem_user_inwar where endtime > unix_timestamp()
        and ((uid = ${uid} and targetuid = ${targetuid})
          or (uid = ${targetuid} and targetuid = ${uid}))`,
    );
    if (!phpEmpty(inwar)) return phpIntval(inwar!.state) === 0 ? 8 : 6;
    return fallback;
  }

  /** WorldFunc.php::getLuoyangCityInfo: overlay the current 洛阳 holder onto the city row. */
  private async overlayLuoyang(city: Row, belongUid: number): Promise<void> {
    const owner = await this.row(
      sql`select uid, name, flagchar, union_id, prestige from sys_user where uid = ${belongUid}`,
    );
    if (phpEmpty(owner)) return;
    city.uid = owner!.uid;
    city.username = owner!.name;
    city.flagchar = owner!.flagchar;
    city.union_id = owner!.union_id;
    city.unionname = await this.cell(
      sql`select name from sys_union where id = ${phpIntval(owner!.union_id)}`,
    );
    city.prestige = owner!.prestige;
  }

  /** `[wid]` -> `[{wid, type, ownercid, province, level, uid, cityname, username, prestige,
   * union_id, unionname}]`. */
  @GlobalCommand()
  async getWorldFieldInfo(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const wid = phpIntval(param[0]);
    const row = await this.row(sql`select w.wid, w.type, w.ownercid, w.province, w.level,
        c.uid, c.name as cityname, u.name as username, u.prestige, u.union_id, n.name as unionname
      from mem_world w left join sys_city c on c.cid = w.ownercid
        left join sys_user u on u.uid = c.uid left join sys_union n on n.id = u.union_id
      where w.wid = ${wid}`);
    return [row ?? null];
  }

  /** `[]`: the 2-4 level named cities with owner / union names; 洛阳 (type 4) owner overlaid. */
  @GlobalCommand()
  async getMapCity(): Promise<unknown[]> {
    const cities = await this.rows(sql`select c.name, c.cid, c.type, u.name as ownername,
        un.name as union_name from sys_city c left join sys_user u on c.uid = u.uid
        left join sys_union un on u.union_id = un.id where c.type > 1 and c.type < 5`);
    const ret: Row[] = [];
    for (const city of cities) {
      if (phpIntval(city.type) === 4) {
        const startTime = await this.assignStartTime();
        let belongUid = phpIntval(
          await this.cell(sql`select uid from log_luoyang_belong where time >= ${startTime}`),
        );
        if (phpEmpty(belongUid)) belongUid = -1;
        const own = await this.row(sql`select u.name as username, n.name as unionname
          from sys_user u, sys_union n where u.union_id = n.id and u.uid = ${belongUid}`);
        if (!phpEmpty(own)) {
          city.ownername = own!.username;
          city.union_name = own!.unionname;
        }
      }
      ret.push(city);
    }
    return ret;
  }

  /**
   * `[cid]` -> `[officeName, maxCountToday, usedToday]`. The day rolls over at UTC+8 midnight; a
   * last-govern time on a prior day resets the used count to 0.
   */
  @GlobalCommand()
  async getGovernInfo(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const cid = phpIntval(param[0]);
    const schedule = await this.row(
      sql`select govern_count, last_govern_time from mem_city_schedule where cid = ${cid}`,
    );
    const officepos = phpIntval(
      await this.cell(sql`select officepos from sys_user where uid = ${ctx.uid}`),
    );
    const officename = await this.cell(
      sql`select name from cfg_office_pos where id = ${officepos}`,
    );
    const cityType = phpIntval(await this.cell(sql`select type from sys_city where cid = ${cid}`));
    const maxCount = this.maxGovernByOffice(cityType, officepos);
    const ret: unknown[] = [officename ?? null, maxCount];
    if (phpEmpty(schedule)) {
      ret.push(0);
      return ret;
    }
    const now = phpIntval(await this.cell(sql`select unix_timestamp()`));
    const lastDay = Math.floor((phpIntval(schedule!.last_govern_time) + 8 * 3600) / 86400);
    if (Math.floor((now + 8 * 3600) / 86400) > lastDay) {
      ret.push(0);
      return ret;
    }
    ret.push(phpIntval(schedule!.govern_count));
    return ret;
  }

  /** WorldFunc.php::getMaxCountByOfficePos. */
  private maxGovernByOffice(cityType: number, officepos: number): number {
    if (cityType === 1) {
      if (officepos === 6) return 1;
      if (officepos === 7) return 2;
      if (officepos >= 8) return 3;
    } else if (cityType === 2) {
      if (officepos === 9) return 4;
      if (officepos === 10) return 5;
      if (officepos >= 11) return 6;
    } else if (cityType === 3) {
      if (officepos >= 12) return 8;
    } else if (cityType === 4) {
      if (officepos >= 13) return 10;
    }
    return 0;
  }

  /**
   * `[cid]`: whether the viewer's union holds at least a third of the sub-region needed to invade
   * a named city. `[true]` when eligible, else `[false, type, total, invaded]`.
   */
  @GlobalCommand()
  async checkCanInvade(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const cid = phpIntval(param[0]);
    let type = phpIntval(await this.cell(sql`select type from sys_city where cid = ${cid}`));
    if (type === 5) type = 0;
    if (type < 2) return [true];
    const unionid = phpIntval(
      await this.cell(sql`select union_id from sys_user where uid = ${ctx.uid}`),
    );
    const wid = cid2wid(cid);
    const place = await this.row(sql`select * from mem_world where wid = ${wid} limit 1`);
    const province = phpIntval(place?.province);
    const jun = phpIntval(place?.jun);
    // mem_world.wid -> owning sys_city.cid used in the legacy sub-queries.
    const widToCid = sql`(floor(w.wid / 10000) * 10 + floor(((w.wid % 100) / 10))) * 1000
      + floor((w.wid % 10000) / 100) * 10 + floor(w.wid % 10)`;
    let total = 0;
    let invaded = 0;
    if (type === 2) {
      total = phpIntval(
        await this.cell(sql`select count(*) from sys_city c
        left join mem_world w on c.cid = ${widToCid}
        where c.type = 1 and w.province = ${province} and w.jun = ${jun}`),
      );
      invaded = phpIntval(
        await this.cell(sql`select count(*) from sys_city c
        left join mem_world w on c.cid = ${widToCid}
        left join sys_user u on u.uid = c.uid
        where c.type = 1 and w.province = ${province} and w.jun = ${jun}
          and u.union_id = ${unionid}`),
      );
    } else if (type === 3) {
      total = phpIntval(
        await this.cell(sql`select count(*) from sys_city c
        left join mem_world w on c.cid = ${widToCid}
        where c.type = 2 and w.province = ${province}`),
      );
      invaded = phpIntval(
        await this.cell(sql`select count(*) from sys_city c
        left join mem_world w on c.cid = ${widToCid}
        left join sys_user u on u.uid = c.uid
        where c.type = 2 and w.province = ${province} and u.union_id = ${unionid}`),
      );
    } else if (type === 4) {
      total = phpIntval(await this.cell(sql`select count(*) from sys_city c where c.type = 3`));
      invaded = phpIntval(
        await this.cell(sql`select count(*) from sys_city c
        left join sys_user u on u.uid = c.uid where c.type = 3 and u.union_id = ${unionid}`),
      );
    }
    const percent = total === 0 ? 0 : invaded / total;
    if (percent > 1 / 3) return [true];
    return [false, type, total, invaded];
  }

  /** `[cid]`: marks an enemy famous city for the player's union; throws the success message. */
  @GlobalCommand()
  async markCity(ctx: CommandContext, param: unknown[]): Promise<never> {
    const uid = ctx.uid;
    const cid = phpIntval(param[0]);
    const city = await this.row(sql`select * from sys_city where cid = ${cid} limit 1`);
    const cityType = phpIntval(city?.type);
    if (phpEmpty(city) || cityType === 0 || cityType === 5) {
      throw GameError.lang('MarkCity.only_for_famous_city');
    }
    const unionid = phpIntval(
      await this.cell(sql`select union_id from sys_user where uid = ${uid}`),
    );
    if (phpEmpty(unionid)) throw GameError.lang('MarkCity.No_Union');
    const union = await this.row(sql`select * from sys_union where id = ${unionid} limit 1`);
    if (phpEmpty(union)) throw GameError.lang('MarkCity.No_Union');
    const unionpos = phpIntval(
      await this.cell(sql`select union_pos from sys_user where uid = ${uid}`),
    );
    // PHP: `$unionpos <= 0 || $unionpos <= 3` — any seat at or below 3 is refused.
    if (unionpos <= 0 || unionpos <= 3) throw GameError.lang('MarkCity.No_Permission');
    const owneruid = phpIntval(await this.cell(sql`select uid from sys_city where cid = ${cid}`));
    if (owneruid > 1000) {
      const targetunionid = phpIntval(
        await this.cell(sql`select union_id from sys_user where uid = ${owneruid}`),
      );
      const relation = await this.rows(sql`select * from sys_union_relation
        where unionid = ${unionid} and target = ${targetunionid} and type = 2`);
      if (relation.length === 0) throw GameError.lang('MarkCity.not_in_war');
    }
    return this.scope.transaction(async () => {
      await this.clearMark(uid);
      const mark = await this.rows(
        sql`select * from sys_union_mark where unionid = ${unionid} and cid = ${cid}`,
      );
      if (mark.length > 0) throw GameError.lang('MarkCity.have_marked');
      const count = phpIntval(
        await this.cell(sql`select count(*) from sys_union_mark where unionid = ${unionid}`),
      );
      if (count >= MARK_MAX) {
        const first = phpIntval(
          await this.cell(sql`select min(endtime) from sys_union_mark where unionid = ${unionid}`),
        );
        const now = phpIntval(await this.cell(sql`select unix_timestamp()`));
        throw GameError.lang('MarkCity.too_many_marks', makeTimeLeft(this.lang, first - now));
      }
      const wid = cid2wid(cid);
      await sql`insert into sys_union_mark (unionid, cid, endtime, type, wid)
        values (${unionid}, ${cid}, unix_timestamp() + ${MARK_TTL}, 1, ${wid})`.execute(
        this.scope.db,
      );
      await this.notifyMark(uid, unionid, cid, city!);
      throw GameError.lang('MarkCity.mark_succ');
    });
  }

  /** Mails every union member that the mark began; the title/content come from the lang table. */
  private async notifyMark(uid: number, unionid: number, cid: number, city: Row): Promise<void> {
    const receivers = await this.rows(
      sql`select uid, name from sys_user where union_id = ${unionid}`,
    );
    const x = cid % 1000;
    const y = Math.floor(cid / 1000);
    const content = this.lang.t('MarkCity.mark_mail_content', city.name, x, y);
    const title = this.lang.t('MarkCity.mark_mail_title');
    for (const receiver of receivers) await this.mail.send(phpIntval(receiver.uid), title, content);
  }

  /** WorldFunc.php::clearMark: drops marks whose enemy relation is gone, then expired marks. */
  private async clearMark(uid: number): Promise<void> {
    const db = this.scope.db;
    const unionid = phpIntval(
      await this.cell(sql`select union_id from sys_user where uid = ${uid}`),
    );
    const marks = await this.rows(sql`select * from sys_union_mark where unionid = ${unionid}`);
    for (const mark of marks) {
      const owneruid = phpIntval(
        await this.cell(sql`select uid from sys_city where cid = ${phpIntval(mark.cid)}`),
      );
      if (owneruid > 1000) {
        const targetunionid = phpIntval(
          await this.cell(sql`select union_id from sys_user where uid = ${owneruid}`),
        );
        const relation = await this.rows(sql`select * from sys_union_relation
          where unionid = ${unionid} and target = ${targetunionid} and type = 2`);
        if (relation.length === 0) {
          await sql`update sys_union_mark set endtime = 0 where id = ${phpIntval(mark.id)}`.execute(
            db,
          );
        }
      }
    }
    await sql`delete from sys_union_mark where endtime < unix_timestamp()`.execute(db);
  }

  /**
   * `[type]` -> `[type, [wid, ...]]`: the 活动野地 positions from cfg_special_act, or `[type, [-1]]`
   * when none is live (a row below 1000, 0 count, or not yet started reads as -1).
   */
  @GlobalCommand()
  async getActionField(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const type = param[0];
    const results = await this.rows(sql`select cid, count, starttime from cfg_special_act`);
    const wids: number[] = [];
    if (results.length === 0) {
      wids.push(-1);
    } else {
      const curtime = phpIntval(await this.cell(sql`select unix_timestamp()`));
      const curdayStart = phpIntval(await this.cell(sql`select unix_timestamp(curdate())`));
      for (const result of results) {
        const cid = phpIntval(result.cid);
        const count = phpIntval(result.count);
        const starttimeArr = String(result.starttime ?? '').split(':');
        const startSec =
          phpIntval(starttimeArr[0]) * 3600 + phpIntval(starttimeArr[1]) * 60 + curdayStart;
        let wid = cid2wid(cid);
        if (cid < 1000 || count === 0 || curtime < startSec) wid = -1;
        wids.push(wid);
      }
    }
    return [type, wids];
  }

  /** `getUserFields` -> `[[{wid}, ...]]`: the wids of the viewer's held wild fields. */
  @GlobalCommand()
  async getUserFields(ctx: CommandContext): Promise<unknown[]> {
    const fields = await this.rows(sql`select wid from mem_world m, sys_city s
      where m.ownercid = s.cid and m.type > 0 and s.uid = ${ctx.uid}`);
    return [fields];
  }

  /** `[cid]`: adds a city or wild field to the campaign favourites; throws the result message. */
  @GlobalCommand()
  async addFavourites(ctx: CommandContext, param: unknown[]): Promise<never> {
    const uid = ctx.uid;
    const targetcid = phpIntval(param[0]);
    return this.scope.transaction(async () => {
      if (
        await this.check(
          sql`select * from sys_favourites where uid = ${uid} and cid = ${targetcid}`,
        )
      ) {
        throw GameError.lang('addFavourites.already_in_fav');
      }
      const cnt = phpIntval(
        await this.cell(sql`select count(*) from sys_favourites where uid = ${uid}`),
      );
      if (cnt >= FAV_MAX) throw GameError.lang('addFavourites.fav_is_full');
      const wid = cid2wid(targetcid);
      const world = await this.row(sql`select * from mem_world where wid = ${wid}`);
      let name: unknown;
      if (phpIntval(world?.type) === 0) {
        name = await this.cell(sql`select name from sys_city where cid = ${targetcid}`);
      } else {
        name = await this.cell(
          sql`select name from cfg_world_type where type = ${phpIntval(world?.type)}`,
        );
      }
      await sql`insert into sys_favourites (uid, cid, name, comments)
        values (${uid}, ${targetcid}, ${name ?? ''}, '')`.execute(this.scope.db);
      throw GameError.lang('addFavourites.succ');
    });
  }

  /** `[]` -> `[[player cities], [favourites]]`. */
  @GlobalCommand()
  async getFavouritesList(ctx: CommandContext): Promise<unknown[]> {
    return this.favouritesList(ctx.uid);
  }

  private async favouritesList(uid: number): Promise<unknown[]> {
    const cities = await this.rows(sql`select cid, name from sys_city where uid = ${uid}`);
    const favs = await this.rows(
      sql`select id, cid, name, comments from sys_favourites where uid = ${uid}`,
    );
    return [cities, favs];
  }

  /** `[id]`: removes one of the player's favourites and returns the refreshed list. */
  @GlobalCommand()
  async deleteFavourites(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const id = phpIntval(param[0]);
    return this.scope.transaction(async () => {
      const fav = await this.row(sql`select * from sys_favourites where id = ${id}`);
      if (phpEmpty(fav) || !phpLooseEquals(fav!.uid, ctx.uid)) {
        throw GameError.lang('deleteFavourites.error_in_del_fav');
      }
      await sql`delete from sys_favourites where id = ${id}`.execute(this.scope.db);
      return this.favouritesList(ctx.uid);
    });
  }

  /** `[id, comments]`: sets the note on a favourite; throws the result message. */
  @GlobalCommand()
  async setFavouritesComments(ctx: CommandContext, param: unknown[]): Promise<never> {
    const id = phpIntval(param[0]);
    const comments = addslashes(
      param[1] === null || param[1] === undefined ? '' : String(param[1]),
    );
    return this.scope.transaction(async () => {
      const fav = await this.row(sql`select * from sys_favourites where id = ${id}`);
      if (phpEmpty(fav) || !phpLooseEquals(fav!.uid, ctx.uid)) {
        throw GameError.lang('setFavouritesComments.already_exist');
      }
      await sql`update sys_favourites set comments = ${comments} where id = ${id}`.execute(
        this.scope.db,
      );
      throw GameError.lang('setFavouritesComments.succ');
    });
  }

  /** utils.php::getAssingStartTime: the start of the current weekly 洛阳 assignment window. */
  private async assignStartTime(): Promise<number> {
    const now = phpIntval(await this.cell(sql`select unix_timestamp()`));
    const cur23Hour = phpIntval(await this.cell(sql`select unix_timestamp(curdate())`)) + 82800;
    // date('N'): 1 (Mon) .. 7 (Sun).
    const curday = ((new Date(now * 1000).getUTCDay() + 6) % 7) + 1;
    if (curday < 3) return cur23Hour - (curday + 4) * 86400;
    if (curday > 3) return cur23Hour - (curday - 3) * 86400;
    return now >= cur23Hour ? cur23Hour : cur23Hour - (curday + 4) * 86400;
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
