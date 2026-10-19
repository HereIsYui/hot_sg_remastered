import { closeSync, createReadStream, createWriteStream, openSync, readSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const RAR4_SIGNATURE = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
const RAR5_SIGNATURE = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);

/** Locates the first RAR archive signature inside a buffer (e.g. a self-extracting exe). */
export function findRarOffset(buf: Buffer): number {
  const candidates = [buf.indexOf(RAR4_SIGNATURE), buf.indexOf(RAR5_SIGNATURE)].filter(
    (i) => i >= 0,
  );
  return candidates.length ? Math.min(...candidates) : -1;
}

/** Scans the head of a file for an embedded RAR archive; SFX stubs are well under 4 MiB. */
export function findRarOffsetInFile(file: string, scanBytes = 4 * 1024 * 1024): number {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(scanBytes);
    const read = readSync(fd, buf, 0, scanBytes, 0);
    return findRarOffset(buf.subarray(0, read));
  } finally {
    closeSync(fd);
  }
}

export async function sliceFile(src: string, dest: string, start: number): Promise<void> {
  await pipeline(createReadStream(src, { start }), createWriteStream(dest));
}

/** Only the parts needed for the rewrite: web root, game database and backend binaries. */
export function isWantedEntry(name: string): boolean {
  const p = name.replace(/\\/g, '/');
  const rel = p.replace(/^APMServ5\.2\.6\/?/, '');
  if (rel === p) return false;
  if (rel.startsWith('www/htdocs/')) return true;
  if (rel.startsWith('MySQL5.1/data/')) return true;
  return rel !== '' && !rel.includes('/');
}
