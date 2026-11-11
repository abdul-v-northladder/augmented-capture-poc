import { useCameraDevices } from 'react-native-vision-camera';

/** True when the phone exposes both a front and a back camera. */
export function useCanSwitchCamera(): boolean {
  const devices = useCameraDevices();
  return devices.some((d) => d.position === 'front') && devices.some((d) => d.position === 'back');
}
