import { ACTIVE_MODEL_CONFIG } from './config/activeModel';
import { resolveActiveModelUri } from './config/activeModelAsset';
import { createModelRuntime } from './runtime/createModelRuntime';
import { PhoneDetectionService, type PhoneDetectionServiceOptions } from './services/PhoneDetectionService';

export * from './types/detection';
export * from './types/errors';
export * from './types/model';
export { PhoneDetectionService } from './services/PhoneDetectionService';

let shared: PhoneDetectionService | null = null;

/** App-wide detector (one session for the whole app). Pass options only on the first call. */
export function getPhoneDetectionService(
  overrides: Partial<Pick<PhoneDetectionServiceOptions, 'runtimeOptions' | 'confidenceThreshold' | 'iouThreshold'>> = {},
): PhoneDetectionService {
  shared ??= new PhoneDetectionService({
    runtime: createModelRuntime(),
    model: ACTIVE_MODEL_CONFIG,
    resolveModelUri: resolveActiveModelUri,
    ...overrides,
  });
  return shared;
}
