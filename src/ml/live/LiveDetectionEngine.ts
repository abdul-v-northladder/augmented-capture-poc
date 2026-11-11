import { DEFAULT_ALIGNMENT_CONSTRAINTS, DEFAULT_READINESS_CONFIG } from '../../config/liveDetection';
import type { FrameGeometry, Size } from '../../types/frame';
import {
  type CaptureReadinessState,
  INITIAL_READINESS_TRACKING,
  type ReadinessConfig,
  type ReadinessTracking,
  advanceReadiness,
} from '../../utils/captureReadiness';
import {
  type AlignmentConstraints,
  type AlignmentResult,
  type PixelBox,
  type ResizeMode,
  evaluateAlignment,
  mapNormalizedBoxToPreview,
} from '../../utils/liveGeometry';
import { ACTIVE_MODEL_CONFIG } from '../config/activeModel';
import { type LetterboxParams, binaryStringToLetterboxedChw } from '../preprocessing/imagePreprocessor';
import type { PhoneDetectionService } from '../services/PhoneDetectionService';
import type { BoundingBox } from '../types/detection';

/** How a frame handed to the engine was prepared (all produced by `planFramePreparation`). */
export interface LiveFrameMeta {
  /** Size of the upright image the detections are normalised against. */
  upright: Size;
  letterbox: LetterboxParams;
  /** True when the preview shows the upright image mirrored (selfie preview). */
  mirrored: boolean;
  /** Raw frame facts, shown in the debug line to diagnose orientation/aspect mismatches. */
  source?: { width: number; height: number; rotation: number };
}

export interface LivePhone {
  /** Phone boundary in preview pixels. */
  box: PixelBox;
  confidence: number;
  className: string;
}

export interface LiveDetectionState {
  status: 'loading' | 'running' | 'error';
  phone: LivePhone | null;
  alignment: AlignmentResult;
  /** Whether the user may capture, and why not. The only readiness state in the app. */
  readiness: CaptureReadinessState;
  /** What else the model saw in the last frame (diagnostics), strongest first. */
  others: { className: string; confidence: number }[];
  inferenceMs: number;
  /** Completed inferences per second (smoothed). */
  fps: number;
  error: string | null;
  /** Last processed frame's raw size and the rotation applied (diagnostics). */
  source: LiveFrameMeta['source'] | null;
}

type Listener = () => void;
type DetectionSource = Pick<PhoneDetectionService, 'load' | 'detectTensor'> & Partial<Pick<PhoneDetectionService, 'warmUp'>>;

export interface LiveDetectionEngineOptions {
  constraints?: AlignmentConstraints;
  resizeMode?: ResizeMode;
  /** Detections below this are not shown at all (alignment additionally requires `constraints.minConfidence`). */
  minDetectionConfidence?: number;
  readiness?: Partial<ReadinessConfig>;
  /** Clock in ms; injectable for tests. */
  now?: () => number;
}

/**
 * Receives prepared frames, runs the shared detection service, maps the result to preview pixels and
 * evaluates alignment against the current capture frame. A tiny external store: React reads it through
 * `useSyncExternalStore`, so only the components that subscribe re-render.
 *
 * Back-pressure: while a frame is being processed, new frames are *dropped* (never queued).
 */
export class LiveDetectionEngine {
  private constraints: AlignmentConstraints;
  private resizeMode: ResizeMode;
  private readonly minDetectionConfidence: number;
  private readiness: ReadinessConfig;
  private readonly clock: () => number;
  private tracking: ReadinessTracking = INITIAL_READINESS_TRACKING;
  private capturing = false;
  private lastDetectionAt = 0;
  private frame: FrameGeometry | null = null;
  private inFlight = false;
  private last: { box: BoundingBox; confidence: number; className: string; meta: LiveFrameMeta } | null = null;
  private lastDoneAt = 0;
  private listeners = new Set<Listener>();
  private state: LiveDetectionState = {
    status: 'loading',
    phone: null,
    alignment: { valid: false, reasons: ['no-phone'], metrics: null },
    readiness: 'searching',
    others: [],
    inferenceMs: 0,
    fps: 0,
    error: null,
    source: null,
  };

  constructor(
    private readonly service: DetectionSource,
    options: LiveDetectionEngineOptions = {},
  ) {
    this.constraints = options.constraints ?? DEFAULT_ALIGNMENT_CONSTRAINTS;
    this.resizeMode = options.resizeMode ?? 'cover';
    this.minDetectionConfidence = options.minDetectionConfidence ?? 0.25;
    this.readiness = { ...DEFAULT_READINESS_CONFIG, ...options.readiness };
    this.clock = options.now ?? Date.now;
  }

