/**
 * Central geometry for live detection. Everything that converts coordinates or decides whether a phone is
 * "in the frame" lives here, so UI components never repeat these calculations.
 *
 * Coordinate systems
 *  - sensor frame : raw camera buffer (usually landscape), what the frame processor receives.
 *  - upright image: the sensor frame rotated so it looks the way the user holds the phone. This is what the
 *                   model sees (letterboxed), and detections are normalised (0–1) against it.
 *  - preview px   : the Camera view in React Native layout pixels. The capture frame (FrameGeometry) lives here.
 *
 * Functions marked 'worklet' also run on the VisionCamera frame-processor thread.
 */
import { type LetterboxParams, computeLetterbox } from '../ml/preprocessing/imagePreprocessor';
import type { BoundingBox } from '../ml/types/detection';
import type { FrameGeometry, Point, Size } from '../types/frame';

export type FrameOrientation = 'portrait' | 'portrait-upside-down' | 'landscape-left' | 'landscape-right';
export type Rotation = 0 | 90 | 180 | 270;
export type ResizeMode = 'cover' | 'contain';
export type PixelBox = { x: number; y: number; width: number; height: number };

// ───────────────────────────────────────────────────────── frame → model input (worklet side)

/**
 * Clockwise rotation (degrees) that makes a sensor frame upright.
 * VisionCamera (Android) reports `frame.orientation` as the *reverse* of CameraX's `rotationDegrees`
 * (which is the clockwise rotation needed to appear upright), hence 'landscape-right' ⇒ 90° and
 * 'landscape-left' ⇒ 270°. A normal portrait back camera therefore reports 'landscape-right' → 90°.
 * Verified from the library source; not yet verified on iOS.
 */
export function rotationToUpright(orientation: FrameOrientation): Rotation {
  'worklet';
  switch (orientation) {
    case 'landscape-right':
      return 90;
    case 'portrait-upside-down':
      return 180;
    case 'landscape-left':
      return 270;
    default:
      return 0;
  }
}

export interface FramePlan {
  rotation: Rotation;
  /** Size of the upright image (after rotation). */
  uprightWidth: number;
  uprightHeight: number;
  /** Letterbox of the *upright* image into the model input. */
  letterbox: LetterboxParams;
  /**
   * Size to scale the *sensor* frame to before rotating: vision-camera-resize-plugin applies
   * crop → scale → rotate, so for 90°/270° the target is the letterbox content size with width/height swapped.
   */
  scaleWidth: number;
  scaleHeight: number;
}

export function planFramePreparation(
  frameWidth: number,
  frameHeight: number,
  orientation: FrameOrientation,
  inputSize: number,
): FramePlan {
  'worklet';
  const rotation = rotationToUpright(orientation);
  const swap = rotation === 90 || rotation === 270;
  const uprightWidth = swap ? frameHeight : frameWidth;
  const uprightHeight = swap ? frameWidth : frameHeight;
  const letterbox = computeLetterbox(uprightWidth, uprightHeight, inputSize);
  return {
    rotation,
    uprightWidth,
    uprightHeight,
    letterbox,
    scaleWidth: swap ? letterbox.newHeight : letterbox.newWidth,
    scaleHeight: swap ? letterbox.newWidth : letterbox.newHeight,
  };
}

// ───────────────────────────────────────────────────────── detection → preview pixels

/**
 * Normalised box in the upright image → pixels in the preview view.
 * `cover` scales the image to fill the view and crops the overflow (centered); `contain` letterboxes it.
 * `mirrored` flips horizontally for a selfie preview that shows the upright image mirrored.
 */
export function mapNormalizedBoxToPreview(
  box: BoundingBox,
  upright: Size,
  view: Size,
  resizeMode: ResizeMode,
  mirrored: boolean,
): PixelBox {
  const sx = view.width / upright.width;
  const sy = view.height / upright.height;
  const scale = resizeMode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const offsetX = (view.width - upright.width * scale) / 2;
  const offsetY = (view.height - upright.height * scale) / 2;

  const width = box.width * upright.width * scale;
  const height = box.height * upright.height * scale;
  let x = box.x * upright.width * scale + offsetX;
  const y = box.y * upright.height * scale + offsetY;
  if (mirrored) x = view.width - (x + width);
  return { x, y, width, height };
}

