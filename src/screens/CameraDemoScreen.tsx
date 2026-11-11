import { Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CameraScreen } from '@/components/camera/CameraScreen';
import { DeviceTypeSelector } from '@/components/camera/DeviceTypeSelector';
import { useDeviceType } from '@/hooks/useDeviceType';
import { useLiveDetection } from '@/hooks/useLiveDetection';

/** The app's one screen: live camera, device-type frame, continuous YOLO detection gating the Capture button. */
export default function CameraDemoScreen() {
  const { deviceType, deviceTypes, selectedId, select } = useDeviceType();
  // Native: VisionCamera frame processor. Web: <video> frame loop. Both feed the same engine.
  const live = useLiveDetection();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top', 'bottom']}>
      <DeviceTypeSelector deviceTypes={deviceTypes} selectedId={selectedId} onSelect={select} />
      <CameraScreen frame={deviceType.frame} live={live} showDetectionBox={Platform.OS === 'web'} />
    </SafeAreaView>
  );
}
