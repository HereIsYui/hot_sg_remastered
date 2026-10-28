import { Module } from '@nestjs/common';
import { TaskModule } from '../task/task.module';
import { LotteryCommands } from './lottery.commands';

/** LotteryFunc.php — the 幸运宝盒 wheel commands. */
@Module({
  imports: [TaskModule],
  providers: [LotteryCommands],
  exports: [LotteryCommands],
})
export class LotteryModule {}
