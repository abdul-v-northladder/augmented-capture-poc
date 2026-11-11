import { useSyncExternalStore } from 'react';

import type { LiveDetectionEngine } from '@/ml/live/LiveDetectionEngine';
import type { CaptureReadinessState } from '@/utils/captureReadiness';

const noopSubscribe = () => () => {};

/**
 * Current capture readiness from the live engine (the single source of truth), or `null` when there is no
 * live detection (e.g. web), in which case capture is not gated. Re-renders only when the state changes.
 */
export function useCaptureReadiness(engine: LiveDetectionEngine | null | undefined): CaptureReadinessState | null {
  const getReadiness = () => (engine ? engine.getSnapshot().readiness : null);
  return useSyncExternalStore(engine ? engine.subscribe : noopSubscribe, getReadiness, getReadiness);
}
