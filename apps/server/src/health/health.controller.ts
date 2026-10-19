import { Controller, Get } from '@nestjs/common';
import { COMMAND_ENDPOINT, PUSH_ENDPOINT } from '@hot/shared';
import { DatabaseHealth } from '../db/database.module';
import { SERVICE_ENDPOINT } from '../gateway/gateway.controller';

@Controller('api/health')
export class HealthController {
  constructor(private readonly database: DatabaseHealth) {}

  @Get()
  async check() {
    const up = await this.database.ping();
    return {
      status: up ? 'ok' : 'degraded',
      database: up ? 'ok' : 'down',
      endpoints: { command: COMMAND_ENDPOINT, service: SERVICE_ENDPOINT, push: PUSH_ENDPOINT },
    };
  }
}
