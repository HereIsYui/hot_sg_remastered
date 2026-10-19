import { Inject, Injectable } from '@nestjs/common';
import { GameError } from '../common/game-error';
import { DATABASE, type Database } from '../db/database.module';

/**
 * Session check of `global.php::checkUserAuth`: the sid issued at login is stored in
 * `sys_sessions` and cached in memory (the original cached it in sessions/<uid> files).
 */
@Injectable()
export class SessionService {
  private readonly cache = new Map<number, string>();

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async verify(uid: unknown, sid: unknown): Promise<number> {
    const id = Number(uid);
    if (!Number.isInteger(id) || id <= 0) throw GameError.raw('invalid_user_auth');
    const expected = await this.current(id);
    if (expected === null || !sameSid(sid, expected)) throw GameError.raw('invalid_user_auth');
    return id;
  }

  async current(uid: number): Promise<string | null> {
    const cached = this.cache.get(uid);
    if (cached !== undefined) return cached;
    const row = await this.db
      .selectFrom('sys_sessions')
      .select('sid')
      .where('uid', '=', uid)
      .executeTakeFirst();
    if (!row) return null;
    const sid = String(row.sid);
    this.cache.set(uid, sid);
    return sid;
  }

  /** Called after login has written the new sid to sys_sessions. */
  remember(uid: number, sid: string | number): void {
    this.cache.set(uid, String(sid));
  }

  forget(uid: number): void {
    this.cache.delete(uid);
  }
}

/** PHP compared with `!=`, so "123" and 123 are the same sid; empty values never match. */
function sameSid(given: unknown, expected: string): boolean {
  if (given === null || given === undefined || given === '' || expected === '') return false;
  return String(given).trim() === expected.trim();
}
