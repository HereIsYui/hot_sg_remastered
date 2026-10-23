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
 * The battle readers (getBattleReport / getBattleData / setSoldierTactics) and the report readers
 * are the 战报 + 战斗视图 read side; the battle ENGINE that writes mem_battle* / sys_report is the
 * parallel wave. The 洛阳 (luoyangTroopStart) dispatch is left to a later wave.
 *
 * `BattleModule` is imported so `TroopTick` can delegate the task-2 (侦察) arrival to `ScoutService`
 * (and, later, a patrol fight through `BattleEngineService`).
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
