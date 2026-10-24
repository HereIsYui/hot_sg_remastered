import { Module } from '@nestjs/common';
import { UnionCommands } from './union.commands';
import { TaskModule } from '../task/task.module';

/** UnionFunc.php wave 3a: founding, applying and the 鸿胪寺 view; member management later. */
@Module({
  imports: [TaskModule],
  providers: [UnionCommands],
})
export class UnionModule {}
