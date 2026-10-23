import { join } from 'node:path';
import { LegacyClient } from '../legacy-client.ts';
import { repoRoot } from '../paths.ts';
import { capture } from '../run.ts';
import { canonicalScalar } from './normalize.ts';
import type { SideDb } from './side-db.ts';

/** cfg_js.php's settlement functions and the server's TickOrder slot porting each. */
export const TICK_SLOTS = {
  HandleTroop: 10,
  HandleBattle: 20,
  HandleHeroHexprs: 30,
  UpdateUsersCurse: 40,
  UpdateUsersTechnic: 50,
  UpdateUsersSoldier: 60,
  UpdateUsersDeinforce: 70,
} as const;

export type TickFunction = keyof typeof TICK_SLOTS;

/**
 * The hour (`date('G')`) and weekday (`date('w')`) a settlement should assume. Giving one also
 * passes the top-of-the-hour check (`date('is') < 15`) of UpdateUsersCurse.
 */
export interface TickClock {
  hour: number;
  weekday: number;
}

/** An amfphp-style endpoint: `Service.method` called with an argument array. */
export interface Target {
  call(service: string, method: string, args: unknown[], rng?: string): Promise<unknown>;
  /** Runs one settlement function of cfg_js.php now. */
  tick(fn: TickFunction, clock?: TickClock, rng?: string): Promise<void>;
}

/** ReportCron.php with its clock reads replaced, evaluated in place of the require. */
function patchedReportCron(clock: TickClock): string {
  const replace = `array("date('is')", "date('G')", "date('w')"), array("0", "${clock.hour}", "${clock.weekday}")`;
  return `eval('?>' . str_replace(${replace}, file_get_contents("ReportCron.php")));`;
}

const LEGACY_COMPOSE = join(repoRoot, 'docker/legacy/docker-compose.yml');

