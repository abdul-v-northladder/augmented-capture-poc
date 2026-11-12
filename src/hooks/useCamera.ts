import { useCallback, useRef, useState } from 'react';

import type { CameraFacing, CameraHandle, CameraStatus, CapturedPhoto } from '@/types/camera';

type Options = {
  initialFacing?: CameraFacing;
  onCapture?: (photo: CapturedPhoto) => void;
  /** Post-process the raw photo (e.g. crop to the capture frame) before it is shown and reported. */
  transformPhoto?: (photo: CapturedPhoto, context: { facing: CameraFacing }) => Promise<CapturedPhoto>;
  /** Sharpness score of a (transformed) photo, higher = sharper. With `minSharpness`, blurry shots are retaken. */
  scorePhoto?: (photo: CapturedPhoto) => Promise<number>;
  minSharpness?: number;
  /** Shots per capture press (default 1 = no retake). */
  maxAttempts?: number;
  retryDelayMs?: number;
};

/** Platform-agnostic camera state: facing, lifecycle status, capture and retry. */
export function useCamera({
  initialFacing = 'back',
  onCapture,
  transformPhoto,
  scorePhoto,
  minSharpness = 0,
  maxAttempts = 1,
  retryDelayMs = 0,
}: Options = {}) {
  const cameraRef = useRef<CameraHandle>(null);
  const [facing, setFacing] = useState<CameraFacing>(initialFacing);
  const [status, setStatus] = useState<CameraStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  // True when every attempt of the last capture was too blurry (no photo is accepted then).
  const [blurry, setBlurry] = useState(false);
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
    setBlurry(false);
    try {
      let best: { photo: CapturedPhoto; score: number } | null = null;
      for (let i = 0; i < maxAttempts; i++) {
        if (i > 0 && retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
        const raw = await cameraRef.current.takePhoto();
        const result = transformPhoto ? await transformPhoto(raw, { facing }) : raw;
        const score = scorePhoto ? await scorePhoto(result) : Infinity;
        if (__DEV__ && scorePhoto) console.log('[blur]', { attempt: i + 1, score: Math.round(score), min: minSharpness });
        if (!best || score > best.score) best = { photo: result, score };
        if (score >= minSharpness) break;
      }
      if (best && best.score >= minSharpness) {
        setPhoto(best.photo);
        onCapture?.(best.photo);
      } else {
        setBlurry(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to take a photo.');
      setStatus('error');
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, onCapture, transformPhoto, scorePhoto, minSharpness, maxAttempts, retryDelayMs, facing]);

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
    blurry,
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
