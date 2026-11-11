import { loadLetterboxedImage } from '../preprocessing/imageLoader';
import { type LetterboxParams, rgbaToChwTensor } from '../preprocessing/imagePreprocessor';
import { decodeYoloOutput } from '../postprocessing/yoloPostprocessor';
import type { ModelRuntime } from '../runtime/ModelRuntime';
import type { DetectionResult } from '../types/detection';
import { InferenceError, MlError, ModelLoadError } from '../types/errors';
import type { LoadedModelInfo, ModelRuntimeOptions, YoloModelConfig } from '../types/model';

export interface PhoneDetectionServiceOptions {
  runtime: ModelRuntime;
  model: YoloModelConfig;
  /** Resolves the model location: a `file://` path on native, a URL on web. */
  resolveModelUri: () => Promise<string>;
  runtimeOptions?: ModelRuntimeOptions;
  /** Defaults to 0.25. */
  confidenceThreshold?: number;
  /** Defaults to 0.45 (only used by raw heads). */
  iouThreshold?: number;
  rawBoxFormat?: 'auto' | 'xyxy' | 'xywh';
  /** See `DecodeOptions.competitorRatio`. Defaults to 0.8 (a phone box is dropped if another class overlaps with ≥ 80% of its score). */
  competitorRatio?: number;
}

export interface DetectOverrides {
  confidenceThreshold?: number;
  iouThreshold?: number;
  competitorRatio?: number;
}

const now = () => globalThis.performance?.now() ?? Date.now();

/**
 * Detects cell phones in still images. The ONNX session is created once and reused; calls are
 * serialised so concurrent `detect()` calls never interleave on the same session.
 */
export class PhoneDetectionService {
  private loading: Promise<LoadedModelInfo> | null = null;
  private info: LoadedModelInfo | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly targetClassIds: number[];

  constructor(private readonly options: PhoneDetectionServiceOptions) {
    const { classNames, targetClassName } = options.model;
    this.targetClassIds = classNames.flatMap((n, i) => (n === targetClassName ? [i] : []));
    if (this.targetClassIds.length === 0) {
      throw new ModelLoadError(`Class "${targetClassName}" is not in the model's class list`);
    }
  }

  get modelInfo(): LoadedModelInfo | null {
    return this.info;
  }

  /** Load the model once. Concurrent callers share one promise; a failed load can be retried. */
  load(): Promise<LoadedModelInfo> {
    this.loading ??= (async () => {
      try {
        const uri = await this.options.resolveModelUri();
        const info = await this.options.runtime.load(uri, this.options.runtimeOptions);
        const size = this.options.model.inputSize;
        const s = info.input.shape; // [1,3,H,W]; -1 means dynamic, which we accept
        if (s.length === 4 && ((s[2] > 0 && s[2] !== size) || (s[3] > 0 && s[3] !== size) || (s[1] > 0 && s[1] !== 3))) {
          throw new ModelLoadError(
            `Model input is [${s.join(', ')}] but the configuration expects [1, 3, ${size}, ${size}]`,
          );
        }
        this.info = info;
        return info;
      } catch (e) {
        this.loading = null;
        throw e instanceof MlError ? e : new ModelLoadError(e instanceof Error ? e.message : String(e), e);
      }
    })();
    return this.loading;
  }

  /** Run once on a blank image so the first real detection doesn't pay the warm-up cost. */
  async warmUp(): Promise<void> {
    const info = await this.load();
    const size = this.options.model.inputSize;
    await this.options.runtime.run(new Float32Array(3 * size * size), [1, 3, size, size]);
    void info;
  }

  detect(imageUri: string, overrides: DetectOverrides = {}): Promise<DetectionResult> {
    const job = this.queue.then(() => this.detectNow(imageUri, overrides));
    this.queue = job.catch(() => undefined); // a failure must not block later calls
    return job;
  }

  /**
   * Live frames: run an already letterboxed CHW tensor (see `binaryStringToLetterboxedChw`) through the same
   * session, decoder and class filter as `detect()`. `letterbox` describes how the frame was fitted.
   */
  detectTensor(input: Float32Array, letterbox: LetterboxParams, overrides: DetectOverrides = {}): Promise<DetectionResult> {
    const job = this.queue.then(async () => {
      const t0 = now();
      await this.load();
      return this.inferAndDecode(input, letterbox, overrides, t0, 0, 0);
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async detectNow(imageUri: string, overrides: DetectOverrides): Promise<DetectionResult> {
    const { model } = this.options;
    const t0 = now();
    await this.load();

    const t1 = now();
    const { rgba, letterbox } = await loadLetterboxedImage(imageUri, model.inputSize, model.padValue);

    const t2 = now();
    const input = rgbaToChwTensor(rgba, model.inputSize);
    const t3 = now();
    return this.inferAndDecode(input, letterbox, overrides, t0, t2 - t1, t3 - t2);
  }

  private async inferAndDecode(
    input: Float32Array,
    letterbox: LetterboxParams,
    overrides: DetectOverrides,
    t0: number,
    imageLoadMs: number,
    preprocessMs: number,
  ): Promise<DetectionResult> {
    const { runtime, model } = this.options;

    const t3 = now();
    let output;
    try {
      output = await runtime.run(input, [1, 3, model.inputSize, model.inputSize]);
    } catch (e) {
      throw new InferenceError(`Inference failed: ${e instanceof Error ? e.message : String(e)}`, e);
    }

    const t4 = now();
    let decoded;
    try {
      decoded = decodeYoloOutput(output, model.classNames, this.targetClassIds, letterbox, {
        confidenceThreshold: overrides.confidenceThreshold ?? this.options.confidenceThreshold ?? 0.25,
        iouThreshold: overrides.iouThreshold ?? this.options.iouThreshold ?? 0.45,
        rawBoxFormat: this.options.rawBoxFormat,
        competitorRatio: overrides.competitorRatio ?? this.options.competitorRatio ?? 0.8,
      });
    } catch (e) {
      throw new InferenceError(`Could not decode model output: ${e instanceof Error ? e.message : String(e)}`, e);
    }
    const t5 = now();

    return {
      detections: decoded.detections,
      otherDetections: decoded.others,
      imageSize: { width: letterbox.srcWidth, height: letterbox.srcHeight },
      outputLayout: decoded.layout,
      timing: {
        imageLoadMs,
        preprocessMs,
        inferenceMs: t4 - t3,
        postprocessMs: t5 - t4,
        totalMs: t5 - t0,
      },
    };
  }

  async dispose(): Promise<void> {
    this.loading = null;
    this.info = null;
    await this.options.runtime.dispose();
  }
}
