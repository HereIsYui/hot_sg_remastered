import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { phpIntval } from '../core/php';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

/** mem_user_buffer.buftype of 徭役令, the item that adds a building queue. */
const YAOYILIN_BUFFER = 11;

/** BufferFunc.php: the time-limited effects of items on players and cities. */
@Injectable()
export class BufferCommands {
  constructor(private readonly scope: DbScope) {}

  /** `[]`: when the player's 徭役令 runs out, 0 without one. */
  @GlobalCommand()
  async getYaoYiLinTime(ctx: CommandContext): Promise<unknown[]> {
    const rows = await sql<{ endtime: unknown }>`select endtime from mem_user_buffer
      where uid = ${ctx.uid} and buftype = ${YAOYILIN_BUFFER} and endtime > unix_timestamp()`.execute(
      this.scope.db,
    );
    return [phpIntval(rows.rows[0]?.endtime ?? 0)];
  }
}