// ───────────────────────────────────────────────────────── capture-frame containment

const corners = (b: PixelBox): Point[] => [
  { x: b.x, y: b.y },
  { x: b.x + b.width, y: b.y },
  { x: b.x + b.width, y: b.y + b.height },
  { x: b.x, y: b.y + b.height },
];

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Is the point inside the capture frame shape (rounded corners and polygons respected), with `tol` px of slack? */
export function isPointInFrame(p: Point, g: FrameGeometry, tol = 0): boolean {
  if (g.points) {
    if (pointInPolygon(p, g.points)) return true;
    return g.points.some((a, i) => distanceToSegment(p, a, g.points![(i + 1) % g.points!.length]) <= tol);
  }
  const { x, y, width, height } = g.bounds;
  const r = g.cornerRadius;
  const left = x - tol;
  const right = x + width + tol;
  const top = y - tol;
  const bottom = y + height + tol;
  if (p.x < left || p.x > right || p.y < top || p.y > bottom) return false;
  if (r <= 0) return true;
  // Inside a rounded corner? Compare against the corner circle (radius grows with the tolerance).
  const cx = p.x < x + r ? x + r : p.x > x + width - r ? x + width - r : p.x;
  const cy = p.y < y + r ? y + r : p.y > y + height - r ? y + height - r : p.y;
  return Math.hypot(p.x - cx, p.y - cy) <= r + tol;
}

/** True only when the *entire* box lies inside the frame shape. */
export function isBoxInsideFrame(box: PixelBox, g: FrameGeometry, tol = 0): boolean {
  if (!corners(box).every((c) => isPointInFrame(c, g, tol))) return false;
  if (g.points) {
    // A concave polygon can cut into a box whose corners are all inside: no vertex may poke into the box.
    const inner = { left: box.x + tol, right: box.x + box.width - tol, top: box.y + tol, bottom: box.y + box.height - tol };
    if (g.points.some((v) => v.x > inner.left && v.x < inner.right && v.y > inner.top && v.y < inner.bottom)) return false;
  }
  return true;
}

// ───────────────────────────────────────────────────────── alignment validation

export interface AlignmentConstraints {
  /** Minimum detection confidence (0–1). */
  minConfidence: number;
  /** Pixels of slack when testing "inside the frame". */
  insideTolerancePx: number;
  /** Phone box area ÷ capture-frame area must be within [minFillRatio, maxFillRatio]. */
  minFillRatio: number;
  maxFillRatio: number;
  /** Max distance between phone centre and frame centre, as a fraction of the frame's width / height. */
  maxCenterOffsetRatio: number;
}

export type AlignmentReason = 'no-phone' | 'low-confidence' | 'outside-frame' | 'too-small' | 'too-large' | 'off-center';

export interface AlignmentResult {
  valid: boolean;
  reasons: AlignmentReason[];
  metrics: { fillRatio: number; centerOffsetX: number; centerOffsetY: number } | null;
}

export function evaluateAlignment(
  phone: { box: PixelBox; confidence: number } | null,
  frame: FrameGeometry | null,
  c: AlignmentConstraints,
): AlignmentResult {
  if (!phone || !frame) return { valid: false, reasons: ['no-phone'], metrics: null };

  const reasons: AlignmentReason[] = [];
  const { box } = phone;
  const fb = frame.bounds;

  const fillRatio = (box.width * box.height) / Math.max(fb.width * fb.height, 1e-9);
  const centerOffsetX = Math.abs(box.x + box.width / 2 - (fb.x + fb.width / 2)) / Math.max(fb.width, 1e-9);
  const centerOffsetY = Math.abs(box.y + box.height / 2 - (fb.y + fb.height / 2)) / Math.max(fb.height, 1e-9);

  if (phone.confidence < c.minConfidence) reasons.push('low-confidence');
  if (!isBoxInsideFrame(box, frame, c.insideTolerancePx)) reasons.push('outside-frame');
  if (fillRatio < c.minFillRatio) reasons.push('too-small');
  if (fillRatio > c.maxFillRatio) reasons.push('too-large');
  if (centerOffsetX > c.maxCenterOffsetRatio || centerOffsetY > c.maxCenterOffsetRatio) reasons.push('off-center');

  return { valid: reasons.length === 0, reasons, metrics: { fillRatio, centerOffsetX, centerOffsetY } };
}
