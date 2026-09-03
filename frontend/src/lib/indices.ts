// Band math on reflectance rasters: the spectral indices and mineral ratios of the Methods page, plus
// percentiles, histograms and Otsu's threshold. Pure functions over typed arrays, shared by the worker and
// the tests. Reflectance is in [0, 1]; invalid pixels are NaN in the outputs.

export type Channel = 'blue' | 'green' | 'red' | 'nir' | 'swir16' | 'swir22';
export const CHANNELS: Channel[] = ['blue', 'green', 'red', 'nir', 'swir16', 'swir22'];

export interface Bands {
  width: number;
  height: number;
  blue: Float32Array;
  green: Float32Array;
  red: Float32Array;
  nir: Float32Array;
  swir16: Float32Array;
  swir22: Float32Array;
  valid: Uint8Array; // 1 where every channel has data and the quality mask is clear
}

export type IndexName = 'ndvi' | 'ndwi' | 'mndwi' | 'ndbi' | 'bsi' | 'nbr' | 'iron' | 'clay' | 'ferrous';

export interface IndexSpec {
  id: IndexName;
  /** display range suggestion */
  range: [number, number];
  /** whether the index is a normalised difference (in [-1, 1]) or a ratio (positive) */
  kind: 'normalised' | 'ratio';
}

export const INDEX_SPECS: Record<IndexName, IndexSpec> = {
  ndvi: { id: 'ndvi', range: [-0.2, 0.8], kind: 'normalised' },
  ndwi: { id: 'ndwi', range: [-0.6, 0.6], kind: 'normalised' },
  mndwi: { id: 'mndwi', range: [-0.8, 0.8], kind: 'normalised' },
  ndbi: { id: 'ndbi', range: [-0.6, 0.6], kind: 'normalised' },
  bsi: { id: 'bsi', range: [-0.4, 0.6], kind: 'normalised' },
  nbr: { id: 'nbr', range: [-0.6, 0.6], kind: 'normalised' },
  iron: { id: 'iron', range: [0.8, 2.6], kind: 'ratio' },
  clay: { id: 'clay', range: [0.8, 1.8], kind: 'ratio' },
  ferrous: { id: 'ferrous', range: [0.4, 1.6], kind: 'ratio' },
};

function nd(a: Float32Array, b: Float32Array, valid: Uint8Array): Float32Array {
  const n = a.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!valid[i]) {
      out[i] = NaN;
      continue;
    }
    const s = a[i]! + b[i]!;
    out[i] = s > 1e-6 ? (a[i]! - b[i]!) / s : NaN;
  }
  return out;
}

function ratio(a: Float32Array, b: Float32Array, valid: Uint8Array): Float32Array {
  const n = a.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = valid[i] && b[i]! > 1e-4 ? a[i]! / b[i]! : NaN;
  }
  return out;
}

export function computeIndex(bands: Bands, name: IndexName): Float32Array {
  const { blue, green, red, nir, swir16, swir22, valid } = bands;
  switch (name) {
    case 'ndvi':
      return nd(nir, red, valid);
    case 'ndwi':
      return nd(green, nir, valid);
    case 'mndwi':
      return nd(green, swir16, valid);
    case 'ndbi':
      return nd(swir16, nir, valid);
    case 'nbr':
      return nd(nir, swir22, valid);
    case 'bsi': {
      const n = red.length;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        if (!valid[i]) {
          out[i] = NaN;
          continue;
        }
        const a = swir16[i]! + red[i]!;
        const b = nir[i]! + blue[i]!;
        out[i] = a + b > 1e-6 ? (a - b) / (a + b) : NaN;
      }
      return out;
    }
    case 'iron':
      return ratio(red, blue, valid);
    case 'clay':
      return ratio(swir16, swir22, valid);
    case 'ferrous':
      return ratio(swir22, nir, valid);
  }
}

/** Percentiles over the finite values (nearest-rank on a sorted copy of a sample of at most 250k values). */
export function percentiles(values: Float32Array, ps: number[], maxSample = 250_000): number[] {
  const finite: number[] = [];
  const step = Math.max(1, Math.floor(values.length / maxSample));
  for (let i = 0; i < values.length; i += step) {
    const v = values[i]!;
    if (Number.isFinite(v)) finite.push(v);
  }
  if (finite.length === 0) return ps.map(() => NaN);
  finite.sort((a, b) => a - b);
  return ps.map((p) => finite[Math.min(finite.length - 1, Math.max(0, Math.round((p / 100) * (finite.length - 1))))]!);
}

