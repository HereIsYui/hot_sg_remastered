import { Module } from '@nestjs/common';
import { BattleArrivalService } from './battle-arrival.service';
import { BattleEngineService } from './battle-engine.service';
import { BattleTick } from './battle.tick';
import { OldBattleService } from './old-battle.service';

/**
 * `battle` module (design §6): cfg_js.php HandleBattle + the 演习 simulator (upManeuver / battleInfo)
 * on the TickOrder.Battle slot, AND the time-stepped city / field engine (OLdBattleCron.php:
 * HandleBattle / updateBattle / return_new_place / getBattleResult) now ported as
 * `OldBattleService`. The cross-server / 洛阳 / 赤壁 / BloodBattle paths (BattleFunc.php) stay out.
 *
 * `BattleEngineService` is exported so the world module's HandleTroop can settle a 侦察 patrol
 * through the same pure loop; `BattleArrivalService` is exported so HandleTroop's task-3/4/9 arrival
 * can start a time-stepped battle.
 */
@Module({
  providers: [BattleEngineService, BattleTick, OldBattleService, BattleArrivalService],
  exports: [BattleEngineService, BattleArrivalService],
})
export class BattleModule {}
