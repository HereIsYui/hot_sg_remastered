import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

export function countFiles(dir: string, ext?: string): number {
  let n = 0;
  for (const f of walk(dir)) if (!ext || f.endsWith(ext)) n++;
  return n;
}

export interface FileEntry {
  path: string;
  size: number;
}

/** Lists files under `dir` with POSIX-style relative paths, sorted for stable output. */
export function listFiles(dir: string): FileEntry[] {
  return [...walk(dir)]
    .map((f) => ({ path: relative(dir, f).split(sep).join('/'), size: statSync(f).size }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
