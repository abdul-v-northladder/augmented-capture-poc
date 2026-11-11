import { ImageLoadError } from '../types/errors';
import { type LetterboxedImage, computeLetterbox } from './imagePreprocessor';

let canvas: HTMLCanvasElement | null = null;

async function decodeBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    // Apply EXIF orientation so portrait photos are not sideways.
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(blob);
  }
}

/** Browser: draw into a size×size canvas with letterboxing and read the pixels back. */
export async function loadLetterboxedImage(uri: string, size: number, padValue: number): Promise<LetterboxedImage> {
  try {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bitmap = await decodeBitmap(await res.blob());
    try {
      const lb = computeLetterbox(bitmap.width, bitmap.height, size);
      canvas ??= document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D canvas is not available');
      ctx.fillStyle = `rgb(${padValue},${padValue},${padValue})`;
      ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, lb.left, lb.top, lb.newWidth, lb.newHeight);
      return { rgba: ctx.getImageData(0, 0, size, size).data, letterbox: lb };
    } finally {
      bitmap.close();
    }
  } catch (e) {
    throw new ImageLoadError(`Could not load image: ${e instanceof Error ? e.message : String(e)}`, e);
  }
}
