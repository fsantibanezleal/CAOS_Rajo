// Prebuild: copy the committed artifacts (../data/derived), the exported models (../models/**, ONNX and
// their JSON side-cars) and the onnxruntime-web WASM runtime into the SPA's public/ overlay so the static
// site serves them. public/data, public/models and public/ort are build-time overlays (git-ignored); the
// canonical copies live in ../data/derived, ../models and node_modules.
// This script COPIES. It never runs science and never writes back into the canonical tree.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PUB = join(HERE, 'public');

// RAJO_DERIVED points the build at a sandbox tree (build/local) for local gates; the default is the committed tree.
const derived = process.env.RAJO_DERIVED ? join(ROOT, process.env.RAJO_DERIVED) : join(ROOT, 'data', 'derived');
const pubData = join(PUB, 'data');
rmSync(pubData, { recursive: true, force: true });
mkdirSync(pubData, { recursive: true });
if (existsSync(join(derived, 'catalog.json'))) {
  cpSync(derived, pubData, { recursive: true });
  console.log(`[copy-data] ${derived} -> public/data`);
} else {
  console.warn('[copy-data] no data/derived/catalog.json: the app runs the browser lanes only (no baked sites)');
}

// models: every .onnx and .json under ../models, tree preserved (models/rf/rf-v1.onnx -> /models/rf/rf-v1.onnx)
const models = join(ROOT, 'models');
const pubModels = join(PUB, 'models');
rmSync(pubModels, { recursive: true, force: true });
mkdirSync(pubModels, { recursive: true });
let nModels = 0;
function copyModels(src, dst) {
  for (const f of readdirSync(src)) {
    const s = join(src, f);
    const d = join(dst, f);
    if (statSync(s).isDirectory()) {
      mkdirSync(d, { recursive: true });
      copyModels(s, d);
    } else if (f.endsWith('.onnx') || f.endsWith('.json')) {
      cpSync(s, d);
      nModels++;
    }
  }
}
if (existsSync(models)) {
  copyModels(models, pubModels);
  console.log(`[copy-data] ${nModels} model file(s) -> public/models`);
}

// the onnxruntime-web runtime: the WASM binaries and their loaders, served from /ort/ (ort.env.wasm.wasmPaths)
const ortDist = join(HERE, 'node_modules', 'onnxruntime-web', 'dist');
const pubOrt = join(PUB, 'ort');
rmSync(pubOrt, { recursive: true, force: true });
mkdirSync(pubOrt, { recursive: true });
if (existsSync(ortDist)) {
  const files = readdirSync(ortDist).filter((f) => /^ort-wasm-simd-threaded(\.jsep)?\.(wasm|mjs)$/.test(f));
  for (const f of files) cpSync(join(ortDist, f), join(pubOrt, f));
  console.log(`[copy-data] ${files.length} onnxruntime-web runtime file(s) -> public/ort`);
} else {
  console.warn('[copy-data] onnxruntime-web not installed: the learned lane cannot run');
}
