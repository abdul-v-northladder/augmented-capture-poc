import {
  UnavailableCameraPreview,
  useUnavailableCameraPermission,
  useUnavailableCanSwitchCamera,
} from './unavailable';

// react-native-vision-camera throws while being *imported* if its native module is missing
// (Expo Go, or a dev build made before it was installed). That would crash the whole route,
// so load it lazily and fall back to an error screen instead.
type Impl = typeof import('./vision');

function load(): Impl {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./vision') as Impl;
  } catch {
    return {
      PlatformCameraPreview: UnavailableCameraPreview,
      usePlatformCameraPermission: useUnavailableCameraPermission,
      useCanSwitchCamera: useUnavailableCanSwitchCamera,
    };
  }
}

const impl = load();

export const PlatformCameraPreview = impl.PlatformCameraPreview;
export const usePlatformCameraPermission = impl.usePlatformCameraPermission;
export const useCanSwitchCamera = impl.useCanSwitchCamera;
