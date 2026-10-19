/**
 * Business command protocol, kept compatible with the original
 * `server/game/Command.php::sendCommand($param)` flat-array format.
 */

export enum CommandType {
  /** `[uid, sid, 0, cid, retType]` */
  City = 0,
  /** `[uid, sid, 1, cid, receiverId, receiverParam, ttype, funcName, ...args]` */
  Dialog = 1,
  /** `[uid, sid, 2, retTag, funcName, ...args]` */
  Global = 2,
}

export type CommandArg =
  string | number | boolean | null | CommandArg[] | { [key: string]: CommandArg };

export type CityCommandRequest = [
  uid: number,
  sid: string,
  type: CommandType.City,
  cid: number,
  retType: CommandArg,
];

export type DialogCommandRequest = [
  uid: number,
  sid: string,
  type: CommandType.Dialog,
  cid: number,
  receiverId: CommandArg,
  receiverParam: CommandArg,
  ttype: CommandArg,
  funcName: string,
  ...args: CommandArg[],
];

export type GlobalCommandRequest = [
  uid: number,
  sid: string,
  type: CommandType.Global,
  retTag: CommandArg,
  funcName: string,
  ...args: CommandArg[],
];

export type CommandRequest = CityCommandRequest | DialogCommandRequest | GlobalCommandRequest;

/** Success responses echo the request header fields, followed by the handler result. */
export type CommandSuccess = [ok: 1, type: CommandType, ...rest: unknown[]];

/** `message` is either a localized text or a key such as `invalid_user_auth`. */
export type CommandFailure = [ok: 0, message: string];

export type CommandResponse = CommandSuccess | CommandFailure;

export const COMMAND_ENDPOINT = '/api/command';

export function isCommandFailure(res: CommandResponse): res is CommandFailure {
  return res[0] === 0;
}
