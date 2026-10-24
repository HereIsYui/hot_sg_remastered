import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { LangService } from '../common/lang.service';
import { sprintf } from '../common/sprintf';
import { CityRules } from '../core/city-rules.service';
import { phpEmpty, phpIntval, phpNum, phpString } from '../core/php';
import { RandomService } from '../core/random.service';
import { ReportService } from '../core/report.service';
import { TaskRules } from '../core/task-rules.service';
import { DbScope } from '../db/database.module';
import { countDescIndex } from './battle-math';
import { checkSodier, type CheckSodierDeps } from './check-sodier';

type Row = Record<string, unknown>;

/**
 * cfg_js.php::HandleTroop, the task-2 (侦察 / scout) state-0 arrival branch, lifted into its own
 * service so it can be dropped into `TroopTick.settle` without colliding with the parallel wave
 * that owns task 3/4/9.
 *
 * What the legacy `case 2:` does, arrival of a scout troop:
 *
 *  1. `$result=0` — a scout always turns home after reporting.
 *  2. `if($field['uid']<1000) checkSodier($field)` — an NPC field/city tops up its garrison. This
 *     draws `mt_rand` / `createmapSoldier` (NONDETERMINISTIC), so the deterministic difftest cases
 *     scout a PLAYER-owned city (uid>1000), which skips it. It is ported as `topUpNpcGarrison`
 *     but only as a faithful stub boundary — see the note there.
 *  3. Find a stationed enemy troop (`state=4`) at the target; build the defender combat stats and
 *     the `$patrol` count via `defcityadd` (city, type 1-3) or `battleAdd` (field, a stationed
 *     troop) with the patrol flag. These two functions reach `take_dtactics` / `take_atactics` /
 *     `getAdd` / `soldierinfo`, NONE of which are ported — so a REAL patrol fight cannot be driven
 *     here. `buildPatrol` throws `PATROL_NOT_PORTED` when a patrol would be fought; the report
 *     assembly for the patrol case is nevertheless ported below for when those helpers land.
 *  4. If `$patrol>0`: run the instant 演习 loop (`upManeuver`) over a one-round scout-vs-patrol
 *     engagement, apply the scout losses to the troop and the patrol losses to the garrison.
 *  5. `switch($end)` — note the legacy `case 0:` has NO `break`, so a win (end 0) FALLS THROUGH
 *     into `case 2:`, the intelligence-gathering block. That block reads `$te_level` (the SCOUT's
 *     own 侦察技巧, tid 7, at its ORIGIN city), adjusts it for a wild-field target and halves it on
 *     a draw, then appends one `$binfouser` table per intel tier the level unlocks:
 *       te_level>=1  资源状况 (gold only from te_level>2; food/wood/rock/iron always)
 *       te_level>=2  建筑状况 (bid<5 from te_level 2; the rest from te_level>=4)
 *       te_level>=5  城防状况
 *       te_level>=6  军队状况 (fuzzy count_desc until te_level>=7, exact from 7)
 *       te_level>=7  盟军状况 (allied troops stationed at the target)
 *       te_level>=8  将领状况
 *       te_level>=9  科技状况
 *       te_level>=10 玩家动态 (only for a real player, field.uid>1000)
 *  6. `sendReport` to the scout; when the target is a real player and the scout was not wiped
 *     first-round, an alarm report (title 12, `$content1`) is filed for the target owner too.
 *
 * The report text is built to byte-match the legacy `sys_report.content` the difftest compares.
 */
@Injectable()
export class ScoutService {
  private readonly logger = new Logger(ScoutService.name);

  constructor(
    private readonly scope: DbScope,
    private readonly lang: LangService,
    private readonly report: ReportService,
    private readonly tasks: TaskRules,
    private readonly cityRules: CityRules,
    private readonly random: RandomService,
  ) {}

