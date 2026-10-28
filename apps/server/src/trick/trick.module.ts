import { Module } from '@nestjs/common';
import { HeroModule } from '../hero/hero.module';
import { TroopModule } from '../world/troop.module';
import { TrickCommands } from './trick.commands';

/**
 * TrickFunc.php (计谋 getTrickList / useTrick) + BufferFunc.php::getTrickBuffer.
 *
 * `TroopModule` / `HeroModule` are imported for the shared 釜底抽薪 helpers
 * (TroopCommands.recallTroop / HeroExprCommands.cancelExpr).
 */
@Module({
  imports: [TroopModule, HeroModule],
  providers: [TrickCommands],
})
export class TrickModule {}
