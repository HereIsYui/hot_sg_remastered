import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GameState, GameStateService } from '../core/game-state.service';
import { HeroRules } from '../core/hero-rules.service';
import { phpEmpty, phpFloatString, phpNum, phpString } from '../core/php';
import { phpDate, phpTime } from '../core/php-time';
import { RandomService } from '../core/random.service';
import { ReportService, ReportTitle } from '../core/report.service';
import { DbScope } from '../db/database.module';
import { RankRebuild } from '../rank/rank-rebuild.service';
import { RankRewards } from '../rank/rank-rewards.service';
import type { TickClock } from '../tick/tick.service';
import { TickHandler, TickOrder } from '../tick/tick.decorator';

type Row = Record<string, unknown>;

/** mem_user_buffer type of 招安: the player's cities are spared the food shortage. */
const AMNESTY_BUFFER = 20;
/** Hero state of a captive held by another player. */
const HERO_CAPTIVE = 5;
/** Lang `curse.resource` index per over-full stock, then the riot of a city below 35 morale. */
const STOCKS = ['gold', 'food', 'wood', 'rock', 'iron', 'people'] as const;
const RIOT = 6;

type Stock = (typeof STOCKS)[number];

/**
 * ReportCron.php::UpdateUsersCurse (天灾人祸): on the hour it rebuilds the rankings, punishes
 * starving, broke, over-full and unhappy cities, lets disloyal heroes desert and, at 16:00
 * (hour 8 of the server clock), pays the opening-event and weekly battlefield rewards.
 */