  /**
   * Settle one scout (task 2, state 0, inwar.result true) arrival. `ctx` carries the values the
   * caller (`TroopTick.settle`) already resolved so the two sides agree on names / types.
   */
  async settle(row: Row, ctx: ScoutContext): Promise<void> {
    const db = this.scope.db;
    const { uid, hid, cid, id, targetcid, task, state, field, type, cityname, targetcityname } =
      ctx;
    const happencid = targetcid;
    const soldierArray = troop2array(phpString(row.soldiers));

    // $result=0 — a scout always turns home.
    // $field['uid']<1000 → checkSodier: top up the NPC garrison (random; see the stub note).
    if (phpNum(field.uid) < 1000) await this.topUpNpcGarrison(field);

    // The stationed enemy troop the scout might meet (not itself).
    const targetrow = await this.one(sql<Row>`select * from sys_troops
      where state = 4 and id <> ${id} and (targetcid = ${targetcid} or cid = ${targetcid})
      order by endtime asc limit 1`);

    // Defender combat info + patrol count. City (type 1-3) → defcityadd; field with a stationed
    // troop → battleAdd. Both reach unported tactic/stat helpers, so a real patrol is refused.
    let patrol = 0;
    if (type > 0 && type < 4) {
      patrol = await this.buildPatrol('city', field, targetcid);
    } else if (targetrow) {
      patrol = await this.buildPatrol('troop', targetrow, targetcid);
    }
    if (!patrol) patrol = 0;

    // The scout-vs-patrol fight only runs when a patrol exists. It needs defcityadd/battleAdd's
    // precomputed stat strings and the 演习 loop; those stat helpers are not ported, so buildPatrol
    // has already thrown PATROL_NOT_PORTED above. Everything below is therefore the NO-PATROL path:
    // $patrol 0, $end 0 (a win), $round 1, no scout losses — and PHP's `case 0:` has no break, so a
    // win falls straight through into the intel block (`case 2:`). The end-1 (scout wiped) and the
    // draw-halving (end 2) branches only occur with a patrol, and land when buildPatrol is ported.
    if (patrol > 0) throw new Error('PATROL_NOT_PORTED');

    // ── report assembly (no-patrol: a clean win, full intel) ──
    let content = this.reportTitle(cityname, targetcityname, task, state, 0);
    let content1 = this.reportTitle(cityname, targetcityname, task, state, 0);

    // 情报任务：野地 133 / 城池 132（完成对应侦察任务目标）。
    if (phpIntval(field.type) === 0) await this.completeTask(uid, 133);
    else await this.completeTask(uid, 132);

    // intel level: the scout's own 侦察技巧 (tid 7) at its ORIGIN city, bumped onto a coarser band
    // for a wild-field target. (A draw would halve it, but a no-patrol scout never draws.)
    let teLevel = phpIntval(
      await this.cell(sql<Row>`select level from sys_city_technic where tid = 7 and cid = ${cid}`),
    );
    if (phpIntval(field.type) > 0 && teLevel) {
      if (teLevel < 3) teLevel = 6;
      else if (teLevel < 6) teLevel = 7;
      else if (teLevel < 9) teLevel += 2;
      else teLevel = 10;
    }

    const binfouser = await this.buildIntel(teLevel, targetcid, field);

    // the scout survives intact (no patrol losses); turn it home (state 1), hero back to state 2.
    const soldiers = array2troop(soldierArray);
    await sql`update sys_troops set soldiers = ${soldiers}, state = 1,
      starttime = unix_timestamp(), endtime = pathtime + unix_timestamp() where id = ${id}`.execute(
      db,
    );
    await sql`update sys_city_hero set state = 2 where hid = ${hid}`.execute(db);

    // 对方未发觉 (3) — no patrol fought. ($okcontent in the legacy; it then sets $content=$okcontent.)
    content += this.reportRow('3');
    content += binfouser;

    // the trailing 返回 line (a scout's $result is 0, so it always 军队正在返回).
    content += this.reportStr('br');
    content += `<br/>军队正在返回${cityname}。`;

    // the target owner's alarm mirror ($content1, title 12): in the legacy $tend is only assigned
    // inside the patrol block, so a no-patrol scout has $tend 0 and the alarm IS sent to a real
    // player (field.uid > 1000). "我方未迎战" (title_2row 9) + the empty battle table.
    content1 += this.reportRow('9');
    content1 += sprintf(this.reportStr('table'), '');
    content1 += this.reportStr('br');
    content1 += `<br/>军队正在返回${cityname}。`;

    await this.report.sendReport(uid, this.reportTitleType(task, state), cid, happencid, content);

    // The common HandleTroop tail. A scout's $result is 0 (it reports and turns home). For a real
    // player target (field.uid > 1000) the alarm mirror ($content1, title 12) is filed when the
    // scout was not wiped first-round: in the legacy $tend is assigned ONLY inside the patrol
    // block, so a no-patrol scout has $tend 0 and the condition `$task==2 && $tend<>1` always holds.
    //
    // The legacy tail then runs `refreshFoodArmyUse($cid)` + `check_city_resource($uid,$cid)` for
    // the scout and the target owner. `check_city_resource` is the full `getUsersCityProduct`
    // economy recompute (caps / add rates / food upkeep), NOT ported — it belongs to the resource
    // wave, and reproducing only half of it (the food-upkeep refresh) would write a value the
    // legacy's full recompute does not. So the scout leaves the two cities' economy UNTOUCHED; the
    // difftest cases scope `mem_city_resource` out, since none of it is scout intelligence.
    if (phpNum(field.uid) > 1000) {
      await this.report.sendReport(phpIntval(field.uid), 12, cid, happencid, content1);
    }
  }

