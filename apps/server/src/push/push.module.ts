import { Global, Module } from '@nestjs/common';
import { PushGateway } from './push.gateway';
import { PushService } from './push.service';
import { WarEventService } from './war-event.service';

@Global()
@Module({
  providers: [PushService, PushGateway, WarEventService],
  exports: [PushService, WarEventService],
})
export class PushModule {}
