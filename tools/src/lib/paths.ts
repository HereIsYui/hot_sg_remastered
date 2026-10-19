import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const paths = {
  startExe: join(repoRoot, 'start.exe'),
  legacy: join(repoRoot, 'legacy'),
  raw: join(repoRoot, 'legacy/raw'),
  apmserv: join(repoRoot, 'legacy/raw/APMServ5.2.6'),
  htdocs: join(repoRoot, 'legacy/raw/APMServ5.2.6/www/htdocs'),
  mysql51Data: join(repoRoot, 'legacy/raw/APMServ5.2.6/MySQL5.1/data'),
  decompiled: join(repoRoot, 'legacy/decompiled'),
  db: join(repoRoot, 'legacy/db'),
  cache: join(repoRoot, 'legacy/.cache'),
  clientAssets: join(repoRoot, 'apps/client/public/assets'),
  design: join(repoRoot, 'design'),
};

export function requireExtracted(): void {
  if (!existsSync(paths.htdocs)) {
    throw new Error(`legacy files not found at ${paths.htdocs}; run "pnpm legacy:extract" first`);
  }
}
