import { Injectable, Logger } from '@nestjs/common';
import { DbScope } from '../db/database.module';
import { TickHandler, TickOrder } from '../tick/tick.decorator';
import { BattleEngineService } from './battle-engine.service';
import { OldBattleService } from './old-battle.service';

/**
 * cfg_js.php::HandleBattle (TickOrder.Battle slot, which runs right after HandleTroop as the
 * original loop ordered them). Two kinds of combat settle here:
 *
 *   1. 演习 maneuvers (`mem_maneuver.state=0`) — the instant simulator. Delegated to
 *      `BattleEngineService.settlePendingManeuvers`, which runs the pure `upManeuver` loop and
 *      writes the result back. The 校场 演习 command and 侦察 patrols both land here.
 *
 *   2. The time-stepped city / field battle (`mem_battle.nexttime <= now`) driven by
 *      `OLdBattleCron.php::HandleBattle` / `updateBattle` / `return_new_place` / `getBattleResult`.
 *      Now PORTED: delegated to `OldBattleService.settleDueBattles`, which advances each due battle
 *      one round and runs the terminal settlement when a side is wiped out.
 */
@Injectable()
export class BattleTick {
  private readonly logger = new Logger(BattleTick.name);

  constructor(
    private readonly scope: DbScope,
    private readonly engine: BattleEngineService,
    private readonly oldBattle: OldBattleService,
  ) {}

  @TickHandler(TickOrder.Battle)
  async handleBattle(): Promise<void> {
    // 1) 演习 — instant maneuvers. Each settles in its own transaction (HandleBattle never throws a
    //    success message, so wrapping the writes is safe and isolates one bad row from the batch).
    await this.settleManeuvers();

    // 2) Time-stepped mem_battle — the OLdBattleCron engine (its own per-battle transactions).
    await this.oldBattle.settleDueBattles();
  }

  private async settleManeuvers(): Promise<void> {
    try {
      await this.scope.transaction(() => this.engine.settlePendingManeuvers());
    } catch (err) {
      this.logger.error(
        `maneuver settlement failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
    }
  }
}
