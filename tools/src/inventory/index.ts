import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths, requireExtracted } from '../lib/paths.ts';
import { log } from '../lib/run.ts';
import { buildApiInventory } from './api.ts';
import { buildDataDictionary } from './dictionary.ts';
import { buildUiInventory } from './ui.ts';

requireExtracted();
for (const [dir, cmd] of [
  [paths.decompiled, 'pnpm legacy:decompile'],
  [paths.db, 'pnpm legacy:dump-db'],
] as const) {
  if (!existsSync(dir)) throw new Error(`${dir} missing; run "${cmd}" first`);
}

mkdirSync(paths.design, { recursive: true });
for (const [file, build] of [
  ['接口清单.md', buildApiInventory],
  ['界面清单.md', buildUiInventory],
  ['数据字典.md', buildDataDictionary],
] as const) {
  const target = join(paths.design, file);
  const content = build();
  writeFileSync(target, content.endsWith('\n') ? content : content + '\n', 'utf8');
  log('inventory', `${target} (${content.split('\n').length} lines)`);
}
