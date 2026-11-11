import { useCallback, useEffect, useState } from 'react';

import type { CameraPermission, CameraPermissionStatus } from '@/types/camera';

export function useWebCameraPermission(): CameraPermission {
  const [status, setStatus] = useState<CameraPermissionStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: CameraPermissionStatus;
      try {
        // Not every browser supports the "camera" permission name (e.g. Safari) → prompt instead.
        const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
        next =
          result.state === 'granted' ? 'granted' : result.state === 'denied' ? 'denied' : 'undetermined';
      } catch {
        next = 'undetermined';
      }
      if (!cancelled) setStatus(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const request = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      // Insecure context or unsupported browser: let the preview report the precise error.
      setStatus('granted');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      setStatus('granted');
    } catch (e) {
      const name = (e as DOMException).name;
      // Other failures (no device, in use) are surfaced by the preview as camera errors.
      setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'granted');
    }
  }, []);

  return { status, canAskAgain: false, request };
}
