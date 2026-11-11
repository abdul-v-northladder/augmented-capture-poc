import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { PlatformCameraPreview } from '@/platform/camera';
import type { CameraStatus, PlatformCameraPreviewProps } from '@/types/camera';

type Props = PlatformCameraPreviewProps & {
  status: CameraStatus;
  /** Overlays (e.g. a capture frame) drawn above the camera, below the loading state. */
  children?: ReactNode;
};

/** Platform preview + loading overlay. Contains no camera-library code. */
export function CameraPreview({ status, children, ...previewProps }: Props) {
  return (
    <View style={styles.container}>
      <PlatformCameraPreview {...previewProps} />
      {children}
      {status === 'loading' && (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
});
