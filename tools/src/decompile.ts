import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ffdec } from './lib/ffdec.ts';
import { countFiles } from './lib/fsutil.ts';
import { paths, requireExtracted } from './lib/paths.ts';
import { log } from './lib/run.ts';
import { MAIN_SWFS } from './lib/swf.ts';

requireExtracted();
const force = process.argv.includes('--force');
mkdirSync(paths.decompiled, { recursive: true });

for (const name of MAIN_SWFS) {
  const out = join(paths.decompiled, name);
  if (existsSync(out) && readdirSync(out).length > 0 && !force) {
    log('decompile', `${name}: already done (use --force to redo)`);
    continue;
  }
  rmSync(out, { recursive: true, force: true });
  log('decompile', `${name}.swf -> ${out}`);
  ffdec(['-export', 'script', out, join(paths.htdocs, `${name}.swf`)]);
  log('decompile', `${name}: ${countFiles(out, '.as')} ActionScript files`);
}
