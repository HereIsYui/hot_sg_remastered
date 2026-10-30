import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PushProc } from '@hot/shared';
import { sql } from 'kysely';
import { TaskRewards } from '../task/task-rewards.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { phpIntval } from '../core/php';
import { UserRules } from '../core/user-rules.service';
import { DbScope } from '../db/database.module';
import { dbNow } from '../db/sql-fragments';
import { SessionService } from '../gateway/session.service';
import { PushService } from '../push/push.service';
import { WorldRefreshService } from '../world/world-refresh.tick';
import { CityBuildingsService } from '../city/city-buildings.service';
import { armorImageName, goodsImageName } from './gm-image';

type Row = Record<string, unknown>;

/** log_money / log_gift / log_goods reason of a GM grant, "4: GM操作". */
export const GM_LOG_TYPE = 4;

/**
 * log_user_action ids for GM property writes. cfg_user_action ends at 10002, so 20001+ cannot
 * collide with a player click action; log_user_action needs *some* aid and the original manage
 * scripts wrote none of these fields at all.
 */
export const GM_AID_PRESTIGE = 20001;
export const GM_AID_NOBILITY = 20002;
export const GM_AID_OFFICEPOS = 20003;

/** sys_user.state value of a locked account (login.service refuses login for it). */
const STATE_LOCKED = 5;
const STATE_NORMAL = 0;
/** Player accounts only: system and NPC rows live below this uid. */
const FIRST_PLAYER_UID = 1000;
/** Original forbiduser.php: the ban end timestamp of an open-ended ban. */
const FORBID_END = 2000000000;
/** Hero states that may be reassigned to a city (free, chief, general, adviser). */
const HERO_IN_CITY_STATES = [0, 1, 7, 8];
/** Row caps for the LIKE searches, so a loose pattern cannot flood the ops UI. */
const SEARCH_LIMIT = 50;
/** Tables counted by the status overview (one scalar subquery each). */
const STATUS_TABLES = [
  'sys_user',
  'sys_city',
  'sys_city_hero',
  'sys_building',
  'sys_technic',
  'sys_goods',
  'sys_troops',
  'sys_mail_box',
  'sys_inform',
  'sys_sessions',
  'sys_union',
  'mem_battle',
  'mem_world',
  'sys_user_task',
] as const;

/**
 * The GM toolbox behind `api/gm`: player / city / hero / goods / announce / world operations,
 * ported from the original manage scripts (`legacy/raw/.../server/manage/game/*.php`) and the
 * 修改器 (design/02-开发计划.md, 阶段 10). Unlike the command gateway this is an ops surface —
 * direct DB writes with log-table bookkeeping instead of game semantics, so GM deliberately
 * skips the GameError/lang path and reports plain HTTP errors.
 */
