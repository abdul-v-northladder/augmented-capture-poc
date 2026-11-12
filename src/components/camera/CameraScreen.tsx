import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { useCamera } from '@/hooks/useCamera';
import { useCaptureReadiness } from '@/hooks/useCaptureReadiness';
import { useCanSwitchCamera, usePlatformCameraPermission } from '@/platform/camera';
import type { CameraFacing, CapturedPhoto } from '@/types/camera';
import type { LiveDetectionEngine } from '@/ml/live/LiveDetectionEngine';
import { BLUR_CONFIG } from '@/config/liveDetection';
import { measureSharpness } from '@/utils/blurDetection';
import { cropPhotoToFrame, trimPhotoToPhone } from '@/utils/photoCrop';
import type { FrameConfiguration, FrameGeometry } from '@/types/frame';

import { CameraControls } from './CameraControls';
import { CameraPermission } from './CameraPermission';
import { CameraPreview } from './CameraPreview';
import { CaptureFrame } from './CaptureFrame';
import { LiveCaptureFrame } from './LiveCaptureFrame';
import { LiveDetectionOverlay } from './LiveDetectionOverlay';

type Props = {
  initialFacing?: CameraFacing;
  onCapture?: (photo: CapturedPhoto) => void;
  /** Optional capture frame drawn over the preview. Changing it never remounts the camera. */
  frame?: FrameConfiguration;
  onFrameGeometryChange?: (geometry: FrameGeometry) => void;
  /**
   * Optional live detection (native). Camera frames feed the engine, which compares the detected phone with
   * `frame`; switching `frame` re-evaluates alignment without touching the camera.
   */
  live?: LiveDetectionEngine | null;
  /** Draw the detected phone's boundary over the preview (used on web). */
  showDetectionBox?: boolean;
  /** Extra bottom padding, e.g. to clear a tab bar. */
  bottomInset?: number;
  /** Extra top padding, e.g. to clear a floating header. */
  topInset?: number;
};

const scorePhoto = (p: CapturedPhoto) => measureSharpness(p.uri);

export function CameraScreen({
  initialFacing,
  onCapture,
  frame,
  onFrameGeometryChange,
  live,
  showDetectionBox,
  bottomInset = 0,
  topInset = 0,
}: Props) {
  const permission = usePlatformCameraPermission();
  // Latest resolved frame, so a capture can be cropped to exactly what the frame showed.
  const geometryRef = useRef<FrameGeometry | null>(null);
  // Bottom edge of the capture frame: the live stats sit just below it.
  const [frameBottom, setFrameBottom] = useState<number | undefined>(undefined);
  const transformPhoto = useCallback(
    async (raw: CapturedPhoto, { facing: f }: { facing: CameraFacing }) => {
      const g = geometryRef.current;
      if (!g) return raw;
      // Crop to the frame, then tighten to the phone itself (edge to edge, small padding).
      return trimPhotoToPhone(await cropPhotoToFrame(raw, g, f));
    },
    [],
  );
  const canSwitch = useCanSwitchCamera();
  const {
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
  } = useCamera({
    initialFacing,
    onCapture,
    transformPhoto,
    scorePhoto: live ? scorePhoto : undefined,
    minSharpness: BLUR_CONFIG.minSharpness,
    maxAttempts: BLUR_CONFIG.maxAttempts,
    retryDelayMs: BLUR_CONFIG.retryDelayMs,
  });

  // One geometry callback for both consumers; the engine uses it as the alignment target.
  const handleFrameGeometry = useCallback(
    (g: FrameGeometry) => {
      geometryRef.current = g;
      setFrameBottom(g.bounds.y + g.bounds.height);
      live?.setFrameGeometry(g);
      onFrameGeometryChange?.(g);
    },
    [live, onFrameGeometryChange],
  );

  // Capture is gated by the live engine's readiness state (the only readiness state); no engine = not gated.
  const readiness = useCaptureReadiness(live);
  const handleCapture = useCallback(async () => {
    if (live && !live.beginCapture()) return; // re-validates the latest detection; false unless still `ready`
    try {
      await capture();
    } finally {
      live?.endCapture();
    }
  }, [live, capture]);

  const pad = { paddingTop: topInset, paddingBottom: bottomInset };

  if (permission.status === 'loading') {
    return (
      <View style={[styles.center, pad]}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (permission.status !== 'granted') {
    return (
      <View style={[styles.root, pad]}>
        <CameraPermission permission={permission} />
      </View>
    );
  }

  if (photo) {
    return (
      <View style={[styles.root, pad]}>
        <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="contain" />
        <Text style={styles.meta}>
          {photo.width} × {photo.height}
        </Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={discardPhoto}>
          <Text style={styles.buttonText}>Retake</Text>
        </Pressable>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={[styles.center, pad]}>
        <Text style={styles.title}>Camera error</Text>
        <Text style={styles.body}>{error ?? 'Something went wrong.'}</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={retry}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, pad]}>
      <CameraPreview
        key={attempt}
        ref={cameraRef}
        facing={facing}
        status={status}
        onReady={onReady}
        onError={onError}
        liveEngine={live ?? undefined}>
        {frame &&
          (live ? (
            <LiveCaptureFrame config={frame} engine={live} onGeometryChange={handleFrameGeometry} />
          ) : (
            <CaptureFrame config={frame} onGeometryChange={handleFrameGeometry} />
          ))}
        {isCapturing && (
          <View style={styles.processing}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.processingText}>Processing photo…</Text>
          </View>
        )}
        {blurry && (
          <View pointerEvents="none" style={styles.blurBanner}>
            <Text style={styles.blurText}>Photo was blurry. Hold the phone steady and try again.</Text>
          </View>
        )}
        {live && <LiveDetectionOverlay engine={live} statsTop={frameBottom} showDetectionBox={showDetectionBox} />}
      </CameraPreview>
      <CameraControls
        onCapture={handleCapture}
        onSwitch={canSwitch ? toggleFacing : undefined}
        disabled={status !== 'ready' || isCapturing}
        busy={isCapturing}
        captureDisabled={readiness !== null && readiness !== 'ready'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  processing: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  processingText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  blurBanner: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(200,40,40,0.9)',
    borderRadius: 12,
    padding: 12,
  },
  blurText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  photo: { flex: 1, width: '100%' },
  meta: { color: '#bbb', textAlign: 'center', paddingTop: 8 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  body: { color: '#bbb', fontSize: 15, textAlign: 'center', maxWidth: 360 },
  button: {
    alignSelf: 'center',
    backgroundColor: '#208AEF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    margin: 16,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
