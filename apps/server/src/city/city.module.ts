import { Module } from '@nestjs/common';
import { BuildingInfoService } from './building-info.service';
import { BuildingRules } from './building-rules.service';
import { BuildingCommands } from './building.commands';
import { CityBuildingsService } from './city-buildings.service';
import { CityCommandService, CityCommands } from './city.commands';
import { CityInfoService } from './city-info.service';
import { CityProductionService } from './city-production.service';
import { TechnicRules } from './technic-rules.service';
import { TechnicCommands } from './technic.commands';
import { TechnicTick } from './technic.tick';

/**
 * CityFunc.php, CityCommand.php, BuildingFunc.php, TechnicFunc.php, the city parts of
 * utils.php / global.php and the matching ReportCron.php settlements.
 */
@Module({
  providers: [
    BuildingCommands,
    BuildingInfoService,
    BuildingRules,
    CityBuildingsService,
    CityCommands,
    CityCommandService,
    CityInfoService,
    CityProductionService,
    TechnicCommands,
    TechnicRules,
    TechnicTick,
  ],
  exports: [BuildingRules, CityBuildingsService, CityInfoService, CityProductionService],
})
export class CityModule {}
