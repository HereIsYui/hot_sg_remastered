import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { DbScope } from '../db/database.module';
import { TickHandler, TickOrder } from '../tick/tick.decorator';
import { BattleEngineService } from './battle-engine.service';

type Row = Record<string, unknown>;

/**
 * cfg_js.php::HandleBattle (TickOrder.Battle slot, which runs right after HandleTroop as the
 * original loop ordered them). Two kinds of combat settle here:
 *
 *   1. 演习 maneuvers (`mem_maneuver.state=0`) — the instant simulator. PORTED: delegated to
 *      `BattleEngineService.settlePendingManeuvers`, which runs the pure `upManeuver` loop and
 *      writes the result back. The 校场 演习 command and 侦察 patrols both land here.
 *
 *   2. The time-stepped city / field battle (`mem_battle.nexttime <= now`) driven by
 *      `OLdBattleCron.php::updateBattle` / `return_new_place` / `getBattleResult` over many ticks.
 *      NOT PORTED yet: `return_new_place` alone is ~700 lines of positional, tech- and skill-laden
 *      round simulation threaded through PHP `$_SESSION` caches. The scaffold below reads the due
 *      rows and logs them so the slot is wired and observable, but leaves each `mem_battle` row in
 *      place (its `nexttime` keeps it due) for the wave that ports the engine — no data is lost and
 *      no half-finished battle is written.
 */
@Injectable()
export class BattleTick {
  private readonly logger = new Logger(BattleTick.name);

  constructor(
    private readonly scope: DbScope,
    private readonly engine: BattleEngineService,
  ) {}

  @TickHandler(TickOrder.Battle)
  async handleBattle(): Promise<void> {
    // 1) 演习 — instant maneuvers. Each settles in its own transaction (HandleBattle never throws a
    //    success message, so wrapping the writes is safe and isolates one bad row from the batch).
    await this.settleManeuvers();

    // 2) Time-stepped mem_battle — scaffold only.
    await this.scaffoldTimedBattles();
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

  /**
   * HandleBattle's `mem_battle` loop, reduced to observation. The original deleted a `mem_battle`
   * whose `sys_battle.state=1` (already finished) and otherwise called `updateBattle`. Until
   * `return_new_place` is ported we only surface due battles; we deliberately do NOT delete or
   * advance any row.
   */
  private async scaffoldTimedBattles(): Promise<void> {
    const due = (
      await sql<Row>`select id from mem_battle where nexttime <= unix_timestamp()`.execute(
        this.scope.db,
      )
    ).rows;
    if (due.length > 0) {
      this.logger.debug(
        `${due.length} mem_battle row(s) due — time-stepped engine (OLdBattleCron.updateBattle) not ported; left in place`,
      );
    }
  }
}
