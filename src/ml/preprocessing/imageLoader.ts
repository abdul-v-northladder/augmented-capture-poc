import type * as ImageManipulatorTypes from 'expo-image-manipulator';
import { decode } from 'fast-png';

import { ImageLoadError } from '../types/errors';
import { type LetterboxedImage, computeLetterbox } from './imagePreprocessor';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * iOS / Android: let the native image stack decode + resize (it also applies EXIF orientation), then
 * read the small resized PNG back and paste it into a padded size×size RGBA buffer.
 * Only the resized (≤ size) image ever crosses into JS, never the full-resolution photo.
 */
export async function loadLetterboxedImage(uri: string, size: number, padValue: number): Promise<LetterboxedImage> {
  try {
    // Lazy: a native module, absent from older development builds (would crash the route at import).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ImageManipulator, SaveFormat } = require('expo-image-manipulator') as typeof ImageManipulatorTypes;
    const probe = await ImageManipulator.manipulate(uri).renderAsync();
    const lb = computeLetterbox(probe.width, probe.height, size);

    const resized = await ImageManipulator.manipulate(uri)
      .resize({ width: lb.newWidth, height: lb.newHeight })
      .renderAsync();
    const saved = await resized.saveAsync({ format: SaveFormat.PNG, base64: true });
    if (!saved.base64) throw new Error('Image manipulator returned no base64 data');

    const png = decode(base64ToBytes(saved.base64));
    if (png.depth !== 8) throw new Error(`Unsupported PNG bit depth ${png.depth}`);

    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = rgba[i + 1] = rgba[i + 2] = padValue;
      rgba[i + 3] = 255;
    }
    const { width: w, height: h, channels: ch, data } = png;
    const rows = Math.min(h, size - lb.top);
    const cols = Math.min(w, size - lb.left);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const s = (y * w + x) * ch;
        const d = ((y + lb.top) * size + (x + lb.left)) * 4;
        if (ch >= 3) {
          rgba[d] = data[s];
          rgba[d + 1] = data[s + 1];
          rgba[d + 2] = data[s + 2];
        } else {
          rgba[d] = rgba[d + 1] = rgba[d + 2] = data[s]; // grey (+alpha)
        }
      }
    }
    return { rgba, letterbox: lb };
  } catch (e) {
    throw new ImageLoadError(`Could not load image: ${e instanceof Error ? e.message : String(e)}`, e);
  }
}
