import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listFiles } from '../lib/fsutil.ts';
import { paths } from '../lib/paths.ts';
import { MAIN_SWFS } from '../lib/swf.ts';
import { FRAMEWORK_DIRS } from './as3.ts';

export const gameDir = join(paths.htdocs, 'server/game');

export interface SourceFile {
  /** e.g. `GoodsFunc.php` or `BloodWar:Hotel/HotelDialog.as` */
  id: string;
  path: string;
  rel: string;
  text: string;
}

export function phpSources(): SourceFile[] {
  return listFiles(gameDir)
    .filter((f) => f.path.endsWith('.php'))
    .map((f) => {
      const path = join(gameDir, f.path);
      return { id: f.path, path, rel: f.path, text: readFileSync(path, 'latin1') };
    });
}

/** Game ActionScript of one decompiled SWF, framework packages excluded. */
export function as3Sources(swf: (typeof MAIN_SWFS)[number]): SourceFile[] {
  const root = join(paths.decompiled, swf, 'scripts');
  return listFiles(root)
    .filter((f) => f.path.endsWith('.as') && !FRAMEWORK_DIRS.test(f.path))
    .map((f) => {
      const path = join(root, f.path);
      return { id: `${swf}:${f.path}`, path, rel: f.path, text: readFileSync(path, 'utf8') };
    });
}
