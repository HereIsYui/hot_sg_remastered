import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { DatabaseHealth } from '../db/database.module';
import { HealthController } from './health.controller';

async function controllerWith(up: boolean) {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: DatabaseHealth, useValue: { ping: async () => up } }],
  }).compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('reports ok with protocol endpoints when the database answers', async () => {
    expect(await (await controllerWith(true)).check()).toEqual({
      status: 'ok',
      database: 'ok',
      endpoints: { command: '/api/command', service: '/api/service', push: '/ws' },
    });
  });

  it('reports degraded when the database is down', async () => {
    expect(await (await controllerWith(false)).check()).toMatchObject({
      status: 'degraded',
      database: 'down',
    });
  });
});
