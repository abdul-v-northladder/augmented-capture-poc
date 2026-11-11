import { useMemo } from 'react';

import { FRAME_ALIGNED_COLOR } from '@/config/liveDetection';
import { useCaptureReadiness } from '@/hooks/useCaptureReadiness';
import type { LiveDetectionEngine } from '@/ml/live/LiveDetectionEngine';
import type { FrameConfiguration, FrameGeometry } from '@/types/frame';

import { CaptureFrame } from './CaptureFrame';

type Props = {
  config: FrameConfiguration;
  engine: LiveDetectionEngine;
  onGeometryChange?: (geometry: FrameGeometry) => void;
};

/**
 * The unchanged `CaptureFrame`, with its outline green while the shared capture state is `ready`/`capturing`
 * (aligned, stable and confident), so frame colour, banner and button always agree. Re-renders only on a state
 * change, not on every detection.
 */
export function LiveCaptureFrame({ config, engine, onGeometryChange }: Props) {
  const readiness = useCaptureReadiness(engine);
  const good = readiness === 'ready' || readiness === 'capturing';
  const shown = useMemo(() => (good ? { ...config, borderColor: FRAME_ALIGNED_COLOR } : config), [good, config]);
  return <CaptureFrame config={shown} onGeometryChange={onGeometryChange} />;
}
