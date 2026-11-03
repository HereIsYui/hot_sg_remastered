import { Module } from '@nestjs/common';
import { BattlefieldLifecycleCommands } from './battlefield-lifecycle.commands';

/**
 * 战场 lifecycle (阶段 9 slice S2 前半, BattleFunc.php): createBattle / joinToBattle /
 * joinToPVPBattle / getBattleInvite plus the shared internal helpers of
 * battlefield-helpers.ts / battlefield-utils.ts. All collaborator services (DbScope, LangService,
 * GoodsRules, UserRules, RandomService) come from the global Database/Common/Core modules, so no
 * imports are needed — registered by the integrator in app.module.ts.
 */
@Module({
  providers: [BattlefieldLifecycleCommands],
})
export class BattlefieldLifecycleModule {}
