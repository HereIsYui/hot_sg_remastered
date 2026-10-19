import { isServiceFault, SERVICE_ENDPOINT } from '@hot/shared';
import { postJson, type Transport } from './http';

/** Client protocol version sent on login (`Global.version`); the server checks it against mem_state. */
export const CLIENT_VERSION = 1121;
/** `pass.js getPassType()` of the original deployment. */
export const DEFAULT_PASS_TYPE = 'uuyx';

export type LoginResult =
  | { kind: 'error'; message: string }
  | { kind: 'queued'; uid: number; sid: number; ahead: number }
  | {
      kind: 'ok';
      uid: number;
      sid: number;
      cardId: string;
      isAdult: number;
      showRule: boolean;
      showVip: boolean;
      vipUrl: string | null;
      lastUpdateServerId: number;
    }
  /** Partner platform redirects (-100 51.com, -200 renren, -101 activation); unused here. */
  | { kind: 'redirect'; code: number };

export type QueueResult =
  { kind: 'invalid' } | { kind: 'ready' } | { kind: 'queued'; ahead: number };

/** Port of the `Login` RemoteObject calls in BloodWar.as and their result parsing. */
export class LoginService {
  private readonly transport: Transport;

  constructor(transport: Transport = postJson) {
    this.transport = transport;
  }

  /** The body is the method's single array parameter. */
  private call(method: string, param: unknown[]): Promise<unknown> {
    return this.transport(`${SERVICE_ENDPOINT}/Login/${method}`, param);
  }

  async getLoginAnnouncement(): Promise<string> {
    const res = await this.call('getLoginAnnouncement', []);
    return typeof res === 'string' ? res : '';
  }

  /** `BloodWar.doLogin`: `[version, 0, passType, passport, password]`. */
  async doLogin(
    passport: string,
    password: string,
    passType = DEFAULT_PASS_TYPE,
  ): Promise<LoginResult> {
    return parseLogin(
      await this.call('doLogin', [CLIENT_VERSION, 0, passType, passport, password]),
    );
  }

  async checkQueue(uid: number, sid: number): Promise<QueueResult> {
    return parseQueue(await this.call('checkQueue', [uid, sid]));
  }
}

export function parseLogin(res: unknown): LoginResult {
  if (isServiceFault(res)) return { kind: 'error', message: res.faultString };
  if (!Array.isArray(res) || res.length < 1) return { kind: 'error', message: 'error' };
  const r = res as unknown[];
  if (r[0] === 0) return { kind: 'error', message: String(r[1] ?? '') };
  if (r[0] !== 1) return { kind: 'redirect', code: Number(r[0]) };
  if (r[1] === 1) {
    return {
      kind: 'queued',
      uid: parseInt(String(r[2])),
      sid: parseInt(String(r[3])),
      ahead: parseInt(String(r[4])),
    };
  }
  const showVip = Boolean(r[7]);
  return {
    kind: 'ok',
    uid: parseInt(String(r[2])),
    sid: parseInt(String(r[3])),
    cardId: String(r[4] ?? ''),
    isAdult: Number(r[5] ?? 0),
    showRule: Boolean(r[6]),
    showVip,
    vipUrl: showVip ? String(r[8] ?? '') : null,
    lastUpdateServerId: Number(showVip ? r[9] : r[8]) || 0,
  };
}

/** `BloodWar.onCheckQueue`. */
export function parseQueue(res: unknown): QueueResult {
  if (!Array.isArray(res) || res.length < 1 || res[0] === 0) return { kind: 'invalid' };
  if (res[1] === 0) return { kind: 'ready' };
  return { kind: 'queued', ahead: parseInt(String(res[2])) };
}
