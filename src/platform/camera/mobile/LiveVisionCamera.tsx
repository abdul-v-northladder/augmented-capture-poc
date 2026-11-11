import { useMemo } from 'react';
import {
  type CameraDevice,
  runAtTargetFps,
  useCameraFormat,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { Worklets, useSharedValue } from 'react-native-worklets-core';
import { useResizePlugin } from 'vision-camera-resize-plugin';

import { DEFAULT_LIVE_MAX_FPS } from '@/config/liveDetection';
import { ACTIVE_MODEL_CONFIG } from '@/ml/config/activeModel';
import type { LiveDetectionEngine, LiveFrameMeta } from '@/ml/live/LiveDetectionEngine';
import { bytesToBinaryString } from '@/ml/preprocessing/imagePreprocessor';
import type { CameraFacing, PlatformCameraPreviewProps } from '@/types/camera';
import { planFramePreparation } from '@/utils/liveGeometry';

import { VisionCameraCore } from './VisionCameraCore';

type Props = Pick<PlatformCameraPreviewProps, 'onReady' | 'onError' | 'ref'> & {
  device: CameraDevice;
  facing: CameraFacing;
  isActive: boolean;
  engine: LiveDetectionEngine;
};

/** Release the in-flight flag (a plain function: the shared value is mutated outside React's render model). */
function release(flag: { value: boolean }) {
  flag.value = false;
}

const INPUT_SIZE = ACTIVE_MODEL_CONFIG.inputSize;

/**
 * Camera + frame processor feeding the shared YOLO inference layer.
 *
 * Per frame, on a worker thread (never the UI thread, never the JS thread):
 *   resize plugin (native: YUV→RGB, scale, rotate upright, float32)  →  HWC→CHW + letterbox  →  hand to JS.
 * On the JS thread the engine runs `session.run` (native, async). While a frame is in flight the shared
 * `busy` flag makes the worker drop every newer frame — there is never a queue of stale frames.
 */
export function LiveVisionCamera({ device, facing, isActive, engine, onReady, onError, ref }: Props) {
  const { resize } = useResizePlugin();
  const busy = useSharedValue(false);

  // ~1 MP video frames keep the native conversion cheap; photos stay at max resolution.
  // Photo and video share one aspect ratio, so the preview (video) and the captured photo show the same field of
  // view; the capture frame can then be cropped out of the photo exactly where it sat on the preview.
  const format = useCameraFormat(device, [
    { photoAspectRatio: 4 / 3 },
    { videoAspectRatio: 4 / 3 },
    { videoResolution: { width: 1280, height: 960 } },
    { photoResolution: 'max' },
  ]);

  const onTensor = useMemo(
    () =>
      Worklets.createRunOnJS((pixels: string, meta: LiveFrameMeta) => {
        void engine.processPixels(pixels, meta).finally(() => release(busy));
      }),
    [engine, busy],
  );
  const onFailure = useMemo(
    () =>
      Worklets.createRunOnJS((message: string) => {
        release(busy);
        onError(message);
      }),
    [busy, onError],
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      if (busy.value) return; // cheap early-out: a frame is still being inferred
      runAtTargetFps(DEFAULT_LIVE_MAX_FPS, () => {
        'worklet';
        if (busy.value) return;
        {
          busy.value = true;
          try {
            const plan = planFramePreparation(frame.width, frame.height, frame.orientation, INPUT_SIZE);
            const rgb = resize(frame, {
              crop: { x: 0, y: 0, width: frame.width, height: frame.height },
              scale: { width: plan.scaleWidth, height: plan.scaleHeight },
              rotation: `${plan.rotation}deg`,
              pixelFormat: 'rgb',
              // 8-bit output: a quarter of the memory of float32 (the float32 buffer crashed natively on Android).
              dataType: 'uint8',
            });
            const pixels = bytesToBinaryString(rgb, plan.letterbox.newWidth * plan.letterbox.newHeight * 3);
            // Only primitives cross runtimes: worklets-core rejects ArrayBuffers and drops typed arrays.
            onTensor(pixels, {
              upright: { width: plan.uprightWidth, height: plan.uprightHeight },
              letterbox: plan.letterbox,
              // The selfie preview is mirrored; the frame buffer is only mirrored if the camera says so.
              mirrored: facing === 'front' && !frame.isMirrored,
              source: { width: frame.width, height: frame.height, rotation: plan.rotation },
            });
          } catch (e) {
            onFailure(`Frame processing failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      });
    },
    [busy, resize, onTensor, onFailure, facing],
  );

  return (
    <VisionCameraCore
      device={device}
      isActive={isActive}
      onReady={onReady}
      onError={onError}
      ref={ref}
      frameProcessor={frameProcessor}
      format={format}
    />
  );
}
