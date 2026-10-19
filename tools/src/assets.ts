import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { buildEmbedIndex, decodeSource, embedSource } from './lib/embeds.ts';
import { ffdec } from './lib/ffdec.ts';
import { countFiles, listFiles, walk } from './lib/fsutil.ts';
import { parseLocale } from './lib/locale.ts';
import { paths, requireExtracted } from './lib/paths.ts';
import { log } from './lib/run.ts';
import { buildManifest, MAIN_SWFS, SKIN_SWFS } from './lib/swf.ts';
import { readScalingGrids, readSymbolNames, type ScalingGrid } from './lib/swf-grid.ts';

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

// Client string table (utils.LocaleChinese), embedded as binary data in BloodWar.swf.
const binDir = join(paths.cache, 'binary-BloodWar');
if (!existsSync(binDir) || readdirSync(binDir).length === 0 || force) {
  rmSync(binDir, { recursive: true, force: true });
  ffdec(['-export', 'binaryData', binDir, join(paths.htdocs, 'BloodWar.swf')]);
}
const localeBin = readdirSync(binDir).find((f) => f.endsWith('utils.LocaleChinese.bin'));
if (!localeBin) throw new Error(`utils.LocaleChinese not found in ${binDir}`);
const locale = parseLocale(readFileSync(join(binDir, localeBin), 'utf8'));
mkdirSync(join(out, 'lang'), { recursive: true });
writeFileSync(join(out, 'lang', 'zh_CN.json'), JSON.stringify(locale) + '\n');
log('assets', `lang/zh_CN.json: ${Object.keys(locale).length} strings`);

const files = listFiles(out).filter(
  (f) => !['manifest.json', 'embeds.json', 'slices.json'].includes(f.path),
);
const filePaths = files.map((f) => f.path);
const embedClasses = MAIN_SWFS.flatMap((name) => {
  const dir = join(paths.decompiled, name);
  return existsSync(dir)
    ? [...walk(dir)].filter((f) => f.includes('__embed_')).map((f) => basename(f, '.as'))
    : [];
});
if (embedClasses.length === 0)
  log('assets', 'no decompiled scripts; run "pnpm legacy:decompile" first');
const BARE_EXPORT = /^embedded\/([^/]+)\/(\d+)\.png$/;
const symbolNames = new Map<string, Map<number, string[]>>(
  MAIN_SWFS.map((name) => [name, readSymbolNames(readFileSync(join(paths.htdocs, `${name}.swf`)))]),
);
const bitmapNames: Record<string, string[]> = {};
for (const p of filePaths) {
  const m = BARE_EXPORT.exec(p);
  const names = m && symbolNames.get(m[1]!)?.get(Number(m[2]));
  if (names) bitmapNames[p] = names;
}
const index = buildEmbedIndex({
  // The game SWF wins when the battle SWFs embed the same source.
  exportedBitmaps: MAIN_SWFS.flatMap((name) =>
    filePaths.filter((p) => p.startsWith(`embedded/${name}/`)),
  ),
  bitmapNames,
  embedClasses,
  spriteFrames: filePaths.filter((p) => /\/sprites\/[^/]+\/1\.png$/.test(p)),
  files: new Set(filePaths),
});
writeFileSync(join(out, 'embeds.json'), JSON.stringify(index.entries, null, 1) + '\n');
log(
  'assets',
  `embeds.json: ${Object.keys(index.entries).length} entries, ${index.unresolved.length} unresolved` +
    (index.unresolved.length ? ` (${index.unresolved.slice(0, 8).join(', ')})` : ''),
);

// 9-slice insets: scale-grid Embeds compiled into the Flex SWFs, and grids of skin SWF symbols.
const slices: Record<string, { size: [number, number]; slice: number[] }> = {};
const addSlice = (key: string, g: ScalingGrid) => {
  slices[key] ??= { size: [g.width, g.height], slice: g.slice };
};
for (const name of MAIN_SWFS) {
  for (const [symbol, grid] of readScalingGrids(readFileSync(join(paths.htdocs, `${name}.swf`)))) {
    const mangled = embedSource(symbol);
    if (mangled !== null)
      addSlice(
        decodeSource(mangled, (p) => filePaths.includes(p)),
        grid,
      );
  }
}
for (const name of SKIN_SWFS) {
  for (const [symbol, grid] of readScalingGrids(
    readFileSync(join(paths.htdocs, 'swf', `${name}.swf`)),
  )) {
    addSlice(`swf/${name}.swf#${symbol}`, grid);
  }
}
writeFileSync(join(out, 'slices.json'), JSON.stringify(slices, null, 1) + '\n');
log('assets', `slices.json: ${Object.keys(slices).length} scaling grids`);

const manifest = buildManifest(files);
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
log(
  'assets',
  `manifest: ${manifest.totalFiles} files, ${(manifest.totalBytes / 1048576).toFixed(1)} MiB`,
);
