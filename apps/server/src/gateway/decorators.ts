import { SetMetadata } from '@nestjs/common';
import type { ClientAddress } from './client-ip';

export const COMMAND_HANDLER = 'hot:command-handler';
export const AMF_SERVICE = 'hot:amf-service';
export const AMF_METHOD = 'hot:amf-method';

export type CommandKind = 'dialog' | 'global';

export interface CommandHandlerMeta {
  kind: CommandKind;
  name?: string;
}

export interface CommandContext extends ClientAddress {
  uid: number;
  /** City the dialog belongs to; 0 for global commands. */
  cid: number;
}

export type ServiceContext = ClientAddress;

/**
 * Registers a method as the target of `sendCommand(..., type=1 (dialog), funcName)`;
 * replaces a PHP `function f($uid, $cid, $param)` listed in `$GLOBALS['openfunc']`.
 * The method receives `(ctx: CommandContext, param: unknown[])`.
 */
export const DialogCommand = (name?: string) =>
  SetMetadata<string, CommandHandlerMeta>(COMMAND_HANDLER, { kind: 'dialog', name });

/** Like DialogCommand for `type=2 (global)`, replacing `function f($uid, $param)`. */
export const GlobalCommand = (name?: string) =>
  SetMetadata<string, CommandHandlerMeta>(COMMAND_HANDLER, { kind: 'global', name });

/** Marks a provider as an amfphp service class (e.g. `Login`), reachable at /api/service/:name/:method. */
export const AmfService = (name: string) => SetMetadata(AMF_SERVICE, name);

/** Exposes a method of an @AmfService; it receives `(param: unknown[], ctx: ServiceContext)`. */
export const AmfMethod = (name?: string) => SetMetadata(AMF_METHOD, name ?? true);
