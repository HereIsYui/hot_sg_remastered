/** Serialises async work per key (one queue per user), replacing PHP's file-based user locks. */
export class KeyedMutex<K = number> {
  private readonly tails = new Map<K, Promise<unknown>>();

  async run<T>(key: K, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const current = prev.then(fn, fn);
    const tail = current.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await current;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  get size(): number {
    return this.tails.size;
  }
}
