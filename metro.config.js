const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Keep the Python/ML workspace (virtualenv, weights) at <root>/ml out of the JS bundler's file crawl.
// Anchored to the project root so it does not match src/ml or src/components/ml.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = [].concat(config.resolver.blockList ?? [], [
  new RegExp(`^${escape(path.join(__dirname, 'ml'))}[\\\\/].*`),
]);
// Bundle the .onnx model as an asset (see scripts/setup-ml-assets.js).
config.resolver.assetExts = [...config.resolver.assetExts, 'onnx'];

module.exports = config;
