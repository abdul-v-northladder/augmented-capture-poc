import { requireOptionalNativeModule } from 'expo';
import { NativeModules } from 'react-native';

/** Which native modules the *running binary* contains. Helps tell "old dev build" from "not registered". */
export function nativeModuleReport(): { onnxruntime: boolean; imagePicker: boolean; imageManipulator: boolean; visionCamera: boolean } {
  return {
    onnxruntime: NativeModules.Onnxruntime != null,
    imagePicker: requireOptionalNativeModule('ExponentImagePicker') != null,
    imageManipulator: requireOptionalNativeModule('ExpoImageManipulator') != null,
    visionCamera: NativeModules.CameraView != null,
  };
}

export function describeNativeModules(): string {
  const r = nativeModuleReport();
  const f = (ok: boolean) => (ok ? 'yes' : 'NO');
  return (
    `Native modules in this app → onnxruntime: ${f(r.onnxruntime)}, image-picker: ${f(r.imagePicker)}, ` +
    `image-manipulator: ${f(r.imageManipulator)}, vision-camera: ${f(r.visionCamera)}.`
  );
}
