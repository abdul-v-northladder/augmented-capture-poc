// Two worklet runtimes live in this app:
//  - react-native-worklets (Reanimated 4): UI-thread worklets, used by Expo Router / animations.
//  - react-native-worklets-core (VisionCamera): the frame-processor runtime.
// They need different compiled output (worklets-core only recognises functions that carry `__closure`, which
// the Reanimated plugin omits for closure-free worklets), and the Reanimated plugin transforms a 'worklet'
// function first. So babel-preset-expo's automatic worklets plugin is turned off and each plugin is applied
// explicitly: worklets-core's only to the files whose 'worklet' functions run inside a VisionCamera frame
// processor, Reanimated's to everything else (including node_modules).
const FRAME_PROCESSOR_FILES = [
  'src/platform/camera/mobile/LiveVisionCamera.tsx',
  'src/utils/liveGeometry.ts',
  'src/ml/preprocessing/imagePreprocessor.ts',
];

// Function patterns: Metro builds its transformer without a filename, which rejects string/RegExp patterns.
// VisionCamera's own helpers (runAtTargetFps, runAsync, ...) are 'worklet' functions that run in the same
// runtime, so they must be compiled by worklets-core too (Reanimated's output made their module-level helpers
// "regular JS functions that cannot be shared").
const FRAME_PROCESSOR_PACKAGES = ['node_modules/react-native-vision-camera/', 'node_modules/vision-camera-resize-plugin/'];

const isFrameProcessorFile = (filename) => {
  if (typeof filename !== 'string') return false;
  const f = filename.replace(/\\/g, '/');
  return FRAME_PROCESSOR_FILES.some((p) => f.endsWith(p)) || FRAME_PROCESSOR_PACKAGES.some((p) => f.includes(p));
};

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { worklets: false, reanimated: false }]],
    overrides: [
      { test: (filename) => !isFrameProcessorFile(filename), plugins: ['react-native-worklets/plugin'] },
      { test: isFrameProcessorFile, plugins: ['react-native-worklets-core/plugin'] },
    ],
  };
};
