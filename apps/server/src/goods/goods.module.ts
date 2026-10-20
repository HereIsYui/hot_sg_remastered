import { Module } from '@nestjs/common';
import { TaskModule } from '../task/task.module';
import { GoodsCommands } from './goods.commands';

/** GoodsFunc.php. */
@Module({ imports: [TaskModule], providers: [GoodsCommands] })
export class GoodsModule {}
