import { Module } from '@nestjs/common';
import { GoodsModule } from '../goods/goods.module';
import { TaskModule } from '../task/task.module';
import { ShopCommands } from './shop.commands';

/** ShopFunc.php: the shop list, buying, buy-and-use and 礼券 redemption. */
@Module({
  imports: [GoodsModule, TaskModule],
  providers: [ShopCommands],
})
export class ShopModule {}
