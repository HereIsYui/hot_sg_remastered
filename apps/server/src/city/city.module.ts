import { Module } from '@nestjs/common';
import { CityBuildingsService } from './city-buildings.service';
import { CityCommandService, CityCommands } from './city.commands';
import { CityInfoService } from './city-info.service';
import { CityProductionService } from './city-production.service';

/** CityFunc.php, CityCommand.php and the city parts of utils.php / global.php. */
@Module({
  providers: [
    CityBuildingsService,
    CityCommands,
    CityCommandService,
    CityInfoService,
    CityProductionService,
  ],
  exports: [CityBuildingsService, CityInfoService, CityProductionService],
})
export class CityModule {}
