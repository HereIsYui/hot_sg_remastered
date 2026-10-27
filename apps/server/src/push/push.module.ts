import { Global, Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { PushGateway } from './push.gateway';
import { PushService } from './push.service';
import { WarEventService } from './war-event.service';
import { UnionEventService } from './union-event.service';

@Global()
@Module({
  providers: [PushService, PushGateway, WarEventService, UnionEventService, ChatService],
  exports: [PushService, WarEventService],
})
export class PushModule {}
