import { useEffect } from 'react';

import type { CameraPermission, PlatformCameraPreviewProps } from '@/types/camera';

export const NATIVE_MODULE_MISSING_MESSAGE =
  'The react-native-vision-camera native module is not in this app.\n\n' +
  'It cannot run in Expo Go. Install a development build (eas build --profile development, ' +
  'or expo run:android / run:ios) and open that app instead.';

/** Drop-in stand-in used when the native module is missing: reports a camera error, nothing else. */
export function UnavailableCameraPreview({ onError }: PlatformCameraPreviewProps) {
  useEffect(() => {
    onError(NATIVE_MODULE_MISSING_MESSAGE);
  }, [onError]);
  return null;
}

export function useUnavailableCameraPermission(): CameraPermission {
  // "granted" lets the screen reach the preview, which then shows the explanatory error.
  return { status: 'granted', canAskAgain: false, request: async () => {} };
}

export function useUnavailableCanSwitchCamera(): boolean {
  return false;
}
