import type { FrameConfiguration, FrameGeometry, Point, Size } from '../types/frame';

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const round = (v: number) => Math.round(v * 100) / 100;

/** Closed SVG path for a (rounded) rectangle. */
export function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  if (r <= 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  return [
    `M${x + r} ${y}`,
    `H${x + w - r}`,
    `A${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V${y + h - r}`,
    `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H${x + r}`,
    `A${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V${y + r}`,
    `A${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join('');
}

export function polygonPath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join('') + 'Z';
}

/**
 * Resolve a configuration against the preview area. The frame is centred.
 * Pure function: no React / React Native dependencies.
 */
export function computeFrameGeometry(config: FrameConfiguration, preview: Size): FrameGeometry {
  const W = Math.max(preview.width, 0);
  const H = Math.max(preview.height, 0);
  const wr = clamp(config.widthRatio, 0, 1);
  const hr = clamp(config.heightRatio, 0, 1);
  const landscape = config.orientation === 'landscape';

  let width: number;
  let height: number;
  if (config.shape === 'square') {
    const side = Math.min(wr * W, hr * H);
    width = height = side;
  } else {
    width = (landscape ? hr : wr) * W;
    height = (landscape ? wr : hr) * H;
  }

  const x = (W - width) / 2;
  const y = (H - height) / 2;
  const bounds = { x: round(x), y: round(y), width: round(width), height: round(height) };

  if (config.shape === 'polygon') {
    if (!config.points || config.points.length < 3) {
      throw new Error(`Frame "${config.id}": polygon shape needs at least 3 points.`);
    }
    const points = config.points.map((p) => ({
      x: round(x + clamp(p.x, 0, 1) * width),
      y: round(y + clamp(p.y, 0, 1) * height),
    }));
    return { previewSize: { width: W, height: H }, bounds, cornerRadius: 0, points, path: polygonPath(points) };
  }

  const defaultRadius = config.shape === 'rounded-rectangle' ? 16 : 0;
  const cornerRadius = round(clamp(config.cornerRadius ?? defaultRadius, 0, Math.min(width, height) / 2));
  return {
    previewSize: { width: W, height: H },
    bounds,
    cornerRadius,
    path: roundedRectPath(bounds.x, bounds.y, bounds.width, bounds.height, cornerRadius),
  };
}