  /**
   * cfg_js.php `$binfouser` — the stack of intel tables unlocked by `$te_level`. Each tier appends
   * one `b_sbinfo` / `b_sbinfoh` table; the exact column selection inside each tier mirrors the
   * original's `if` guards so the byte output matches.
   */
  private async buildIntel(teLevel: number, targetcid: number, field: Row): Promise<string> {
    const db = this.scope.db;
    let binfouser = '';

    // te_level>=1: 资源状况
    if (teLevel >= 1) {
      const res = await this.one(
        sql<Row>`select * from mem_city_resource where cid = ${targetcid}`,
      );
      if (res) {
        const arr = [
          Math.floor(phpNum(res.gold)),
          Math.floor(phpNum(res.food)),
          Math.floor(phpNum(res.wood)),
          Math.floor(phpNum(res.rock)),
          Math.floor(phpNum(res.iron)),
          Math.floor(phpNum(res.people)),
          Math.floor(phpNum(res.morale)),
        ];
        const names = this.langArray('report', 'resources');
        let okkcd = '';
        arr.forEach((v, bid) => {
          // (bid<1||bid>4)&&te_level>2  ||  bid>0&&bid<5
          if (((bid < 1 || bid > 4) && teLevel > 2) || (bid > 0 && bid < 5)) {
            okkcd += sprintf(this.reportStr('b_count'), names[bid] ?? '', v);
          }
        });
        binfouser += sprintf(this.reportStr('b_sbinfo'), '资源状况', '资源', '数量', okkcd);
      }
    }

    // te_level>=2: 建筑状况
    if (teLevel >= 2) {
      const buildings = (
        await sql<Row>`select * from sys_building where cid = ${targetcid} order by bid, level desc`.execute(
          db,
        )
      ).rows;
      if (buildings.length) {
        const names = this.langArray('report', 'building');
        // $level[bid] = comma-joined level list, in bid order of first appearance.
        const level = new Map<number, string>();
        const comma = new Map<number, string>();
        for (const b of buildings) {
          const bid = phpIntval(b.bid);
          const prefix = (level.get(bid) ?? '') + (comma.get(bid) ?? '');
          level.set(bid, prefix + phpString(b.level));
          comma.set(bid, ',');
        }
        let okkcd = '';
        for (const [bid, v] of level) {
          if (bid < 5) okkcd += sprintf(this.reportStr('b_count'), names[bid] ?? '', v);
          else if (teLevel >= 4) okkcd += sprintf(this.reportStr('b_count'), names[bid] ?? '', v);
        }
        binfouser += sprintf(this.reportStr('b_sbinfo'), '建筑状况', '建筑', '等级', okkcd);
      }
    }

    // te_level>=5: 城防状况
    if (teLevel >= 5) {
      const defences = (
        await sql<Row>`select * from sys_city_defence where cid = ${targetcid}`.execute(db)
      ).rows;
      if (defences.length) {
        const names = this.langArray('battle', 'patrol_report_defence');
        let okkcd = '';
        for (const d of defences) {
          if (phpNum(d.count) > 0) {
            okkcd += sprintf(this.reportStr('b_count'), names[phpIntval(d.did)] ?? '', d.count);
          }
        }
        binfouser += sprintf(this.reportStr('b_sbinfo'), '城防状况', '城防', '数量', okkcd);
      }
    }

    // te_level>=6: 军队状况 (exact from te_level>=7, fuzzy count_desc below)
    if (teLevel >= 6) {
      let solds = new Map<number, number>();
      if (phpIntval(field.type) > 0) {
        const temp = await this.cell(sql<Row>`select soldiers from sys_troops
          where state = 4 and (cid = ${targetcid} or targetcid = ${targetcid}) limit 1`);
        if (!phpEmpty(temp)) solds = troop2array(phpString(temp));
      } else {
        const temp = (
          await sql<Row>`select * from sys_city_soldier where cid = ${targetcid} and count > 0`.execute(
            db,
          )
        ).rows;
        for (const s of temp) solds.set(phpIntval(s.sid), phpNum(s.count));
      }
      if (solds.size) {
        const names = this.langArray('battle', 'patrol_report_soldier');
        let okkcd = '';
        for (const [sid, cnt] of solds) {
          if (cnt > 0) {
            const shown = teLevel >= 7 ? cnt : this.countDesc(cnt);
            okkcd += sprintf(this.reportStr('b_count'), names[sid] ?? '', shown);
          }
        }
        binfouser += sprintf(this.reportStr('b_sbinfo'), '军队状况', '军队', '数量', okkcd);
      }
    }

    // te_level>=7: 盟军状况 (allied troops stationed at the target)
    if (teLevel >= 7) {
      const mengyous = (
        await sql<Row>`select * from sys_troops where state = 4 and targetcid = ${targetcid}`.execute(
          db,
        )
      ).rows;
      if (mengyous.length) {
        const names = this.langArray('battle', 'patrol_report_soldier');
        // NB: the legacy builds `$okkcd` across ALL allied troops but appends a fresh b_sbinfo per
        // troop (the `$binfouser.=` is inside the foreach), and it sprintf's `$count` — an UNSET
        // variable — so each count cell is the empty string. Mirror both quirks exactly.
        let okkcd = '';
        for (const m of mengyous) {
          const soldArray = troop2array(phpString(m.soldiers));
          for (const [sid] of soldArray) {
            okkcd += sprintf(this.reportStr('b_count'), names[sid] ?? '', '');
          }
          binfouser += sprintf(this.reportStr('b_sbinfo'), '盟军状况', '盟友军队', '数量', okkcd);
        }
      }
    }

    // te_level>=8: 将领状况
    if (teLevel >= 8) {
      const heros = (
        await sql<Row>`select * from sys_city_hero where cid = ${targetcid}`.execute(db)
      ).rows;
      if (heros.length) {
        let okkcd = '';
        for (const h of heros) {
          okkcd += sprintf(this.reportStr('b_counth'), h.name, h.level, h.loyalty);
        }
        binfouser += sprintf(
          this.reportStr('b_sbinfoh'),
          '将领状况',
          '将领',
          '等级',
          '忠诚',
          okkcd,
        );
      }
    }

    // te_level>=9: 科技状况
    if (teLevel >= 9) {
      const technics = (
        await sql<Row>`select * from sys_city_technic where cid = ${targetcid}`.execute(db)
      ).rows;
      if (technics.length) {
        const names = this.langArray('report', 'technics');
        let okkcd = '';
        for (const t of technics) {
          okkcd += sprintf(this.reportStr('b_count'), names[phpIntval(t.tid)] ?? '', t.level);
        }
        binfouser += sprintf(this.reportStr('b_sbinfo'), '科技状况', '科技', '等级', okkcd);
      }
    }

    // te_level>=10: 玩家动态 (only a real player)
    if (teLevel >= 10 && phpNum(field.uid) > 1000) {
      const lastTime = phpNum(
        await this.cell(sql<Row>`select lastupdate from sys_online where uid = ${field.uid}`),
      );
      const status = this.nowSec() - lastTime <= 10 ? '在线' : '离线';
      const lastLogin = phpString(
        await this.cell(sql<Row>`select from_unixtime(${lastTime}) as v`),
      );
      const okkcd = sprintf(this.reportStr('b_count'), status, lastLogin);
      binfouser += sprintf(this.reportStr('b_sbinfo'), '玩家动态', '动态', '最后活动时间', okkcd);
    }

    return binfouser;
  }