  // ── store ───────────────────────────────────────────────────────────────
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): LiveDetectionState => this.state;

  private set(patch: Partial<LiveDetectionState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ── configuration (all trigger re-evaluation of the last detection) ─────
  /** Capture frame in preview pixels (from `CaptureFrame`'s onGeometryChange). Switching device type lands here. */
  setFrameGeometry = (geometry: FrameGeometry | null) => {
    this.frame = geometry;
    this.recompute();
  };
  setConstraints(constraints: AlignmentConstraints) {
    this.constraints = constraints;
    this.recompute();
  }
  setReadinessConfig(config: Partial<ReadinessConfig>) {
    this.readiness = { ...DEFAULT_READINESS_CONFIG, ...config };
    this.recompute();
  }
  setResizeMode(mode: ResizeMode) {
    this.resizeMode = mode;
    this.recompute();
  }

  // ── lifecycle ───────────────────────────────────────────────────────────
  /** Load the model (shared session). Frames are ignored until this succeeds. */
  async start(): Promise<void> {
    try {
      await this.service.load();
      // The first inference is slow (kernel setup); pay for it now. A failed warm-up is not fatal.
      await this.service.warmUp?.().catch(() => undefined);
      this.set({ status: 'running', error: null });
    } catch (e) {
      this.set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Report a problem found outside the engine (e.g. frame processing unavailable). */
  fail(message: string) {
    this.set({ status: 'error', error: message });
  }

  get isBusy(): boolean {
    return this.inFlight;
  }

  /**
   * Frame-processor entry: `pixels` is the packed RGB frame (see `bytesToBinaryString`). Unpacks it into the
   * letterboxed CHW tensor only when the engine can take it, so dropped frames cost nothing here.
   */
  async processPixels(pixels: string, meta: LiveFrameMeta): Promise<boolean> {
    if (this.inFlight || this.state.status !== 'running') return false;
    const { newWidth, newHeight, left, top } = meta.letterbox;
    const { inputSize, padValue } = ACTIVE_MODEL_CONFIG;
    let tensor: Float32Array;
    try {
      tensor = binaryStringToLetterboxedChw(pixels, newWidth, newHeight, inputSize, padValue, left, top);
    } catch (e) {
      this.fail(`Frame decode failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    return this.processTensor(tensor, meta);
  }

  /** @returns false when the frame was dropped (engine busy or model not ready). */
  async processTensor(tensor: Float32Array, meta: LiveFrameMeta): Promise<boolean> {
    if (this.inFlight || this.state.status !== 'running') return false;
    this.inFlight = true;
    try {
      const result = await this.service.detectTensor(tensor, meta.letterbox, {
        confidenceThreshold: this.minDetectionConfidence,
      });
      const best = result.detections[0]; // sorted by confidence, phone class only
      this.lastDetectionAt = this.clock();
      this.last = best ? { box: best.boundingBox, confidence: best.confidence, className: best.className, meta } : null;

      const nowMs = Date.now();
      const instFps = this.lastDoneAt ? 1000 / Math.max(nowMs - this.lastDoneAt, 1) : 0;
      this.lastDoneAt = nowMs;
      this.state = {
        ...this.state,
        inferenceMs: result.timing.inferenceMs,
        others: (result.otherDetections ?? []).map((d) => ({ className: d.className, confidence: d.confidence })),
        source: meta.source ?? null,
        fps: this.state.fps ? this.state.fps * 0.7 + instFps * 0.3 : instFps,
      };
      this.recompute(true);
      return true;
    } catch (e) {
      this.set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      return true;
    } finally {
      this.inFlight = false;
    }
  }

  // ── capture gate ────────────────────────────────────────────────────────
  /**
   * Call when the user presses Capture. Re-validates the latest detection (fresh, aligned, stable) and, only if
   * the state is `ready`, moves to `capturing` and returns true. A second call while capturing returns false.
   */
  beginCapture(): boolean {
    if (this.capturing || this.state.status !== 'running') return false;
    this.recompute(); // re-evaluate now: stale or invalid data downgrades the state
    if (this.state.readiness !== 'ready') return false;
    this.capturing = true;
    this.set({ readiness: 'capturing' });
    return true;
  }

  /** Call when the capture finished or failed. The user must stabilise again before the next capture. */
  endCapture() {
    this.capturing = false;
    this.last = null; // never reuse a detection from before the capture
    this.tracking = INITIAL_READINESS_TRACKING;
    this.recompute();
  }

  private recompute(isNewFrame = false) {
    const now = this.clock();
    const fresh = this.last !== null && now - this.lastDetectionAt <= this.readiness.maxStaleMs;
    let phone: LivePhone | null = null;
    if (this.last && fresh && this.frame) {
      const { box, confidence, className, meta } = this.last;
      phone = {
        box: mapNormalizedBoxToPreview(box, meta.upright, this.frame.previewSize, this.resizeMode, meta.mirrored),
        confidence,
        className,
      };
    }
    const alignment = evaluateAlignment(phone, this.frame, this.constraints);
    const next = advanceReadiness(
      this.tracking,
      { phone, alignment, frameSize: this.frame?.bounds ?? null, isNewFrame, now },
      this.readiness,
    );
    this.tracking = next.tracking;
    this.set({ phone, alignment, readiness: this.capturing ? 'capturing' : next.state });
  }
}
