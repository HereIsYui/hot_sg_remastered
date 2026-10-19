/**
 * Flex compiles every `Embed(source=...)` into a class named
 * `<Owner>__embed_<css|mxml>_<mangled source>_<hash>`, where the mangled source is the original
 * path with `/` and `.` replaced by `_` (and `../` by `___`). FFDec names exported bitmaps
 * `<characterId>_<package.Class>.png`. The index built here maps original source paths such as
 * `images/board_login.jpg` or `swf/UIParts.swf#board_listdown` to files under the client assets,
 * so client code can refer to the paths used in the original MXML/CSS.
 */

const EMBED_CLASS = /__embed_(?:css|mxml)_(.+)_(-?\d+)$/;
const IMAGE_EXT = /^(.*)_(png|jpg|jpeg|gif)$/;
const SWF_SYMBOL = /^swf_(.+?)_swf_(.+)$/;

/** Returns the mangled source of an embed class name, or null for other classes. */
export function embedSource(className: string): string | null {
  return EMBED_CLASS.exec(className)?.[1] ?? null;
}

/**
 * Decodes a mangled embed source. Underscores are ambiguous (`images_board_login_jpg` could be
 * `images/board/login.jpg`), so candidates are checked against `exists`; without a match the first
 * segment is taken as the directory, which is how nearly all sources are laid out.
 */
export function decodeSource(mangled: string, exists: (path: string) => boolean): string {
  const source = mangled.replace(/^_+/, '');
  const swf = SWF_SYMBOL.exec(source);
  if (swf) return `swf/${swf[1]}.swf#${swf[2]}`;
  const image = IMAGE_EXT.exec(source);
  if (!image) return source;
  const [, base = '', ext = ''] = image;
  const parts = base.split('_');
  const candidates: string[] = [];
  for (let dirs = 1; dirs < Math.min(parts.length, 4); dirs++) {
    candidates.push(`${parts.slice(0, dirs).join('/')}/${parts.slice(dirs).join('_')}.${ext}`);
  }
  return candidates.find(exists) ?? candidates[0] ?? `${base}.${ext}`;
}

export interface EmbedIndexInput {
  /** Asset paths of FFDec bitmap exports, e.g. `embedded/BloodWar/847_Login.LoginDialog__embed_...png`. */
  exportedBitmaps: string[];
  /** Embed class names found in the decompiled scripts (without package). */
  embedClasses: string[];
  /** Asset paths of sprite frames, e.g. `swf/UIParts/sprites/DefineSprite_27_board_listdown/1.png`. */
  spriteFrames: string[];
  /**
   * Every asset path. Bitmaps compiled into the SWF win over the plain copy under `images/`,
   * which the web server shipped separately and is sometimes a later, differently sized revision.
   */
  files: ReadonlySet<string>;
}

export interface EmbedIndex {
  /** Original source path or `symbol:<package.Class>` -> asset path. */
  entries: Record<string, string>;
  /** Sources referenced by embed classes that no asset could be found for. */
  unresolved: string[];
}

const EXPORT_NAME = /^\d+_(.+)\.png$/;
const SPRITE_DIR = /^swf\/([^/]+)\/sprites\/DefineSprite_\d+_([^/]+)\/1\.png$/;

export function buildEmbedIndex(input: EmbedIndexInput): EmbedIndex {
  const exists = (p: string) => input.files.has(p);
  const entries: Record<string, string> = {};
  const add = (key: string, path: string) => {
    entries[key] ??= path;
  };

  const sprites = new Map<string, string>();
  for (const frame of input.spriteFrames) {
    const m = SPRITE_DIR.exec(frame);
    if (m) sprites.set(`swf/${m[1]}.swf#${m[2]}`, frame);
  }

  const exportedBySource = new Map<string, string>();
  for (const path of input.exportedBitmaps) {
    const qualified = EXPORT_NAME.exec(path.slice(path.lastIndexOf('/') + 1))?.[1];
    if (!qualified) continue;
    const mangled = embedSource(qualified);
    if (mangled === null) {
      add(`symbol:${qualified}`, path);
    } else {
      const source = decodeSource(mangled, exists);
      if (!exportedBySource.has(source)) exportedBySource.set(source, path);
    }
  }

  const unresolved = new Set<string>();
  const sources = new Set(
    input.embedClasses.flatMap((c) => {
      const mangled = embedSource(c);
      return mangled === null ? [] : [decodeSource(mangled, exists)];
    }),
  );
  for (const source of [...sources, ...exportedBySource.keys()]) {
    const path = exportedBySource.get(source) ?? (exists(source) ? source : sprites.get(source));
    if (path) add(source, path);
    else unresolved.add(source);
  }
  for (const [source, frame] of sprites) add(source, frame);

  const sorted = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : 1)));
  return { entries: sorted, unresolved: [...unresolved].sort() };
}
