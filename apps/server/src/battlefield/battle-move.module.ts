import { Module } from '@nestjs/common';
import { BattleMoveCommands } from './battle-move.commands';

/**
 * Battlefield march & engagement command face (评审 S4 前半): startBattleTroop /
 * getBattleFieldState / battleTroopDispatch / battleAttack / battlePatrol / selectOneTroop /
 * getInfoForBattleArmy* / getCurrentCityGroundLevel*.
 *
 * Sibling slices own the rest of the family: `BattlefieldModule` (battlefield.module.ts, S1
 * hall queries), the lifecycle commands (battle/), the troop-support commands (battle/, S4b)
 * and the tick/type-4 settlement (world/troop.tick.ts + battle/battle-result.ts). The shared
 * helpers those slices export (battlefield-troop-support.ts / battlefield-helpers.ts /
 * battlefield-utils.ts) are consumed, not duplicated. Registration: add `BattleMoveModule` to
 * app.module.ts (or fold the provider into BattlefieldModule) during integration.
 */
@Module({
  providers: [BattleMoveCommands],
})
export class BattleMoveModule {}
