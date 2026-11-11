export interface LetterboxParams {
  srcWidth: number;
  srcHeight: number;
  /** Network input side. */
  size: number;
  /** Source → content scale (uniform). */
  scale: number;
  /** Content size after resizing. */
  newWidth: number;
  newHeight: number;
  /** Padding on the left/top as a float (used to map coordinates back). */
  padX: number;
  padY: number;
  /** Integer pixel position where the resized content is pasted. */
  left: number;
  top: number;
}

/** Aspect-preserving fit into `size`×`size`, centred — the same maths as ml/scripts/test_model.py. */
export function computeLetterbox(srcWidth: number, srcHeight: number, size: number): LetterboxParams {
  'worklet'; // also runs inside the VisionCamera frame-processor runtime (a no-op directive everywhere else)
  if (!(srcWidth > 0 && srcHeight > 0)) throw new RangeError(`Invalid image size ${srcWidth}x${srcHeight}`);
  const scale = Math.min(size / srcWidth, size / srcHeight);
  const newWidth = Math.max(1, Math.round(srcWidth * scale));
  const newHeight = Math.max(1, Math.round(srcHeight * scale));
  const padX = (size - newWidth) / 2;
  const padY = (size - newHeight) / 2;
  return {
    srcWidth,
    srcHeight,
    size,
    scale,
    newWidth,
    newHeight,
    padX,
    padY,
    left: Math.max(0, Math.round(padX - 0.1)),
    top: Math.max(0, Math.round(padY - 0.1)),
  };
}

/** A letterboxed square RGBA image plus the geometry needed to undo the letterbox. */
export interface LetterboxedImage {
  /** size×size×4, RGBA, 8 bit. Padding already filled. */
  rgba: Uint8ClampedArray | Uint8Array;
  letterbox: LetterboxParams;
}

/** RGBA (HWC, 0–255) → RGB planar CHW float32 in 0–1. Alpha is ignored. */
export function rgbaToChwTensor(rgba: ArrayLike<number>, size: number): Float32Array {
  const plane = size * size;
  if (rgba.length < plane * 4) throw new RangeError(`RGBA buffer too small: ${rgba.length} < ${plane * 4}`);
  const out = new Float32Array(3 * plane);
  const k = 1 / 255;
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    out[i] = rgba[p] * k;
    out[plane + i] = rgba[p + 1] * k;
    out[2 * plane + i] = rgba[p + 2] * k;
  }
  return out;
}

/**
 * Frame-processor side: pack 8-bit interleaved RGB bytes into a string (one char per byte, 0–255).
 * worklets-core can only move primitives, arrays and objects between runtimes (no typed arrays or
 * ArrayBuffers), and a string is the cheapest primitive that carries a pixel buffer.
 */
export function bytesToBinaryString(bytes: ArrayLike<number>, length: number): string {
  'worklet';
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < length; i += CHUNK) {
    const end = Math.min(i + CHUNK, length);
    const codes: number[] = [];
    for (let j = i; j < end; j++) codes.push(bytes[j]);
    parts.push(String.fromCharCode.apply(null, codes));
  }
  return parts.join('');
}

/**
 * JS side: unpack `bytesToBinaryString` output (interleaved RGB, srcWidth×srcHeight) into a planar CHW float32
 * tensor (0–1), pasted at (left, top) into a size×size canvas pre-filled with `padValue` (0–255).
 */
export function binaryStringToLetterboxedChw(
  pixels: string,
  srcWidth: number,
  srcHeight: number,
  size: number,
  padValue: number,
  left: number,
  top: number,
): Float32Array {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  out.fill(padValue / 255);
  if (pixels.length < srcWidth * srcHeight * 3) {
    throw new Error(`Frame pixels arrived short (${pixels.length} of ${srcWidth * srcHeight * 3})`);
  }
  const rows = Math.min(srcHeight, size - top);
  const cols = Math.min(srcWidth, size - left);
  for (let y = 0; y < rows; y++) {
    const dstRow = (y + top) * size + left;
    let s = y * srcWidth * 3;
    for (let x = 0; x < cols; x++, s += 3) {
      const d = dstRow + x;
      out[d] = pixels.charCodeAt(s) / 255;
      out[plane + d] = pixels.charCodeAt(s + 1) / 255;
      out[2 * plane + d] = pixels.charCodeAt(s + 2) / 255;
    }
  }
  return out;
}
