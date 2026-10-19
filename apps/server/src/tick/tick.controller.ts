import {
  Body,
  Controller,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { type TickClock, TickService } from './tick.service';

/** Lets the differential tests settle one slot at a chosen moment, like calling a cron function. */
@Controller('api/debug/tick')
export class TickController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tick: TickService,
  ) {}

  @Post(':order')
  async run(
    @Param('order', ParseIntPipe) order: number,
    @Body() body?: { clock?: TickClock },
  ): Promise<{ ran: string[] }> {
    if (!this.config.TICK_DEBUG_ENDPOINT) throw new NotFoundException();
    const clock = body?.clock;
    const valid =
      clock && Number.isInteger(clock.hour) && Number.isInteger(clock.weekday) ? clock : undefined;
    return { ran: await this.tick.runSlot(order, valid) };
  }
}
