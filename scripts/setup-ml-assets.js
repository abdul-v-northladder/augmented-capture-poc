#!/usr/bin/env node
// Copies the files the app needs at runtime but that are not committed to Git:
//   ml/models/yolo26n.onnx                -> assets/models/yolo26n.onnx   (bundled by Metro)
//   onnxruntime-web WASM runtime          -> public/ort/                  (served at /ort/ on web)
// Run after `npm install` and after re-exporting the model:  npm run ml:setup
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`copied ${path.relative(root, from)} -> ${path.relative(root, to)}`);
};

const model = path.join(root, 'ml/models/yolo26n.onnx');
if (!fs.existsSync(model)) {
  console.error(
    'Missing ml/models/yolo26n.onnx. Create it first:\n' +
      '  cd ml && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt\n' +
      '  python scripts/export_model.py',
  );
  process.exit(1);
}
copy(model, path.join(root, 'assets/models/yolo26n.onnx'));

const dist = path.join(root, 'node_modules/onnxruntime-web/dist');
for (const f of ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  copy(path.join(dist, f), path.join(root, 'public/ort', f));
}