  /**
   * cfg_js.php::checkSodier boundary. On an NPC field/city (`$field['uid']<1000`) the original tops
   * the garrison up with `createmapSoldier` driven by `mt_rand` — now ported in `check-sodier.ts`,
   * so a scout of an NPC field/city respawns the same garrison as the legacy on the deterministic
   * (scripted-RNG) difftest path. The RNG draws (createmapSoldier `rand()`/`mt_rand`, the NPC pick)
   * ride the request's scripted source via `RandomService`, so both servers stay in lockstep.
   */
  private async topUpNpcGarrison(field: Row): Promise<void> {
    await checkSodier(this.checkSodierDeps(), field);
  }

  /** Assemble the `CheckSodierDeps` from this service's collaborators. */
  private checkSodierDeps(): CheckSodierDeps {
    const db = this.scope.db;
    const query = async (q: ReturnType<typeof sql<Row>>) => (await q.execute(db)).rows;
    return {
      db,
      query,
      one: async (q) => (await query(q))[0] ?? false,
      cell: async (q) => {
        const row = (await query(q))[0];
        return row ? Object.values(row)[0] : undefined;
      },
      soldierValue: () => {
        const sv = (this.lang.value<Record<string, unknown>>('soldier')?.soldiervalue ?? []) as
          unknown[];
        return sv.map((v) => phpNum(v));
      },
      addCitySoldiers: (cid, soldiers, add) => this.cityRules.addCitySoldiers(cid, soldiers, add),
      rand: () => this.random.rand(),
      mtRand: (min, max) => this.random.mtRand(min, max),
    };
  }

