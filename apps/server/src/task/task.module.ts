import { Module } from '@nestjs/common';
import { TaskGoals } from './task-goals.service';
import { TaskRewards } from './task-rewards.service';
import { TaskCommands } from './task.commands';

/** TaskFunc.php. */
@Module({
  providers: [TaskCommands, TaskGoals, TaskRewards],
  exports: [TaskGoals, TaskRewards],
})
export class TaskModule {}
