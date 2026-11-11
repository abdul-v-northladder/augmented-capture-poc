#!/usr/bin/env node
// Creates ml/models/yolo26n.onnx (git-ignored, so a fresh clone does not have it):
//   1. creates ml/.venv if missing
//   2. installs ml/requirements.txt into it
//   3. runs ml/scripts/export_model.py (downloads the yolo26n weights, needs internet)
// Run once after cloning:  npm run ml:export && npm run ml:setup
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const mlDir = path.resolve(__dirname, '..', 'ml');
const isWin = process.platform === 'win32';
const venvPython = path.join(mlDir, '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: mlDir, stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    console.error(`\nFailed: ${cmd} ${args.join(' ')}${r.error ? ` (${r.error.message})` : ''}`);
    process.exit(r.status || 1);
  }
}

if (!fs.existsSync(venvPython)) run(isWin ? 'python' : 'python3', ['-m', 'venv', '.venv']);
run(venvPython, ['-m', 'pip', 'install', '-r', 'requirements.txt']);
run(venvPython, ['scripts/export_model.py']);
console.log('\nDone. Now run: npm run ml:setup');
