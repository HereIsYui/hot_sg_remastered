import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { ScoutService } from '../battle/scout';
import { LangService } from '../common/lang.service';
import { sprintf } from '../common/sprintf';
import { CityRules, cid2wid } from '../core/city-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { ReportService } from '../core/report.service';
import { DbScope } from '../db/database.module';
import { TickHandler, TickOrder } from '../tick/tick.decorator';

type Row = Record<string, unknown>;

/**
 * cfg_js.php::HandleTroop (TickOrder.Troop slot): settles troops whose `endtime` has passed in
 * state 0 (arrival) or 1 (return home).
 *
 * Ported here:
 *   - state 0, task 0 运输: deposit the carried resources into the target and turn the troop home.
 *   - state 0, task 1 派遣: arrive at an own city (hero takes a post, soldiers/resources join the
 *     city, row deleted) or at a union city / own-or-union field (merge into the stationed troop,
 *     state 4), with the arrival report.
 *   - state 1 返回: hero comes home, soldiers and resources return to the origin, row deleted.
 *   - state 0, task 2 侦察: delegated to `ScoutService` (apps/src/battle/scout.ts) — the scout
 *     battle (if a patrol is present), the intelligence report at every unlocked level, the troop
 *     turning home, and the target owner's alarm. Kept in the battle module so the parallel wave
 *     owning task 3/4/9 does not collide with it.
 *
 * NOT ported (battle wave): the arrival of a 掠夺/占领/攻击 troop (task 3/4/9) starts a battle
 * (battleAdd / defcityadd / mem_battle). That branch is isolated behind `battleArrivalNotPorted`,
 * which leaves the `sys_troops` row untouched so the next wave can drop the engine in without data
 * loss. 战场 tasks (7/8), and any battlefield-slot arrival (`battlefieldid != 0`), are routed to the
 * same holder.
 */
