import { Module } from '@nestjs/common';
import { WorldCommands } from './world.commands';
import { WorldRefreshService } from './world-refresh.tick';
import { WorldStubCommands } from './world-stub.commands';

/**
 * WorldFunc.php (and the 野地 parts of utils.php / UtilsExtend.php): the world-map query and
 * utility commands, plus the 8-hour wild-field refresh job. The battle / troop-dispatch action
 * commands (createCityFromLand, governOthers, startWar, unionAssit, mergeCity) are stubbed here
 * until a later wave.
 */
@Module({
  providers: [WorldCommands, WorldStubCommands, WorldRefreshService],
})
export class WorldModule {}
