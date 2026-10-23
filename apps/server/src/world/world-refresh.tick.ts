import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { sql } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { phpIntval } from '../core/php';
import { DbScope } from '../db/database.module';

type Row = Record<string, unknown>;

const INTERVAL_NAME = 'world-refresh';

/**
 * mem_state row holding the last 野地刷新 run time, so the 8-hour cadence survives a restart.
 * mem_state is the same numeric key/value store HandleUsersRank stamps (state 10); 112 is unused
 * by the shipped save (MinorityRegionOpen is 111, Operator 197), so this is append-only.
 */
export const WORLD_REFRESH_STATE = 112;

/**
 * The periodic 野地刷新 the plan schedules every 8 hours (`design/02-开发计划.md`, 阶段 5). The
 * original lived in the closed-source 易语言 backend (no PHP source — see the plan's black-box
 * note), so this is a faithful reconstruction from the data model rather than a line port:
 *
 *  - Abandoned wild fields (`mem_world.type > 0`, `ownercid = 0`, `state = 0`) that have decayed
 *    below their `maxlevel` regrow one level toward it, and `updatetime` is stamped so the client's
 *    block data reflects the change on the next `getBlockData`.
 *  - Their NPC garrison schedule (`mem_world_schedule.last_create_npc`) is cleared so the on-demand
 *    `checkSodier` path (UtilsExtend.php) respawns defenders at the refreshed level on the next
 *    battle, exactly as a long-idle field behaves.
 *
 * It is NOT one of the `cfg_js.php` 3-second settlement slots, so it is a standalone interval
 * rather than a `@TickHandler`. `refresh(now)` is the testable core; the interval only gates it on
 * the persisted last-run time and calls it.
 */
@Injectable()
export class WorldRefreshService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorldRefreshService.name);
  private running: Promise<number> | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly scope: DbScope,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.WORLD_REFRESH_ENABLED) {
      this.logger.warn('wild-field refresh disabled (WORLD_REFRESH_ENABLED=false)');
      return;
    }
    // The check cadence is a fraction of the window so a restart cannot delay a due run by 8h; the
    // DB timestamp is the real gate, so firing early is a no-op until the window has elapsed.
    const checkMs = Math.max(60_000, Math.floor(this.config.WORLD_REFRESH_INTERVAL_MS / 8));
    const timer = setInterval(() => void this.tick(), checkMs);
    this.scheduler.addInterval(INTERVAL_NAME, timer);
    this.logger.log(`wild-field refresh armed (every ${this.config.WORLD_REFRESH_INTERVAL_MS}ms)`);
  }

  onApplicationShutdown(): void {
    if (this.scheduler.doesExist('interval', INTERVAL_NAME)) {
      this.scheduler.deleteInterval(INTERVAL_NAME);
    }
  }

  /** Runs one refresh if the 8-hour window has elapsed; concurrent callers share the pass. */
  async tick(): Promise<number | null> {
    if (this.running) return null;
    const now = phpIntval(
      (await sql<{ now: number }>`select unix_timestamp() as now`.execute(this.scope.db)).rows[0]
        ?.now,
    );
    const last = await this.lastRun();
    if (now - last < Math.floor(this.config.WORLD_REFRESH_INTERVAL_MS / 1000)) return null;
    this.running = this.refresh(now).finally(() => {
      this.running = null;
    });
    const touched = await this.running;
    this.logger.log(`wild-field refresh: ${touched} field(s) regenerated`);
    return touched;
  }

  /**
   * Regenerates abandoned wild fields and returns the number touched. Stamps the run time first so
   * two nodes cannot both claim the same window.
   */
  async refresh(now: number): Promise<number> {
    return this.scope.transaction(async () => {
      const db = this.scope.db;
      await sql`update mem_state set value = ${now} where state = ${WORLD_REFRESH_STATE}`.execute(
        db,
      );
      const grow = await sql`update mem_world set level = level + 1, updatetime = ${now}
        where type > 0 and ownercid = 0 and state = 0 and level < maxlevel`.execute(db);
      const touched = phpIntval(grow.numAffectedRows ?? 0n);
      // Clear the NPC garrison schedule of the regrown fields so defenders respawn at the new level.
      await sql`update mem_world_schedule set last_create_npc = 0
        where wid in (select wid from mem_world
          where type > 0 and ownercid = 0 and state = 0 and updatetime = ${now})`.execute(db);
      return touched;
    });
  }

  private async lastRun(): Promise<number> {
    const row = await sql<{ value: unknown }>`select value from mem_state
      where state = ${WORLD_REFRESH_STATE}`.execute(this.scope.db);
    return phpIntval((row.rows[0] as Row | undefined)?.value);
  }
}
