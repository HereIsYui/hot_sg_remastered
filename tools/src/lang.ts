import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths, requireExtracted } from './lib/paths.ts';
import { capture, log, succeeds } from './lib/run.ts';

/**
 * Evaluates server/game/lang.php with the legacy PHP image and writes every `$GLOBALS`
 * entry it defines as JSON. Running PHP is more faithful than parsing the array literals
 * (string concatenation, sprintf placeholders, escapes).
 */
const IMAGE = 'hot-legacy-php:5.6';
const SCRIPT = [
  '$before = array_keys($GLOBALS);',
  'include "/src/server/game/lang.php";',
  '$out = array();',
  'foreach ($GLOBALS as $k => $v) { if (!in_array($k, $before, true) || $k === "openfunc") $out[$k] = $v; }',
  'echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);',
].join(' ');

requireExtracted();
if (!succeeds('docker', ['image', 'inspect', IMAGE])) {
  throw new Error(`${IMAGE} not built; run "pnpm legacy:up" once first`);
}

const out = join(paths.legacy, 'lang');
mkdirSync(out, { recursive: true });
for (const [locale, file] of [
  ['zh_CN', 'lang.php'],
  ['zh_TW', 'lang_tw.php'],
] as const) {
  const json = capture('docker', [
    'run',
    '--rm',
    '--platform',
    'linux/amd64',
    '--entrypoint',
    'php',
    '-v',
    `${paths.htdocs}:/src:ro`,
    IMAGE,
    '-d',
    'short_open_tag=On',
    '-r',
    SCRIPT.replace('lang.php', file),
  ]);
  const data = JSON.parse(json.replace(/^\uFEFF+/, '')) as Record<string, unknown>;
  const target = join(out, `${locale}.json`);
  writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
  log('lang', `${target}: ${Object.keys(data).length} groups`);
}
