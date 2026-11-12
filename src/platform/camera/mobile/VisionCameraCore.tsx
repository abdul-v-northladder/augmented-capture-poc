import { type ComponentProps, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Camera, type CameraDevice } from 'react-native-vision-camera';

import type { CameraHandle, PlatformCameraPreviewProps } from '@/types/camera';

type Extra = Pick<ComponentProps<typeof Camera>, 'frameProcessor' | 'format'>;

type Props = Pick<PlatformCameraPreviewProps, 'onReady' | 'onError' | 'ref'> &
  Extra & {
    device: CameraDevice;
    isActive: boolean;
  };

/** The `<Camera>` itself: ready/error reporting and photo capture. Frame processing is injected via props. */
export function VisionCameraCore({ device, isActive, onReady, onError, ref, frameProcessor, format }: Props) {
  const cameraRef = useRef<Camera>(null);
  const readyRef = useRef(false);

  useImperativeHandle(
    ref,
    (): CameraHandle => ({
      focus: async (point) => {
        try {
          await cameraRef.current?.focus(point);
        } catch {
          // Unsupported (some front cameras) or interrupted: capture just uses the current focus.
        }
      },
      takePhoto: async () => {
        if (!cameraRef.current || !readyRef.current) throw new Error('Camera is not ready yet.');
        const photo = await cameraRef.current.takePhoto({ enableShutterSound: true });
        // Photos keep the (landscape) sensor size and carry an orientation; a portrait photo is
        // reported as landscape-left/right, so swap to get the dimensions as displayed.
        const rotated = photo.orientation === 'landscape-left' || photo.orientation === 'landscape-right';
        return {
          uri: `file://${photo.path}`,
          width: rotated ? photo.height : photo.width,
          height: rotated ? photo.width : photo.height,
          isMirrored: photo.isMirrored,
          orientation: photo.orientation,
        };
      },
    }),
    [],
  );

  return (
    <Camera
      ref={cameraRef}
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={isActive}
      photo
      photoQualityBalance="quality"
      resizeMode="cover"
      // Photos follow the preview's orientation, not the physical device's. The default ('device') rotates the
      // saved photo when the phone is tilted/turned while the screen is locked to portrait, so it came out
      // rotated or upside-down compared with what the preview showed.
      outputOrientation="preview"
      frameProcessor={frameProcessor}
      format={format}
      onInitialized={() => {
        readyRef.current = true;
        onReady();
      }}
      onError={(e) => onError(e.message)}
    />
  );
}
