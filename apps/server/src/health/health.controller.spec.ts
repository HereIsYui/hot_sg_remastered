import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports ok with protocol endpoints', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    const controller = moduleRef.get(HealthController);
    expect(controller.check()).toEqual({
      status: 'ok',
      endpoints: { command: '/api/command', push: '/ws' },
    });
  });
});
