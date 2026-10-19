/** Framework / third-party packages that never contain game logic. */
export const FRAMEWORK_DIRS = /^(mx|flash|fl|com\/adobe|com\/hurlant|com\/flexkf|spark)\//;

/** Collects every double-quoted identifier-like string literal, e.g. command names. */
export function stringLiterals(src: string): Set<string> {
  return new Set([...src.matchAll(/"([A-Za-z_]\w*)"/g)].map((m) => m[1] as string));
}

export interface ClientCall {
  func: string;
  kind: 'global' | 'dialog';
  module?: string;
}

/** Finds Command.sendGlobalCommand("module","func",…) and sendDialogCommand("func",…) calls. */
export function clientCalls(src: string): ClientCall[] {
  const out: ClientCall[] = [];
  for (const m of src.matchAll(/sendGlobalCommand\(\s*"(\w+)"\s*,\s*"(\w+)"/g)) {
    out.push({ func: m[2] as string, kind: 'global', module: m[1] as string });
  }
  for (const m of src.matchAll(/sendDialogCommand\(\s*"(\w+)"/g)) {
    out.push({ func: m[1] as string, kind: 'dialog' });
  }
  return out;
}

export type UiKind = 'Dialog' | 'Panel' | 'View';

/** Matches hand-written UI classes; skips Flex codegen helpers (`_Foo_…`, `…__embed_…`). */
export function uiKind(fileName: string): UiKind | null {
  if (fileName.startsWith('_') || fileName.includes('__')) return null;
  const m = /(Dialog|Panel|View)\.as$/.exec(fileName);
  return m ? (m[1] as UiKind) : null;
}

export type Phase = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 'drop' | 'unknown';

const PACKAGE_PHASES: Record<string, Phase> = {
  '': 2,
  Bar: 2,
  Loader: 2,
  Login: 2,
  Preloader: 2,
  System: 2,
  Tooltip: 2,
  UI: 2,
  utils: 2,
  Building: 3,
  Government: 3,
  Wall: 3,
  College: 3,
  Army: 3,
  Task: 3,
  guide: 3,
  Basic: 3,
  Hero: 4,
  Hotel: 4,
  BlackSmith: 4,
  Armor: 4,
  Goods: 4,
  Store: 4,
  Barn: 4,
  Shop: 4,
  World: 5,
  Troop: 5,
  Report: 5,
  Mail: 5,
  Ground: 5,
  Union: 6,
  friend: 6,
  Market: 6,
  Chat: 6,
  Office: 7,
  Rank: 7,
  Stat: 7,
  Achivement: 7,
  UserInfo: 7,
  Buffer: 7,
  Trick: 7,
  Lottery: 7,
  Honglu: 7,
  Arena: 8,
  GuoGuanZhanJiang: 8,
  LuoYang: 8,
  MarrySystem: 8,
  war: 8,
  Nireus: 8,
  Battle: 9,
  Adult: 'drop',
  secret: 'drop',
};

/** Maps a BloodWar.swf package onto the plan phase (02-开发计划.md) that ports its UI. */
export function phaseForPackage(pkg: string): Phase {
  const top = pkg.split('/')[0] ?? '';
  return PACKAGE_PHASES[top] ?? 'unknown';
}
