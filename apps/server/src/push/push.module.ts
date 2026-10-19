import { Global, Module } from '@nestjs/common';
import { PushGateway } from './push.gateway';
import { PushService } from './push.service';

@Global()
@Module({
  providers: [PushService, PushGateway],
  exports: [PushService],
})
export class PushModule {}
