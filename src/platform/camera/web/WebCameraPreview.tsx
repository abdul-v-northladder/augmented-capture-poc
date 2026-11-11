import { useEffect, useImperativeHandle, useRef } from 'react';

import type { CameraHandle, PlatformCameraPreviewProps } from '@/types/camera';

import { useWebLiveFrames } from './useWebLiveFrames';

export function describeCameraError(e: unknown): string {
  const name = (e as DOMException)?.name;
  switch (name) {
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
      return 'The camera is in use by another application.';
    case 'NotAllowedError':
      return 'Camera access was blocked.';
    default:
      return (e as Error)?.message || 'Could not start the camera.';
  }
}

export function WebCameraPreview({ facing, onReady, onError, ref, liveEngine }: PlatformCameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useWebLiveFrames(videoRef, liveEngine, facing);
  // Keep latest callbacks without restarting the stream when parents re-render.
  const callbacks = useRef({ onReady, onError });
  useEffect(() => {
    callbacks.current = { onReady, onError };
  });

  useImperativeHandle(
    ref,
    (): CameraHandle => ({
      takePhoto: async () => {
        const video = videoRef.current;
        if (!video || video.videoWidth === 0) throw new Error('Camera is not ready yet.');
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not create a drawing context.');
        if (facing === 'front') {
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1); // match the mirrored preview
        }
        ctx.drawImage(video, 0, 0);
        return {
          uri: canvas.toDataURL('image/jpeg', 0.9),
          width: canvas.width,
          height: canvas.height,
          isMirrored: facing === 'front',
        };
      },
    }),
    [facing],
  );

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        callbacks.current.onError('Camera requires a secure context (https or localhost).');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing === 'back' ? 'environment' : 'user' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        if (!cancelled) callbacks.current.onReady();
      } catch (e) {
        if (!cancelled) callbacks.current.onError(describeCameraError(e));
      }
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: facing === 'front' ? 'scaleX(-1)' : undefined,
      }}
    />
  );
}
