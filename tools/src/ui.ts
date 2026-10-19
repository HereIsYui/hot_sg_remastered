/**
 * Dumps the UI structure of every decompiled Flex view into legacy/ui/<swf>/ as JSON plus a
 * readable outline (geometry, styles, image sources, bound texts, event handlers), as reference
 * for porting dialogs to the H5 client. For BloodWar it also writes the merged global style
 * sheet to the client assets (styles.json), which the client skins read by `styleName`.
 *
 *   pnpm legacy:ui [swf]      default: BloodWar
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
  extractComponent,
  globalStyles,
  hasDescriptor,
  outline,
  type OutlineContext,
  type UiComponent,
} from './lib/as3-ui.ts';
import { decodeSource, embedSource } from './lib/embeds.ts';
import { walk } from './lib/fsutil.ts';
import { paths } from './lib/paths.ts';
import { log } from './lib/run.ts';

const swf = process.argv[2] ?? 'BloodWar';
const scripts = join(paths.decompiled, swf, 'scripts');
if (!existsSync(scripts)) throw new Error(`${scripts} missing; run "pnpm legacy:decompile" first`);

const langFile = join(paths.clientAssets, 'lang', 'zh_CN.json');
const texts: Record<string, string> = existsSync(langFile)
  ? (JSON.parse(readFileSync(langFile, 'utf8')) as Record<string, string>)
  : {};
if (!existsSync(langFile)) log('ui', 'client strings missing; run "pnpm legacy:assets" for texts');

const imagesRoot = paths.clientAssets;
const ctx: OutlineContext = {
  embed: (ref) => {
    const mangled = embedSource(ref.replace(/^_embed_/, 'X__embed_'));
    return mangled === null ? null : decodeSource(mangled, (p) => existsSync(join(imagesRoot, p)));
  },
  text: (key) => texts[key],
};

const out = join(paths.legacy, 'ui', swf);
rmSync(out, { recursive: true, force: true });
let count = 0;
const index: string[] = [];
const components: UiComponent[] = [];
for (const file of walk(scripts)) {
  if (!file.endsWith('.as') || file.includes('__embed_')) continue;
  const src = readFileSync(file, 'utf8');
  if (!hasDescriptor(src)) continue;
  const rel = relative(scripts, file).slice(0, -3);
  const className = rel.split(sep).join('.');
  try {
    const component = extractComponent(className, src);
    const target = join(out, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(`${target}.json`, JSON.stringify(component, null, 1) + '\n');
    writeFileSync(`${target}.txt`, outline(component, ctx));
    components.push(component);
    index.push(className);
    count++;
  } catch (err) {
    log('ui', `${className}: ${(err as Error).message}`);
  }
}
writeFileSync(join(out, 'index.txt'), index.sort().join('\n') + '\n');
log('ui', `${swf}: ${count} views -> ${out}`);

if (swf === 'BloodWar') {
  // The application's own declarations come first so they win over component duplicates.
  components.sort((a, b) => Number(b.className === swf) - Number(a.className === swf));
  const sheet = globalStyles(components, ctx.embed);
  const target = join(paths.clientAssets, 'styles.json');
  writeFileSync(target, JSON.stringify(sheet, null, 1) + '\n');
  log('ui', `styles.json: ${Object.keys(sheet).length} selectors -> ${target}`);
}
