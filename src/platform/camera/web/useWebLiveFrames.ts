import { type RefObject, useEffect } from 'react';

import { DEFAULT_LIVE_MAX_FPS } from '@/config/liveDetection';
import { ACTIVE_MODEL_CONFIG } from '@/ml/config/activeModel';
import type { LiveDetectionEngine } from '@/ml/live/LiveDetectionEngine';
import { computeLetterbox, rgbaToChwTensor } from '@/ml/preprocessing/imagePreprocessor';
import type { CameraFacing } from '@/types/camera';

/**
 * Browser frame source for live detection: copies the playing <video> into a letterboxed canvas, converts it with
 * the shared tensor helpers and hands it to the same `LiveDetectionEngine` the native camera uses (ONNX Runtime
 * Web runs the model). Only the acquisition differs per platform; mapping, alignment and readiness are shared.
 *
 * One frame at a time: the next tick is scheduled only after the previous inference finished (no queue, stale
 * frames are simply never taken), capped at `DEFAULT_LIVE_MAX_FPS`, and paused while the tab is hidden.
 */
export function useWebLiveFrames(
  videoRef: RefObject<HTMLVideoElement | null>,
  engine: LiveDetectionEngine | undefined,
  facing: CameraFacing,
) {
  useEffect(() => {
    if (!engine) return;
    const { inputSize, padValue } = ACTIVE_MODEL_CONFIG;
    const interval = 1000 / DEFAULT_LIVE_MAX_FPS;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let canvas: HTMLCanvasElement | null = null;

    const tick = async () => {
      const started = performance.now();
      const video = videoRef.current;
      try {
        if (!document.hidden && video && video.readyState >= 2 && video.videoWidth > 0 && !engine.isBusy) {
          const lb = computeLetterbox(video.videoWidth, video.videoHeight, inputSize);
          canvas ??= document.createElement('canvas');
          canvas.width = inputSize;
          canvas.height = inputSize;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.fillStyle = `rgb(${padValue},${padValue},${padValue})`;
            ctx.fillRect(0, 0, inputSize, inputSize);
            ctx.imageSmoothingQuality = 'high'; // closer to the Python/PIL resize the model was checked with
            ctx.drawImage(video, lb.left, lb.top, lb.newWidth, lb.newHeight);
            const tensor = rgbaToChwTensor(ctx.getImageData(0, 0, inputSize, inputSize).data, inputSize);
            await engine.processTensor(tensor, {
              upright: { width: video.videoWidth, height: video.videoHeight },
              letterbox: lb,
              // The selfie preview is shown mirrored (CSS), the video pixels are not.
              mirrored: facing === 'front',
              source: { width: video.videoWidth, height: video.videoHeight, rotation: 0 },
            });
          }
        }
      } catch (e) {
        engine.fail(`Frame processing failed: ${e instanceof Error ? e.message : String(e)}`);
        return; // stop the loop: the engine is in its error state
      }
      if (!stopped) timer = setTimeout(tick, Math.max(0, interval - (performance.now() - started)));
    };

    timer = setTimeout(tick, interval);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [videoRef, engine, facing]);
}
