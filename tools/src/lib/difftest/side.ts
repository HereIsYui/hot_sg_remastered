import { LegacyClient } from '../legacy-client.ts';
import { canonicalScalar } from './normalize.ts';
import type { SideDb } from './side-db.ts';

/** An amfphp-style endpoint: `Service.method` called with an argument array. */
export interface Target {
  call(service: string, method: string, args: unknown[]): Promise<unknown>;
}

export function legacyTarget(client = new LegacyClient()): Target {
  return { call: (service, method, args) => client.call(`${service}.${method}`, args) };
}

/** The NestJS gateway mirrors json.php at /api/service/:service/:method. */
export function newTarget(baseUrl: string): Target {
  return {
    async call(service, method, args) {
      const res = await fetch(`${baseUrl}/api/service/${service}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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

  constructor(label: 'legacy' | 'new', target: Target, db: SideDb, clientVersion = '1121') {
    this.label = label;
    this.target = target;
    this.db = db;
    this.clientVersion = clientVersion;
  }

  async service(
    service: string,
    method: string,
    args: unknown[],
    label?: string,
  ): Promise<unknown> {
    const value = await this.target.call(service, method, args);
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

  query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.query<T>(sql, params);
  }
}
