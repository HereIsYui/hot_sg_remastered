import { Module } from '@nestjs/common';
import { BattleModule } from '../battle/battle.module';
import { BattleReadCommands } from './battle-read.commands';
import { ExternService } from './extern.service';
import { ReportCommands } from './report.commands';
import { StartTroopCommands } from './start-troop.commands';
import { TroopCommands } from './troop.commands';
import { TroopTick } from './troop.tick';

/**
 * GroundFunc.php (出征) + TroopFunc.php (军队面板 + battle readers) + ExternService.php
 * (getTroopMaxTime) commands, ReportFunc.php (战报) + HeroFunc.php::getKingReward, and the
 * HandleTroop settlement of cfg_js.php on the 3s loop (TickOrder.Troop).
 *
 * The battle ENGINE lives in BattleModule; TroopTick imports it so HandleTroop's task-3/4/9 arrival
 * (掠夺/占领/攻击) can start a time-stepped battle through `BattleArrivalService`. The 洛阳
 * (luoyangTroopStart) dispatch is left to a later wave.
 */
@Module({
  imports: [BattleModule],
  providers: [
    ExternService,
    TroopCommands,
    StartTroopCommands,
    TroopTick,
    ReportCommands,
    BattleReadCommands,
  ],
})
export class TroopModule {}
