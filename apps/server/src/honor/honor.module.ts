import { Module } from '@nestjs/common';
import { CityModule } from '../city/city.module';
import { HonorCommands } from './honor.commands';

/**
 * 君主荣誉: the monarch detail / designation commands of UserFunc.php (loadUserDetail,
 * loadUserDetailInfo, changeUserDesignation), the campaign-medal commands of BattleFunc.php
 * (medalChange, getMedalRecord) and the praise command of HeroFunc.php (praiseHero).
 */
@Module({
  imports: [CityModule],
  providers: [HonorCommands],
})
export class HonorModule {}
