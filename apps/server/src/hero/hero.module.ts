import { Module } from '@nestjs/common';
import { CityModule } from '../city/city.module';
import { GoodsModule } from '../goods/goods.module';
import { TaskModule } from '../task/task.module';
import { ArmorCommands } from './armor.commands';
import { BlackSmithCommands } from './blacksmith.commands';
import { HeroCommands } from './hero.commands';
import { HotelCommands } from './hotel.commands';
import { SkillCommands } from './skill.commands';

/** HotelFunc.php, HeroFunc.php, ArmorFunc.php, HeroSkillFunc.php and EquipmentFunc.php. */
@Module({
  imports: [CityModule, GoodsModule, TaskModule],
  providers: [ArmorCommands, BlackSmithCommands, HeroCommands, HotelCommands, SkillCommands],
})
export class HeroModule {}
