import type {
    CaptureReadinessState,
    ReadinessConfig,
} from "@/utils/captureReadiness";
import type { AlignmentConstraints } from "@/utils/liveGeometry";

/**
 * Geometry + confidence rules for ONE frame: "is the phone I see right now lined up with the capture frame?"
 * (All sizes are relative, so they work on any screen size.) Override per screen via `useLiveDetection({ constraints })`.
 */
export const DEFAULT_ALIGNMENT_CONSTRAINTS: AlignmentConstraints = {
  // Lowest model confidence (0-1) a single frame may have and still count as aligned. Lower = detects more phones
  // but lets weaker/false detections through. Capture additionally needs the AVERAGE over the hold time to reach
  // `DEFAULT_READINESS_CONFIG.minMeanConfidence`, which is what keeps one-frame false spikes out.
  minConfidence: 0.6,
  // Extra pixels of slack when checking "the whole phone is inside the frame". 0 = must be exactly inside;
  // bigger = a phone slightly over the edge still passes.
  insideTolerancePx: 4,
  // Phone area / capture-frame area must be between these two. Below min -> "move closer" (too small),
  // above max -> "move farther" (too large). 0.5 = the phone must fill at least half of the frame.
  minFillRatio: 0.5,
  maxFillRatio: 1.05,
  // How far the phone's centre may be from the frame's centre, as a fraction of the frame's width/height.
  // 0.2 = up to 20% off-centre is accepted. Smaller = the user must centre the phone more precisely.
  maxCenterOffsetRatio: 0.2,
};

/**
 * Most frames per second sent to the model (Android frame processor and the web loop). Lower = smoother preview and
 * less battery/CPU, but slower reaction; higher = faster reaction, more load. Real speed is also limited by how
 * long one inference takes (a new frame is dropped while one is still being processed).
 */
export const DEFAULT_LIVE_MAX_FPS = 8;

/** Colour of the capture-frame outline while the state is `ready` (or `capturing`). */
export const FRAME_ALIGNED_COLOR = "#30D158";

/**
 * "Held steady" rules: how long and how consistently the phone must stay aligned before the Capture button
 * unlocks. Configurable per screen via `useLiveDetection({ readiness })`.
 */
export const DEFAULT_READINESS_CONFIG: ReadinessConfig = {
  // How long (ms) the phone must stay aligned without interruption. Longer = fewer accidental unlocks but slower.
  stableMs: 300,
  // ...and across at least this many consecutive analysed frames (at ~5-8 fps, 3 frames is roughly 0.4-0.6 s,
  // so this can be the real limit rather than `stableMs`).
  minStableFrames: 3,
  // Largest allowed jump of the phone's centre between two frames, as a fraction of the frame size. A bigger
  // jump means "still moving" and restarts the hold. 0.08 = 8%.
  maxJitterRatio: 0.08,
  // A detection older than this (ms) is ignored (treated as "no phone"), so Capture is never allowed on old data.
  maxStaleMs: 1500,
  // The AVERAGE confidence over the hold must reach this (0-1). A single high-confidence false frame cannot
  // unlock Capture; a real phone hovering around 0.75-0.9 can.
  minMeanConfidence: 0.6,
  // Detector flicker forgiven without restarting the hold: this many frames in a row with no phone or a too-low
  // confidence. Position problems (outside / too small / too large / off-centre) are never forgiven.
  maxMissedFrames: 1,
};

/** The one place state → feedback text is defined. */
export const READINESS_MESSAGES: Record<CaptureReadinessState, string> = {
  searching: "Position your phone inside the frame.",
  detected: "Align your phone within the frame.",
  too_far: "Move closer to the camera.",
  too_close: "Move farther from the camera.",
  outside_frame: "Position your phone inside the frame.",
  aligning: "Hold your phone steady.",
  ready: "Device detected. Ready to capture.",
  capturing: "Capturing image...",
};
