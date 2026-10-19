import { Controller, Inject, NotFoundException, Param, ParseIntPipe, Post } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { TickService } from './tick.service';

/** Lets the differential tests settle one slot at a chosen moment, like calling a cron function. */
@Controller('api/debug/tick')
export class TickController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tick: TickService,
  ) {}

  @Post(':order')
  async run(@Param('order', ParseIntPipe) order: number): Promise<{ ran: string[] }> {
    if (!this.config.TICK_DEBUG_ENDPOINT) throw new NotFoundException();
    return { ran: await this.tick.runSlot(order) };
  }
}
