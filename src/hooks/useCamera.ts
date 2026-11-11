import { useCallback, useRef, useState } from 'react';

import type { CameraFacing, CameraHandle, CameraStatus, CapturedPhoto } from '@/types/camera';

type Options = {
  initialFacing?: CameraFacing;
  onCapture?: (photo: CapturedPhoto) => void;
  /** Post-process the raw photo (e.g. crop to the capture frame) before it is shown and reported. */
  transformPhoto?: (photo: CapturedPhoto, context: { facing: CameraFacing }) => Promise<CapturedPhoto>;
};

/** Platform-agnostic camera state: facing, lifecycle status, capture and retry. */
export function useCamera({ initialFacing = 'back', onCapture, transformPhoto }: Options = {}) {
  const cameraRef = useRef<CameraHandle>(null);
  const [facing, setFacing] = useState<CameraFacing>(initialFacing);
  const [status, setStatus] = useState<CameraStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  // Changing the key remounts the preview, which re-runs camera start-up.
  const [attempt, setAttempt] = useState(0);

  const onReady = useCallback(() => {
    setError(null);
    setStatus('ready');
  }, []);

  const onError = useCallback((message: string) => {
    setError(message);
    setStatus('error');
  }, []);

  const toggleFacing = useCallback(() => {
    setStatus('loading');
    setFacing((f) => (f === 'back' ? 'front' : 'back'));
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setStatus('loading');
    setAttempt((a) => a + 1);
  }, []);

  const capture = useCallback(async () => {
    if (!cameraRef.current || isCapturing) return;
    setIsCapturing(true);
    try {
      const raw = await cameraRef.current.takePhoto();
      const result = transformPhoto ? await transformPhoto(raw, { facing }) : raw;
      setPhoto(result);
      onCapture?.(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to take a photo.');
      setStatus('error');
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, onCapture, transformPhoto, facing]);

  const discardPhoto = useCallback(() => {
    setPhoto(null);
    // The preview unmounts while reviewing a photo, so it must start up again.
    setStatus('loading');
    setAttempt((a) => a + 1);
  }, []);

  return {
    cameraRef,
    facing,
    status,
    error,
    photo,
    isCapturing,
    attempt,
    onReady,
    onError,
    toggleFacing,
    retry,
    capture,
    discardPhoto,
  };
}
