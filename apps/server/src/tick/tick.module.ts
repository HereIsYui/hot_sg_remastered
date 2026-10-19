import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TickController } from './tick.controller';
import { TickService } from './tick.service';

@Global()
@Module({
  imports: [DiscoveryModule, ScheduleModule.forRoot()],
  controllers: [TickController],
  providers: [TickService],
  exports: [TickService],
})
export class TickModule {}
