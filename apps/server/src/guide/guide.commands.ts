import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { phpIntval } from '../core/php';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

/** GuideFunc.php: the 新手引导 steps shown after creating a role. */
@Injectable()
export class GuideCommands {
  constructor(private readonly scope: DbScope) {}

  /** `[group]`: `[steps of the group by gid]`. */
  @GlobalCommand()
  async getGuidesByGroup(_ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const group = phpIntval(param.shift());
    const rows = await sql`select b.* from cfg_guide b where \`group\` = ${String(group)}
      order by b.gid`.execute(this.scope.db);
    return [rows.rows];
  }

  /** `[gid]`: remembers the step as done. The original client never sends it. */
  @GlobalCommand()
  async completeGuide(ctx: CommandContext, param: unknown[]): Promise<void> {
    const gid = phpIntval(param.shift());
    await sql`insert into sys_user_guide (uid, gid, state, time)
      values (${ctx.uid}, ${gid}, 1, unix_timestamp())
      on duplicate key update state = 1`.execute(this.scope.db);
  }
}
