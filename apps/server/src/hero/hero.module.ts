import { Module } from '@nestjs/common';
import { CityModule } from '../city/city.module';
import { GoodsModule } from '../goods/goods.module';
import { TaskModule } from '../task/task.module';
import { HotelCommands } from './hotel.commands';

/** HotelFunc.php and HeroFunc.php. */
@Module({
  imports: [CityModule, GoodsModule, TaskModule],
  providers: [HotelCommands],
})
export class HeroModule {}
