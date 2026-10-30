import { HttpException, HttpStatus } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

export const GM_TOKEN_HEADER = 'x-gm-token';

/**
 * Shared-token protection for the GM ops API (the original managed through a password-protected
 * manage/ web directory). Every /api/gm request must carry `x-gm-token: $GM_TOKEN`; with the
 * variable unset the whole surface answers 403, so a deployment without the token simply has no
 * GM API. GM is an ops interface, not a player command, so it deliberately bypasses the command
 * gateway's session/whitelist path.
 */
export class GmTokenGuard {
  canActivate(context: ExecutionContextLike): boolean {
    const expected = process.env.GM_TOKEN ?? '';
    if (expected === '') {
      throw new HttpException('GM_TOKEN not configured, GM API disabled', HttpStatus.FORBIDDEN);
    }
    const request = context.switchToHttp().getRequest();
    const given = String(request.headers[GM_TOKEN_HEADER] ?? '');
    const mismatch =
      given.length !== expected.length ||
      !timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (mismatch) throw new HttpException('invalid gm token', HttpStatus.FORBIDDEN);
    return true;
  }
}

/** Narrowed to what the guard needs, keeping tests free of the express types. */
interface ExecutionContextLike {
  switchToHttp(): { getRequest(): { headers: Record<string, unknown> } };
}
