import { Module } from '@nestjs/common';
import { GoodsModule } from '../goods/goods.module';
import { TaskModule } from '../task/task.module';
import { BattleArrivalService } from './battle-arrival.service';
import { BattleEngineService } from './battle-engine.service';
import { BattleLifecycleCommands } from './battle-lifecycle.commands';
import { BattleTick } from './battle.tick';
import { BattlefieldMetaCommands } from './battlefield-meta.commands';
import { ScoutService } from './scout';
import { OldBattleService } from './old-battle.service';

/**
 * `battle` module (design §6): cfg_js.php HandleBattle + the 演习 simulator (upManeuver / battleInfo)
 * on the TickOrder.Battle slot, AND the time-stepped city / field engine (OLdBattleCron.php:
 * HandleBattle / updateBattle / return_new_place / getBattleResult) now ported as
 * `OldBattleService`. The cross-server / 洛阳 / 赤壁 paths (BattleFunc.php) stay out.
 *
 * `BattleLifecycleCommands` (阶段 9 S2) carries the BloodBattle quit / invite lifecycle
 * (BattleFunc.php getQuitResult / quitBattle / invite 三条).
 *
 * `BattlefieldMetaCommands` (阶段 9 S5) carries the battlefield meta periphery (BattleFunc.php
 * 任务面板 / NPC 对话 / 战场商城 / 荣誉统计); it injects TaskGoals, hence the TaskModule import.
 *
 * `BattleEngineService` is exported so the world module's HandleTroop can settle a 侦察 patrol
 * through the same pure loop; `ScoutService` holds the task-2 (侦察) arrival and
 * `BattleArrivalService` the task-3/4/9 arrival that starts a time-stepped battle.
 */
@Module({
  imports: [GoodsModule, TaskModule],
  providers: [
    BattleEngineService,
    BattleTick,
    ScoutService,
    OldBattleService,
    BattleArrivalService,
    BattleLifecycleCommands,
    BattlefieldMetaCommands,
  ],
  exports: [
    BattleEngineService,
    ScoutService,
    BattleArrivalService,
    // Exported so app.module.ts can wire the BATTLEFIELD_QUIT hook of
    // BattlefieldTroopSupportModule to BattleLifecycleCommands.quitBattle
    // (callBackArmy's bid=5001 auto-fail branch).
    BattleLifecycleCommands,
  ],
})
export class BattleModule {}
