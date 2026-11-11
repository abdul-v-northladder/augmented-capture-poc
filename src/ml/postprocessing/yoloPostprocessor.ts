import type { Detection, OutputLayout } from '../types/detection';
import type { DecodeOptions } from '../types/model';
import type { LetterboxParams } from '../preprocessing/imagePreprocessor';

/** A decoded box in *network input* pixels (letterboxed space). */
interface RawDetection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
  classId: number;
}

/** How many non-target detections are reported for diagnostics. */
const OTHER_LIMIT = 3;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Decide how to read a rank-3 output tensor from its *actual* dims. Nothing is assumed about the
 * export: `[1, N, 6]` is the NMS-free head, `[1, 4+nc, A]` / `[1, A, 4+nc]` are raw heads.
 */
export function inferOutputLayout(dims: readonly number[], numClasses: number): OutputLayout {
  if (dims.length !== 3) throw new Error(`Unsupported output rank ${dims.length}: [${dims.join(', ')}]`);
  const [, a, b] = dims;
  if (b === 6 && a !== 4 + numClasses) return 'end2end';
  if (a === 4 + numClasses) return 'raw-channels-first';
  if (b === 4 + numClasses) return 'raw-anchors-first';
  throw new Error(`Cannot infer output layout from [${dims.join(', ')}] with ${numClasses} classes`);
}

export function iou(a: RawDetection, b: RawDetection): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Greedy, class-aware NMS. Returns the kept detections, highest score first. */
export function nonMaxSuppression<T extends RawDetection>(dets: T[], iouThreshold: number): T[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  for (const d of sorted) {
    if (kept.every((k) => k.classId !== d.classId || iou(k, d) <= iouThreshold)) kept.push(d);
  }
  return kept;
}

function decodeEnd2End(data: ArrayLike<number>, rows: number, confThr: number): RawDetection[] {
  const out: RawDetection[] = [];
  for (let i = 0; i < rows; i++) {
    const o = i * 6;
    const score = data[o + 4];
    if (!(score >= confThr)) continue;
    out.push({ x1: data[o], y1: data[o + 1], x2: data[o + 2], y2: data[o + 3], score, classId: Math.round(data[o + 5]) });
  }
  return out;
}

function decodeRaw(
  data: ArrayLike<number>,
  anchors: number,
  channels: number,
  channelsFirst: boolean,
  confThr: number,
  boxFormat: 'auto' | 'xyxy' | 'xywh',
): RawDetection[] {
  const at = (anchor: number, ch: number) => (channelsFirst ? data[ch * anchors + anchor] : data[anchor * channels + ch]);

  if (boxFormat === 'auto') {
    // Corners satisfy x2>=x1 and y2>=y1 for *every* anchor; centre/size essentially never do.
    boxFormat = 'xyxy';
    for (let a = 0; a < anchors; a++) {
      if (at(a, 2) < at(a, 0) || at(a, 3) < at(a, 1)) {
        boxFormat = 'xywh';
        break;
      }
    }
  }

  const out: RawDetection[] = [];
  for (let a = 0; a < anchors; a++) {
    let best = -1;
    let bestScore = -Infinity;
    for (let c = 4; c < channels; c++) {
      const s = at(a, c);
      if (s > bestScore) {
        bestScore = s;
        best = c - 4;
      }
    }
    if (!(bestScore >= confThr)) continue;
    const v0 = at(a, 0), v1 = at(a, 1), v2 = at(a, 2), v3 = at(a, 3);
    out.push(
      boxFormat === 'xyxy'
        ? { x1: v0, y1: v1, x2: v2, y2: v3, score: bestScore, classId: best }
        : { x1: v0 - v2 / 2, y1: v1 - v3 / 2, x2: v0 + v2 / 2, y2: v1 + v3 / 2, score: bestScore, classId: best },
    );
  }
  return out;
}

export interface DecodeInput {
  data: ArrayLike<number>;
  dims: readonly number[];
}

export interface DecodeResult {
  detections: Detection[];
  /** Strongest detections of the other classes, highest score first (at most `OTHER_LIMIT`). */
  others: Detection[];
  layout: OutputLayout;
}

/**
 * Output tensor → detections for `targetClassIds`, with coordinates normalised to the *original* image
 * (letterbox scale and padding undone, clipped to the image).
 */
export function decodeYoloOutput(
  output: DecodeInput,
  classNames: readonly string[],
  targetClassIds: readonly number[] | null,
  letterbox: LetterboxParams,
  options: DecodeOptions,
): DecodeResult {
  const layout = inferOutputLayout(output.dims, classNames.length);
  const [, a, b] = output.dims;

  let raw: RawDetection[];
  if (layout === 'end2end') {
    raw = decodeEnd2End(output.data, a, options.confidenceThreshold);
    // Sanity check that the layout guess matches the values: scores are probabilities.
    if (raw.some((d) => d.score > 1 + 1e-4)) throw new Error('Column 4 is not a probability; unexpected output format');
  } else {
    const channelsFirst = layout === 'raw-channels-first';
    raw = decodeRaw(
      output.data,
      channelsFirst ? b : a,
      channelsFirst ? a : b,
      channelsFirst,
      options.confidenceThreshold,
      options.rawBoxFormat ?? 'auto',
    );
    raw = nonMaxSuppression(raw, options.iouThreshold);
  }

  const wanted = targetClassIds ? new Set(targetClassIds) : null;
  const { padX, padY, scale, srcWidth, srcHeight } = letterbox;

  // Competing classes: drop a target box that another class explains at least as well.
  const ratio = options.competitorRatio ?? 0;
  const competitorIou = options.competitorIou ?? 0.6;
  const competitors = wanted && ratio > 0 ? raw.filter((d) => !wanted.has(d.classId)) : [];
  const outvoted = (d: RawDetection) =>
    competitors.some((c) => c.score >= ratio * d.score && iou(c, d) >= competitorIou);

  const toDetection = (d: RawDetection): Detection | null => {
    const x1 = clamp((d.x1 - padX) / scale, 0, srcWidth) / srcWidth;
    const y1 = clamp((d.y1 - padY) / scale, 0, srcHeight) / srcHeight;
    const x2 = clamp((d.x2 - padX) / scale, 0, srcWidth) / srcWidth;
    const y2 = clamp((d.y2 - padY) / scale, 0, srcHeight) / srcHeight;
    if (x2 <= x1 || y2 <= y1) return null;
    return {
      classId: d.classId,
      className: classNames[d.classId] ?? `class_${d.classId}`,
      confidence: d.score,
      boundingBox: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
    };
  };

  const detections: Detection[] = [];
  const others: Detection[] = [];
  for (const d of raw) {
    const isTarget = !wanted || wanted.has(d.classId);
    if (isTarget && outvoted(d)) continue;
    const det = toDetection(d);
    if (!det) continue;
    (isTarget ? detections : others).push(det);
  }
  detections.sort((p, q) => q.confidence - p.confidence);
  others.sort((p, q) => q.confidence - p.confidence);
  return { detections, others: others.slice(0, OTHER_LIMIT), layout };
}