  /**
   * cfg_js.php::defcityadd / battleAdd with the patrol flag ($task=1): the defender's precomputed
   * combat stats and the patrol (斥候) count. Both reach `take_dtactics` / `take_atactics` /
   * `getAdd` / `soldierinfo` / `getshootadd` — the full tactic + attribute pipeline, none of which
   * is ported. So this detects whether a patrol WOULD be fought and refuses in that case; it
   * returns 0 (no patrol) for the common garrison with no 斥候-type defender, which is all the
   * deterministic scout cases need.
   */
  private async buildPatrol(
    kind: 'city' | 'troop',
    source: Row,
    targetcid: number,
  ): Promise<number> {
    // A patrol is fought only when a defender of soldier-type 3 (斥候) is present. For a city that
    // is a stationed garrison soldier sid whose type is 3; for a field it is a stationed troop
    // carrying sid 3. Detect it cheaply; if present, the fight needs the unported stat pipeline.
    if (kind === 'city') {
      const has = await this.one(sql<Row>`select 1 as x from sys_city_soldier s
        join cfg_soldier c on c.sid = s.sid
        where s.cid = ${targetcid} and s.count > 0 and c.type = 3 limit 1`);
      if (has) throw new Error('PATROL_NOT_PORTED');
    } else {
      const soldArray = troop2array(phpString(source.soldiers));
      for (const [sid] of soldArray) {
        if (sid === 3) throw new Error('PATROL_NOT_PORTED');
      }
    }
    return 0;
  }

