import { Module } from '@nestjs/common';
import { TaskModule } from '../task/task.module';
import { LoginActivityCommands } from './login-activity.commands';

@Module({
  imports: [TaskModule],
  providers: [LoginActivityCommands],
})
export class LoginActivityModule {}
