import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createExtractorFromFile } from 'node-unrar-js';
import { findRarOffsetInFile, isWantedEntry, sliceFile } from './lib/rar.ts';
import { paths } from './lib/paths.ts';
import { log } from './lib/run.ts';

const force = process.argv.includes('--force');

if (!existsSync(paths.startExe)) {
  throw new Error(
    `start.exe not found at ${paths.startExe}; copy the original package there first`,
  );
}
if (existsSync(paths.htdocs) && !force) {
  log('extract', `already extracted to ${paths.raw} (use --force to redo)`);
  process.exit(0);
}

const offset = findRarOffsetInFile(paths.startExe);
if (offset < 0) throw new Error('no RAR archive found inside start.exe');
log('extract', `RAR archive found at offset ${offset}`);

mkdirSync(paths.cache, { recursive: true });
const rarFile = join(paths.cache, 'start.rar');
if (!existsSync(rarFile) || statSync(rarFile).size !== statSync(paths.startExe).size - offset) {
  await sliceFile(paths.startExe, rarFile, offset);
}

rmSync(paths.raw, { recursive: true, force: true });
mkdirSync(paths.raw, { recursive: true });

const extractor = await createExtractorFromFile({ filepath: rarFile, targetPath: paths.raw });
const { files } = extractor.extract({ files: (header) => isWantedEntry(header.name) });
let count = 0;
for (const f of files) {
  if (!f.fileHeader.flags.directory) count++;
  if (count > 0 && count % 2000 === 0) log('extract', `${count} files…`);
}
log('extract', `done, ${count} files written to ${paths.raw}`);
