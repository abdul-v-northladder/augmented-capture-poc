export type FrameShape = 'rectangle' | 'square' | 'rounded-rectangle' | 'polygon';
export type FrameOrientation = 'portrait' | 'landscape';

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/**
 * Pure visual/declarative description of a capture frame.
 * It knows nothing about the preview size — see `FrameGeometry` for resolved coordinates.
 */
export interface FrameConfiguration {
  id: string;
  /** Human readable name, e.g. for selectors. */
  label?: string;
  shape: FrameShape;
  /**
   * Frame size relative to the preview area (0–1], authored for **portrait**.
   * With `orientation: 'landscape'` the two ratios are swapped
   * (frame width = heightRatio × preview width, frame height = widthRatio × preview height).
   * For `square`, the side is min(widthRatio × width, heightRatio × height).
   */
  widthRatio: number;
  heightRatio: number;
  orientation: FrameOrientation;
  /** Corner radius in px. Ignored for `polygon`. Defaults: 0, or 16 for `rounded-rectangle`. */
  cornerRadius?: number;
  /**
   * Required for `polygon`: ≥3 vertices, normalised (0–1) inside the frame's own bounding box,
   * so (0,0) is the top-left of the frame and (1,1) its bottom-right.
   */
  points?: Point[];
  borderColor?: string;
  borderWidth?: number;
  /** Colour of the dimmed area outside the frame. */
  overlayColor?: string;
  /** 0–1 opacity of the dimmed area. */
  overlayOpacity?: number;
}

/** Resolved frame in the preview's pixel coordinate system (origin top-left). */
export interface FrameGeometry {
  previewSize: Size;
  bounds: { x: number; y: number; width: number; height: number };
  cornerRadius: number;
  /** Absolute polygon vertices; only set for `polygon` shapes. */
  points?: Point[];
  /** SVG path (closed) outlining the frame. */
  path: string;
}
