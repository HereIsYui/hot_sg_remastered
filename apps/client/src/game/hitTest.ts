import { assets } from '../assets/registry';

/** Pixel masks of images, for Flash-style `BitmapData.getPixel` hit tests on irregular shapes. */
export interface PixelMask {
  width: number;
  height: number;
  /** RGBA bytes. */
  data: Uint8ClampedArray;
}

/** `getPixel(x, y) != 0`: transparent pixels are stored premultiplied, so they read as 0. */
export function maskHit(mask: PixelMask, x: number, y: number): boolean {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) return false;
  const i = (py * mask.width + px) * 4;
  const d = mask.data;
  return d[i + 3]! > 0 && (d[i]! | d[i + 1]! | d[i + 2]!) !== 0;
}

const masks = new Map<string, Promise<PixelMask | null>>();

export function loadMask(source: string): Promise<PixelMask | null> {
  let mask = masks.get(source);
  if (!mask) {
    mask = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        resolve({
          width: canvas.width,
          height: canvas.height,
          data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        });
      };
      img.onerror = () => resolve(null);
      img.src = assets.url(source);
    });
    masks.set(source, mask);
  }
  return mask;
}
