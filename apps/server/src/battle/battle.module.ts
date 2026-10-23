import { Module } from '@nestjs/common';
import { BattleEngineService } from './battle-engine.service';
import { BattleTick } from './battle.tick';

/**
 * `battle` module (design §6): cfg_js.php HandleBattle + the 演习 simulator (upManeuver / battleInfo)
 * on the TickOrder.Battle slot. The time-stepped city / field engine (OLdBattleCron.php) is scaffolded
 * but not yet ported; the cross-server / 洛阳 / 赤壁 / BloodBattle paths (BattleFunc.php) stay out.
 *
 * `BattleEngineService` is exported so the world module's HandleTroop can settle a 侦察 patrol
 * through the same pure loop.
 */
@Module({
  providers: [BattleEngineService, BattleTick],
  exports: [BattleEngineService],
})
export class BattleModule {}
