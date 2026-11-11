/** Axis-aligned box, **normalised 0–1 relative to the original (un-letterboxed) image**, top-left origin. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Detection {
  classId: number;
  className: string;
  confidence: number;
  boundingBox: BoundingBox;
}

export interface DetectionTiming {
  /** Decoding + resizing the image into the letterboxed RGBA buffer. */
  imageLoadMs: number;
  /** RGBA → normalised CHW float tensor. */
  preprocessMs: number;
  /** `session.run` only. */
  inferenceMs: number;
  /** Output decoding, NMS, class filter, normalisation. */
  postprocessMs: number;
  totalMs: number;
}

export interface DetectionResult {
  detections: Detection[];
  /** Strongest non-target detections (diagnostics: what else the model sees). Optional. */
  otherDetections?: Detection[];
  /** Size of the original image in pixels (after EXIF orientation). */
  imageSize: { width: number; height: number };
  timing: DetectionTiming;
  /** Which output layout the decoder detected from the real tensor shape. */
  outputLayout: OutputLayout;
}

export type OutputLayout = 'end2end' | 'raw-channels-first' | 'raw-anchors-first';
