// The random forest's per-pixel feature stack, mirrored operation for operation from
// data-pipeline/train/common.py (rf_features). The order is a contract with the ONNX model; the golden
// fixture test (features.test.ts) pins every value against the Python output on a synthetic chip.
//
// Python computes on bands where no-data pixels are 0 (never NaN); the browser read leaves NaN where a
// pixel has no data, so the bands are copied with NaN -> 0 first. Validity is decided by the caller.
import type { Bands } from '../lib/indices';

export const RF_FEATURES = [
  'blue', 'green', 'red', 'nir', 'swir16', 'swir22',
  'ndvi', 'mndwi', 'bsi', 'ndbi',
  'iron', 'clay', 'ferrous',
  'bsi_mean3', 'bsi_std3', 'ndvi_mean3',
] as const;
export const N_FEATURES = RF_FEATURES.length;
const EPS = 1e-6;

/** NaN (no data) -> 0 like the Python chips, and negative reflectance (a calibration artefact) -> 0. */
function zeroNaN(a: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!;
    out[i] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  return out;
}

/** scipy.ndimage.uniform_filter(size=3, mode='reflect'): the edge pixel is repeated (d c b a | a b c d | d c b a). */
export function boxMean3(x: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(x.length);
  const out = new Float32Array(x.length);
  // horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let i = 0; i < w; i++) {
      const l = i > 0 ? i - 1 : 0;
      const r = i < w - 1 ? i + 1 : w - 1;
      tmp[row + i] = (x[row + l]! + x[row + i]! + x[row + r]!) / 3;
    }
  }
  // vertical pass
  for (let y = 0; y < h; y++) {
    const u = y > 0 ? y - 1 : 0;
    const d = y < h - 1 ? y + 1 : h - 1;
    for (let i = 0; i < w; i++) out[y * w + i] = (tmp[u * w + i]! + tmp[y * w + i]! + tmp[d * w + i]!) / 3;
  }
  return out;
}

export function boxStd3(x: Float32Array, w: number, h: number): Float32Array {
  const m = boxMean3(x, w, h);
  const sq = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) sq[i] = x[i]! * x[i]!;
  const m2 = boxMean3(sq, w, h);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = m2[i]! - m[i]! * m[i]!;
    out[i] = Math.sqrt(v > 0 ? v : 0);
  }
  return out;
}

/** Sixteen feature planes in RF_FEATURES order, each width*height float32. */
export function rfFeatures(bands: Pick<Bands, 'width' | 'height' | 'blue' | 'green' | 'red' | 'nir' | 'swir16' | 'swir22'>): Float32Array[] {
  const { width: w, height: h } = bands;
  const n = w * h;
  const blue = zeroNaN(bands.blue);
  const green = zeroNaN(bands.green);
  const red = zeroNaN(bands.red);
  const nir = zeroNaN(bands.nir);
  const swir16 = zeroNaN(bands.swir16);
  const swir22 = zeroNaN(bands.swir22);
  const ndvi = new Float32Array(n);
  const mndwi = new Float32Array(n);
  const bsi = new Float32Array(n);
  const ndbi = new Float32Array(n);
  const iron = new Float32Array(n);
  const clay = new Float32Array(n);
  const ferrous = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = blue[i]!;
    const g = green[i]!;
    const r = red[i]!;
    const ni = nir[i]!;
    const s1 = swir16[i]!;
    const s2 = swir22[i]!;
    ndvi[i] = (ni - r) / (ni + r + EPS);
    mndwi[i] = (g - s1) / (g + s1 + EPS);
    bsi[i] = (s1 + r - (ni + b)) / (s1 + r + (ni + b) + EPS);
    ndbi[i] = (s1 - ni) / (s1 + ni + EPS);
    iron[i] = r / (b + EPS);
    clay[i] = s1 / (s2 + EPS);
    ferrous[i] = s2 / (ni + EPS); // B12 / B8A, docs/methods/02
  }
  return [blue, green, red, nir, swir16, swir22, ndvi, mndwi, bsi, ndbi, iron, clay, ferrous, boxMean3(bsi, w, h), boxStd3(bsi, w, h), boxMean3(ndvi, w, h)];
}

/** Interleaves the planes into the [N, 16] row-major tensor the ONNX forest expects, for rows [from, to). */
export function featureRows(planes: Float32Array[], from: number, to: number): Float32Array {
  const rows = to - from;
  const out = new Float32Array(rows * planes.length);
  for (let f = 0; f < planes.length; f++) {
    const p = planes[f]!;
    for (let i = 0; i < rows; i++) out[i * planes.length + f] = p[from + i]!;
  }
  return out;
}
