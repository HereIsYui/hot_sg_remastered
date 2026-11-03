import {
  Module,
  type DynamicModule,
  type ForwardReference,
  type Provider,
  type Type,
} from '@nestjs/common';
import { BattlefieldTroopSupportCommands } from './battlefield-troop-support.commands';

/**
 * BattleFunc.php battlefield troop-support commands (stage 9 / S4 second half:
 * 援军 / 召军 / 回军 / 加速 / 探索). Everything it injects (DbScope / LangService / GoodsRules /
 * ReportService) comes from the global core modules, so no imports are needed — importing the
 * module class directly is enough.
 *
 * The optional `register(quitProvider)` variant is where the join/quit slice's quitBattle gets
 * wired once it exists — the provider must be bound to the BATTLEFIELD_QUIT token (exported from
 * the commands file). `BattleLifecycleCommands.quitBattle` is the natural target:
 *
 *   BattlefieldTroopSupportModule.register({
 *     provide: BATTLEFIELD_QUIT,
 *     useFactory: (quit: BattleLifecycleCommands) => ({
 *       quitBattle: (uid, _param) => quit.quitBattle({ uid, cid: 0, ip: 0, sip: '' }),
 *     }),
 *     inject: [BattleLifecycleCommands],
 *   })
 *
 * (quitBattle's `$param` — the monarch name — is never read by the original's quitBattle body.)
 * Until then callBackArmy's bid=5001 branch logs and skips (see the commands file header).
 */
@Module({
  providers: [BattlefieldTroopSupportCommands],
  exports: [BattlefieldTroopSupportCommands],
})
export class BattlefieldTroopSupportModule {
  static register(
    quitProvider?: Provider,
    imports: Array<Type | DynamicModule | ForwardReference> = [],
  ): DynamicModule {
    return {
      module: BattlefieldTroopSupportModule,
      // `imports` carries the module exporting the quit provider's injected dependencies (e.g.
      // BattleModule for BattleLifecycleCommands — a factory's `inject` only sees providers of
      // IMPORTED modules, not AppModule siblings).
      imports,
      providers: quitProvider
        ? [BattlefieldTroopSupportCommands, quitProvider]
        : [BattlefieldTroopSupportCommands],
      exports: [BattlefieldTroopSupportCommands],
    };
  }
}
