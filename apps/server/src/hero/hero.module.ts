import { Module } from '@nestjs/common';
import { CityModule } from '../city/city.module';
import { GoodsModule } from '../goods/goods.module';
import { TaskModule } from '../task/task.module';
import { HeroCommands } from './hero.commands';
import { HotelCommands } from './hotel.commands';

/** HotelFunc.php and HeroFunc.php. */
@Module({
  imports: [CityModule, GoodsModule, TaskModule],
  providers: [HeroCommands, HotelCommands],
})
export class HeroModule {}
