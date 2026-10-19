import { Module } from '@nestjs/common';
import { RankModule } from '../rank/rank.module';
import { BuildingInfoService } from './building-info.service';
import { BuildingRules } from './building-rules.service';
import { BuildingCommands } from './building.commands';
import { CityBuildingsService } from './city-buildings.service';
import { CityListCommands } from './city-list.commands';
import { CityCommandService, CityCommands } from './city.commands';
import { CityInfoService } from './city-info.service';
import { CityProductionService } from './city-production.service';
import { CurseTick } from './curse.tick';
import { DefenceRules } from './defence-rules.service';
import { DefenceCommands } from './defence.commands';
import { DefenceTick } from './defence.tick';
import { GovernmentCommands } from './government.commands';
import { SoldierRules } from './soldier-rules.service';
import { SoldierCommands } from './soldier.commands';
import { SoldierTick } from './soldier.tick';
import { TechnicRules } from './technic-rules.service';
import { TechnicCommands } from './technic.commands';
import { TechnicTick } from './technic.tick';

/**
 * CityFunc.php, CityCommand.php, BuildingFunc.php, TechnicFunc.php, SoldierFunc.php,
 * DefenceFunc.php, the city parts of utils.php / global.php and the matching ReportCron.php
 * settlements.
 */
@Module({
  imports: [RankModule],
  providers: [
    BuildingCommands,
    BuildingInfoService,
    BuildingRules,
    CityBuildingsService,
    CityCommands,
    CityCommandService,
    CityListCommands,
    CityInfoService,
    CityProductionService,
    CurseTick,
    DefenceCommands,
    DefenceRules,
    DefenceTick,
    GovernmentCommands,
    SoldierCommands,
    SoldierRules,
    SoldierTick,
    TechnicCommands,
    TechnicRules,
    TechnicTick,
  ],
  exports: [BuildingRules, CityBuildingsService, CityInfoService, CityProductionService],
})
export class CityModule {}
