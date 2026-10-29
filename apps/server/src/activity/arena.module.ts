import { Module } from '@nestjs/common';
import { TaskModule } from '../task/task.module';
import { ArenaCommands } from './arena.commands';
import { PkEngine } from './pk-engine';

/**
 * PKFunc.php — the 竞技场 arena commands plus the shared startUserPK PK engine (PKFunc.php:9-208,
 * also the 过关斩将 campaign's battle core). The cross-server part (CrossAssembleSend,
 * CrossArenaDialog) belongs to the cross-server family and is not registered here.
 */
@Module({
  imports: [TaskModule],
  providers: [ArenaCommands, PkEngine],
  exports: [PkEngine],
})
export class ArenaModule {}
