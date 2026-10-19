import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ffdec } from './lib/ffdec.ts';
import { countFiles, listFiles } from './lib/fsutil.ts';
import { paths, requireExtracted } from './lib/paths.ts';
import { log } from './lib/run.ts';
import { buildManifest, MAIN_SWFS, SKIN_SWFS } from './lib/swf.ts';

requireExtracted();
const force = process.argv.includes('--force');
const out = paths.clientAssets;

function step(dir: string, label: string, action: () => void): void {
  if (existsSync(dir) && countFiles(dir) > 0 && !force) {
    log('assets', `${label}: already exported (use --force to redo)`);
    return;
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  action();
  log('assets', `${label}: ${countFiles(dir)} files`);
}

step(join(out, 'images'), 'htdocs/images', () => {
  cpSync(join(paths.htdocs, 'images'), join(out, 'images'), { recursive: true });
});

for (const name of MAIN_SWFS) {
  const dir = join(out, 'embedded', name);
  step(dir, `${name}.swf bitmaps`, () => {
    ffdec(['-format', 'image:png', '-export', 'image', dir, join(paths.htdocs, `${name}.swf`)]);
  });
}

for (const name of SKIN_SWFS) {
  const dir = join(out, 'swf', name);
  step(dir, `swf/${name}.swf bitmaps + sprites`, () => {
    ffdec([
      '-format',
      'image:png,sprite:png',
      '-export',
      'image,sprite',
      dir,
      join(paths.htdocs, 'swf', `${name}.swf`),
    ]);
  });
}

const manifest = buildManifest(listFiles(out).filter((f) => f.path !== 'manifest.json'));
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
log(
  'assets',
  `manifest: ${manifest.totalFiles} files, ${(manifest.totalBytes / 1048576).toFixed(1)} MiB`,
);