@Injectable()
export class CurseTick {
  /** The hour (unix time / 3600) of the last run, besides mem_state 10 which survives restarts. */
  private lastHour = -1;

  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly state: GameStateService,
    private readonly cityRules: CityRules,
    private readonly heroes: HeroRules,
    private readonly reports: ReportService,
    private readonly random: RandomService,
    private readonly rank: RankRebuild,
    private readonly rewards: RankRewards,
  ) {}

  @TickHandler(TickOrder.Curse)
  async updateUsersCurse(clock?: TickClock): Promise<void> {
    const now = phpTime();
    if (!clock) {
      if (!(await this.dueThisHour(now))) return;
      clock = { hour: Number(phpDate('G', now)), weekday: Number(phpDate('w', now)) };
    }
    this.lastHour = Math.floor(now / 3600);
    await this.rank.handleUsersRank();

    const db = this.scope.db;
    const cities = (
      await sql<Row>`select r.*, c.name, c.uid from mem_city_resource r, sys_city c
        where r.cid = c.cid and c.uid > 1000 and c.state < 3 and r.vacation = 0
          and (r.food <= 0 or r.gold <= 0 or r.rock > r.rock_max or r.iron > r.iron_max
            or r.food > r.food_max or r.wood > r.wood_max or r.people > r.people_max
            or r.gold > r.gold_max or r.morale < 40)`.execute(db)
    ).rows;
    const amnesty = new Set(
      (
        await sql<{ cid: unknown }>`select c.cid from sys_city c, mem_user_buffer b
          where b.buftype = ${AMNESTY_BUFFER} and b.uid = c.uid`.execute(db)
      ).rows.map((r) => phpNum(r.cid)),
    );
    const recalled: unknown[] = [];
    for (const city of cities) {
      await this.scope.transaction(() => this.punishCity(city, amnesty, recalled));
    }
    if (recalled.length > 0) {
      await this.scope.transaction(async () => {
        await sql`delete from sys_gather where troopid in (${sql.join(recalled)})`.execute(
          this.scope.db,
        );
        await sql`update sys_troops set state = 1, starttime = unix_timestamp(),
            endtime = unix_timestamp() + pathtime
          where id in (${sql.join(recalled)})`.execute(this.scope.db);
      });
    }
    await this.updateHeroRun();
    if (clock.hour === 8) await this.rewards.checkUserAct();
    if (clock.weekday === 6 && clock.hour === 8) await this.rewards.getUserBattleKing();
  }

  /**
   * The original ran during the first 15 seconds of every hour and, with a 3-second tick, up to
   * five times in a row (five times the losses and rewards); this runs once per hour.
   */
  private async dueThisHour(now: number): Promise<boolean> {
    if (phpDate('i', now) !== '00') return false;
    const hour = Math.floor(now / 3600);
    if (this.lastHour === hour) return false;
    const rebuilt = phpNum(await this.state.value(GameState.RankUpdated));
    return Math.floor(rebuilt / 3600) !== hour;
  }

  private async punishCity(city: Row, amnesty: Set<number>, recalled: unknown[]): Promise<void> {
    const db = this.scope.db;
    const cid = phpNum(city.cid);
    const uid = phpNum(city.uid);
    const cityname = `${phpString(city.name)}（${cid % 1000},${Math.floor(cid / 1000)}）`;
    const report = (content: string) =>
      this.reports.sendReport(uid, ReportTitle.Curse, cid, cid, content);

    if (phpNum(city.food) <= 0 && !amnesty.has(cid)) {
      const troops = (
        await sql<{ id: unknown }>`select id from sys_troops
          where cid = ${cid} and state = 4 and uid = ${uid}`.execute(db)
      ).rows;
      if (troops.length > 0) {
        recalled.push(...troops.map((t) => t.id));
        await report(cityname + this.lang.t('curse.troops_back'));
      } else {
        await this.desertion(cid, cityname, report);
      }
    }
    if (phpNum(city.gold) <= 0) {
      await sql`update sys_city_hero set loyalty = loyalty - 1 where cid = ${cid}`.execute(db);
      await report(cityname + this.lang.t('curse.gold_less'));
    }

    const lines = this.lang.value<{ resource?: string[] }>('curse')?.resource ?? [];
    // Values PHP wrote back as it read them, or as its 14-digit float string once reduced.
    const next = {} as Record<Stock, string>;
    let moraleadd = 0;
    for (const [i, stock] of STOCKS.entries()) {
      const have = city[stock];
      next[stock] = phpString(have);
      if (phpNum(have) > phpNum(city[`${stock}_max`])) {
        moraleadd += 5;
        const lost = Math.round(phpNum(have) * 0.1);
        await report(cityname + phpString(lines[i]) + (lost ? phpFloatString(lost) : next[stock]));
        next[stock] = phpFloatString(phpNum(have) * 0.9);
      }
    }
    if (phpNum(city.morale) < 35) {
      const lost = Math.round(phpNum(next.people) * 0.1);
      await report(cityname + phpString(lines[RIOT]) + (lost ? phpFloatString(lost) : next.people));
      next.people = phpFloatString(phpNum(next.people) * 0.9);
    }
    if (moraleadd || !phpEmpty(next.people)) {
      // An SQL literal, as PHP interpolated it: round() of a string would round half to even.
      const people = sql.raw(String(phpNum(next.people)));
      await sql`update mem_city_resource set morale = greatest(0, morale - ${moraleadd}),
          morale_stable = greatest(0, least(100 - tax - complaint, 100)),
          wood = ${next.wood}, rock = ${next.rock}, iron = ${next.iron}, food = ${next.food},
          gold = ${next.gold}, people = round(${people})
        where cid = ${cid}`.execute(db);
    }
  }

  /**
   * A starving city with no troops away loses a fifth of each soldier type, four fifths of the
   * deserters turning into lamsters (逃兵). The original carried the lost counts over to the
   * next starving city (arrays never reset), taking soldiers it never had.
   */
  private async desertion(
    cid: number,
    cityname: string,
    report: (content: string) => Promise<void>,
  ): Promise<void> {
    const soldiers = (
      await sql<{ sid: unknown; count: unknown }>`select sid, count from sys_city_soldier
        where cid = ${cid} and count > 0`.execute(this.scope.db)
    ).rows;
    if (soldiers.length === 0) return;
    const names = this.lang.value<{ patrol_report_soldier?: Record<string, string> }>(
      'battle',
    )?.patrol_report_soldier;
    const lost = new Map<number, number>();
    const lamsters = new Map<number, number>();
    let lines = '';
    for (const s of soldiers) {
      const sid = phpNum(s.sid);
      const count = Math.round(phpNum(s.count) * 0.2);
      if (count <= 0) continue;
      lost.set(sid, count);
      lines += `${phpString(names?.[sid])}&nbsp;-&nbsp;${phpFloatString(count)}<br/>`;
      lamsters.set(sid, Math.round(count * 0.8));
    }
    if (lost.size === 0) return;
    await this.addCityLamsters(cid, lamsters, true);
    await this.cityRules.addCitySoldiers(cid, lost, false);
    await report(cityname + this.lang.t('curse.troops_lost') + lines);
    await this.cityRules.refreshFoodArmyUsers(cid);
  }

  /** ReportCron.php::addCityLamsters: never below zero. */
  private async addCityLamsters(
    cid: number,
    soldiers: Map<number, number>,
    add: boolean,
  ): Promise<void> {
    if (soldiers.size === 0) return;
    const rows = [...soldiers].map(
      ([sid, count]) => sql`(${cid}, ${sid}, ${phpFloatString(count)})`,
    );
    const sign = sql.raw(add ? '+' : '-');
    await sql`insert into mem_city_lamster (cid, sid, count) values ${sql.join(rows)}
      on duplicate key update count = greatest(0, count ${sign} values(count))`.execute(
      this.scope.db,
    );
  }

  /**
   * ReportCron.php::updateherorun: heroes below 50 loyalty desert with chance (loyalty-1)/600,
   * captives (state 5) for sure unless taken within the last day; the others get a warning.
   * The original exempted players whose vacation had ended (`vacend <= now`) instead of those
   * still on vacation.
   */
  private async updateHeroRun(): Promise<void> {
    const db = this.scope.db;
    const fresh = new Set(
      (
        await sql<{ hid: unknown }>`select hid from sys_hero_captive
          where captivetime >= unix_timestamp() - 86400`.execute(db)
      ).rows.map((r) => phpNum(r.hid)),
    );
    const heroes = (
      await sql<Row>`select * from sys_city_hero where loyalty < 50 and uid > 1000
        and not exists (select * from sys_user_state
          where vacend > unix_timestamp() and uid = sys_city_hero.uid)`.execute(db)
    ).rows;
    const deserted: unknown[] = [];
    for (const hero of heroes) {
      await this.scope.transaction(async () => {
        const hid = phpNum(hero.hid);
        const loyalty = phpNum(hero.loyalty);
        const lost =
          phpNum(hero.state) === HERO_CAPTIVE
            ? !fresh.has(hid)
            : this.random.mtRand(1, 600) < loyalty;
        const n = (column: string) => phpNum(hero[column]);
        const addOn = (column: string) => (lost ? 0 : n(`${column}_add_on`));
        const cityname = await this.cityRules.getNamePosition(phpNum(hero.cid), 1);
        const content = this.lang.t(
          lost ? 'curse.hero_lost1' : 'curse.hero_lost',
          cityname,
          hero.name,
          hero.level,
          n('command_base') + n('level') + addOn('command'),
          n('affairs_base') + n('affairs_add') + addOn('affairs'),
          n('bravery_base') + n('bravery_add') + addOn('bravery'),
          n('wisdom_base') + n('wisdom_add') + addOn('wisdom'),
          hero.loyalty,
        );
        if (lost) {
          await this.heroes.throwUsersHeroField(hero);
          await this.heroes.updateCityHeroChange(hero.uid, hero.cid);
          deserted.push(hero.hid);
        }
        await this.reports.sendReport(
          phpNum(hero.uid),
          ReportTitle.Curse,
          phpNum(hero.cid),
          phpNum(hero.cid),
          content,
        );
      });
    }
    if (deserted.length > 0) {
      await sql`delete from sys_hero_captive where hid in (${sql.join(deserted)})`.execute(db);
    }
  }
}
