import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { GameState } from '../core/game-state.service';
import { LORD_HERO_TYPE } from '../core/hero-rules.service';
import { phpString } from '../core/php';
import { DbScope } from '../db/database.module';

type Row = Record<string, unknown>;

/** The rankings rebuilt from scratch by TRUNCATE + insert, so `rank` restarts at 1. */
const TRUNCATED = {
  union: ['rank_union', 'sys_union_city'],
  hero: [
    'rank_hero',
    'rank_hero_affairs',
    'rank_hero_bravery',
    'rank_hero_wisdom',
    'rank_hero_command',
  ],
  military: ['rank_military', 'rank_military_defence'],
  battle: ['rank_battle_day', 'rank_battle_week'],
} as const;

/**
 * ReportCron.php::HandleUsersRank: rebuilds every ranking table and the login announcement.
 * TRUNCATE commits implicitly, so this must not run inside a transaction.
 */
@Injectable()
export class RankRebuild {
  constructor(private readonly scope: DbScope) {}

  async handleUsersRank(): Promise<void> {
    const db = this.scope.db;
    await sql`update mem_state set value = unix_timestamp()
      where state = ${GameState.RankUpdated}`.execute(db);
    await this.users();
    await this.truncate(TRUNCATED.union);
    await sql`insert into rank_union (uid, name, leader, member, prestige)
      select n.id, n.name, u.name, n.member, n.prestige from sys_union n, sys_user u
      where n.leader = u.uid order by n.prestige desc`.execute(db);
    await sql`update rank_union set famouscity = (select count(c.type) from sys_city c, sys_user u
      where c.type > 0 and rank_union.uid = u.union_id and u.uid = c.uid)`.execute(db);
    await sql`insert into sys_union_city (unionid, count)
      select uid, famouscity from rank_union where famouscity > 0 order by uid`.execute(db);
    await this.heroes();
    await sql`truncate table rank_user_level`.execute(db);
    await sql`insert into rank_user_level (uid, name, levelname, level, nobility, battle, prestige,
        hero_level)
      select u.uid, u.name, e.name, s.level, u.nobility, h.bravery_add * 10, u.prestige, h.level
      from rank_user u, cfg_user_level e, sys_city_hero h, sys_user_level s
      where s.level = e.level and u.uid = s.uid and h.uid = s.uid
        and h.herotype = ${LORD_HERO_TYPE} order by s.level desc`.execute(db);
    await this.military();
    await this.battle();
    await this.announce();
  }

  /** 玩家排名: also stores each player's place in sys_user.rank (unranked players come last). */
  private async users(): Promise<void> {
    const db = this.scope.db;
    await sql`delete from rank_user`.execute(db);
    const users = await this.rows(sql`select uid, name, nobility, prestige from sys_user
      where uid > 1000 and prestige > 5 and state <> 3
      order by nobility desc, prestige desc`);
    let i = 1;
    for (const u of users) {
      const nobility = await this.cell(sql`select name from cfg_nobility where id = ${u.nobility}`);
      await sql`insert into rank_user (\`rank\`, uid, name, nobility, prestige)
        values (${i}, ${u.uid}, ${u.name}, ${nobility}, ${u.prestige})`.execute(db);
      await sql`update sys_user set \`rank\` = ${i} where uid = ${u.uid}`.execute(db);
      i++;
    }
    await sql`update rank_user set rank_user.union = (select n.name from sys_union n, sys_user u
      where n.id = u.union_id and u.uid = rank_user.uid)`.execute(db);
    await sql`update rank_user set city = (select count(uid) from sys_city
      where uid = rank_user.uid)`.execute(db);
    await sql`update rank_user set people = (select sum(r.people)
      from mem_city_resource r, sys_city c where r.cid = c.cid and c.uid = rank_user.uid)`.execute(
      db,
    );
    await sql`update sys_user set \`rank\` = ${i} where \`rank\` = 0 and uid > 1000`.execute(db);
  }

  /** 将领: heroes above level 10, then the same list re-sorted per attribute. */
  private async heroes(): Promise<void> {
    const db = this.scope.db;
    await this.truncate(TRUNCATED.hero);
    await sql`insert into rank_hero (hid, name, user, level, command, affairs, bravery, wisdom)
      select hid, name, uid, level, command_base + command_add_on + level,
        affairs_base + affairs_add + affairs_add_on, bravery_base + bravery_add + bravery_add_on,
        wisdom_base + wisdom_add + wisdom_add_on
      from sys_city_hero where (npcid > 0 or (npcid = 0 and uid > 1000)) and level > 10
      order by level desc, command_base + command_add_on desc`.execute(db);
    await sql`update rank_hero set user = (select name from sys_user
      where uid = rank_hero.user)`.execute(db);
    for (const [table, column] of [
      ['rank_hero_bravery', 'bravery'],
      ['rank_hero_wisdom', 'wisdom'],
      ['rank_hero_affairs', 'affairs'],
      ['rank_hero_command', 'command'],
    ] as const) {
      await sql`insert into ${sql.table(table)}
          (hid, name, user, level, affairs, bravery, wisdom, command)
        select hid, name, user, level, affairs, bravery, wisdom, command from rank_hero
        order by ${sql.ref(column)} desc`.execute(db);
    }
  }

