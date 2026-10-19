/**
 * Original asset lookup. Sources are the paths the Flash client used (`images/x.png`, embed
 * paths like `swf/UIParts.swf#board_listdown`); the asset pipeline (`pnpm legacy:assets`,
 * `pnpm legacy:ui`) exports them under public/assets together with these indexes:
 *   embeds.json  source -> exported file (embeds that are not plain files)
 *   slices.json  source -> 9-slice insets of Scale9 embeds
 *   styles.json  Flex global style sheet (selector -> style values, skins as sources)
 */

export interface SliceInfo {
  size: [number, number];
  /** Insets in px: top, right, bottom, left. */
  slice: [number, number, number, number];
}

export type StyleValue = string | number | boolean | null | StyleValue[];
export type StyleDecl = Record<string, StyleValue>;

export interface AssetIndex {
  embeds: Record<string, string>;
  slices: Record<string, SliceInfo>;
  styles: Record<string, StyleDecl>;
}

export class AssetRegistry {
  private index: AssetIndex = { embeds: {}, slices: {}, styles: {} };
  private readonly base: string;

  constructor(base: string) {
    this.base = base;
  }

  setIndex(index: AssetIndex): void {
    this.index = index;
  }

  /** Normalizes a source as written in the original (cache-busting query, leading slash). */
  static source(path: string): string {
    return path.replace(/[?#]r=.*$/, '').replace(/^\.?\//, '');
  }

  url(path: string): string {
    const source = AssetRegistry.source(path);
    return this.base + (this.index.embeds[source] ?? source);
  }

  slice(path: string): SliceInfo | undefined {
    return this.index.slices[AssetRegistry.source(path)];
  }

  /**
   * Resolved styles of a component, Flex precedence: type selector, then each style name
   * (space separated, later wins), then inline styles.
   */
  style(type: string, styleName?: string, inline?: StyleDecl): StyleDecl {
    const decl: StyleDecl = { ...this.index.styles[type] };
    for (const name of styleName?.split(/\s+/).filter(Boolean) ?? []) {
      Object.assign(decl, this.index.styles[`.${name}`]);
    }
    return Object.assign(decl, inline);
  }
}

export const assets = new AssetRegistry(`${import.meta.env.BASE_URL}assets/`);

async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (res.ok) return (await res.json()) as T;
  } catch {
    // reported below
  }
  console.warn(`missing ${url}; run "pnpm legacy:assets" and "pnpm legacy:ui"`);
  return fallback;
}

export async function loadAssetIndex(): Promise<void> {
  const base = `${import.meta.env.BASE_URL}assets/`;
  const [embeds, slices, styles] = await Promise.all([
    fetchJson<AssetIndex['embeds']>(`${base}embeds.json`, {}),
    fetchJson<AssetIndex['slices']>(`${base}slices.json`, {}),
    fetchJson<AssetIndex['styles']>(`${base}styles.json`, {}),
  ]);
  assets.setIndex({ embeds, slices, styles });
}

/** Loads images ahead of use; failures count as done so a missing file never blocks startup. */
export function preloadImages(
  paths: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  let done = 0;
  onProgress?.(0, paths.length);
  return Promise.all(
    paths.map(
      (path) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = img.onerror = () => {
            onProgress?.(++done, paths.length);
            resolve();
          };
          img.src = assets.url(path);
        }),
    ),
  ).then(() => undefined);
}
