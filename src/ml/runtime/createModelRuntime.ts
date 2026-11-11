import { OnnxNativeRuntime } from './mobile/OnnxNativeRuntime';
import type { ModelRuntime } from './ModelRuntime';

/** iOS / Android. (`createModelRuntime.web.ts` replaces this file on web.) */
export function createModelRuntime(): ModelRuntime {
  return new OnnxNativeRuntime();
}
