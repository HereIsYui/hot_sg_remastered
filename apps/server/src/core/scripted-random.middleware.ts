import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { parseRngSpec, ScriptedRandom } from './random.service';

/** The header a differential-test case sends to make random outcomes scripted; see side.ts. */
export const RNG_HEADER = 'x-difftest-rng';

/**
 * Differential-test only: when `TICK_DEBUG_ENDPOINT` is on and a request carries the
 * `X-Difftest-Rng` header, runs that request with a scripted {@link DrawSource} installed, so
 * `RandomService` returns the same values the legacy server's `rng-prepend.php` does. Absent the
 * flag or the header it is a pass-through, so production randomness is never touched. Runs the
 * downstream handler inside `AsyncLocalStorage.run`, which spans the request's async work.
 */
@Injectable()
export class ScriptedRandomMiddleware implements NestMiddleware {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly scripted: ScriptedRandom,
  ) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    if (!this.config.TICK_DEBUG_ENDPOINT) return next();
    const raw = req.headers[RNG_HEADER];
    const spec = Array.isArray(raw) ? raw[0] : raw;
    const source = spec ? parseRngSpec(spec) : undefined;
    if (!source) return next();
    this.scripted.run(source, () => next());
  }
}