export function legacyTarget(client = new LegacyClient()): Target {
  return {
    call: (service, method, args, rng) =>
      // `ExternService` methods take spread positional args (getTroopMaxTime($x,$y),
      // saveEnemyTroopSet($cid,$actions)); amfphp reaches those through URL-path segments, not the
      // single body array every Command/Login/CityCommand method expects. Route it accordingly.
      service === 'ExternService'
        ? client.callSpread(`${service}.${method}`, args, rng)
        : client.call(`${service}.${method}`, args, rng),
    async tick(fn, clock, rng) {
      // cfg_js.php's includes and the helper it defines for ReportCron.php, without the other
      // handlers it calls at the top level. HandleHeroHexprs() is defined in cfg_js.php itself
      // (not ReportCron.php) and wraps HeroExpr::checkHeroExpr(), so source it and its class too.
      const reportCron = clock ? patchedReportCron(clock) : 'require_once "ReportCron.php";';
      let script: string;
      if (fn === 'HandleBattle') {
        // HandleBattle has two parts on the new side (BattleTick.handleBattle): settle pending
        // 演习 maneuvers via upManeuver, then the time-stepped mem_battle loop (scaffold only).
        // The legacy 演习 settlement lives in cfg_js.php::upManeuver — no cron calls it (the
        // 易语言 backend did), so eval the whole cfg_js battle region (`del` … end-of-file, which
        // defines upManeuver, battleInfo, getNamePosition, action/checkPos/getTarget/SoBitSo/…)
        // and drive a harness HandleBattle that settles every pending maneuver the way the new
        // BattleTick does. The real OLdBattleCron::HandleBattle (mem_battle) is NOT ported on
        // either side yet, so it is deliberately not run here.
        script = `require_once "BattleFunc.php"; require_once "UtilsExtend.php";
          require_once "HeroExpr.php";
          $cfg = file_get_contents("cfg_js.php");
          preg_match('/function del\\b.*/s', $cfg, $b); eval($b[0]);
          $pending = sql_fetch_rows("select id from mem_maneuver where state=0");
          if (!empty($pending)) foreach ($pending as $m) { upManeuver($m['id'], 0); }`;
      } else {
        // HandleTroop's task-2 侦察 arrival (and the 掠夺/占领/攻击 battle arrivals) call into the
        // whole cfg_js battle region — battleAdd / defcityadd / upManeuver / count_desc /
        // getNamePosition / SoBitSo all live AFTER `function del` (end-of-file region), not between
        // getNamePosition and SoBitSo. Evalling only the getNamePosition…SoBitSo slice (what the
        // non-battle settlements needed) left those undefined, so a scout with a patrol fataled.
        // Eval the full `del`…EOF region — which defines getNamePosition and SoBitSo too — plus the
        // two handler bodies that sit BEFORE `del` (HandleHeroHexprs, HandleTroop). This mirrors the
        // HandleBattle branch's `del`…EOF eval, so both ticks see the same battle helpers.
        //
        // `@unlink("cron/uptroop")` drops HandleTroop's per-troop dedup file (it writes `$id.$state`
        // and skips a row whose id+state it already saw). That cache is a production cron guard the
        // new side has no equivalent of; left in place it makes a scout case pass on the FIRST
        // difftest run and silently skip (no report) on the SECOND, since the gate runs twice. The
        // new side never consults it, so clearing it each tick keeps the two sides symmetric.
        script = `require_once "BattleFunc.php"; require_once "UtilsExtend.php";
          require_once "HeroExpr.php";
          @unlink("cron/uptroop");
          $cfg = file_get_contents("cfg_js.php");
          preg_match('/function del\\b.*/s', $cfg, $b); eval($b[0]);
          preg_match('/function HandleHeroHexprs\\b.*?(?=function HandleTroop)/s', $cfg, $h); eval($h[0]);
          preg_match('/function HandleTroop\\b.*?(?=function del\\b)/s', $cfg, $t); eval($t[0]);
          ${reportCron} ${fn}();`;
      }
      // `php -r` bypasses apache, so the scripted RNG spec rides an env var (the auto_prepend
      // reads HOT_DIFFTEST_RNG as a fallback to the header); `-e HOT_DIFFTEST_RNG` passes it only
      // when a case armed one, so ordinary ticks are unaffected.
      const rngEnv = rng ? ['-e', `HOT_DIFFTEST_RNG=${rng}`] : [];
      const out = capture('docker', [
        'compose',
        '-f',
        LEGACY_COMPOSE,
        'exec',
        '-T',
        ...rngEnv,
        '-w',
        '/var/www/html/server/game',
        'php',
        'php',
        '-r',
        script,
      ]);
      if (/Fatal error|Uncaught/.test(out)) throw new Error(`${fn}: ${out.trim()}`);
    },
  };
}

/** The NestJS gateway mirrors json.php at /api/service/:service/:method. */
export function newTarget(baseUrl: string): Target {
  return {
    async tick(fn, clock, rng) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (rng) headers['x-difftest-rng'] = rng;
      const res = await fetch(`${baseUrl}/api/debug/tick/${TICK_SLOTS[fn]}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ clock }),
      });
      if (!res.ok) throw new Error(`tick ${fn}: HTTP ${res.status} ${await res.text()}`);
    },
    async call(service, method, args, rng) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (rng) headers['x-difftest-rng'] = rng;
      const res = await fetch(`${baseUrl}/api/service/${service}/${method}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(args),
      });
      const text = await res.text();
      if (!res.ok)
        throw new Error(`${service}.${method}: HTTP ${res.status} ${text.slice(0, 300)}`);
      return JSON.parse(text) as unknown;
    },
  };
}

export interface Session {
  uid: number;
  sid: unknown;
}

export type TreePath = (string | number)[];

export interface RecordedResponse {
  label: string;
  value: unknown;
  /** Arrays inside the response whose order the original query left undefined. */
  unordered: TreePath[];
  /** Values that depend on the moment of the call (e.g. seconds left); `'*'` = any element. */
  masked: TreePath[];
  /** Times relative to the call (e.g. now + build time); compared as minutes from the case start. */
  offsets: TreePath[];
}

/** What a test case drives: records every response and the values to alias before comparing. */
export class Side {
  readonly label: 'legacy' | 'new';
  readonly clientVersion: string;
  readonly responses: RecordedResponse[] = [];
  readonly aliases = new Map<string, string>();
  private readonly target: Target;
  private readonly db: SideDb;
  /** Scripted-RNG spec sent with each request until changed; undefined = real randomness. */
  private rngSpec: string | undefined;

