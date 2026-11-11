/* eslint-disable import/namespace -- eslint-plugin-import cannot read onnxruntime-web's package `exports` */
import type * as OrtWeb from 'onnxruntime-web';

import { ModelLoadError } from '../../types/errors';
import type { ExecutionProvider, LoadedModelInfo, ModelRuntimeOptions } from '../../types/model';
import { type ModelRuntime, type RuntimeOutput, providerCandidates, toTensorInfo } from '../ModelRuntime';

type Ort = typeof OrtWeb;

/**
 * Metro cannot bundle onnxruntime-web's ESM build (it contains a dynamic `import(variable)`), so the
 * prebuilt browser script is served from public/ort/ (copied by `npm run ml:setup`) and loaded once with a
 * <script> tag. The npm package is still the single source of the version, types and runtime files.
 */
let ortPromise: Promise<Ort> | null = null;
function loadOrt(basePath: string): Promise<Ort> {
  ortPromise ??= new Promise<Ort>((resolve, reject) => {
    const existing = (globalThis as { ort?: Ort }).ort;
    if (existing) return resolve(existing);
    const script = document.createElement('script');
    script.src = `${basePath}ort.wasm.min.js`;
    script.async = true;
    script.onload = () => {
      const ort = (globalThis as { ort?: Ort }).ort;
      if (ort) resolve(ort);
      else reject(new Error('ort.wasm.min.js loaded but did not define `ort`'));
    };
    script.onerror = () => {
      ortPromise = null; // allow a retry
      reject(new Error(`Could not load ${script.src}. Did you run \`npm run ml:setup\`?`));
    };
    document.head.appendChild(script);
  });
  return ortPromise;
}

export interface OnnxWebRuntimeConfig {
  /** Where `ort-wasm-simd-threaded.{mjs,wasm}` are served from (see `npm run ml:setup`). */
  wasmPath?: string;
  /** Run WASM in a worker so inference never blocks the page. */
  proxy?: boolean;
}

/** onnxruntime-web adapter (WASM execution provider by default). */
export class OnnxWebRuntime implements ModelRuntime {
  readonly name = 'onnxruntime-web';
  private ort: Ort | null = null;
  private session: OrtWeb.InferenceSession | null = null;
  private inputName = '';
  private outputName = '';

  constructor(private readonly config: OnnxWebRuntimeConfig = {}) {}

  async load(modelUri: string, options: ModelRuntimeOptions = {}): Promise<LoadedModelInfo> {
    const basePath = this.config.wasmPath ?? '/ort/';
    let ort: Ort;
    try {
      ort = await loadOrt(basePath);
    } catch (cause) {
      throw new ModelLoadError(cause instanceof Error ? cause.message : String(cause), cause);
    }
    this.ort = ort;
    ort.env.wasm.wasmPaths = basePath;
    ort.env.wasm.proxy = this.config.proxy ?? true;
    // Multi-threading needs SharedArrayBuffer (cross-origin isolation); otherwise ORT would warn and fall back anyway.
    ort.env.wasm.numThreads =
      options.intraOpNumThreads ?? (globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1);

    const candidates = providerCandidates(options.executionProviders, 'wasm');
    let lastError: unknown;
    for (const provider of candidates) {
      try {
        const session = await ort.InferenceSession.create(modelUri, {
          executionProviders: [provider as ExecutionProvider],
          graphOptimizationLevel: 'all',
        });
        this.session = session;
        this.inputName = session.inputNames[0];
        this.outputName = session.outputNames[0];
        const meta = (names: readonly string[], list: typeof session.inputMetadata) =>
          names.map((n) => {
            const m = list.find((x) => x.name === n);
            return toTensorInfo(n, m && m.isTensor ? m.shape : undefined);
          });
        return {
          runtime: this.name,
          executionProvider: provider,
          input: meta(session.inputNames, session.inputMetadata)[0],
          outputs: meta(session.outputNames, session.outputMetadata),
        };
      } catch (e) {
        lastError = e;
      }
    }
    throw new ModelLoadError(`Could not create an ONNX Runtime Web session for ${modelUri}`, lastError);
  }

  async run(input: Float32Array, dims: readonly number[]): Promise<RuntimeOutput> {
    if (!this.session || !this.ort) throw new Error('Model is not loaded');
    const results = await this.session.run({ [this.inputName]: new this.ort.Tensor('float32', input, dims as number[]) });
    const out = results[this.outputName];
    return { name: this.outputName, data: out.data as Float32Array, dims: [...out.dims] };
  }

  async dispose(): Promise<void> {
    await this.session?.release();
    this.session = null;
  }
}
