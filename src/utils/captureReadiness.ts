import type { AlignmentResult } from './liveGeometry';

/** The single source of truth for whether (and why not) the user may capture. */
export type CaptureReadinessState =
  | 'searching'
  | 'detected'
  | 'too_far'
  | 'too_close'
  | 'outside_frame'
  | 'aligning'
  | 'ready'
  | 'capturing';

export interface ReadinessConfig {
  /** The phone must stay validly aligned for at least this long (ms) before capture unlocks. */
  stableMs: number;
  /** ...and across at least this many consecutive processed frames. */
  minStableFrames: number;
  /** Largest allowed centre movement between consecutive frames, as a fraction of the capture frame size. */
  maxJitterRatio: number;
  /** A detection older than this (ms) is treated as "no phone": never capture on stale data. */
  maxStaleMs: number;
  /**
   * Mean confidence of the valid frames in the current run must reach this. A one-frame false spike cannot unlock
   * Capture, while a real phone hovering around 0.7–0.9 can (the per-frame floor is `minConfidence`).
   */
  minMeanConfidence: number;
  /**
   * Detector flicker tolerated without restarting the hold: this many consecutive frames with no phone or a
   * below-floor confidence. Geometric problems (outside, too small/large, off-centre) never get a grace.
   */
  maxMissedFrames: number;
}

/** What the tracker remembers between frames. Plain data so it is easy to test and reset. */
export interface ReadinessTracking {
  /** When the current uninterrupted run of valid frames began. */
  validSince: number | null;
  validFrames: number;
  /** Sum of the confidences of the valid frames in this run (for the mean). */
  confidenceSum: number;
  /** Consecutive flicker frames absorbed by the grace allowance. */
  missed: number;
  lastCenter: { x: number; y: number } | null;
}

export const INITIAL_READINESS_TRACKING: ReadinessTracking = {
  validSince: null,
  validFrames: 0,
  confidenceSum: 0,
  missed: 0,
  lastCenter: null,
};

type PhoneBox = { box: { x: number; y: number; width: number; height: number }; confidence: number };

/** Why a detected phone is not (yet) aligned, as one user-facing state. Priority: size, then position. */
export function classifyMisalignment(alignment: AlignmentResult): 'detected' | 'too_far' | 'too_close' | 'outside_frame' {
  const r = alignment.reasons;
  if (r.includes('too-large')) return 'too_close';
  if (r.includes('outside-frame')) return 'outside_frame';
  if (r.includes('too-small')) return 'too_far';
  return 'detected'; // off-centre or low confidence: seen, but not lined up yet
}

export interface ReadinessInput {
  phone: PhoneBox | null;
  alignment: AlignmentResult;
  /** Capture frame size, used to scale the jitter limit. */
  frameSize: { width: number; height: number } | null;
  /** True when this evaluation comes from a newly processed camera frame (not a config/geometry change). */
  isNewFrame: boolean;
  now: number;
}

/**
 * Advance the readiness state for one evaluation. Pure: returns the next tracking data and the state
 * (never `capturing`, which the engine layers on top while a capture is in flight).
 *
 * `ready` needs an unbroken run of valid frames lasting `stableMs`; any invalid frame, missing phone or
 * sudden jump resets the run.
 */
export function advanceReadiness(
  prev: ReadinessTracking,
  input: ReadinessInput,
  config: ReadinessConfig,
): { tracking: ReadinessTracking; state: Exclude<CaptureReadinessState, 'capturing'> } {
  const { phone, alignment, frameSize, isNewFrame, now } = input;

  // Detector flicker (nothing seen, or confidence under the floor) is forgiven for a frame or two while a run is
  // in progress; anything geometric resets immediately. Never forgiven outside a new frame (e.g. on a frame change).
  const flicker = !phone || alignment.reasons.every((r) => r === 'no-phone' || r === 'low-confidence');
  if (!phone || !alignment.valid) {
    if (isNewFrame && flicker && prev.validSince !== null && prev.missed < config.maxMissedFrames) {
      return { tracking: { ...prev, missed: prev.missed + 1 }, state: 'aligning' };
    }
    return phone
      ? { tracking: INITIAL_READINESS_TRACKING, state: classifyMisalignment(alignment) }
      : { tracking: INITIAL_READINESS_TRACKING, state: 'searching' };
  }

  const center = { x: phone.box.x + phone.box.width / 2, y: phone.box.y + phone.box.height / 2 };
  let { validSince, validFrames, confidenceSum } = prev;

  if (validSince === null) {
    validSince = now;
    validFrames = isNewFrame ? 1 : 0;
    confidenceSum = isNewFrame ? phone.confidence : 0;
  } else if (isNewFrame) {
    const jumped =
      prev.lastCenter !== null &&
      frameSize !== null &&
      (Math.abs(center.x - prev.lastCenter.x) > config.maxJitterRatio * frameSize.width ||
        Math.abs(center.y - prev.lastCenter.y) > config.maxJitterRatio * frameSize.height);
    if (jumped) {
      validSince = now; // moved too much: hold-steady period restarts
      validFrames = 1;
      confidenceSum = phone.confidence;
    } else {
      validFrames += 1;
      confidenceSum += phone.confidence;
    }
  }

  const tracking: ReadinessTracking = {
    validSince,
    validFrames,
    confidenceSum,
    missed: isNewFrame ? 0 : prev.missed,
    lastCenter: isNewFrame ? center : (prev.lastCenter ?? center),
  };
  const meanConfidence = validFrames > 0 ? confidenceSum / validFrames : 0;
  const stable =
    validFrames >= config.minStableFrames &&
    now - validSince >= config.stableMs &&
    meanConfidence >= config.minMeanConfidence;
  return { tracking, state: stable ? 'ready' : 'aligning' };
}