  constructor(label: 'legacy' | 'new', target: Target, db: SideDb, clientVersion = '1121') {
    this.label = label;
    this.target = target;
    this.db = db;
    this.clientVersion = clientVersion;
  }

  /**
   * Arm a scripted RNG for the following requests: both servers draw `seq` in call order and
   * scale a bounded `rand($min,$max)` / `mt_rand($min,$max)` to `$min + (draw mod ($max-$min+1))`,
   * so a random game outcome is identical on both sides. The sequence is cycled if a request
   * draws more values than it holds. Call with `[]` (or {@link stopRng}) to go back to real
   * randomness.
   */
  rng(seq: number[]): void {
    this.rngSpec = seq.length ? seq.join(',') : undefined;
  }

  /** Arm a scripted RNG from a seed (a reproducible stream) instead of an explicit sequence. */
  seed(n: number): void {
    this.rngSpec = `seed:${n}`;
  }

  /** Stop the scripted RNG; following requests use real randomness again. */
  stopRng(): void {
    this.rngSpec = undefined;
  }

  async service(
    service: string,
    method: string,
    args: unknown[],
    label?: string,
  ): Promise<unknown> {
    const value = await this.target.call(service, method, args, this.rngSpec);
    this.responses.push({
      label: label ?? `${service}.${method}`,
      value,
      unordered: [],
      masked: [],
      offsets: [],
    });
    return value;
  }

  /** doLogin with a local passport; the random sid is aliased. */
  async login(passport: string, passtype = 'testpassport'): Promise<Session> {
    const ret = (await this.service(
      'Login',
      'doLogin',
      [this.clientVersion, 0, passtype, passport],
      `doLogin ${passport}`,
    )) as unknown[];
    if (Number(ret[0]) !== 1) throw new Error(`${this.label}: login failed ${JSON.stringify(ret)}`);
    this.alias(ret[3], '<sid>');
    return { uid: Number(ret[2]), sid: ret[3] };
  }

  /** A global command (type 2) through Command.sendCommand. */
  command(session: Session, func: string, ...args: unknown[]): Promise<unknown> {
    return this.service(
      'Command',
      'sendCommand',
      [session.uid, session.sid, 2, 0, func, ...args],
      func,
    );
  }

  /** A dialog command (type 1); the reply echoes the receiver so the right dialog takes it. */
  dialog(
    session: Session,
    cid: number,
    receiverId: number,
    receiverParam: number,
    func: string,
    ...args: unknown[]
  ): Promise<unknown> {
    return this.service(
      'Command',
      'sendCommand',
      [session.uid, session.sid, 1, cid, receiverId, receiverParam, 0, func, ...args],
      func,
    );
  }

  /** CityCommand.sendCommand: the main screen's polling of city data. */
  cityCommand(session: Session, cid: number, type: number): Promise<unknown> {
    return this.service(
      'CityCommand',
      'sendCommand',
      [session.uid, cid, session.sid, type],
      `CityCommand ${type}`,
    );
  }

  /** Compares the array at `path` in the last response as a multiset. */
  unordered(...path: TreePath): void {
    this.last('unordered').unordered.push(path);
  }

  /** Leaves the values at `path` in the last response out of the comparison. */
  mask(...path: TreePath): void {
    this.last('mask').masked.push(path);
  }

  /** Compares the times at `path` in the last response relative to the case start. */
  offset(...path: TreePath): void {
    this.last('offset').offsets.push(path);
  }

  private last(caller: string): RecordedResponse {
    const last = this.responses.at(-1);
    if (!last) throw new Error(`${caller}() needs a recorded response`);
    return last;
  }

  alias(value: unknown, placeholder: string): void {
    this.aliases.set(String(canonicalScalar(value)), placeholder);
  }

  /** Runs a cfg_js.php settlement function; its effects show up in the table deltas. */
  tick(fn: TickFunction, clock?: TickClock): Promise<void> {
    return this.target.tick(fn, clock, this.rngSpec);
  }

  query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.query<T>(sql, params);
  }
}
