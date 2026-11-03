import { Module } from '@nestjs/common';
import { BattlefieldCommands } from './battlefield.commands';

/**
 * 战场大厅 (BattleFunc.php 阶段 9 S1, 评审 §4 S1): the login / 战况-entry command surface —
 * the hall list readers, the battlefield snapshot polls, the medal-exchange quote, the
 * double-rate timetable and the 赤壁 gates. Everything it injects (DbScope / LangService /
 * GoodsRules / UserRules) comes from the global core modules; the shared
 * `firstGetUserBattleInfo` / `ifFrozeExit` helpers are plain imports from the battle module's
 * battlefield-troop-support, so no provider wiring is needed.
 */
@Module({
  providers: [BattlefieldCommands],
})
export class BattlefieldModule {}
