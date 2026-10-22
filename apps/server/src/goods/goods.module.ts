import { forwardRef, Module } from '@nestjs/common';
import { CityModule } from '../city/city.module';
import { HeroModule } from '../hero/hero.module';
import { TaskModule } from '../task/task.module';
import { BufferGoods } from './buffer-goods.service';
import { DefaultBoxService } from './default-box.service';
import { GoodsCommands } from './goods.commands';
import { TypeGoodsCommands } from './type-goods.commands';

/** GoodsFunc.php. */
@Module({
  imports: [CityModule, TaskModule, forwardRef(() => HeroModule)],
  providers: [GoodsCommands, TypeGoodsCommands, BufferGoods, DefaultBoxService],
  exports: [DefaultBoxService],
})
export class GoodsModule {}
