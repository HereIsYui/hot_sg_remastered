import type { FileEntry } from './fsutil.ts';

/** Flex applications whose ActionScript is decompiled for reference. */
export const MAIN_SWFS = ['BloodWar', 'BloodBattle', 'ChibiBattle', 'common2'] as const;

/** Small skin / animation SWFs under htdocs/swf that carry sprites. */
export const SKIN_SWFS = [
  'UIParts',
  'announce_entry',
  'battleRound',
  'bloodwar',
  'bloodwarskin',
  'bloodwarskin2',
  'button_up',
  'fight',
  'heroBattleEffect',
  'scene',
  'skin',
  'trooper',
  'trooperReverse',
  'unActiveHero',
] as const;

export interface AssetManifest {
  version: 1;
  totalFiles: number;
  totalBytes: number;
  groups: Record<string, { files: number; bytes: number }>;
  files: FileEntry[];
}

/** Groups by the first two path segments, e.g. `embedded/BloodWar`, `images/<dir>`. */
export function groupKey(path: string): string {
  const parts = path.split('/');
  return parts.length > 2 ? `${parts[0]}/${parts[1]}` : (parts[0] ?? path);
}

export function buildManifest(files: FileEntry[]): AssetManifest {
  const groups: AssetManifest['groups'] = {};
  let totalBytes = 0;
  for (const f of files) {
    const g = (groups[groupKey(f.path)] ??= { files: 0, bytes: 0 });
    g.files++;
    g.bytes += f.size;
    totalBytes += f.size;
  }
  return { version: 1, totalFiles: files.length, totalBytes, groups, files };
}
