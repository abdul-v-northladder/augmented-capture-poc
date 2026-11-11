// onnxruntime-react-native ships a legacy `unimodule.json` and no react-native.config.js, so on Android Expo
// compiles the library (its .so files end up in the APK) but never registers `OnnxruntimePackage`.
// Result at runtime: NativeModules.Onnxruntime === null ("Cannot read property 'install' of null").
// This plugin adds the package to MainApplication manually, as the generated file's own comment suggests
// for "packages that cannot be autolinked yet". Idempotent.
const { withMainApplication } = require('@expo/config-plugins');

const IMPORT_PATH = 'ai.onnxruntime.reactnative.OnnxruntimePackage';

module.exports = function withOnnxruntimeAndroidPackage(config) {
  return withMainApplication(config, (cfg) => {
    const { language, contents } = cfg.modResults;
    if (contents.includes('OnnxruntimePackage')) return cfg;

    let updated = contents;
    if (language === 'kt') {
      updated = contents.replace(
        /(PackageList\(this\)\.packages\.apply \{\n)/,
        `$1          add(${IMPORT_PATH}())\n`,
      );
    } else {
      updated = contents.replace(
        /(List<ReactPackage> packages = new PackageList\(this\)\.getPackages\(\);\n)/,
        `$1      packages.add(new ${IMPORT_PATH}());\n`,
      );
    }
    if (updated === contents) {
      throw new Error(
        'withOnnxruntimeAndroidPackage: could not find the PackageList block in MainApplication; ' +
          'add OnnxruntimePackage manually.',
      );
    }
    cfg.modResults.contents = updated;
    return cfg;
  });
};
