import { useCallback, useState } from 'react';
import { Camera } from 'react-native-vision-camera';

import type { CameraPermission, CameraPermissionStatus } from '@/types/camera';

function read(): CameraPermissionStatus {
  switch (Camera.getCameraPermissionStatus()) {
    case 'granted':
      return 'granted';
    case 'not-determined':
      return 'undetermined';
    default: // 'denied' | 'restricted'
      return 'denied';
  }
}

export function useVisionCameraPermission(): CameraPermission {
  const [status, setStatus] = useState<CameraPermissionStatus>(read);
  const [canAskAgain, setCanAskAgain] = useState(true);

  const request = useCallback(async () => {
    const result = await Camera.requestCameraPermission();
    setStatus(result === 'granted' ? 'granted' : 'denied');
    // Once the system prompt has been answered with "deny", the OS won't show it again:
    // the UI should then send the user to Settings.
    if (result !== 'granted') setCanAskAgain(false);
  }, []);

  return { status, canAskAgain, request };
}
