/** Convert interleaved 8-bit pixel data (1–4 channels) to a grayscale Float32Array. */
export function toGray(data: ArrayLike<number>, width: number, height: number, channels: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const s = i * channels;
    out[i] = channels >= 3 ? 0.299 * data[s] + 0.587 * data[s + 1] + 0.114 * data[s + 2] : data[s];
  }
  return out;
}

/**
 * Sharpness score: variance of the 3×3 Laplacian response over the image interior.
 * Sharp images have strong edges (high variance); blurred or flat images have weak ones (low variance).
 */
export function laplacianVariance(gray: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}
