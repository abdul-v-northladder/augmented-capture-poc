export type ExecutionProvider = 'cpu' | 'xnnpack' | 'nnapi' | 'coreml' | 'wasm' | 'webgpu';

/** Static description of a YOLO ONNX export. Output layout is *not* part of it: it is read from the tensors. */
export interface YoloModelConfig {
  id: string;
  /** Square network input side in pixels (the exported graph is fixed-size). */
  inputSize: number;
  /** Letterbox padding value, 0–255 (Ultralytics uses 114). */
  padValue: number;
  /** Class names indexed by class id. */
  classNames: readonly string[];
  /** Class to keep when detecting phones. Resolved by *name* so ids are never hard-coded. */
  targetClassName: string;
}

export interface ModelRuntimeOptions {
  /** Tried in order; the runtime falls back to the platform default (cpu / wasm) if all fail. */
  executionProviders?: ExecutionProvider[];
  intraOpNumThreads?: number;
}

export interface TensorInfo {
  name: string;
  /** Static dims from the model metadata; symbolic/dynamic dims are reported as -1. */
  shape: number[];
}

/** What the runtime found in the loaded graph. */
export interface LoadedModelInfo {
  runtime: string;
  executionProvider: ExecutionProvider;
  input: TensorInfo;
  outputs: TensorInfo[];
}

export interface DecodeOptions {
  /** Minimum class score to keep (0–1). */
  confidenceThreshold: number;
  /** NMS IoU threshold; only used for raw (one-to-many) heads. */
  iouThreshold: number;
  /** Raw-head box encoding. 'auto' inspects the values (corners vs centre/size). */
  rawBoxFormat?: 'auto' | 'xyxy' | 'xywh';
  /**
   * Drop a target detection when a box of another class overlaps it (IoU ≥ `competitorIou`) with a score of at
   * least `competitorRatio` × the target's score: the model thinks the object is something else (remote, book...).
   * 0 or undefined disables it.
   */
  competitorRatio?: number;
  /** Defaults to 0.6. */
  competitorIou?: number;
}
