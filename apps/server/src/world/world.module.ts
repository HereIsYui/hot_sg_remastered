import { Module } from '@nestjs/common';
import { CityFoundCommands } from './city-found.commands';
import { GovernCommands } from './govern.commands';
import { WorldCommands } from './world.commands';
import { WorldRefreshService } from './world-refresh.tick';
import { WorldStubCommands } from './world-stub.commands';

/**
 * WorldFunc.php (and the 野地 parts of utils.php / UtilsExtend.php): the world-map query and
 * utility commands, plus the 8-hour wild-field refresh job. 野地建城 (createCityFromLand) lives in
 * CityFoundCommands and 政令 (governOthers) in GovernCommands; the remaining stubs (startWar,
 * unionAssit, mergeCity) wait for a later wave.
 */
@Module({
  providers: [
    WorldCommands,
    WorldStubCommands,
    WorldRefreshService,
    CityFoundCommands,
    GovernCommands,
  ],
})
export class WorldModule {}