  /** 军事: attack prestige order, then re-sorted by army size and by defence prestige. */
  private async military(): Promise<void> {
    const db = this.scope.db;
    await sql`delete from rank_military_attack`.execute(db);
    await this.truncate(TRUNCATED.military);
    const users = await this.rows(sql`select uid, name, war_attack_prestige,
        war_defence_prestige, union_id from sys_user
      where uid > 1000 and \`rank\` > 0 and state in (0, 1, 2, 4)
      order by war_attack_prestige desc, nobility desc`);
    let i = 1;
    for (const u of users) {
      const union = await this.cell(sql`select name from sys_union where id = ${u.union_id}`);
      const army = await this.cell(sql`select sum(c.people_need * s.count)
        from sys_city_soldier s, cfg_soldier c, sys_city t
        where s.cid = t.cid and s.sid = c.sid and t.uid = ${u.uid}`);
      await sql`insert into rank_military_attack (\`rank\`, name, unionname, attack, defence, army,
          uid)
        values (${i}, ${u.name}, ${union}, ${u.war_attack_prestige}, ${u.war_defence_prestige},
          ${army}, ${u.uid})`.execute(db);
      i++;
    }
    await sql`insert into rank_military (name, unionname, attack, defence, army, uid)
      select name, unionname, attack, defence, army, uid from rank_military_attack
      order by army desc`.execute(db);
    await sql`insert into rank_military_defence (name, unionname, attack, defence, army, uid)
      select name, unionname, attack, defence, army, uid from rank_military_attack
      order by defence desc`.execute(db);
  }

  /** 战场: total honour, with the last day's and week's honour, re-sorted by each. */
  private async battle(): Promise<void> {
    const db = this.scope.db;
    await sql`delete from rank_battle_total`.execute(db);
    await this.truncate(TRUNCATED.battle);
    const users = await this.rows(sql`select uid, name, honour, union_id from sys_user
      where honour > 0 order by honour desc`);
    let i = 1;
    for (const u of users) {
      const union = await this.cell(sql`select name from sys_union where id = ${u.union_id}`);
      const day = await this.cell(sql`select sum(honour) from log_battle_honour
        where finishtime > (unix_timestamp() - 86400) and uid = ${u.uid}`);
      const week = await this.cell(sql`select sum(honour) from log_battle_honour
        where finishtime > (unix_timestamp() - 604800) and uid = ${u.uid}`);
      await sql`insert into rank_battle_total (\`rank\`, uid, unionname, name, total, day, week)
        values (${i}, ${u.uid}, ${union}, ${u.name}, ${u.honour}, ${day}, ${week})`.execute(db);
      i++;
    }
    for (const [table, column] of [
      ['rank_battle_day', 'day'],
      ['rank_battle_week', 'week'],
    ] as const) {
      await sql`insert into ${sql.table(table)} (uid, name, unionname, total, day, week)
        select uid, name, unionname, total, day, week from rank_battle_total
        order by ${sql.ref(column)} desc`.execute(db);
    }
  }

  /** sys_login_announce: the top player, their office, nobility and the top attacker / defender. */
  private async announce(): Promise<void> {
    const db = this.scope.db;
    await sql`delete from sys_login_announce`.execute(db);
    const top = (await this.rows(sql`select * from rank_user where \`rank\` = 1`))[0];
    const maxpos = await this.cell(sql`select p.name from cfg_office_pos p, sys_user u
      where u.uid = ${phpString(top?.uid)} and u.officepos = p.id`);
    const maxnob = await this.cell(sql`select nobility from rank_user where \`rank\` = 1`);
    const maxattack = await this.cell(sql`select name from rank_military_attack
      where \`rank\` = 1 and attack > 0`);
    const maxdefence = await this.cell(sql`select name from rank_military_defence
      where \`rank\` = 1 and defence > 0`);
    await sql`insert into sys_login_announce (maxname, maxpos, maxnob, maxattack, maxdefence, id)
      values (${phpString(top?.name)}, ${maxpos}, ${maxnob}, ${maxattack}, ${maxdefence}, 1)`.execute(
      db,
    );
  }

  private async truncate(tables: readonly string[]): Promise<void> {
    for (const t of tables) await sql`truncate table ${sql.table(t)}`.execute(this.scope.db);
  }

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.scope.db)).rows as Row[];
  }

  /** `sql_fetch_one_cell` as PHP interpolated it into the next statement: '' when missing. */
  private async cell(query: RawBuilder<unknown>): Promise<string> {
    const first = (await this.rows(query))[0];
    return phpString(first ? Object.values(first)[0] : undefined);
  }
}
