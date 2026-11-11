import { useEffect, useState } from 'react';

import { DEFAULT_ALIGNMENT_CONSTRAINTS } from '@/config/liveDetection';
import { getPhoneDetectionService } from '@/ml';
import { LiveDetectionEngine } from '@/ml/live/LiveDetectionEngine';
import type { ReadinessConfig } from '@/utils/captureReadiness';
import type { AlignmentConstraints } from '@/utils/liveGeometry';

type Options = {
  /** Live detection needs camera frames, so it is native-only for now. */
  enabled?: boolean;
  constraints?: AlignmentConstraints;
  /** Stability requirements for capture (hold time, frame count, ...). */
  readiness?: Partial<ReadinessConfig>;
};

/** One engine per screen, sharing the app-wide ONNX session. Loads and warms the model on mount. */
export function useLiveDetection({ enabled = true, constraints = DEFAULT_ALIGNMENT_CONSTRAINTS, readiness }: Options = {}) {
  const [engine] = useState(() =>
    enabled ? new LiveDetectionEngine(getPhoneDetectionService(), { constraints, readiness }) : null,
  );

  useEffect(() => {
    void engine?.start();
  }, [engine]);

  useEffect(() => {
    engine?.setConstraints(constraints);
  }, [engine, constraints]);

  return engine;
}
