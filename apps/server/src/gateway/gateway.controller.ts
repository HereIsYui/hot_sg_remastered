import {
  BadRequestException,
  Body,
  Controller,
  Header,
  HttpCode,
  Ip,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { COMMAND_ENDPOINT, SERVICE_ENDPOINT } from '@hot/shared';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { clientAddress, type ClientAddress } from './client-ip';
import { CommandService } from './command.service';
import { HandlerRegistry } from './handler-registry';

/** amfphp answers an exception thrown by a service method with HTTP 200 and this fault code. */
export const AMF_RUNTIME_ERROR = 'AMFPHP_RUNTIME_ERROR';

function asArgs(body: unknown): unknown[] {
  if (!Array.isArray(body)) throw new BadRequestException('request body must be a JSON array');
  return body;
}

@Controller()
export class GatewayController {
  constructor(
    private readonly commands: CommandService,
    private readonly registry: HandlerRegistry,
    private readonly lang: LangService,
  ) {}

  @Post(COMMAND_ENDPOINT)
  @HttpCode(200)
  command(@Body() body: unknown, @Ip() ip: string): Promise<unknown[]> {
    return this.commands.dispatch(asArgs(body), clientAddress(ip));
  }

  /** Mirrors amfphp's `json.php/Service.method`; `Command/sendCommand` is the command gateway. */
  @Post(`${SERVICE_ENDPOINT}/:service/:method`)
  @HttpCode(200)
  @Header('content-type', 'application/json; charset=utf-8')
  async service(
    @Param('service') service: string,
    @Param('method') method: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ): Promise<string> {
    // Serialized here because Nest would send a bare string result as text, not JSON.
    return JSON.stringify(
      await this.invokeService(service, method, asArgs(body), clientAddress(ip)),
    );
  }

  private async invokeService(
    service: string,
    method: string,
    args: unknown[],
    client: ClientAddress,
  ): Promise<unknown> {
    if (service === 'Command' && method === 'sendCommand') {
      return this.commands.dispatch(args, client);
    }
    const target = this.registry.serviceMethod(service, method);
    if (!target) throw new NotFoundException(`${service}.${method} not found`);
    try {
      const result = await target.invoke(args, client);
      return result === undefined ? null : result;
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      // amfphp serializes a service exception as a 3-field fault: faultCode, faultString and a
      // faultDetail carrying the PHP file+line. We have no PHP source location, so faultDetail is
      // an empty string; the differential test masks it since the legacy value is an environment
      // path. The client only reads faultString / faultCode.
      return {
        faultCode: AMF_RUNTIME_ERROR,
        faultDetail: '',
        faultString: this.lang.messageOf(err),
      };
    }
  }
}
