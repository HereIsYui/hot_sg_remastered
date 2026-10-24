import { Module } from '@nestjs/common';
import { CityFoundCommands } from './city-found.commands';
import { WorldCommands } from './world.commands';
import { WorldRefreshService } from './world-refresh.tick';
import { WorldStubCommands } from './world-stub.commands';

/**
 * WorldFunc.php (and the 野地 parts of utils.php / UtilsExtend.php): the world-map query and
 * utility commands, plus the 8-hour wild-field refresh job. The remaining battle / troop-dispatch
 * action commands (governOthers, startWar, unionAssit, mergeCity) are stubbed here until a later
 * wave; 野地建城 (createCityFromLand) lives in CityFoundCommands.
 */
@Module({
  providers: [WorldCommands, WorldStubCommands, WorldRefreshService, CityFoundCommands],
})
export class WorldModule {}
