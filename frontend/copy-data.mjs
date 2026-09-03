// Prebuild: copy the committed artifacts (../data/derived) and the exported models (../models/*.onnx)
// into the SPA's public/ overlay so the static site serves them. public/data and public/models are
// build-time overlays (git-ignored); the canonical copies live in ../data/derived and ../models.
// This script COPIES. It never runs science and never writes back into the canonical tree.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
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

const models = join(ROOT, 'models');
const pubModels = join(PUB, 'models');
rmSync(pubModels, { recursive: true, force: true });
mkdirSync(pubModels, { recursive: true });
if (existsSync(models)) {
  const onnx = readdirSync(models).filter((f) => f.endsWith('.onnx') || f === 'registry.json');
  for (const f of onnx) cpSync(join(models, f), join(pubModels, f));
  console.log(`[copy-data] ${onnx.length} model file(s) -> public/models`);
}
