# Phone Detection POC

A mobile app that uses the live camera to detect a mobile phone, checks that it sits correctly inside a **Smartphone** or **Tablet** capture frame, and enables the **Capture** button only when the phone is fully inside the frame, correctly sized and held steady. The captured photo is cropped to the frame.

- **Model:** YOLO26n (Ultralytics, COCO-pretrained, `cell phone` class), exported to ONNX (~10 MB, 640×640 input). No custom training yet.
- **Stack:** Expo SDK 58, React Native 0.88, Expo Router, `react-native-vision-camera` 4, `onnxruntime-react-native`, `react-native-svg`.
- **Status:** tested on Android. iOS code paths exist but are untested. Web support exists in the code but is not covered here.

## Setup

### Prerequisites

- Node.js 20+ and npm
- Python 3.10+ (one-time, to export the model)
- A **physical device** (the camera and frame processor do not work in Expo Go or on simulators without a camera)
- Android: Android Studio (SDK + emulator/USB debugging) and JDK 17
- iOS: macOS with Xcode and an Apple developer team for device signing

### 1. Install dependencies

```bash
npm install
```

`postinstall` applies the patch in `patches/` (onnxruntime-react-native).

### 2. Export the model and copy it into the app

The `.onnx` / `.pt` files are git-ignored, so create them once:

```bash
npm run ml:export     # creates ml/.venv, installs requirements, writes ml/models/yolo26n.onnx (needs internet)
npm run ml:setup      # copies it to assets/models/yolo26n.onnx
```

Run `ml:export` first; `ml:setup` fails with "Missing ml/models/yolo26n.onnx" if the model does not exist yet. Manual equivalent of `ml:export`:

```bash
cd ml && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && python scripts/export_model.py
```

Re-run `npm run ml:setup` whenever the model is re-exported. If `assets/models/yolo26n.onnx` is missing, Metro fails with "Unable to resolve module …yolo26n.onnx".

### 3. Build and run

The app uses native modules (VisionCamera, ONNX Runtime, worklets), so it needs a **development build**, not Expo Go. `ios/` and `android/` are generated and git-ignored.

**Android** (device connected with USB debugging, or an emulator with a camera):

```bash
npm run android                 # = npx expo run:android (local build, installs and starts Metro)
```

Or build in the cloud with EAS, install the APK, then start Metro:

```bash
npx eas-cli@latest build --profile development --platform android
npx expo start --dev-client
```

**iOS** (physical device, Xcode required):

```bash
npm run ios -- --device         # = npx expo run:ios --device
```

### Day-to-day

- JS/TS changes: keep `npx expo start --dev-client` running and press `r` to reload.
- After changing `babel.config.js`: restart with `npx expo start --dev-client -c`.
- After adding or upgrading a package with native code: rebuild the development build (step 3). Install packages with `npx expo install <package>`.
- Checks: `npm run lint` and `npx tsc --noEmit`.

## How it works

```
Camera frame ──► [worker thread] resize plugin: YUV→RGB, scale, rotate upright
             └─► letterbox to 640×640 ──► [JS thread] LiveDetectionEngine
                                            └─► PhoneDetectionService (ONNX session)
                                            └─► map box to preview → alignment check
                                            └─► readiness state machine
                                                  └─► banner · frame colour · Capture button
```

1. **Frame capture:** a VisionCamera frame processor runs at most `DEFAULT_LIVE_MAX_FPS` (8) frames per second. While one frame is being inferred, newer frames are dropped (no queue).
2. **Pre-processing:** the native resize plugin converts and rotates the frame on a background thread. Pixels are sent to JS as an 8-bit binary string, because `react-native-worklets-core` cannot pass typed arrays or ArrayBuffers between runtimes.
3. **Inference:** `PhoneDetectionService` runs the ONNX model (end-to-end output `[1,300,6]`, no NMS needed) and keeps the `cell phone` class. Competing classes that overlap a phone box with a similar score suppress it (reduces phone-cover false positives).
4. **Geometry:** `liveGeometry.ts` maps the box into preview pixels (rotation, cover-crop, mirroring) and checks it against the selected capture frame (inside, size, centring).
5. **Readiness:** `captureReadiness.ts` moves through `searching → detected → too_far / too_close / outside_frame → aligning → ready → capturing`. Capture is enabled only in `ready` (≥3 stable frames over ~300 ms, mean confidence ≥ 0.75). Pressing Capture re-validates the latest detection first.
6. **Capture:** the photo is taken with `outputOrientation="preview"` and cropped to the frame region with `expo-image-manipulator`.

### Project layout

```
src/
  app/                       Expo Router entry (single screen)
  screens/CameraDemoScreen   the one screen: device-type selector + camera
  components/camera/         CameraScreen, controls, capture frame (SVG), detection overlay, permission UI
  hooks/                     useCamera, useLiveDetection, useCaptureReadiness, useDeviceType
  platform/camera/mobile/    VisionCamera: LiveVisionCamera (frame processor), VisionCameraCore (preview + photo)
  ml/
    live/                    LiveDetectionEngine (external store: inference, mapping, readiness)
    services/                PhoneDetectionService
    preprocessing/           letterbox + CHW tensor
    postprocessing/          YOLO output decoding, competitor suppression
    runtime/                 ONNX runtime adapter
    config/                  activeModel.ts (which model is used), asset resolution
  utils/                     liveGeometry, captureReadiness, frameGeometry, photoCrop
  config/                    deviceTypes.ts (frame shapes), liveDetection.ts (all thresholds + messages)
ml/                          Python tooling (not bundled in the app): export, evaluation, fine-tuning
```

`babel.config.js` applies the worklets-core Babel plugin only to frame-processor files and VisionCamera packages, and the Reanimated plugin to everything else. Do not remove it.

## Configuration

| What | Where |
|---|---|
| Frame types and dimensions (Smartphone, Tablet) | `src/config/deviceTypes.ts` |
| Confidence, size, centring and steadiness thresholds, FPS cap, banner messages | `src/config/liveDetection.ts` (every setting is commented) |
| Which model is loaded | `src/ml/config/activeModel.ts` |

## Improving detection quality

The stock model is generic COCO and has no "phone cover" concept, so a cover can score as a phone. The app mitigates this with the competitor suppression and the mean-confidence rule above. The proper fix is fine-tuning on our own photos:

- `ml/scripts/evaluate_images.py`: precision/recall per threshold on your own positive/negative photos (see `ml/datasets/README.md`).
- `ml/training/`: fine-tuning kit (see `ml/training/README.md`).
- Model export details and the model specification: `ml/README.md`.

## Known limitations

- The generic model can miss real phones and accept phone covers; fine-tuning with our own data is needed.
- Front camera, iOS and device rotation are not verified on real devices; no accuracy numbers on real data yet.
- **Licence:** YOLO26 (Ultralytics) is AGPL-3.0. Get legal sign-off before shipping, or switch to a permissively licensed model.
- Release setup (production builds, store submission) is not done.
