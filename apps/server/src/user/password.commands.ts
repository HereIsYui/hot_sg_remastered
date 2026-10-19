import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { GameError } from '../common/game-error';
import { phpString, phpTrim } from '../core/php';
import { DbScope } from '../db/database.module';
import { GlobalCommand, type CommandContext } from '../gateway/decorators';

const md5 = (text: string) => createHash('md5').update(text).digest('hex');

/** The 2级密码 that guards discarding cities, dismissing heroes and armies (utils.php). */
@Injectable()
export class PasswordCommands {
  constructor(private readonly scope: DbScope) {}

  /**
   * `[type, salt, password]` → `[type, notSetYet]` or `[type, false, matches]`; the client
   * runs the guarded action of `type` itself when the password matches.
   */
  @GlobalCommand()
  async openLock(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const [type, salt, password] = param;
    const stored = await this.stored(ctx.uid);
    if (stored === undefined) return [type, true];
    return [type, false, stored === md5(phpTrim(password) + phpString(salt))];
  }

  /**
   * `[old, salt, new]` → `[1]` when the first password was set (any old one is accepted),
   * `[2]` when the old one matched and was replaced.
   */
  @GlobalCommand()
  async modifyPassword(ctx: CommandContext, param: unknown[]): Promise<unknown[]> {
    const uid = ctx.uid;
    const salt = phpString(param[1]);
    const target = md5(phpTrim(param[2]) + salt);
    const stored = await this.stored(uid);
    const db = this.scope.db;
    if (stored === undefined) {
      await sql`insert into sys_user_password (uid, time, password)
        values (${uid}, unix_timestamp(), ${target})`.execute(db);
      return [1];
    }
    if (md5(phpTrim(param[0]) + salt) !== stored) {
      throw GameError.lang('password.oldpassword_error');
    }
    await sql`update sys_user_password set password = ${target} where uid = ${uid}`.execute(db);
    return [2];
  }

  private async stored(uid: number): Promise<string | undefined> {
    const row = await this.scope.db
      .selectFrom('sys_user_password')
      .select('password')
      .where('uid', '=', uid)
      .executeTakeFirst();
    return row?.password;
  }
}
