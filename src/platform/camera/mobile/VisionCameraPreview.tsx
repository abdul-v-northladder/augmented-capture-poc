import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useCameraDevice } from 'react-native-vision-camera';

import type { PlatformCameraPreviewProps } from '@/types/camera';

import { VisionCameraCore } from './VisionCameraCore';

const LIVE_UNAVAILABLE_MESSAGE =
  'Live detection is not available in this build: react-native-worklets-core / vision-camera-resize-plugin ' +
  'are missing from the app binary. Install the latest development build (eas build --profile development).';

/** Wait this long for a device before reporting "no camera" (simulators have none). */
const NO_DEVICE_TIMEOUT_MS = 1500;

/**
 * Frame processing needs two extra native modules (worklets-core, resize plugin). Resolve that component once,
 * guarded, at module load so a build without them still gets the normal camera preview (and the live status
 * shows why) instead of the whole camera falling back to the "unavailable" screen.
 */
const LiveCamera = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('./LiveVisionCamera') as typeof import('./LiveVisionCamera')).LiveVisionCamera;
  } catch {
    return null;
  }
})();

export function VisionCameraPreview({ facing, onReady, onError, ref, liveEngine }: PlatformCameraPreviewProps) {
  const device = useCameraDevice(facing);
  const [isActive, setIsActive] = useState(AppState.currentState === 'active');

  // Stop the capture session while the app is in the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setIsActive(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (device) return;
    const t = setTimeout(() => onError(`No ${facing} camera was found on this device.`), NO_DEVICE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [device, facing, onError]);

  useEffect(() => {
    if (liveEngine && !LiveCamera) liveEngine.fail(LIVE_UNAVAILABLE_MESSAGE);
  }, [liveEngine]);

  if (!device) return null;

  // Frame processing lives in its own component so its hooks only run when live detection is requested.
  return LiveCamera && liveEngine ? (
    <LiveCamera device={device} facing={facing} isActive={isActive} engine={liveEngine} onReady={onReady} onError={onError} ref={ref} />
  ) : (
    <VisionCameraCore device={device} isActive={isActive} onReady={onReady} onError={onError} ref={ref} />
  );
}