@Injectable()
export class TroopTick {
  private readonly logger = new Logger(TroopTick.name);

  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly cityRules: CityRules,
    private readonly heroes: HeroRules,
    private readonly report: ReportService,
    private readonly scout: ScoutService,
  ) {}

  @TickHandler(TickOrder.Troop)
  async handleTroop(): Promise<void> {
    const rows = await this.rows(sql<Row>`select * from sys_troops
      where endtime > 0 and endtime <= unix_timestamp() and state in (0, 1) order by endtime asc`);
    for (const row of rows) {
      // Each row is settled in its own transaction. The lesson from wave 1 does not apply here:
      // HandleTroop never throws a success message, so wrapping the writes is safe and keeps one
      // troop's failure from corrupting the batch.
      try {
        await this.scope.transaction(() => this.settle(row));
      } catch (err) {
        this.logger.error(
          `troop ${phpString(row.id)} settle failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
        );
      }
    }
  }

  private async settle(row: Row): Promise<void> {
    const db = this.scope.db;
    const uid = phpIntval(row.uid);
    const hid = phpIntval(row.hid);
    const cid = phpIntval(row.cid);
    const id = phpIntval(row.id);
    const targetcid = phpIntval(row.targetcid);
    const task = phpIntval(row.task);
    const state = phpIntval(row.state);
    const bid = phpIntval(row.battlefieldid);

    // A battlefield-slot arrival (battlefieldid != 0) and the 战场 tasks (7/8) need the battle
    // engine / 战场 flow; leave the row for the next wave. A scout (task 2) on the battlefield slot
    // also waits here — ScoutService only owns the ordinary (bid 0) scout arrival.
    if (bid !== 0 || task === 7 || task === 8) {
      this.battleArrivalNotPorted(row);
      return;
    }

    const field = await this.checkFieldOwner(targetcid);
    const type = this.battleType(field, task);
    const cityname = await this.cityRules.getNamePosition(cid, type);
    const targetcityname = await this.cityRules.getNamePosition(targetcid, type);
    const happencid = targetcid;

    const soldierArray = this.troop2array(phpString(row.soldiers));
    const inwar = await this.checkInwar(cid, targetcid, task);
    const resource = this.checkResource(phpString(row.resource));
    const hero = hid > 0 ? await this.contentHero(hid) : '';
    let content = this.reportTitle(cityname, targetcityname, task, state);

    // $result in the original: 1 => "军队进入<target>", 0 => "军队正在返回<origin>" (the troop
    // turned home). Defaults to 1; a 运输 (task 0) always turns home, and a 派遣 (task 1) turns
    // home only when the city has no free hero slot.
    let result = 1;

    if (state === 0) {
      if (!inwar.result) {
        // inwar blocks arrival: the troop turns back (the `else` of the original `if inwar.result`).
        await sql`update sys_troops set state = 1, starttime = unix_timestamp(),
          endtime = pathtime + unix_timestamp() where id = ${id}`.execute(db);
        await sql`update sys_troops set state = 0 where state = 2 and targetcid = ${targetcid}
          order by endtime asc limit 1`.execute(db);
        content += phpString(inwar.msg);
        content += `<br/>军队正在返回${cityname}。`;
        await this.finishReport(uid, task, state, cid, happencid, content);
        return;
      }

      switch (task) {
        case 0: {
          // 运输到达：资源入库，掉头返回。
          result = 0;
          if (resource) {
            await this.cityRules.addCityResources(
              targetcid,
              resource.wood,
              resource.rock,
              resource.iron,
              resource.food,
              resource.gold,
            );
          }
          await sql`update sys_troops set state = 1, starttime = unix_timestamp(),
            endtime = pathtime + unix_timestamp(), resource = 0 where id = ${id}`.execute(db);
          content += this.reportRow('5');
          content += sprintf(
            this.reportStr('troopback'),
            '运输军队',
            hero,
            this.reportSoldier(soldierArray),
          );
          if (resource) content += this.resourceLine('携带资源', resource);
          break;
        }
        case 1: {
          await this.handleDispatchArrival(row, {
            uid,
            hid,
            cid,
            id,
            targetcid,
            field,
            inwar,
            resource,
            soldierArray,
            hero,
          });
          // title_2row 6 (no free 将领 slot, turned home) vs 4 (arrived); turn-back sets result 0.
          content += this.reportRow(this.lastDispatchTurnedBack ? '6' : '4');
          if (this.lastDispatchTurnedBack) result = 0;
          content += sprintf(
            this.reportStr('troopback'),
            '派遣到达',
            hero,
            this.reportSoldier(soldierArray),
          );
          content += this.lastDispatchOkMsg;
          break;
        }
        case 2: {
          // 侦察到达：侦察战斗(若有巡逻) + 情报报告 + 返回 + 警报。ScoutService 自行发报并返回，
          // 不走下面公共的"进入/返回"收尾（和 case 3/4/9 的 battle 到达一样 return）。
          await this.scout.settle(row, {
            uid,
            hid,
            cid,
            id,
            targetcid,
            task,
            state,
            field,
            type,
            cityname,
            targetcityname,
          });
          return;
        }
        case 3:
        case 4:
        case 9: {
          // 掠夺/占领/攻击 到达即开战 —— 战斗引擎尚未移植。
          this.battleArrivalNotPorted(row);
          return;
        }
        default: {
          // Unknown task: leave untouched rather than guess.
          this.battleArrivalNotPorted(row);
          return;
        }
      }

      content += this.reportStr('br');
      content += result ? `<br/>军队进入${targetcityname}。` : `<br/>军队正在返回${cityname}。`;
      // 军队吃粮刷新。
      if (uid > 1000) await this.cityRules.refreshFoodArmyUsers(cid);
      if (phpNum(field.uid) > 1000 && task === 0 && uid !== phpIntval(field.uid)) {
        await this.report.sendReport(phpIntval(field.uid), 1, cid, happencid, content);
        await this.cityRules.refreshFoodArmyUsers(phpIntval(field.ownercid));
      }
      await this.finishReport(uid, task, state, cid, happencid, content);
      return;
    }

    // ───────────────────── state 1: 返回 ─────────────────────
    if (hid > 0) await this.changeHero(uid, cid, hid, 0);
    await this.cityRules.addCitySoldiers(cid, soldierArray, true);
    content += sprintf(
      this.reportStr('troopback'),
      '军队返回',
      hero,
      this.reportSoldier(soldierArray),
    );
    if (resource) {
      await this.cityRules.addCityResources(
        cid,
        resource.wood,
        resource.rock,
        resource.iron,
        resource.food,
        resource.gold,
      );
      content += this.resourceLine('携带资源', resource);
    }
    await sql`delete from sys_troops where id = ${id}`.execute(db);
    await this.cityRules.refreshFoodArmyUsers(cid);
    content += this.reportStr('br');
    content += `<br/>军队进入${cityname}。`;
    await this.finishReport(uid, task, state, cid, happencid, content);
  }

  /** The `okmss` the last dispatch arrival produced (resource line appended to its report). */
  private lastDispatchOkMsg = '';

  /** Whether the last dispatch arrival turned home (no free 将领 slot) — drives `$result` / title. */
  private lastDispatchTurnedBack = false;

  /**
   * cfg_js.php HandleTroop state-0 task-1 body: arrival of a 派遣 troop. Mutates `sys_troops`,
   * `sys_city_hero`, `sys_city_soldier` and resources; the report text is built by the caller.
   */
  private async handleDispatchArrival(
    row: Row,
    a: {
      uid: number;
      hid: number;
      cid: number;
      id: number;
      targetcid: number;
      field: Row;
      inwar: InwarResult;
      resource: Resource | false;
      soldierArray: Map<number, number>;
      hero: string;
    },
  ): Promise<void> {
    const db = this.scope.db;
    const { uid, hid, cid, id, targetcid, field, inwar, resource } = a;
    this.lastDispatchOkMsg = '';
    this.lastDispatchTurnedBack = false;

    if (
      phpIntval(inwar.relation) === 0 &&
      phpIntval(field.type) === 0 &&
      uid === phpIntval(field.uid)
    ) {
      // 到达自己的城池。
      if (hid > 0) {
        if (await this.cityHasHeroPosition(uid, targetcid)) {
          await this.changeHero(uid, cid, hid, 0, uid, targetcid);
          await this.cityRules.addCitySoldiers(targetcid, a.soldierArray, true);
          if (resource) {
            await this.cityRules.addCityResources(
              targetcid,
              resource.wood,
              resource.rock,
              resource.iron,
              resource.food,
              resource.gold,
            );
            this.lastDispatchOkMsg = this.resourceLine('携带资源', resource);
          }
          await sql`delete from sys_troops where id = ${id}`.execute(db);
        } else {
          // 城里没有将领空位，掉头返回。
          this.lastDispatchTurnedBack = true;
          await sql`update sys_troops set state = 1, starttime = unix_timestamp(),
            endtime = pathtime + unix_timestamp() where id = ${id}`.execute(db);
        }
      } else {
        await this.cityRules.addCitySoldiers(targetcid, a.soldierArray, true);
        if (resource) {
          await this.cityRules.addCityResources(
            targetcid,
            resource.wood,
            resource.rock,
            resource.iron,
            resource.food,
            resource.gold,
          );
          this.lastDispatchOkMsg = this.resourceLine('携带资源', resource);
        }
        await sql`delete from sys_troops where id = ${id}`.execute(db);
      }
      return;
    }

    // 到达盟友城池或自己 / 盟友野地：尝试并入已驻军 (state 4)。
    let canin = false;
    let targetrow: Row | false = false;
    if (phpIntval(inwar.relation) === 0) {
      targetrow = await this.one(sql<Row>`select * from sys_troops
        where uid = ${uid} and cid = ${cid} and targetcid = ${targetcid} and state = 4
        order by hid desc limit 1`);
      canin = !!targetrow && !(phpNum(targetrow.hid) > 0 && hid > 0);
    }
    if (hid > 0) await sql`update sys_city_hero set state = 4 where hid = ${hid}`.execute(db);
    if (canin && targetrow) {
      const newsoldiers = this.addSoldier(phpString(row.soldiers), phpString(targetrow.soldiers));
      let mergedResource: string = phpString(targetrow.resource);
      if (resource) {
        mergedResource = this.addResource(resource, phpString(targetrow.resource));
        this.lastDispatchOkMsg = this.resourceLine('携带资源', resource);
      }
      await sql`update sys_troops set hid = GREATEST(${hid}, ${targetrow.hid}),
          soldiers = ${newsoldiers}, resource = ${mergedResource},
          people = ${phpNum(row.people)} + ${phpNum(targetrow.people)},
          fooduse = ${phpNum(row.fooduse)} + ${phpNum(targetrow.fooduse)}
        where id = ${targetrow.id}`.execute(db);
      await sql`delete from sys_troops where id = ${id}`.execute(db);
    } else {
      await sql`update sys_troops set state = 4 where id = ${id}`.execute(db);
    }
  }

  /**
   * The battle-starting arrival branch (task 3/4/9 in state 0) and battlefield tasks (7/8).
   * The battle engine (OLdBattleCron.php + battleInfo) is not ported yet, so this intentionally
   * does NOTHING to the troop row — the row stays due (`endtime` in the past) and will be settled
   * by the next wave once the engine exists. (Task 2 侦察 is now handled by `ScoutService`.)
   * Logged at debug so it is visible without spamming.
   */
  private battleArrivalNotPorted(row: Row): void {
    this.logger.debug(
      `troop ${phpString(row.id)} (task ${phpString(row.task)}, state ${phpString(row.state)}): battle not ported — row left in place`,
    );
  }

  // ─────────────────────────── helpers (UtilsExtend.php) ───────────────────────────

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

  /** UtilsExtend.php::troop2array: `count,sid,n,...` → map of sid→count (only positive counts). */
  private troop2array(soldiers: string): Map<number, number> {
    const out = new Map<number, number>();
    if (!soldiers || soldiers === '0') return out;
    const parts = soldiers.split(',');
    const num = phpIntval(parts.shift());
    for (let i = 0; i < num; i++) {
      const sid = phpIntval(parts.shift());
      const cnt = phpNum(parts.shift());
      if (cnt > 0) out.set(sid, cnt);
    }
    return out;
  }

  /** UtilsExtend.php::array2troop: map → `count,sid,n,...`, keys ascending (ksort). */
  private array2troop(soldiers: Map<number, number>): string {
    const keys = [...soldiers.keys()].sort((x, y) => x - y);
    const parts: (string | number)[] = [keys.length];
    for (const sid of keys) parts.push(sid, soldiers.get(sid)!);
    return parts.join(',');
  }

  /** UtilsExtend.php::add_soldier: merge two troop strings (summing shared sids). */
  private addSoldier(s1: string, s2: string): string {
    const a = this.troop2array(s1);
    const b = this.troop2array(s2);
    const merged = new Map<number, number>(a);
    for (const [sid, cnt] of b) merged.set(sid, (merged.get(sid) ?? 0) + cnt);
    return this.array2troop(merged);
  }

  /** UtilsExtend.php::addResource: add a parsed resource to a `g,f,w,r,i` string, element-wise. */
  private addResource(r1: Resource, r2: string): string {
    const b = r2.split(',').map(phpNum);
    const a = [r1.gold, r1.food, r1.wood, r1.rock, r1.iron];
    return a.map((v, i) => phpNum(v) + (b[i] ?? 0)).join(',');
  }

  /** UtilsExtend.php::check_resource: parse `g,f,w,r,i` unless it is the empty `0`/`0,0,0,0,0,`. */
  private checkResource(resource: string): Resource | false {
    if (resource === '0' || resource === '0,0,0,0,0,' || resource === '') return false;
    const parts = resource.split(',');
    return {
      gold: phpNum(parts[0]),
      food: phpNum(parts[1]),
      wood: phpNum(parts[2]),
      rock: phpNum(parts[3]),
      iron: phpNum(parts[4]),
    };
  }

  /** UtilsExtend.php::check_field_owner: the target field with its owning uid resolved. */
  private async checkFieldOwner(cid: number): Promise<Row> {
    const wid = cid2wid(cid);
    const field =
      (await this.one(sql<Row>`select * from mem_world where wid = ${wid}`)) || ({ wid } as Row);
    if (phpNum(field.ownercid) > 0) {
      field.uid = await this.cell(sql<Row>`select uid from sys_city where cid = ${field.ownercid}`);
    } else {
      const u = await this.cell(sql<Row>`select uid from sys_troops where cid = ${cid} limit 1`);
      field.uid = phpEmpty(u) ? 0 : u;
    }
    return field;
  }

  /** UtilsExtend.php::battleType: the battle kind for a field+task. */
  private battleType(field: Row, task: number): number {
    // Mirrors UtilsExtend.php::battleType. The subtlety: a WILD FIELD target (field.type > 0)
    // yields 0, while a CITY target (field.type == 0) yields a NON-zero type (1 for 攻击 task 4,
    // 4 for the 战场 tasks 7/8/9, else 2). getNamePosition then reads this inverted: type 0 is the
    // field's terrain name (cfg_world_type), non-zero is the sys_city name. So a transport/派遣 to
    // a city must pass type 2 to get the city's own name in the report — returning field.type (0)
    // produced "城池"/"平地" instead of "长乐宫".
    if (phpIntval(field.type) > 0) return 0;
    if (task === 4) return 1;
    if (task === 7 || task === 8 || task === 9) return 4;
    return 2;
  }

  /**
   * UtilsExtend.php::check_inwar: whether the arriving troop's path is blocked (`result` false) and
   * the friend/enemy `relation`. For the ported tasks (0 运输 / 1 派遣) the original only ever sets
   * `relation` (0 = self/union, 1 = other) and leaves `result` truthy, so arrivals proceed.
   */
  private async checkInwar(cid: number, targetcid: number, task: number): Promise<InwarResult> {
    const uid = phpNum(await this.cell(sql<Row>`select uid from sys_city where cid = ${cid}`));
    const targetwid = cid2wid(targetcid);
    const worldinfo =
      (await this.one(sql<Row>`select * from mem_world where wid = ${targetwid}`)) || ({} as Row);
    const targetCityInfo =
      (await this.one(sql<Row>`select * from sys_city where cid = ${worldinfo.ownercid}`)) ||
      ({} as Row);

    let targetIsUnion = false;
    let targetuid = 0;
    if (phpNum(worldinfo.ownercid) === phpNum(cid)) {
      targetIsUnion = true;
      targetuid = uid;
    } else if (phpIntval(worldinfo.type) === 0) {
      targetuid = phpIntval(targetCityInfo.uid);
    } else if (phpNum(worldinfo.ownercid) !== 0) {
      targetuid = phpIntval(targetCityInfo.uid);
    }

    const result: InwarResult = { relation: 1, result: true, msg: '' };
    if (!phpEmpty(targetuid)) {
      const myUser =
        (await this.one(sql<Row>`select * from sys_user where uid = ${uid}`)) || ({} as Row);
      const targetUser =
        (await this.one(sql<Row>`select * from sys_user where uid = ${targetuid}`)) || ({} as Row);
      const targetunion = targetUser.union_id;
      const myunion = myUser.union_id;
      if (uid === targetuid) {
        targetIsUnion = true;
        result.relation = 0;
      } else if (
        !phpEmpty(targetunion) &&
        phpNum(myunion) === phpNum(targetunion) &&
        phpNum(myunion) > 0
      ) {
        targetIsUnion = true;
        result.relation = 0;
      }
      if (phpIntval(worldinfo.type) === 0 && !targetIsUnion) {
        const unionRelation = await this.one(sql<Row>`select * from sys_union_relation
          where unionid = ${myunion} and target = ${targetunion}`);
        if (unionRelation && phpIntval(unionRelation.type) === 0 && task === 2) {
          result.msg = this.lang.t('StartTroop.cant_detect_friendly_union');
          result.relation = 0;
        }
      }
    }
    return result;
  }

  /** utils.php::cityHasHeroPosition: whether the city has a free hero slot (城守/主将/军师). */
  private async cityHasHeroPosition(uid: number, cid: number): Promise<boolean> {
    const city = await this.one(sql<Row>`select chiefhid, generalid, counsellorid
      from sys_city where uid = ${uid} and cid = ${cid}`);
    if (!city) return false;
    return (
      phpNum(city.chiefhid) === 0 || phpNum(city.generalid) === 0 || phpNum(city.counsellorid) === 0
    );
  }

  /** UtilsExtend.php::change_hero: move / restate a hero, with the city-hero-change refresh. */
  private async changeHero(
    uid: number,
    cid: number,
    hid: number,
    state: number,
    targetuid = 0,
    targetcid = 0,
  ): Promise<void> {
    const db = this.scope.db;
    const exists = await this.one(sql<Row>`select 1 as x from sys_city_hero
      where uid = ${uid} and cid = ${cid} and hid = ${hid}`);
    if (!exists || hid <= 0) return;
    const tUid = targetuid === 0 ? uid : targetuid;
    const tCid = targetcid === 0 ? cid : targetcid;
    if (cid !== tCid) {
      if (uid === tUid) {
        await sql`update sys_city_hero set cid = ${tCid}, state = ${state} where hid = ${hid}`.execute(
          db,
        );
      } else {
        await sql`update sys_city_hero set uid = ${tUid}, cid = ${tCid}, state = ${state} where hid = ${hid}`.execute(
          db,
        );
      }
      await this.heroes.updateCityHeroChange(uid, cid);
      await this.heroes.updateCityHeroChange(tUid, tCid);
    } else {
      await sql`update sys_city_hero set state = ${state} where hid = ${hid}`.execute(db);
    }
  }

  /** UtilsExtend.php::getContentHero: the HTML hero snippet for a report. */
  private async contentHero(hid: number): Promise<string> {
    if (hid <= 0) return this.reportStr('empty');
    const hero = await this.one(
      sql<Row>`select name, level, face, sex from sys_city_hero where hid = ${hid}`,
    );
    if (!hero) return this.reportStr('empty');
    const sex = phpNum(hero.sex) ? 'boy' : 'girl';
    return sprintf(
      this.reportStr('heroname'),
      `${sex}_${phpString(hero.face)}`,
      hero.name,
      hero.name,
      hero.level,
    );
  }

  /** UtilsExtend.php::getreportsoldier: the soldier list for a report. */
  private reportSoldier(soldiers: Map<number, number>): string {
    const names = this.lang.value<Record<string, unknown>>('battle')?.patrol_report_soldier as
      Record<string, unknown> | undefined;
    let msg = '';
    for (const [sid, cnt] of soldiers) {
      msg += sprintf(this.reportStr('b_count'), names?.[String(sid)] ?? '', cnt);
    }
    return msg;
  }

  /** `$GLOBALS['report']['resource']` line. */
  private resourceLine(label: string, r: Resource): string {
    return sprintf(this.reportStr('resource'), label, r.gold, r.food, r.wood, r.rock, r.iron);
  }

  /** `$GLOBALS['report'][key]`. */
  private reportStr(key: string): string {
    const v = this.lang.value<Record<string, unknown>>('report')?.[key];
    return typeof v === 'string' ? v : '';
  }

  /** `$GLOBALS['report']['title_2row'][n]`. */
  private reportRow(n: string): string {
    const rows = this.lang.value<Record<string, unknown>>('report')?.title_2row as
      Record<string, unknown> | undefined;
    const v = rows?.[n];
    return typeof v === 'string' ? v : '';
  }

  /** UtilsExtend.php::getreporttitle (me = 1). */
  private reportTitle(cityname: string, tarname: string, task: number, state: number): string {
    const report = this.lang.value<Record<string, unknown>>('report');
    const tasktype = (report?.type as Record<string, unknown> | undefined)?.[String(task)] ?? '';
    const statetype = state === 0 ? '已到达目标' : `已经返回${cityname}`;
    return sprintf(this.reportStr('title'), tarname, tasktype, statetype);
  }

  /** UtilsExtend.php::getReportTitleType + utils.php::sendReport for a settled troop. */
  private async finishReport(
    uid: number,
    task: number,
    state: number,
    cid: number,
    happencid: number,
    content: string,
  ): Promise<void> {
    await this.report.sendReport(uid, this.reportTitleType(task, state), cid, happencid, content);
  }

  /** UtilsExtend.php::getReportTitleType. */
  private reportTitleType(task: number, state: number): number {
    if (state === 0) {
      const map: Record<number, number> = { 0: 1, 1: 3, 2: 5, 3: 7, 4: 9, 7: 36, 8: 37, 9: 38 };
      return map[task] ?? 0;
    }
    // state 1 (返回).
    const map: Record<number, number> = { 0: 2, 1: 4, 2: 6, 3: 8, 4: 10, 7: 36, 8: 37, 9: 38 };
    return map[task] ?? 0;
  }
}

interface Resource {
  gold: number;
  food: number;
  wood: number;
  rock: number;
  iron: number;
}

interface InwarResult {
  relation: number;
  result: boolean;
  msg: string;
}
