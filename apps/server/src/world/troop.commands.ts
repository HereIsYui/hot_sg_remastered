import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { CityRules, cid2wid, wid2cid } from '../core/city-rules.service';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { DbScope } from '../db/database.module';
import { DialogCommand, GlobalCommand, type CommandContext } from '../gateway/decorators';

type Row = Record<string, unknown>;

/** 烽火台 building id (ID_BUILDING_BALEFIRE). */
const ID_BUILDING_BALEFIRE = 19;

/**
 * TroopFunc.php: the 军队 panel (BloodWar:Troop/*) and 鸿胪寺 driving-permission toggles.
 *
 * The cross-server (BattleNet/ChibiNet), 沙场 and 洛阳 troop sources that getArmyTroops merges in
 * are out of single-player scope; those branches are dropped (they return nothing here). The
 * battle-report readers (getBattleReport / getBattleData / setSoldierTactics) belong to the battle
 * wave and are not ported.
 */
@Injectable()
export class TroopCommands {
  constructor(
    private readonly scope: DbScope,
    private readonly cityRules: CityRules,
  ) {}

  private async rows(query: ReturnType<typeof sql<Row>>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows;
  }

  private async one(query: ReturnType<typeof sql<Row>>): Promise<Row | false> {
    return (await this.rows(query))[0] ?? false;
  }

  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = await this.one(query);
    return row === false ? false : Object.values(row)[0];
  }

  // ─────────────────────── 鸿胪寺 driving permissions ───────────────────────

  /** TroopFunc.php::allowUnionTroop: toggle 允许盟友驻军. */
  @DialogCommand()
  async allowUnionTroop(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const allow = phpIntval(param[0]);
    await sql`insert into sys_allow_union_troop (uid, \`allow\`) values (${ctx.uid}, ${allow})
      on duplicate key update \`allow\` = ${allow}`.execute(this.scope.db);
    return [await this.allowFlag(ctx.uid, 'allow')];
  }

  /** TroopFunc.php::allowAntiPlunder: toggle 防止被掠夺. */
  @DialogCommand()
  async allowAntiPlunder(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const allow = phpIntval(param[0]);
    await sql`insert into sys_allow_union_troop (uid, anti_plunder) values (${ctx.uid}, ${allow})
      on duplicate key update anti_plunder = ${allow}`.execute(this.scope.db);
    return [await this.allowFlag(ctx.uid, 'anti_plunder')];
  }

  /** TroopFunc.php::allowAntiInvade: toggle 防止被占领. */
  @DialogCommand()
  async allowAntiInvade(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const allow = phpIntval(param[0]);
    await sql`insert into sys_allow_union_troop (uid, anti_invade) values (${ctx.uid}, ${allow})
      on duplicate key update anti_invade = ${allow}`.execute(this.scope.db);
    return [await this.allowFlag(ctx.uid, 'anti_invade')];
  }

  /**
   * CityFunc.php::getAllowAutoDiscard — the 自动遣散 flag lives in its OWN table
   * (`sys_allow_auto_discard`), not a column of `sys_allow_union_troop`. When a player has no row
   * yet the legacy reader seeds one with `allow = 1` and returns 1, so a fresh player defaults to
   * auto-discard ON; mirror both the read and the seeding insert.
   */
  private async autoDiscardFlag(uid: number): Promise<unknown> {
    const row = await this.one(sql<Row>`select * from sys_allow_auto_discard where uid = ${uid}`);
    if (row === false) {
      await sql`insert into sys_allow_auto_discard (allow, uid) values (1, ${uid})`.execute(
        this.scope.db,
      );
      return 1;
    }
    return row.allow;
  }

  /**
   * UnionFunc.php::getAllow* readers. `allow` (允许盟友驻军) defaults to 0 when the row is missing;
   * `anti_plunder` (防掠夺) and `anti_invade` (防占领) both default to 1 — a player with no row is
   * protected by default. `sql_fetch_one_cell` returns false only when NO row exists, so an
   * existing row's stored 0 is kept as-is; `phpEmpty` would wrongly fold a stored 0 into the
   * default, so the missing-row test is on the row, not the value.
   */
  private async allowFlag(
    uid: number,
    column: 'allow' | 'anti_plunder' | 'anti_invade',
  ): Promise<unknown> {
    const v = await this.cell(
      sql<Row>`select ${sql.ref(column)} from sys_allow_union_troop where uid = ${uid}`,
    );
    if (v !== false && v !== undefined) return v;
    return column === 'allow' ? 0 : 1;
  }

  // ─────────────────────────── kick / recall ───────────────────────────

  /** TroopFunc.php::kickTroop: send a stationed union troop (task 1, state 4) home. */
  @GlobalCommand()
  async kickTroop(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const troopid = phpIntval(param[0]);
    const troop = await this.one(
      sql<Row>`select * from sys_troops where id = ${troopid} and task = 1 and state = 4`,
    );
    if (!troop) throw GameError.lang('kickUnionTroop.army_not_exist');
    await sql`update sys_troops set \`state\` = 1, endtime = pathtime + unix_timestamp()
      where id = ${troopid}`.execute(this.scope.db);
    await this.cityRules.updateCityResourceAdd(phpIntval(troop.targetcid));
    return [];
  }

  /** TroopFunc.php::callBackTroop: recall a troop, matching the per-state behaviour exactly. */
  @GlobalCommand()
  async callBackTroop(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const db = this.scope.db;
    const troopid = phpIntval(param[0]);
    if (await this.one(sql<Row>`select * from sys_gather where troopid = ${troopid}`)) {
      throw GameError.lang('callBackTroop.gather');
    }
    const troop = await this.one(
      sql<Row>`select * from sys_troops where id = ${troopid} and uid = ${ctx.uid}`,
    );
    if (!troop) throw GameError.lang('callBackTroop.invalid_army');

    const state = phpIntval(troop.state);
    if (state === 0 && phpNum(troop.noback) > 0) throw GameError.lang('callBackTroop.on_back');

    if (state === 0) {
      // 前进中返回：剩余时间＝已走时间（endtime 回退已过去的那一段）。
      await sql`update sys_troops set \`state\` = 1,
          endtime = unix_timestamp() - starttime + unix_timestamp(), starttime = unix_timestamp()
        where id = ${troop.id}`.execute(db);
    } else if (state === 4 || state === 2) {
      // 驻军或等待战斗，召回按整段路程时间。
      await sql`update sys_troops set \`state\` = 1, endtime = pathtime + unix_timestamp(),
          starttime = unix_timestamp() where id = ${troop.id}`.execute(db);
      await this.cityRules.updateCityResourceAdd(phpIntval(troop.cid));
      await this.cityRules.updateCityResourceAdd(phpIntval(troop.targetcid));
      if (phpNum(troop.hid) > 0) {
        await sql`update sys_city_hero set state = 2 where hid = ${troop.hid}`.execute(db);
      }
    } else if (state === 3) {
      throw GameError.lang('callBackTroop.army_in_battle');
    } else if (state === 1) {
      throw GameError.lang('callBackTroop.army_on_way_back');
    }
    return [];
  }

  // ─────────────────────────── troop lists ───────────────────────────

  /**
   * TroopFunc.php::getArmyTroops: the player's own marching troops (state < 4). The cross-server /
   * 沙场 / 洛阳 merges are out of single-player scope. `task 7/8/9` battlefield rows keep their
   * original shape but their battle-city name lookups return nothing here.
   */
  @GlobalCommand()
  async getArmyTroops(ctx: CommandContext): Promise<unknown[]> {
    const { uid } = ctx;
    await sql`update sys_alarm set troops = 0 where uid = ${uid}`.execute(this.scope.db);
    const troops = await this.rows(sql<Row>`select t.*, c.name as fromcity
      from sys_troops t left join sys_city c on c.cid = t.cid
      where t.uid = ${uid} and t.state < 4`);
    for (const troop of troops) {
      troop.resource = '';
      troop.soldier = '';
      const task = phpIntval(troop.task);
      if (task === 7) {
        troop.targetcity = await this.cell(sql<Row>`select name from cfg_battle_city
          where bid = ${troop.bid} and xy = ${phpIntval(troop.targetcid) % 1000}`);
      } else if (task === 8 || task === 9) {
        troop.targetcity = await this.cell(
          sql<Row>`select name from sys_battle_city where cid = ${troop.targetcid}`,
        );
        troop.fromcity = await this.cell(
          sql<Row>`select name from sys_battle_city where cid = ${troop.cid}`,
        );
      } else {
        troop.wtype = await this.cell(
          sql<Row>`select type from mem_world where wid = ${cid2wid(phpIntval(troop.targetcid))}`,
        );
        if (phpNum(troop.wtype) === 0) {
          troop.targetcity = await this.cell(
            sql<Row>`select name from sys_city where cid = ${troop.targetcid}`,
          );
        }
      }
      troop.userid = troop.uid;
      troop.inBattleNet = 0;
    }
    return troops;
  }

  /**
   * TroopFunc.php::getEnemyTroops: enemy troops bound for the player's cities (task 2/3/4) and
   * their owned fields, filtered by 烽火台 level and 敌军过滤. 烽火台 ≥ 4 reveals the enemy name,
   * ≥ 5 the origin city.
   */
  @GlobalCommand()
  async getEnemyTroops(ctx: CommandContext): Promise<unknown[]> {
    const db = this.scope.db;
    const { uid } = ctx;
    await sql`update sys_alarm set enemy = 0 where uid = ${uid}`.execute(db);
    const troops1 = await this.rows(sql<Row>`select t.*, t.targetcid as targetownercid,
        c.name as targetcity
      from sys_troops t, sys_city c
      where t.targetcid = c.cid and c.uid = ${uid} and t.uid <> ${uid}
        and t.state < 4 and t.task in (2, 3, 4)`);

    const fieldCids = await this.ownedFieldCids(uid);
    let troops2: Row[] = [];
    if (fieldCids.length) {
      troops2 = await this.rows(sql<Row>`select * from sys_troops
        where uid <> ${uid} and state < 4 and task in (2, 3, 4)
          and targetcid in (${sql.join(fieldCids)})`);
      for (const troop of troops2) {
        const world = await this.one(sql<Row>`select type, ownercid from mem_world
          where wid = ${cid2wid(phpIntval(troop.targetcid))}`);
        troop.wtype = world ? world.type : undefined;
        troop.targetownercid = world ? world.ownercid : undefined;
      }
    }

    // 烽火台 ≥ 5 的城池按 sys_enemy_troop_filter 过滤小股部队（低于设定兵量不显示）。
    const filters = new Map<number, Map<number, number> | false>();
    const kept: Row[] = [];
    for (const troop of troops1) {
      const cid = phpIntval(troop.targetcid);
      if (!filters.has(cid)) {
        const level = phpNum(
          await this.cell(sql<Row>`select level from sys_building
            where cid = ${cid} and bid = ${ID_BUILDING_BALEFIRE} limit 1`),
        );
        if (level < 5) filters.set(cid, false);
        else {
          const rows = await this.rows(sql<Row>`select action, \`count\`
            from sys_enemy_troop_filter where cid = ${cid}`);
          const map = new Map<number, number>();
          for (const r of rows) map.set(phpIntval(r.action), phpNum(r.count));
          filters.set(cid, map);
        }
      }
      const filter = filters.get(cid);
      const task = phpIntval(troop.task);
      if (filter && filter.get(task)) {
        if ((filter.get(task) as number) > this.soldierCount(phpString(troop.soldiers))) continue;
      }
      kept.push(troop);
    }

    const troops = [...kept, ...troops2];
    for (const troop of troops) {
      troop.userid = troop.uid;
      troop.resource = '';
      troop.soldier = '';
      const viewLevel = phpNum(
        await this.cell(sql<Row>`select level from sys_building
          where cid = ${troop.targetownercid} and bid = ${ID_BUILDING_BALEFIRE} limit 1`),
      );
      troop.viewLevel = viewLevel;
      if (viewLevel >= 4) {
        troop.enemyuser = await this.cell(
          sql<Row>`select name from sys_user where uid = ${troop.uid}`,
        );
      }
      if (viewLevel >= 5) {
        troop.origincity = await this.cell(
          sql<Row>`select name from sys_city where cid = ${troop.cid}`,
        );
      }
    }
    return troops;
  }

  /**
   * TroopFunc.php::getStayTroops: the player's stationed troops (state 4), with gathering ones
   * flagged state 5. The 战场 (task 7/8/9) name lookups return nothing in single player.
   */
  @GlobalCommand()
  async getStayTroops(ctx: CommandContext): Promise<unknown[]> {
    const { uid } = ctx;
    const ret: unknown[] = [await this.autoDiscardFlag(uid)];
    const troops = await this.rows(sql<Row>`select t.*, c.name as origincity, g.starttime
      from sys_troops t left join sys_city c on c.cid = t.cid
        left join sys_gather g on g.troopid = t.id
      where t.uid = ${uid} and t.state = 4`);
    for (const troop of troops) {
      troop.userid = troop.uid;
      troop.resource = '';
      troop.soldier = '';
      troop.wtype = await this.cell(
        sql<Row>`select type from mem_world where wid = ${cid2wid(phpIntval(troop.targetcid))}`,
      );
      if (phpNum(troop.wtype) === 0) {
        troop.targetcity = await this.cell(
          sql<Row>`select name from sys_city where cid = ${troop.targetcid}`,
        );
      }
      const task = phpIntval(troop.task);
      if (task === 7 || task === 8 || task === 9) {
        troop.targetcity = await this.cell(
          sql<Row>`select name from sys_battle_city where cid = ${troop.targetcid}`,
        );
        troop.origincity = await this.cell(
          sql<Row>`select name from sys_city where cid = ${troop.startcid}`,
        );
        troop.cid = troop.startcid;
      }
      if (!phpEmpty(troop.starttime)) {
        troop.state = 5;
        troop.endtime = await this.cell(
          sql<Row>`select starttime from sys_gather where troopid = ${troop.id}`,
        );
      }
    }
    ret.push(troops);
    return ret;
  }

  /**
   * TroopFunc.php::getUnionTroops: union (and own) troops bound for the player's cities / fields
   * on a transport or dispatch task (task 0/1).
   */
  @GlobalCommand()
  async getUnionTroops(ctx: CommandContext): Promise<unknown[]> {
    const { uid } = ctx;
    const troops1 = await this.rows(sql<Row>`select t.*, c.name as targetcity
      from sys_troops t, sys_city c
      where t.targetcid = c.cid and c.uid = ${uid} and t.uid <> ${uid}
        and (t.task = 0 or t.task = 1)`);

    const fieldCids = await this.ownedFieldCids(uid);
    let troops2: Row[] = [];
    if (fieldCids.length) {
      troops2 = await this.rows(sql<Row>`select * from sys_troops
        where uid <> ${uid} and (task = 0 or task = 1) and targetcid in (${sql.join(fieldCids)})`);
      for (const troop of troops2) {
        troop.wtype = await this.cell(
          sql<Row>`select type from mem_world where wid = ${cid2wid(phpIntval(troop.targetcid))}`,
        );
      }
    }

    const troops = [...troops1, ...troops2];
    for (const troop of troops) {
      troop.userid = troop.uid;
      troop.resource = '';
      troop.soldier = '';
      troop.fromcity = await this.cell(
        sql<Row>`select name from sys_city where cid = ${troop.cid}`,
      );
      troop.username = await this.cell(
        sql<Row>`select name from sys_user where uid = ${troop.uid}`,
      );
    }
    return troops;
  }

  /**
   * TroopFunc.php::getTroopDetail: one troop's detail, with 烽火台-level gating of the owner,
   * hero, technic info when the viewer is not the troop's owner and it is attacking.
   */
  @GlobalCommand()
  async getTroopDetail(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const troopid = phpIntval(param[0]);
    const hid = phpIntval(param[1]);
    const info: Row = {};
    const troop = await this.one(
      sql<Row>`select * from sys_troops where id = ${troopid} and hid = ${hid}`,
    );
    if (!troop) throw GameError.lang('callBackTroop.invalid_army');
    info.troop = troop;

    const owner = await this.one(
      sql<Row>`select name, union_id from sys_user where uid = ${troop.uid}`,
    );
    info.troopowner = owner ? owner.name : undefined;
    if (owner && phpNum(owner.union_id) > 0) {
      info.troopunion = await this.cell(
        sql<Row>`select name from sys_union where id = ${owner.union_id}`,
      );
    }
    info.viewLevel = 10;

    const task = phpIntval(troop.task);
    if (phpIntval(troop.uid) !== ctx.uid && (task === 2 || task === 3 || task === 4)) {
      const mycid = await this.cell(
        sql<Row>`select ownercid from mem_world where wid = ${cid2wid(phpIntval(troop.targetcid))}`,
      );
      const viewLevel = phpNum(
        await this.cell(sql<Row>`select level from sys_building
          where cid = ${mycid} and bid = ${ID_BUILDING_BALEFIRE} limit 1`),
      );
      info.viewLevel = viewLevel;
      info.troopowner = viewLevel >= 4 ? (owner ? owner.name : undefined) : null;
      if (viewLevel >= 9) {
        if (phpNum(troop.hid) > 0) {
          info.hero = await this.one(sql<Row>`select name, level, npcid
            from sys_city_hero where hid = ${troop.hid}`);
        }
      } else {
        info.troopunion = null;
      }
      if (viewLevel >= 10) {
        info.technic = await this.rows(sql<Row>`select tid, level from sys_city_technic
          where cid = ${troop.cid} and tid in (6,7,8,9,10,11,12,13,14,16,20)`);
      }
    } else if (phpNum(troop.hid) > 0) {
      info.hero = await this.one(
        sql<Row>`select name, level, npcid from sys_city_hero where hid = ${troop.hid}`,
      );
    }

    const buffers = await this.rows(
      sql<Row>`select buftype, bufparam from mem_troops_buffer where troopid = ${troopid}`,
    );
    if (buffers.length) info.buffers = buffers;
    return [info];
  }

  // ─────────────────────────── helpers ───────────────────────────

  /** `group_concat`-equivalent list of the owning cids' field cids (type > 0), for the IN clauses. */
  private async ownedFieldCids(uid: number): Promise<number[]> {
    const cids = (await this.rows(sql<Row>`select cid from sys_city where uid = ${uid}`)).map((r) =>
      phpIntval(r.cid),
    );
    if (!cids.length) return [];
    const fields = await this.rows(sql<Row>`select wid from mem_world
      where ownercid in (${sql.join(cids)}) and type > 0`);
    return fields.map((f) => wid2cid(phpIntval(f.wid)));
  }

  /** TroopFunc.php::getSoldierCount: total soldiers in a `count,sid,n,...` string. */
  private soldierCount(soldiers: string): number {
    const parts = soldiers.split(',');
    const num = phpIntval(parts.shift());
    let count = 0;
    for (let i = 0; i < num; i++) {
      parts.shift(); // sid
      count += phpNum(parts.shift());
    }
    return count;
  }
}
