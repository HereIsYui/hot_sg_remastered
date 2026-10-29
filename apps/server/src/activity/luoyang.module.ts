import { Module } from '@nestjs/common';
import { TaskModule } from '../task/task.module';
import { LuoyangCommands } from './luoyang.commands';

/** LuoyangFunc.php — the 洛阳战场 commands (openfunc lang.php:2652). */
@Module({
  imports: [TaskModule],
  providers: [LuoyangCommands],
  exports: [LuoyangCommands],
})
export class LuoyangModule {}
