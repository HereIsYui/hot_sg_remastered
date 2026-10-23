import { Module } from '@nestjs/common';
import { GroundCommands } from './ground.commands';
import { GroundRules } from './ground-rules.service';

/**
 * GroundFunc.php: the 校场 (Ground). 募兵, 出征/防守战术, 伤兵/俘虏/逃兵 handling and 演习.
 * The 出征 dispatch itself (StartTroop / getTroopScheme / setTroopScheme / getTroopMaxTime) and
 * the 演习 battle simulation are the world-map / battle flows of a later wave and are not here.
 */
@Module({
  providers: [GroundCommands, GroundRules],
})
export class GroundModule {}