export interface Histogram {
  lo: number;
  hi: number;
  counts: Uint32Array;
  n: number;
}

export function histogram(values: Float32Array, lo: number, hi: number, bins = 128): Histogram {
  const counts = new Uint32Array(bins);
  const span = hi - lo || 1e-9;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    let k = Math.floor(((v - lo) / span) * bins);
    if (k < 0) k = 0;
    else if (k >= bins) k = bins - 1;
    counts[k]!++;
    n++;
  }
  return { lo, hi, counts, n };
}

/** Otsu 1979: the threshold that maximises the between-class variance of the histogram. */
export function otsuThreshold(h: Histogram): number {
  const bins = h.counts.length;
  let total = 0;
  let sumAll = 0;
  for (let k = 0; k < bins; k++) {
    total += h.counts[k]!;
    sumAll += k * h.counts[k]!;
  }
  if (total === 0) return NaN;
  // The between-class variance is constant across the empty bins between two modes, so every bin of
  // that plateau is optimal; the middle of the plateau is returned (the first bin would sit on the
  // shoulder of the lower mode).
  let w0 = 0;
  let sum0 = 0;
  let best = -1;
  let firstK = 0;
  let lastK = 0;
  for (let k = 0; k < bins; k++) {
    w0 += h.counts[k]!;
    if (w0 === 0) continue;
    const w1 = total - w0;
    if (w1 === 0) break;
    sum0 += k * h.counts[k]!;
    const m0 = sum0 / w0;
    const m1 = (sumAll - sum0) / w1;
    const between = w0 * w1 * (m0 - m1) * (m0 - m1);
    if (between > best * (1 + 1e-12)) {
      best = between;
      firstK = k;
      lastK = k;
    } else if (between >= best * (1 - 1e-12)) {
      lastK = k;
    }
  }
  const bestK = (firstK + lastK) / 2;
  return h.lo + ((bestK + 1) / bins) * (h.hi - h.lo);
}

/** Bare-ground mask: BSI above the threshold, not vegetation, not water; 3x3 opening; small-component removal. */
export function bareMask(bands: Bands, bsi: Float32Array, threshold: number, minPixels = 20): Uint8Array {
  const { width, height, valid } = bands;
  const ndvi = computeIndex(bands, 'ndvi');
  const mndwi = computeIndex(bands, 'mndwi');
  const raw = new Uint8Array(width * height);
  for (let i = 0; i < raw.length; i++) {
    raw[i] = valid[i] && bsi[i]! > threshold && ndvi[i]! < 0.2 && mndwi[i]! < 0 ? 1 : 0;
  }
  const opened = dilate(erode(raw, width, height), width, height);
  return removeSmall(opened, width, height, minPixels);
}

export function erode(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      out[i] =
        m[i - w - 1]! & m[i - w]! & m[i - w + 1]! & m[i - 1]! & m[i]! & m[i + 1]! & m[i + w - 1]! & m[i + w]! & m[i + w + 1]!;
    }
  }
  return out;
}

export function dilate(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      out[i] =
        m[i - w - 1]! | m[i - w]! | m[i - w + 1]! | m[i - 1]! | m[i]! | m[i + 1]! | m[i + w - 1]! | m[i + w]! | m[i + w + 1]!;
    }
  }
  return out;
}

/** Removes 4-connected components smaller than minPixels (iterative flood fill with an explicit stack). */
export function removeSmall(m: Uint8Array, w: number, h: number, minPixels: number): Uint8Array {
  const out = new Uint8Array(m);
  const seen = new Uint8Array(m.length);
  const stack: number[] = [];
  for (let start = 0; start < m.length; start++) {
    if (!out[start] || seen[start]) continue;
    const comp: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % w;
      const y = (i - x) / w;
      const nb = [i - 1, i + 1, i - w, i + w];
      const ok = [x > 0, x < w - 1, y > 0, y < h - 1];
      for (let k = 0; k < 4; k++) {
        const j = nb[k]!;
        if (ok[k] && out[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (comp.length < minPixels) for (const i of comp) out[i] = 0;
  }
  return out;
}

export function maskArea(mask: Uint8Array, pixelM: number): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i]!;
  return (n * pixelM * pixelM) / 1e6; // km2
}