@Injectable()
export class GmCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly rewards: TaskRewards,
    private readonly users: UserRules,
    private readonly goods: GoodsRules,
    private readonly heroes: HeroRules,
    private readonly buildings: CityBuildingsService,
    private readonly push: PushService,
    private readonly sessions: SessionService,
    private readonly moduleRef: ModuleRef,
  ) {}

  // ---------------------------------------------------------------- players

  /** search_username.php / search_passport.php: fuzzy player lookup with joined display names. */
  async searchPlayers(by: 'name' | 'passport', name: string): Promise<Row[]> {
    const like = this.like(name);
    const column = by === 'passport' ? 'u.passport' : 'u.name';
    const result = await sql<Row>`select u.uid, u.name, u.passport, u.money, u.gift, u.prestige,
        u.nobility, u.officepos, u.state, u.union_id, u.regtime, u.lastcid,
        o.name as officepos_name, n.name as nobility_name, un.name as union_name
      from sys_user u
      left join cfg_office_pos o on o.id = u.officepos
      left join cfg_nobility n on n.id = u.nobility
      left join sys_union un on un.id = u.union_id
      where u.uid > ${FIRST_PLAYER_UID} and ${sql.raw(column)} like ${like}
      order by u.uid limit ${SEARCH_LIMIT}`.execute(this.scope.db);
    return result.rows;
  }

  /**
   * Sets a player's money / gift / prestige / nobility / officepos (absolute values, 修改器
   * style). Money and gift go through utils.php::addMoney/addGift with the GM log type; the
   * rest are direct writes with a log_user_action row, mirroring how the original manage
   * backend recorded ops.
   */
  async updatePlayer(input: {
    uid: number;
    money?: number;
    gift?: number;
    prestige?: number;
    nobility?: number;
    officepos?: number;
  }): Promise<Row> {
    return this.scope.transaction(async () => {
      const user = await this.requireUser(input.uid);
      if (input.money !== undefined) {
        await this.rewards.addMoney(input.uid, input.money - phpIntval(user.money), GM_LOG_TYPE);
      }
      if (input.gift !== undefined) {
        await this.rewards.addGift(input.uid, input.gift - phpIntval(user.gift), GM_LOG_TYPE);
      }
      if (input.prestige !== undefined) {
        await sql`update sys_user set prestige = ${input.prestige} where uid = ${input.uid}`.execute(
          this.scope.db,
        );
        await this.users.logUserAction(input.uid, GM_AID_PRESTIGE);
      }
      if (input.nobility !== undefined) {
        await this.requireCfgRow('cfg_nobility', 'id', input.nobility, 'nobility');
        await sql`update sys_user set nobility = ${input.nobility} where uid = ${input.uid}`.execute(
          this.scope.db,
        );
        await this.users.logUserAction(input.uid, GM_AID_NOBILITY);
      }
      if (input.officepos !== undefined) {
        await this.requireCfgRow('cfg_office_pos', 'id', input.officepos, 'officepos');
        await sql`update sys_user set officepos = ${input.officepos} where uid = ${input.uid}`.execute(
          this.scope.db,
        );
        await this.users.logUserAction(input.uid, GM_AID_OFFICEPOS);
      }
      return this.requireUser(input.uid);
    });
  }

  /** game/forbidlist.php: the accounts with an open ban. */
  async forbidList(): Promise<Row[]> {
    const result =
      await sql<Row>`select u.uid, u.passport, u.name, u.state, s.forbistart, s.forbiend
      from sys_user_state s left join sys_user u on u.uid = s.uid
      where s.forbiend > unix_timestamp() order by u.uid`.execute(this.scope.db);
    return result.rows;
  }

  /**
   * game/forbiduser.php: bans one account — sys_user_state through FORBID_END, the cities'
   * mem_city_resource.forbidden, the login-blocking sys_user.state=5 and (like the original's
   * `sessions/<uid>` file write) an invalidation of the stored session; optionally purges the
   * mails the account sent.
   */
  async forbidUser(input: { uid: number; delemail: boolean }): Promise<Row> {
    return this.scope.transaction(async () => {
      await this.requirePlayer(input.uid);
      const db = this.scope.db;
      await sql`update mem_city_resource set forbidden = 1
        where cid in (select cid from sys_city where uid = ${input.uid})`.execute(db);
      await sql`insert into sys_user_state (uid, forbistart, forbiend)
        values (${input.uid}, unix_timestamp(), ${FORBID_END})
        on duplicate key update forbistart = unix_timestamp(), forbiend = ${FORBID_END}`.execute(
        db,
      );
      await sql`update sys_user set state = ${STATE_LOCKED} where uid = ${input.uid}`.execute(db);
      await sql`delete from sys_sessions where uid = ${input.uid}`.execute(db);
      this.sessions.forget(input.uid);
      if (input.delemail) {
        await sql`delete from sys_mail_box where fromuid = ${input.uid}`.execute(db);
      }
      return this.requireUser(input.uid);
    });
  }

  /** game/unforbiduser.php: lifts the ban and releases the cities; state 5 only resets to 0. */
  async unforbidUser(uid: number): Promise<Row> {
    return this.scope.transaction(async () => {
      await this.requirePlayer(uid);
      const db = this.scope.db;
      await sql`update sys_user_state set forbistart = 0, forbiend = 0 where uid = ${uid}`.execute(
        db,
      );
      await sql`update mem_city_resource set forbidden = 0
        where cid in (select cid from sys_city where uid = ${uid})`.execute(db);
      await sql`update sys_user set state = ${STATE_NORMAL} where uid = ${uid}
        and state = ${STATE_LOCKED}`.execute(db);
      return this.requireUser(uid);
    });
  }

  // ---------------------------------------------------------------- cities

  /** game/search_cityname.php, plus the x/y lookup (`cid = x + y*1000` like the position concat). */
  async searchCities(query: { name?: string; x?: number; y?: number }): Promise<Row[]> {
    const db = this.scope.db;
    if (query.x !== undefined || query.y !== undefined) {
      if (query.x === undefined || query.y === undefined) {
        throw new BadRequestException('x and y must be given together');
      }
      const cid = query.x + query.y * 1000;
      const result = await sql<Row>`select c.cid, c.cid % 1000 as x, floor(c.cid / 1000) as y,
          c.name, c.type, c.state, c.uid, u.name as username
        from sys_city c left join sys_user u on u.uid = c.uid where c.cid = ${cid}`.execute(db);
      return result.rows;
    }
    if (query.name === undefined) throw new BadRequestException('name or x/y required');
    const result = await sql<Row>`select c.cid, c.cid % 1000 as x, floor(c.cid / 1000) as y,
        c.name, c.type, c.state, c.uid, u.name as username
      from sys_city c left join sys_user u on u.uid = c.uid
      where c.name like ${this.like(query.name)}
      order by c.cid limit ${SEARCH_LIMIT}`.execute(db);
    return result.rows;
  }

  /**
   * 一键满级: every building of the city jumps to the max level cfg_building_level defines and
   * every technic of the owner to the cfg_technic_level max, then the per-city technic levels
   * (sys_city_technic) are re-derived by CityBuildingsService.syncUserTechnics — the same
   * maintenance the research tick runs. Works for a union main city (联盟建筑) exactly like for
   * a player city; the rows live in the same tables.
   */
  async cityMaxLevel(cid: number): Promise<{ buildings: number; technics: number }> {
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      const city = await this.requireCity(cid);
      const uid = phpIntval(city.uid);
      const buildings = await sql`update sys_building sb set sb.level =
          (select max(l.level) from cfg_building_level l where l.bid = sb.bid),
          sb.state = 0, sb.state_starttime = 0, sb.state_endtime = 0
        where sb.cid = ${cid}`.execute(db);
      const technics = await sql`update sys_technic st set st.level =
          (select max(l.level) from cfg_technic_level l where l.tid = st.tid),
          st.state = 0, st.state_starttime = 0, st.state_endtime = 0
        where st.uid = ${uid}`.execute(db);
      await this.buildings.syncUserTechnics(uid);
      return {
        // numAffectedRows is a bigint (phpIntval cannot read bigint, so count with Number).
        buildings: Number(buildings.numAffectedRows ?? 0n),
        technics: Number(technics.numAffectedRows ?? 0n),
      };
    });
  }

  /**
   * 数据清理: deletes one test player with all referenced rows (dangerous — needs
   * `confirm: true`). Player accounts only (uid > 1000); log_* tables are kept as an audit
   * trail. The table lists cover the player- and city-scoped rows a test account leaves
   * behind; anything not listed (e.g. an in-flight battle) belongs to live game state and is
   * out of scope for a data cleanup.
   */
  async cleanupUser(input: { uid: number; confirm: boolean }): Promise<{ ok: true }> {
    if (input.confirm !== true) {
      throw new BadRequestException('confirm must be true for data cleanup');
    }
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      await this.requirePlayer(input.uid);
      // Hero-scoped rows first, while sys_city_hero still knows the hids.
      for (const table of ['mem_hero_blood', 'sys_city_hero_base_add', 'sys_hero_skill']) {
        await sql`delete from ${sql.raw(table)} where hid in
          (select hid from sys_city_hero where uid = ${input.uid})`.execute(db);
      }
      // Recruit pools and captive rows hold the hero copies of the player's heroes.
      await sql`delete from sys_recruit_hero where cid in
        (select cid from sys_city where uid = ${input.uid})`.execute(db);
      await sql`delete from sys_hero_captive where uid = ${input.uid}`.execute(db);
      await sql`delete from sys_city_hero where uid = ${input.uid}`.execute(db);
      for (const table of [
        'sys_building',
        'sys_technic',
        'sys_city_soldier',
        'sys_city_defence',
        'sys_city_area',
        'sys_city_draftqueue',
        'sys_city_reinforcequeue',
        'sys_city_res_add',
        'sys_city_rumor',
        'sys_city_tactics',
        'sys_city_technic',
        'sys_city_trade',
        'sys_attack_position',
        'sys_thing_position',
        'mem_city_resource',
        'mem_city_buffer',
        'mem_city_captive',
        'mem_city_draft',
        'mem_city_lamster',
        'mem_city_reinforce',
        'mem_city_schedule',
        'mem_city_wounded',
        'mem_building_upgrading',
        'mem_building_destroying',
        'mem_technic_upgrading',
        'mem_treasure_map',
        'sys_hero_rest',
        'sys_king_expr',
      ]) {
        await sql`delete from ${sql.raw(table)} where cid in
          (select cid from sys_city where uid = ${input.uid})`.execute(db);
      }
      await sql`delete from sys_troops where uid = ${input.uid}`.execute(db);
      await sql`delete from sys_city where uid = ${input.uid}`.execute(db);
      for (const table of [
        'sys_goods',
        'sys_things',
        'sys_user_armor',
        'sys_user_task',
        'sys_user_goal',
        'sys_user_designation',
        'sys_user_level',
        'sys_user_comming',
        'sys_user_state',
        'sys_user_donate',
        'sys_hero_expr',
        'sys_hero_expr_reward',
        'sys_hero_act',
        'sys_lionize',
        'sys_favourites',
        'sys_allow_auto_discard',
        'sys_allowpk',
        'sys_allow_union_troop',
        'sys_sessions',
        'mem_assemble',
        'mem_user_buffer',
      ]) {
        await sql`delete from ${sql.raw(table)} where uid = ${input.uid}`.execute(db);
      }
      await sql`delete from sys_user_relation where uid = ${input.uid}
        or tuid = ${input.uid}`.execute(db);
      // sys_mail_box: fromuid is the sender, uid the recipient.
      await sql`delete from sys_mail_box where fromuid = ${input.uid}
        or uid = ${input.uid}`.execute(db);
      this.sessions.forget(input.uid);
      await sql`delete from sys_user where uid = ${input.uid}`.execute(db);
      return { ok: true as const };
    });
  }

  // ---------------------------------------------------------------- heroes

  /** Player heroes and the 名将 definitions (cfg_npc_hero) matching a name. */
  async searchHeroes(name: string): Promise<{ heroes: Row[]; npcHeroes: Row[] }> {
    const like = this.like(name);
    const db = this.scope.db;
    const heroes = await sql<Row>`select h.hid, h.uid, h.cid, h.name, h.level, h.exp, h.herotype,
        h.npcid, h.state, h.hero_health, u.name as username,
        h.command_base, h.affairs_base, h.bravery_base, h.wisdom_base
      from sys_city_hero h left join sys_user u on u.uid = h.uid
      where h.uid > 0 and h.name like ${like} order by h.hid limit ${SEARCH_LIMIT}`.execute(db);
    const npcHeroes = await sql<Row>`select npcid, name, zi, type, sex, affairs_base, bravery_base,
        wisdom_base, introduce
      from cfg_npc_hero where name like ${like} order by npcid limit ${SEARCH_LIMIT}`.execute(db);
    return { heroes: heroes.rows, npcHeroes: npcHeroes.rows };
  }

  /**
   * Sets a hero's level / exp / base attributes (absolute values); derived stats are rebuilt
   * with HeroFunc::regenerateHeroAttri and the city's hero fee is refreshed.
   */
  async updateHero(input: {
    hid: number;
    level?: number;
    exp?: number;
    command?: number;
    affairs?: number;
    bravery?: number;
    wisdom?: number;
  }): Promise<Row> {
    return this.scope.transaction(async () => {
      const hero = await this.requireHero(input.hid);
      const db = this.scope.db;
      if (input.level !== undefined) {
        const level = Math.min(125, Math.max(1, input.level));
        await sql`update sys_city_hero set level = ${level} where hid = ${input.hid}`.execute(db);
      }
      if (input.exp !== undefined) {
        await sql`update sys_city_hero set exp = ${input.exp} where hid = ${input.hid}`.execute(db);
      }
      if (input.command !== undefined) {
        await sql`update sys_city_hero set command_base = ${input.command}
          where hid = ${input.hid}`.execute(db);
      }
      if (input.affairs !== undefined) {
        await sql`update sys_city_hero set affairs_base = ${input.affairs}
          where hid = ${input.hid}`.execute(db);
      }
      if (input.bravery !== undefined) {
        await sql`update sys_city_hero set bravery_base = ${input.bravery}
          where hid = ${input.hid}`.execute(db);
      }
      if (input.wisdom !== undefined) {
        await sql`update sys_city_hero set wisdom_base = ${input.wisdom}
          where hid = ${input.hid}`.execute(db);
      }
      await this.heroes.regenerateHeroAttri(phpIntval(hero.uid), input.hid);
      await this.heroes.updateCityHeroChange(phpIntval(hero.uid), phpIntval(hero.cid));
      return this.requireHero(input.hid);
    });
  }

  /**
   * 放入指定城池: rewrites sys_city_hero.cid and guarantees the mem_hero_blood row the city /
   * battle joins expect. Only an in-city hero (free or appointed, states 0/1/7/8) may move —
   * heroes out with a troop belong to the battle settlement, not the GM.
   */
  async placeHero(input: { hid: number; cid: number }): Promise<Row> {
    return this.scope.transaction(async () => {
      const hero = await this.requireHero(input.hid);
      await this.requireCity(input.cid);
      if (!HERO_IN_CITY_STATES.includes(phpIntval(hero.state))) {
        throw new BadRequestException(`hero ${input.hid} is out (state ${hero.state})`);
      }
      const db = this.scope.db;
      await sql`update sys_city_hero set cid = ${input.cid} where hid = ${input.hid}`.execute(db);
      const blood = await sql<Row>`select hid from mem_hero_blood where hid = ${input.hid}`.execute(
        db,
      );
      if (blood.rows.length === 0) {
        await sql`replace into mem_hero_blood (hid) values (${input.hid})`.execute(db);
      }
      await this.heroes.updateCityHeroChange(phpIntval(hero.uid), input.cid);
      await this.heroes.updateCityHeroChange(phpIntval(hero.uid), phpIntval(hero.cid));
      return this.requireHero(input.hid);
    });
  }

  // ---------------------------------------------------------------- goods

  /** cfg_goods / cfg_armor fuzzy search with the preview image file name (see gm-image.ts). */
  async searchGoods(kind: 'goods' | 'armor', name: string): Promise<Row[]> {
    const like = this.like(name);
    const db = this.scope.db;
    if (kind === 'armor') {
      const result = await sql<Row>`select id, name, image, level, hero_level, inuse, description
        from cfg_armor where name like ${like} order by id limit ${SEARCH_LIMIT}`.execute(db);
      return result.rows.map((row) => ({ ...row, imageName: armorImageName(row) }));
    }
    const result = await sql<Row>`select gid, name, image, imagetype, \`group\`, level, inuse,
        description
      from cfg_goods where name like ${like} order by gid limit ${SEARCH_LIMIT}`.execute(db);
    return result.rows.map((row) => ({ ...row, imageName: goodsImageName(row) }));
  }

  /** utils.php::addGoods with the GM log reason. */
  async grantGoods(input: { uid: number; gid: number; count: number }): Promise<{ ok: true }> {
    await this.requirePlayer(input.uid);
    if (input.count === 0) throw new BadRequestException('count must not be 0');
    await this.goods.addGoods(input.uid, input.gid, input.count, GM_LOG_TYPE);
    return { ok: true };
  }

  /** Removes an owned item (all copies, or `count` of them with a negative log_goods row). */
  async removeGoods(input: { uid: number; gid: number; count?: number }): Promise<{ ok: true }> {
    await this.requirePlayer(input.uid);
    if (input.count === undefined) {
      await this.scope.transaction(async () => {
        const db = this.scope.db;
        const owned = await sql<{ count: unknown }>`select count from sys_goods
          where uid = ${input.uid} and gid = ${input.gid}`.execute(db);
        const count = phpIntval(owned.rows[0]?.count);
        if (count > 0) {
          await sql`delete from sys_goods where uid = ${input.uid} and gid = ${input.gid}`.execute(
            db,
          );
          await db
            .insertInto('log_goods')
            .values({
              uid: input.uid,
              gid: input.gid,
              count: -count,
              time: sql<number>`unix_timestamp()`,
              type: GM_LOG_TYPE,
            })
            .execute();
        }
      });
      return { ok: true };
    }
    await this.goods.reduceGoods(input.uid, input.gid, input.count, GM_LOG_TYPE);
    return { ok: true };
  }

  // ---------------------------------------------------------------- announce

  /**
   * 系统公告: a sys_inform scrolling row (utils.php::sendSysInform semantics); the client's
   * inform bar picks it up on its next poll.
   */
  async sendInform(input: {
    msg: string;
    color?: number;
    seconds?: number;
    type?: number;
  }): Promise<{ ok: true }> {
    await this.users.sendSysInform({
      type: input.type ?? 1,
      inuse: 1,
      starttime: 0,
      endtime: input.seconds ?? 3600,
      interval: 50000,
      scrollcount: 1,
      color: input.color ?? 14972979,
      msg: input.msg,
    });
    return { ok: true };
  }

  /**
   * GM 喊话: pushed to every online client as proc 14 NOTIFY_ADMIN_SPEEK with the fields the
   * original ChatPanel.onNotifyGMSpeek parsed from the binary frame (type 3 chat entry).
   */
  async speak(input: { msg: string; from?: string }): Promise<number> {
    return this.push.broadcast(PushProc.NOTIFY_ADMIN_SPEEK, {
      type: 3,
      fromuid: 0,
      fromuser: input.from ?? '管理员',
      touid: 0,
      touser: '',
      msg: input.msg,
    });
  }

  // ---------------------------------------------------------------- world

  /**
   * Forces one 野地刷新 pass now, bypassing the 8-hour window (WorldRefreshService.refresh).
   * The touched count is recomputed here because WorldRefreshService counts via phpIntval,
   * which cannot read the bigint numAffectedRows.
   */
  async refreshWilds(): Promise<{ touched: number }> {
    return this.scope.transaction(async () => {
      const refresh = this.moduleRef.get(WorldRefreshService, { strict: false });
      const now = await dbNow(this.scope.db);
      await refresh.refresh(now);
      const grown = await sql<{ n: unknown }>`select count(*) as n from mem_world
        where type > 0 and ownercid = 0 and state = 0 and updatetime = ${now}`.execute(
        this.scope.db,
      );
      return { touched: Number(grown.rows[0]?.n ?? 0) };
    });
  }

  /** Online players (push connections) and a row-count overview of the main tables. */
  async status(): Promise<{ online: number; onlineUids: number[]; tables: Row[] }> {
    const onlineUids = this.push.onlineUids();
    const columns = STATUS_TABLES.map((t) => `(select count(*) from ${t}) as \`${t}\``).join(', ');
    const result = await sql<Row>`select ${sql.raw(columns)}`.execute(this.scope.db);
    return { online: onlineUids.length, onlineUids, tables: result.rows };
  }

  // ---------------------------------------------------------------- helpers

  private like(name: string): string {
    const trimmed = name.trim();
    if (trimmed === '') throw new BadRequestException('name must not be empty');
    return `%${trimmed}%`;
  }

  private async requireUser(uid: number): Promise<Row> {
    const result = await sql<Row>`select u.uid, u.name, u.passport, u.money, u.gift, u.prestige,
        u.nobility, u.officepos, u.state, u.union_id, u.lastcid,
        o.name as officepos_name, n.name as nobility_name, un.name as union_name
      from sys_user u
      left join cfg_office_pos o on o.id = u.officepos
      left join cfg_nobility n on n.id = u.nobility
      left join sys_union un on un.id = u.union_id
      where u.uid = ${uid}`.execute(this.scope.db);
    const user = result.rows[0];
    if (!user) throw new NotFoundException(`uid ${uid} not found`);
    return user;
  }

  /** Player accounts only: GM writes must never touch the system / NPC rows below uid 1000. */
  private async requirePlayer(uid: number): Promise<Row> {
    if (!Number.isInteger(uid) || uid <= FIRST_PLAYER_UID) {
      throw new BadRequestException(`uid must be an integer > ${FIRST_PLAYER_UID}`);
    }
    return this.requireUser(uid);
  }

  private async requireCity(cid: number): Promise<Row> {
    const row = await this.one(sql`select cid, uid, name from sys_city where cid = ${cid}`);
    if (!row) throw new NotFoundException(`cid ${cid} not found`);
    return row;
  }

  private async requireHero(hid: number): Promise<Row> {
    const row = await this.one(sql`select hid, uid, cid, name, level, exp, herotype, npcid, state
      from sys_city_hero where hid = ${hid}`);
    if (!row) throw new NotFoundException(`hid ${hid} not found`);
    return row;
  }

  private async requireCfgRow(
    table: 'cfg_nobility' | 'cfg_office_pos',
    column: 'id',
    id: number,
    label: string,
  ): Promise<void> {
    const row = await this.one(
      sql`select id from ${sql.raw(table)} where ${sql.raw(column)} = ${id}`,
    );
    if (!row) throw new NotFoundException(`${label} ${id} not found`);
  }

  private async one(query: ReturnType<typeof sql>): Promise<Row | undefined> {
    return (await query.execute(this.scope.db)).rows[0] as Row | undefined;
  }
}