  // ─────────────────────────── helpers ───────────────────────────

  private async one(query: ReturnType<typeof sql<Row>>): Promise<Row | false> {
    return (await query.execute(this.scope.db)).rows[0] ?? false;
  }

  private async cell(query: ReturnType<typeof sql<Row>>): Promise<unknown> {
    const row = await this.one(query);
    return row === false ? false : Object.values(row)[0];
  }

  private nowSec(): number {
    return Math.floor(Date.now() / 1000);
  }

  /** utils.php::completeTask — `replace into sys_user_goal`, via the shared TaskRules. */
  private async completeTask(uid: number, taskid: number): Promise<void> {
    await this.tasks.completeTask(uid, taskid);
  }

  /** cfg_js.php::count_desc — the fuzzy army-size label. */
  private countDesc(count: number): string {
    const labels = this.langArray('report', 'count_desc');
    return phpString(labels[countDescIndex(count)] ?? '');
  }

  /** UtilsExtend.php::getreporttitle (me = 0 → title1; me = 1 → title). */
  private reportTitle(
    cityname: string,
    tarname: string,
    task: number,
    state: number,
    me = 1,
  ): string {
    const tasktype = this.langArray('report', 'type')[task] ?? '';
    if (me) {
      const statetype = state === 0 ? '已到达目标' : `已经返回${cityname}`;
      return sprintf(this.reportStr('title'), tarname, tasktype, statetype);
    }
    return sprintf(this.reportStr('title1'), tarname, tasktype);
  }

  /** `$GLOBALS['report'][key]` (a string; missing → '' as PHP reads an unset entry in concat). */
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

  /** A `$GLOBALS[group][key]` array/object read as `index → value`. */
  private langArray(group: string, key: string): Record<number, unknown> {
    const node = (this.lang.value<Record<string, unknown>>(group)?.[key] ?? {}) as
      unknown[] | Record<number, unknown>;
    if (Array.isArray(node)) {
      const out: Record<number, unknown> = {};
      node.forEach((v, i) => (out[i] = v));
      return out;
    }
    return node as Record<number, unknown>;
  }

  /** UtilsExtend.php::getReportTitleType, scout state 0 → 5, state 1 → 6. */
  private reportTitleType(task: number, state: number): number {
    if (state === 0) {
      const map: Record<number, number> = { 0: 1, 1: 3, 2: 5, 3: 7, 4: 9, 7: 36, 8: 37, 9: 38 };
      return map[task] ?? 0;
    }
    const map: Record<number, number> = { 0: 2, 1: 4, 2: 6, 3: 8, 4: 10, 7: 36, 8: 37, 9: 38 };
    return map[task] ?? 0;
  }
}

/** The values `TroopTick.settle` resolves before handing the row to the scout branch. */
export interface ScoutContext {
  uid: number;
  hid: number;
  cid: number;
  id: number;
  targetcid: number;
  task: number;
  state: number;
  field: Row;
  type: number;
  cityname: string;
  targetcityname: string;
}

/** UtilsExtend.php::troop2array: `count,sid,n,...` → map of sid→count (positive counts only). */
function troop2array(soldiers: string): Map<number, number> {
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

/**
 * UtilsExtend.php::array2troop (the $def=0 form): `count,sid,cnt,sid,cnt,` WITH a trailing comma,
 * keys in iteration order; an empty map returns the scalar `0`. This is NOT the battle-math
 * `array2troop` (which drops the trailing comma and ksorts) — HandleTroop stores the UtilsExtend
 * shape (`1,3,100,`), so the scout's `sys_troops.soldiers` must match it byte-for-byte.
 */
function array2troop(soldiers: Map<number, number>): string {
  let out = '';
  let i = 0;
  for (const [sid, cnt] of soldiers) {
    if (cnt > 0) {
      out += `${sid},${cnt},`;
      i++;
    }
  }
  return i ? `${i},${out}` : '0';
}
