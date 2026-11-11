import type { ModelRuntime } from './ModelRuntime';
import { OnnxWebRuntime } from './web/OnnxWebRuntime';

/** Browser. */
export function createModelRuntime(): ModelRuntime {
  return new OnnxWebRuntime();
}
