/**
 * A rule violation reported to the player, i.e. the PHP `throw new Exception($GLOBALS[g][k])`.
 * Carries a lang key (`group.key`) so text is resolved where the response is built;
 * `GameError.raw` is for the few literal messages such as `invalid_user_auth`.
 */
export class GameError extends Error {
  private constructor(
    readonly key: string | null,
    message: string,
    readonly args: unknown[],
  ) {
    super(message);
    this.name = 'GameError';
  }

  static lang(key: string, ...args: unknown[]): GameError {
    return new GameError(key, key, args);
  }

  static raw(message: string): GameError {
    return new GameError(null, message, []);
  }
}
