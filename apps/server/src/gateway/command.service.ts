import { Injectable, Logger } from '@nestjs/common';
import { CommandType } from '@hot/shared';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { OwnershipService } from '../core/ownership.service';
import type { ClientAddress } from './client-ip';
import type { CommandContext } from './decorators';
import { HandlerRegistry } from './handler-registry';
import { KeyedMutex } from './keyed-mutex';
import { SessionService } from './session.service';

/** Port of `Command.php::sendCommand`: same request layout, echo fields and error format. */
@Injectable()
export class CommandService {
  private readonly logger = new Logger(CommandService.name);
  private readonly userLocks = new KeyedMutex<number>();

  constructor(
    private readonly ownership: OwnershipService,
    private readonly registry: HandlerRegistry,
    private readonly sessions: SessionService,
    private readonly lang: LangService,
  ) {}

  async dispatch(request: unknown[], client: ClientAddress): Promise<unknown[]> {
    const param = [...request];
    const uidArg = param.shift();
    const sidArg = param.shift();
    const type = Number(param.shift());
    const ret: unknown[] = [1, type];
    try {
      const uid = await this.sessions.verify(uidArg, sidArg);
      if (type === CommandType.Dialog) {
        const cid = Number(param.shift());
        ret.push(cid, param.shift(), param.shift(), param.shift());
        await this.ownership.checkCityOwner(cid, uid);
        const func = String(param.shift() ?? '');
        ret.push(await this.invoke('dialog', func, { ...client, uid, cid }, param));
      } else if (type === CommandType.City) {
        ret.push(Number(param.shift()), param.shift());
      } else if (type === CommandType.Global) {
        ret.push(param.shift());
        const func = String(param.shift() ?? '');
        ret.push(func);
        // Unknown global commands fall through to the `#` GM console (WizardFunc.php, not ported),
        // which answers anything else with the bare header.
        if (this.registry.command(func)) {
          ret.push(await this.invoke('global', func, { ...client, uid, cid: 0 }, param));
        }
      }
      return ret;
    } catch (err) {
      if (!(err instanceof GameError)) {
        this.logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
      }
      return [0, this.lang.messageOf(err)];
    }
  }

  private async invoke(
    kind: 'dialog' | 'global',
    func: string,
    ctx: CommandContext,
    param: unknown[],
  ): Promise<unknown> {
    const handler = this.registry.command(func);
    if (!handler || handler.kind !== kind) {
      throw GameError.raw(func + this.lang.t('sendCommand.command_not_found'));
    }
    const result = await this.userLocks.run(ctx.uid, async () => handler.invoke(ctx, param));
    return result === undefined ? null : result;
  }
}
