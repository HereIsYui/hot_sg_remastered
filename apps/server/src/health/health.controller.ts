import { Controller, Get } from '@nestjs/common';
import { COMMAND_ENDPOINT, PUSH_ENDPOINT } from '@hot/shared';

@Controller('api/health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      endpoints: { command: COMMAND_ENDPOINT, push: PUSH_ENDPOINT },
    };
  }
}
