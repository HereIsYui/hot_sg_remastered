import { Module } from '@nestjs/common';
import { ExternService } from './extern.service';
import { StartTroopCommands } from './start-troop.commands';
import { TroopCommands } from './troop.commands';
import { TroopTick } from './troop.tick';

/**
 * GroundFunc.php (出征) + TroopFunc.php (军队面板) + ExternService.php (getTroopMaxTime) commands,
 * and the HandleTroop settlement of cfg_js.php on the 3s loop (TickOrder.Troop).
 *
 * The 洛阳 (luoyangTroopStart) dispatch and the battle readers / engine are left to later waves.
 */
@Module({
  providers: [ExternService, TroopCommands, StartTroopCommands, TroopTick],
})
export class TroopModule {}
