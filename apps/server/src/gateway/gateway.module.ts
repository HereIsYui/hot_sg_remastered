import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { CommandService } from './command.service';
import { GatewayController } from './gateway.controller';
import { HandlerRegistry } from './handler-registry';
import { SessionService } from './session.service';

@Global()
@Module({
  imports: [DiscoveryModule],
  controllers: [GatewayController],
  providers: [HandlerRegistry, SessionService, CommandService],
  exports: [HandlerRegistry, SessionService, CommandService],
})
export class GatewayModule {}
