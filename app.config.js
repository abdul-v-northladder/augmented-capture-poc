// Extends app.json (passed in as `config`) with Android size optimisations for release-type builds.
// Controlled by EAS env vars (see eas.json): ANDROID_ABIS, e.g. "arm64-v8a" (comma separated).
// Unset (development profile / local runs) = Expo defaults, so emulators (x86_64) keep working.
module.exports = ({ config }) => {
  const abis = (process.env.ANDROID_ABIS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const optimise = process.env.ANDROID_OPTIMIZE === '1';

  const android = {
    ...(abis.length ? { buildArchs: abis } : {}),
    ...(optimise
      ? {
          enableProguardInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          // Compress native .so files inside the APK (smaller download; the OS extracts them at install).
          useLegacyPackaging: true,
          // This entry replaces (not merges with) the rules react-native-vision-camera's own plugin adds, so they are
          // repeated here. ONNX Runtime's JNI layer looks classes up by name, so R8 must not rename/strip them.
          extraProguardRules: [
            '-keep class com.mrousavy.camera.** { *; }',
            '-keep class com.worklets.** { *; }',
            '-keep class com.visioncameraresizeplugin.** { *; }',
            '-keep class ai.onnxruntime.** { *; }',
          ].join('\n'),
        }
      : {}),
  };

  if (Object.keys(android).length === 0) return config;
  return { ...config, plugins: [...(config.plugins ?? []), ['expo-build-properties', { android }]] };
};
