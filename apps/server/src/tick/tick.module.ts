import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TickService } from './tick.service';

@Global()
@Module({
  imports: [DiscoveryModule, ScheduleModule.forRoot()],
  providers: [TickService],
  exports: [TickService],
})
export class TickModule {}
