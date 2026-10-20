import { Module } from '@nestjs/common';
import { CityModule } from '../city/city.module';
import { TaskModule } from '../task/task.module';
import { GoodsCommands } from './goods.commands';
import { TypeGoodsCommands } from './type-goods.commands';

/** GoodsFunc.php. */
@Module({ imports: [CityModule, TaskModule], providers: [GoodsCommands, TypeGoodsCommands] })
export class GoodsModule {}
