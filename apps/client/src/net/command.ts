import { COMMAND_ENDPOINT, CommandType, SERVICE_ENDPOINT, type CommandArg } from '@hot/shared';
import { NetworkError, postJson, type Transport } from './http';

/** Port of `Command.as`: request layout, response routing and failure keys of the original. */

export interface CommandSession {
  uid: number;
  sid: number;
  cid: number;
  /** `User.locked` (vacation): dialog and city commands are suppressed. */
  locked: boolean;
}

export interface DialogResult {
  cid: number;
  receiverId: number;
  receiverParam: number;
  ttype: number;
  data: unknown;
}

export interface CommandHandlers {
  global(action: string, command: string, data: unknown): void;
  dialog(result: DialogResult): void;
  city(type: number, data: unknown): void;
  failure(failure: CommandFailure): void;
  /** Response shorter than two fields; `city` for CityCommand. */
  malformed(source: 'command' | 'city'): void;
  /** Transport fault. `silent` for the background services (service2/service3). */
  fault(error: unknown, silent: boolean): void;
  /** `BloodWar.notifyAction`: user activity resets the idle kick-out timer. */
  action?(): void;
  busy?(pending: number): void;
}

export type CommandFailure =
  | { kind: 'needRefresh'; swfPass: string | null }
  | { kind: 'invalidAuth' }
  | { kind: 'serverUpdating' }
  | { kind: 'notUserCity' }
  | { kind: 'notEnoughGoods'; gid: number; count: number }
  | { kind: 'ask'; what: 'yaoyiling' | 'yaoyiling2' | 'qiuxianzhao' | 'copperShop' }
  /** `**text`: shown in the floating AlertPanel instead of a modal Alert. */
  | { kind: 'panel'; text: string }
  | { kind: 'alert'; text: string };

const ALERT_HEAD = '**';
const ASK: Record<string, Extract<CommandFailure, { kind: 'ask' }>['what']> = {
  ask_to_use_yaoyiling: 'yaoyiling',
  ask_to_use_yaoyiling2: 'yaoyiling2',
  ask_to_use_qiuxianzhao: 'qiuxianzhao',
  ask_for_copperShop: 'copperShop',
};

export function classifyFailure(message: string, rest: unknown[] = []): CommandFailure {
  if (message === 'need_refresh') {
    return { kind: 'needRefresh', swfPass: rest[0] ? String(rest[0]) : null };
  }
  if (message === 'invalid_user_auth') return { kind: 'invalidAuth' };
  if (message === 'server_is_updating') return { kind: 'serverUpdating' };
  if (message === 'not_user_city') return { kind: 'notUserCity' };
  if (message.startsWith('not_enough_goods')) {
    const [gid, count] = message.slice(16).split('#');
    return {
      kind: 'notEnoughGoods',
      gid: parseInt(gid ?? '', 10),
      count: count === undefined ? 1 : parseInt(count, 10),
    };
  }
  const ask = ASK[message];
  if (ask) return { kind: 'ask', what: ask };
  if (message.startsWith(ALERT_HEAD))
    return { kind: 'panel', text: message.slice(ALERT_HEAD.length) };
  return { kind: 'alert', text: message };
}

export class CommandClient {
  /** `mOpen`: closed by `Global.popGame` until the next login. */
  open = true;
  private pending = 0;
  private readonly session: () => CommandSession;
  private readonly handlers: CommandHandlers;
  private readonly transport: Transport;

  constructor(
    session: () => CommandSession,
    handlers: CommandHandlers,
    transport: Transport = postJson,
  ) {
    this.session = session;
    this.handlers = handlers;
    this.transport = transport;
  }

  /** Resolves once the response has been routed (Flex `onCompleteHandler`). */
  async sendGlobalCommand(
    action: string,
    command: string,
    args?: CommandArg[] | null,
    showBusy = true,
  ): Promise<void> {
    if (!this.open) return;
    const { uid, sid } = this.session();
    const request = [uid, sid, CommandType.Global, action, command, ...(args ?? [])];
    this.handlers.action?.();
    await this.send(COMMAND_ENDPOINT, request, showBusy, (res) => this.onCommand(res));
  }

  async sendDialogCommand(
    command: string,
    receiverId: number,
    receiverParam = 0,
    args?: CommandArg[] | null,
    ttype = 0,
  ): Promise<void> {
    const { uid, sid, cid, locked } = this.session();
    if (!this.open || locked) return;
    const request = [
      uid,
      sid,
      CommandType.Dialog,
      cid,
      receiverId,
      receiverParam,
      ttype,
      command,
      ...(args ?? []),
    ];
    this.handlers.action?.();
    await this.send(COMMAND_ENDPOINT, request, true, (res) => this.onCommand(res));
  }

  /** CityCommand service (`[uid, cid, sid, type]`), polled in the background. */
  async sendCityCommand(type: number): Promise<void> {
    const { uid, sid, cid, locked } = this.session();
    if (!this.open || locked) return;
    await this.send(
      `${SERVICE_ENDPOINT}/CityCommand/sendCommand`,
      [uid, cid, sid, type],
      false,
      (res) => this.onCityCommand(res),
    );
  }

  private async send(
    url: string,
    body: unknown[],
    showBusy: boolean,
    route: (res: unknown[]) => void,
  ): Promise<void> {
    if (showBusy) this.handlers.busy?.(++this.pending);
    let res: unknown;
    try {
      res = await this.transport(url, body);
    } catch (err) {
      if (!(err instanceof NetworkError)) throw err;
      this.handlers.fault(err, !showBusy);
      return;
    } finally {
      if (showBusy) this.handlers.busy?.(--this.pending);
    }
    route(Array.isArray(res) ? [...(res as unknown[])] : []);
  }

  private onCommand(res: unknown[]): void {
    if (res.length < 2) {
      this.handlers.malformed('command');
      return;
    }
    if (!res.shift()) {
      this.handlers.failure(classifyFailure(String(res.shift()), res));
      return;
    }
    const type = Number(res.shift());
    if (type === CommandType.Dialog) {
      const [cid, receiverId, receiverParam, ttype, data] = res;
      this.handlers.dialog({
        cid: Number(cid),
        receiverId: Number(receiverId),
        receiverParam: Number(receiverParam),
        ttype: Number(ttype),
        data,
      });
    } else if (type === CommandType.Global) {
      const [action, command, data] = res;
      this.handlers.global(String(action), String(command), data);
    }
  }

  private onCityCommand(res: unknown[]): void {
    if (res.length < 2) {
      this.handlers.malformed('city');
      return;
    }
    if (!res.shift()) {
      this.handlers.failure(classifyFailure(String(res.shift()), res));
      return;
    }
    this.handlers.city(Number(res.shift()), res.shift());
  }
}
