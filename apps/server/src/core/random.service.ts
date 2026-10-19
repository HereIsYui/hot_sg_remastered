import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';

/** `getrandmax()` / `mt_getrandmax()` on 64-bit Linux PHP. */
export const PHP_RAND_MAX = 2147483647;

/**
 * Replacement for PHP `rand()` / `mt_rand()`. Injected so tests can substitute a scripted
 * source and make random game outcomes deterministic.
 */
@Injectable()
export class RandomService {
  /** `rand()`: 0..PHP_RAND_MAX. */
  rand(): number {
    return randomInt(PHP_RAND_MAX + 1);
  }

  /** `mt_rand($min, $max)`, both ends inclusive. */
  mtRand(min: number, max: number): number {
    return randomInt(min, max + 1);
  }
}
