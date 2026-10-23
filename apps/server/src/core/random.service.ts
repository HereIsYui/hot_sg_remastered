import { AsyncLocalStorage } from 'node:async_hooks';
import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';

/** `getrandmax()` / `mt_getrandmax()` on 64-bit Linux PHP. */
export const PHP_RAND_MAX = 2147483647;

/**
 * A source of raw integer draws. Each draw is in `0..PHP_RAND_MAX`; bounded calls scale it with
 * {@link scaleDraw}. Both the scripted sequence and the seed PRNG match the legacy side's
 * `rng-prepend.php` exactly, so a bounded call returns the same value on both servers.
 */
export interface DrawSource {
  draw(): number;
}

/** Scaling shared with the legacy `rng-prepend.php`: `min + (draw mod (max-min+1))`. */
export function scaleDraw(min: number, max: number, v: number): number {
  if (max > min) return min + (v % (max - min + 1));
  return min; // max <= min: PHP rand()/our randRange both collapse to min
}

/** A fixed list of raw draws, cycled when exhausted (mirrors the legacy prepend). */
export function sequenceSource(seq: number[]): DrawSource {
  let i = 0;
  return {
    draw() {
      const v = seq[i % seq.length]!;
      i++;
      return v;
    },
  };
}

/**
 * A 31-bit LCG seeded with `seed`; the identical recurrence the legacy prepend's `seed:` mode
 * runs, verified to produce the same raw stream. BigInt keeps the 32x32 multiply exact (the same
 * reason PHP's native 64-bit ints stay exact before the mask).
 */
export function seedSource(seed: number): DrawSource {
  let state = BigInt(seed >>> 0) & 0x7fffffffn;
  return {
    draw() {
      state = (1103515245n * state + 12345n) & 0x7fffffffn;
      return Number(state);
    },
  };
}

/** Parses an `X-Difftest-Rng` header value into a draw source, or `undefined` when empty. */
export function parseRngSpec(spec: string): DrawSource | undefined {
  if (spec.startsWith('seed:')) {
    const seed = Number.parseInt(spec.slice(5), 10);
    return Number.isFinite(seed) ? seedSource(seed) : undefined;
  }
  const seq = spec
    .split(',')
    .filter((t) => t !== '')
    .map((t) => Number.parseInt(t, 10))
    .filter((n) => Number.isFinite(n));
  return seq.length ? sequenceSource(seq) : undefined;
}

/**
 * Holds the scripted draw source for the current request, in AsyncLocalStorage so concurrent
 * requests never share one (same pattern as {@link DbScope}). The differential-test debug
 * middleware runs a request inside {@link run}; everything else sees no source and gets real
 * randomness.
 */
@Injectable()
export class ScriptedRandom {
  private readonly current = new AsyncLocalStorage<DrawSource>();

  run<T>(source: DrawSource, fn: () => T): T {
    return this.current.run(source, fn);
  }

  get active(): DrawSource | undefined {
    return this.current.getStore();
  }
}

/**
 * Replacement for PHP `rand()` / `mt_rand()`. When the differential test has armed a scripted
 * source for this request (via {@link ScriptedRandom}), draws come from it so random game
 * outcomes match the legacy server call-for-call; otherwise real randomness is used.
 */
@Injectable()
export class RandomService {
  constructor(private readonly scripted: ScriptedRandom) {}

  /** `rand()`: 0..PHP_RAND_MAX. */
  rand(): number {
    const source = this.scripted.active;
    return source ? source.draw() : randomInt(PHP_RAND_MAX + 1);
  }

  /** `rand($min, $max)`, both ends inclusive (libc rand; difftest scripts fix it). */
  randRange(min: number, max: number): number {
    const source = this.scripted.active;
    if (source) return scaleDraw(min, max, source.draw());
    if (max < min) return min;
    return randomInt(min, max + 1);
  }

  /** `mt_rand($min, $max)`, both ends inclusive. */
  mtRand(min: number, max: number): number {
    const source = this.scripted.active;
    if (source) return scaleDraw(min, max, source.draw());
    if (max < min) return min;
    return randomInt(min, max + 1);
  }
}
