import { reactive, type CSSProperties } from 'vue';
import { assets, type StyleDecl, type StyleValue } from '../assets/registry';

/** Flex layout props shared by all components (absolute coordinates or edge constraints). */
export interface BoxProps {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

export function px(v: number | undefined): string | undefined {
  return v === undefined ? undefined : `${v}px`;
}

export function boxStyle(box: BoxProps, natural?: readonly [number, number]): CSSProperties {
  return {
    position: 'absolute',
    left: px(box.left ?? (box.right === undefined ? (box.x ?? 0) : undefined)),
    top: px(box.top ?? (box.bottom === undefined ? (box.y ?? 0) : undefined)),
    right: px(box.right),
    bottom: px(box.bottom),
    width: px(
      box.w ?? (box.left !== undefined && box.right !== undefined ? undefined : natural?.[0]),
    ),
    height: px(
      box.h ?? (box.top !== undefined && box.bottom !== undefined ? undefined : natural?.[1]),
    ),
  };
}

/** Flex colors are uints (`15136376`) or `#rrggbb` strings. */
export function cssColor(v: StyleValue | undefined, alpha?: number): string | undefined {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^(#|0x)[0-9a-f]{6}$/i.test(v))
    n = parseInt(v.replace(/^(#|0x)/i, ''), 16);
  else return undefined;
  const hex = `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
  if (alpha === undefined || alpha >= 1) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Text-related styles of a resolved declaration. */
export function textStyle(decl: StyleDecl, color = decl.color): CSSProperties {
  return {
    color: cssColor(color),
    fontSize: typeof decl.fontSize === 'number' ? `${decl.fontSize}px` : undefined,
    fontWeight:
      decl.fontWeight === 'bold' ? 'bold' : decl.fontWeight === 'normal' ? 'normal' : undefined,
    fontStyle: decl.fontStyle === 'italic' ? 'italic' : undefined,
    textAlign:
      typeof decl.textAlign === 'string'
        ? (decl.textAlign as CSSProperties['textAlign'])
        : undefined,
    letterSpacing: typeof decl.letterSpacing === 'number' ? `${decl.letterSpacing}px` : undefined,
    textDecoration: decl.textDecoration === 'underline' ? 'underline' : undefined,
  };
}

const sizes = reactive(new Map<string, readonly [number, number]>());
const loading = new Set<string>();

/**
 * Natural size of a skin: from the 9-slice index when known, otherwise measured once the image
 * loads (reactive, so components sized by their skin re-render).
 */
export function skinSize(source: string | undefined): readonly [number, number] | undefined {
  if (!source) return undefined;
  const slice = assets.slice(source);
  if (slice) return slice.size;
  const url = assets.url(source);
  const known = sizes.get(url);
  if (known || loading.has(url) || typeof Image === 'undefined') return known;
  loading.add(url);
  const img = new Image();
  img.onload = () => sizes.set(url, [img.naturalWidth, img.naturalHeight]);
  img.src = url;
  return undefined;
}

/**
 * Paints a skin over the whole element: Scale9 skins as a border-image, others stretched (Flex
 * scales bitmap skins to the component size).
 */
export function skinStyle(source: string | undefined): CSSProperties {
  if (!source) return {};
  const url = `url("${assets.url(source)}")`;
  const slice = assets.slice(source);
  if (!slice) {
    return { backgroundImage: url, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat' };
  }
  const [t, r, b, l] = slice.slice;
  return {
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderWidth: `${t}px ${r}px ${b}px ${l}px`,
    borderImageSource: url,
    borderImageSlice: `${t} ${r} ${b} ${l} fill`,
    borderImageRepeat: 'stretch',
    boxSizing: 'border-box',
  };
}

export function styleString(decl: StyleDecl, key: string): string | undefined {
  const v = decl[key];
  return typeof v === 'string' ? v : undefined;
}

export function styleNumber(decl: StyleDecl, key: string): number | undefined {
  const v = decl[key];
  return typeof v === 'number'
    ? v
    : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))
      ? Number(v)
      : undefined;
}
