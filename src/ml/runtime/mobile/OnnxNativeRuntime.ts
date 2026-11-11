import type * as OrtNative from 'onnxruntime-react-native';
import { NativeModules } from 'react-native';

import { ModelLoadError } from '../../types/errors';
import type { ExecutionProvider, LoadedModelInfo, ModelRuntimeOptions } from '../../types/model';
import { describeNativeModules } from './nativeDiagnostics';
import { type ModelRuntime, type RuntimeOutput, providerCandidates, toTensorInfo } from '../ModelRuntime';

type Ort = typeof OrtNative;

/**
 * onnxruntime-react-native adapter. The module is required lazily: it is a native module, and
 * importing it in a build that does not contain it (e.g. Expo Go) would otherwise crash the whole route.
 * Session loading and `run` execute on native worker threads, so the JS/UI thread is not blocked.
 */
export class OnnxNativeRuntime implements ModelRuntime {
  readonly name = 'onnxruntime-react-native';
  private ort: Ort | null = null;
  private session: OrtNative.InferenceSession | null = null;
  private inputName = '';
  private outputName = '';

  private getOrt(): Ort {
    if (this.ort) return this.ort;
    // Check first: onnxruntime-react-native throws an opaque "Cannot read property 'install' of null" at import time.
    if (NativeModules.Onnxruntime == null) {
      throw new ModelLoadError(
        'The ONNX Runtime native module (NativeModules.Onnxruntime) is not registered in this app binary.\n' +
          describeNativeModules() +
          '\nIf the other modules are also missing, you are running an old development build: uninstall the app and ' +
          'install the latest build. If only onnxruntime is missing, the library is not being linked/registered ' +
          'by this build (React Native 0.88 / new architecture).',
      );
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.ort = require('onnxruntime-react-native') as Ort;
      return this.ort;
    } catch (cause) {
      throw new ModelLoadError(
        'onnxruntime-react-native is not available in this app. It is a native module: it cannot run in Expo Go. ' +
          'Use a development build (eas build --profile development, or expo run:android / run:ios).',
        cause,
      );
    }
  }

  async load(modelUri: string, options: ModelRuntimeOptions = {}): Promise<LoadedModelInfo> {
    const ort = this.getOrt();
    const candidates = providerCandidates(options.executionProviders, 'cpu');
    let lastError: unknown;

    for (const provider of candidates) {
      try {
        // A single provider per attempt, so we know exactly which one is active.
        const session = await ort.InferenceSession.create(modelUri, {
          executionProviders: [provider as ExecutionProvider] as OrtNative.InferenceSession.ExecutionProviderConfig[],
          graphOptimizationLevel: 'all',
          intraOpNumThreads: options.intraOpNumThreads,
        });
        this.session = session;
        this.inputName = session.inputNames[0];
        this.outputName = session.outputNames[0];
        const meta = (names: readonly string[], list: OrtNative.InferenceSession['inputMetadata']) =>
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
    throw new ModelLoadError(`Could not create an ONNX Runtime session for ${modelUri}`, lastError);
  }

  async run(input: Float32Array, dims: readonly number[]): Promise<RuntimeOutput> {
    if (!this.session || !this.ort) throw new Error('Model is not loaded');
    const tensor = new this.ort.Tensor('float32', input, dims as number[]);
    const results = await this.session.run({ [this.inputName]: tensor });
    const out = results[this.outputName];
    return { name: this.outputName, data: out.data as Float32Array, dims: [...out.dims] };
  }

  async dispose(): Promise<void> {
    await this.session?.release();
    this.session = null;
  }
}
