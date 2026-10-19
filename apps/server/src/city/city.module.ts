import { Module } from '@nestjs/common';
import { BuildingRules } from './building-rules.service';
import { BuildingCommands } from './building.commands';
import { CityBuildingsService } from './city-buildings.service';
import { CityCommandService, CityCommands } from './city.commands';
import { CityInfoService } from './city-info.service';
import { CityProductionService } from './city-production.service';

/** CityFunc.php, CityCommand.php, BuildingFunc.php and the city parts of utils.php / global.php. */
@Module({
  providers: [
    BuildingCommands,
    BuildingRules,
    CityBuildingsService,
    CityCommands,
    CityCommandService,
    CityInfoService,
    CityProductionService,
  ],
  exports: [BuildingRules, CityBuildingsService, CityInfoService, CityProductionService],
})
export class CityModule {}
