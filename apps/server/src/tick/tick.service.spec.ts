import { Global, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { APP_CONFIG, loadConfig } from '../config/app-config';
import { TickHandler, TickOrder } from './tick.decorator';
import { TickModule } from './tick.module';
import { TickService } from './tick.service';

const order: string[] = [];

@Injectable()
class Handlers {
  @TickHandler(TickOrder.Battle)
  async battle() {
    await new Promise((r) => setTimeout(r, 5));
    order.push('battle');
  }

  @TickHandler(TickOrder.Troop)
  troop() {
    order.push('troop');
    throw new Error('troop exploded');
  }

  @TickHandler(TickOrder.Trade)
  trade() {
    order.push('trade');
  }
}

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useValue: loadConfig({ TICK_ENABLED: 'false' }) }],
  exports: [APP_CONFIG],
})
class TestConfigModule {}

async function tickService() {
  const moduleRef = await Test.createTestingModule({
    imports: [TestConfigModule, TickModule],
    providers: [Handlers],
  }).compile();
  await moduleRef.init();
  return moduleRef.get(TickService);
}

describe('TickService', () => {
  it('runs handlers in cfg_js.php order and isolates failures', async () => {
    const tick = await tickService();
    expect(tick.handlerNames).toEqual(['Handlers.troop', 'Handlers.battle', 'Handlers.trade']);
    order.length = 0;
    const report = await tick.runOnce();
    expect(order).toEqual(['troop', 'battle', 'trade']);
    expect(report.failed).toEqual(['Handlers.troop']);
  });

  it('does not overlap passes', async () => {
    const tick = await tickService();
    order.length = 0;
    const [first, second] = await Promise.all([tick.tick(), tick.tick()]);
    expect(first?.failed).toEqual(['Handlers.troop']);
    expect(second).toBeNull();
    expect(order.filter((x) => x === 'battle')).toHaveLength(1);
  });
});
