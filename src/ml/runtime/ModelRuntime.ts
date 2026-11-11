import type { ExecutionProvider, LoadedModelInfo, ModelRuntimeOptions, TensorInfo } from '../types/model';

export interface RuntimeOutput {
  name: string;
  data: Float32Array;
  dims: number[];
}

/**
 * Platform-neutral view of an ONNX Runtime session. Implementations live in `./mobile`
 * (onnxruntime-react-native) and `./web` (onnxruntime-web); nothing above this interface imports either.
 */
export interface ModelRuntime {
  readonly name: string;
  /** Create the session (once) from a `file://` path (native) or URL (web). */
  load(modelUri: string, options?: ModelRuntimeOptions): Promise<LoadedModelInfo>;
  /** Run the first input → first output. Asynchronous: does not block the UI. */
  run(input: Float32Array, dims: readonly number[]): Promise<RuntimeOutput>;
  dispose(): Promise<void>;
}

/** ORT metadata reports symbolic/dynamic dims as strings (or undefined); expose them as -1. */
export function toTensorInfo(name: string, shape: readonly (number | string)[] | undefined): TensorInfo {
  return { name, shape: (shape ?? []).map((d) => (typeof d === 'number' ? d : -1)) };
}

/** Providers to attempt, in order, always ending with the platform default so loading cannot fail on a bad choice. */
export function providerCandidates(
  requested: ExecutionProvider[] | undefined,
  platformDefault: ExecutionProvider,
): ExecutionProvider[] {
  const list = requested && requested.length > 0 ? [...requested] : [platformDefault];
  if (!list.includes(platformDefault)) list.push(platformDefault);
  return list;
}
