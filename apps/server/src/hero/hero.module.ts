import { Module } from '@nestjs/common';
import { CityModule } from '../city/city.module';
import { GoodsModule } from '../goods/goods.module';
import { TaskModule } from '../task/task.module';
import { ArmorCommands } from './armor.commands';
import { BlackSmithCommands } from './blacksmith.commands';
import { HeroCommands } from './hero.commands';
import { HeroExprCommands } from './hero-expr.commands';
import { HeroExprTick } from './hero-expr.tick';
import { HotelCommands } from './hotel.commands';
import { SkillCommands } from './skill.commands';

/** HotelFunc.php, HeroFunc.php, ArmorFunc.php, HeroSkillFunc.php, EquipmentFunc.php and the 将领历练 settlement. */
@Module({
  imports: [CityModule, GoodsModule, TaskModule],
  providers: [
    ArmorCommands,
    BlackSmithCommands,
    HeroCommands,
    HeroExprCommands,
    HeroExprTick,
    HotelCommands,
    SkillCommands,
  ],
})
export class HeroModule {}
