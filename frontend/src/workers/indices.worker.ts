// The band-math worker. It holds one live read (six reflectance bands, the validity mask, the grid) and
// answers requests: composites, indices with colormap and statistics, Otsu bare-ground masks, k-means
// clustering, spectral-angle masks against an endmember. Every result is a transferable typed array; the
// UI thread only paints. Deterministic: k-means uses a seeded generator.
import { colorize, type ColormapName, lut } from '../lib/colormap';
import {
  type Bands,
  bareMask,
  computeIndex,
  histogram,
  type IndexName,
  maskArea,
  otsuThreshold,
  percentiles,
} from '../lib/indices';

export interface LoadMsg {
  type: 'load';
  width: number;
  height: number;
  pixelM: number;
  bands: Record<'blue' | 'green' | 'red' | 'nir' | 'swir16' | 'swir22', Float32Array>;
  valid: Uint8Array;
}
export interface CompositeMsg {
  type: 'composite';
  kind: 'tc' | 'fc' | 'swir';
}
export interface IndexMsg {
  type: 'index';
  name: IndexName;
  cmap: ColormapName;
  lo?: number;
  hi?: number;
}
export interface OtsuMsg {
  type: 'otsu';
  threshold?: number;
}
export interface KmeansMsg {
  type: 'kmeans';
  k: number;
}
export interface SamMsg {
  type: 'sam';
  endmemberMask?: Uint8Array;
  angleRad: number;
}
export type RequestBody = LoadMsg | CompositeMsg | IndexMsg | OtsuMsg | KmeansMsg | SamMsg;
export type Request = RequestBody & { reqId: number };

export interface IndexResult {
  type: 'index';
  name: IndexName;
  values: Float32Array;
  rgba: Uint8ClampedArray;
  lo: number;
  hi: number;
  stats: { p2: number; p98: number; min: number; max: number; mean: number; n: number };
  hist: { lo: number; hi: number; counts: Uint32Array };
}
export interface MaskResult {
  type: 'otsu' | 'sam';
  threshold: number;
  mask: Uint8Array;
  rgba: Uint8ClampedArray;
  areaKm2: number;
  values?: Float32Array; // BSI or the angles
}
export interface KmeansResult {
  type: 'kmeans';
  labels: Uint8Array;
  rgba: Uint8ClampedArray;
  centroids: number[][]; // k x 6 reflectance
  counts: number[];
  areasKm2: number[];
  iterations: number;
}
export interface CompositeResult {
  type: 'composite';
  rgba: Uint8ClampedArray;
  clips: [number, number][];
}
export type ResponseBody = IndexResult | MaskResult | KmeansResult | CompositeResult | { type: 'loaded' } | { type: 'error'; message: string };
export type Response = ResponseBody & { reqId: number };

let data: (Bands & { pixelM: number }) | null = null;
const ACCENT: [number, number, number] = [232, 163, 61];

function at(a: ArrayLike<number>, i: number): number {
  const v = a[i];
  return v === undefined ? NaN : v;
}

function stretchTo(out: Uint8ClampedArray, channel: Float32Array, k: number, present: Uint8Array, gamma = 1 / 1.35): [number, number] {
  const q = percentiles(channel, [2, 98]);
  const lo = at(q, 0);
  const hi = at(q, 1);
  const span = hi - lo || 1e-6;
  for (let i = 0; i < channel.length; i++) {
    if (!present[i]) continue;
    let t = (at(channel, i) - lo) / span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    out[i * 4 + k] = Math.round(Math.pow(t, gamma) * 255);
  }
  return [lo, hi];
}

function composite(kind: 'tc' | 'fc' | 'swir'): CompositeResult {
  if (!data) throw new Error('no data loaded');
  const n = data.width * data.height;
  const rgba = new Uint8ClampedArray(n * 4);
  const chans: [Float32Array, Float32Array, Float32Array] =
    kind === 'tc' ? [data.red, data.green, data.blue] : kind === 'fc' ? [data.nir, data.red, data.green] : [data.swir22, data.nir, data.red];
  const present = new Uint8Array(n);
  for (let i = 0; i < n; i++) present[i] = Number.isFinite(at(data.red, i)) ? 1 : 0;
  const clips: [number, number][] = [];
  for (let k = 0; k < 3; k++) clips.push(stretchTo(rgba, chans[k]!, k, present));
  for (let i = 0; i < n; i++) if (present[i]) rgba[i * 4 + 3] = 255;
  return { type: 'composite', rgba, clips };
}

function index(msg: IndexMsg): IndexResult {
  if (!data) throw new Error('no data loaded');
  const values = computeIndex(data, msg.name);
  const q = percentiles(values, [2, 98, 0, 100]);
  const p2 = at(q, 0);
  const p98 = at(q, 1);
  const mn = at(q, 2);
  const mx = at(q, 3);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = at(values, i);
    if (Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  const lo = msg.lo ?? p2;
  const hi = msg.hi ?? p98;
  const rgba = colorize(values, data.width, data.height, msg.cmap, lo, hi);
  const h = histogram(values, Math.min(lo, mn), Math.max(hi, mx), 128);
  return {
    type: 'index',
    name: msg.name,
    values,
    rgba,
    lo,
    hi,
    stats: { p2, p98, min: mn, max: mx, mean: n ? sum / n : NaN, n },
    hist: { lo: h.lo, hi: h.hi, counts: h.counts },
  };
}

function maskRgba(mask: Uint8Array, n: number, color: [number, number, number] = ACCENT): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    rgba[i * 4] = color[0];
    rgba[i * 4 + 1] = color[1];
    rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = 190;
  }
  return rgba;
}

function otsu(msg: OtsuMsg): MaskResult {
  if (!data) throw new Error('no data loaded');
  const bsi = computeIndex(data, 'bsi');
  const q = percentiles(bsi, [0.5, 99.5]);
  const threshold = msg.threshold ?? otsuThreshold(histogram(bsi, at(q, 0), at(q, 1), 256));
  const mask = bareMask(data, bsi, threshold);
  return { type: 'otsu', threshold, mask, rgba: maskRgba(mask, data.width * data.height), areaKm2: maskArea(mask, data.pixelM), values: bsi };
}

// deterministic PRNG (mulberry32) so a run is reproducible
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function kmeans(msg: KmeansMsg): KmeansResult {
  if (!data) throw new Error('no data loaded');
  const d0 = data;
  const k = Math.max(2, Math.min(10, msg.k));
  const n = d0.width * d0.height;
  const chans = [d0.blue, d0.green, d0.red, d0.nir, d0.swir16, d0.swir22];
  const ndvi = computeIndex(d0, 'ndvi');
  const mndwi = computeIndex(d0, 'mndwi');
  const feats = [...chans, ndvi, mndwi];
  const d = feats.length;
  const feat = (f: number, i: number): number => at(feats[f]!, i);
  // standardisation statistics over valid pixels
  const mean: number[] = new Array<number>(d).fill(0);
  const sd: number[] = new Array<number>(d).fill(0);
  let nv = 0;
  for (let i = 0; i < n; i++) {
    if (!d0.valid[i]) continue;
    nv++;
    for (let f = 0; f < d; f++) mean[f] = mean[f]! + feat(f, i);
  }
  for (let f = 0; f < d; f++) mean[f] = mean[f]! / Math.max(1, nv);
  for (let i = 0; i < n; i++) {
    if (!d0.valid[i]) continue;
    for (let f = 0; f < d; f++) {
      const x = feat(f, i) - mean[f]!;
      sd[f] = sd[f]! + x * x;
    }
  }
  for (let f = 0; f < d; f++) sd[f] = Math.sqrt(sd[f]! / Math.max(1, nv)) || 1;
  const z = (i: number, f: number) => (feat(f, i) - mean[f]!) / sd[f]!;
  // sample for fitting
  const rand = rng(7);
  const sample: number[] = [];
  const target = Math.min(40_000, nv);
  const stride = Math.max(1, Math.floor(nv / Math.max(1, target)));
  let c = 0;
  for (let i = 0; i < n; i++) {
    if (!d0.valid[i]) continue;
    if (c++ % stride === 0) sample.push(i);
  }
  if (sample.length === 0) throw new Error('no valid pixels');
  // k-means++ seeding
  const cent: number[][] = [];
  const first = sample[Math.floor(rand() * sample.length)]!;
  cent.push(Array.from({ length: d }, (_, f) => z(first, f)));
  const dist2: number[] = new Array<number>(sample.length).fill(Infinity);
  while (cent.length < k) {
    const last = cent[cent.length - 1]!;
    let total = 0;
    for (let s = 0; s < sample.length; s++) {
      let dd = 0;
      for (let f = 0; f < d; f++) {
        const x = z(sample[s]!, f) - last[f]!;
        dd += x * x;
      }
      if (dd < dist2[s]!) dist2[s] = dd;
      total += dist2[s]!;
    }
    let r = rand() * total;
    let pick = sample.length - 1;
    for (let s = 0; s < sample.length; s++) {
      r -= dist2[s]!;
      if (r <= 0) {
        pick = s;
        break;
      }
    }
    cent.push(Array.from({ length: d }, (_, f) => z(sample[pick]!, f)));
  }
  // Lloyd iterations on the sample
  const assign = new Uint8Array(sample.length);
  let iterations = 0;
  for (let it = 0; it < 30; it++) {
    iterations = it + 1;
    let changed = 0;
    for (let s = 0; s < sample.length; s++) {
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < k; j++) {
        let dd = 0;
        const cj = cent[j]!;
        for (let f = 0; f < d; f++) {
          const x = z(sample[s]!, f) - cj[f]!;
          dd += x * x;
        }
        if (dd < bd) {
          bd = dd;
          best = j;
        }
      }
      if (assign[s] !== best) {
        assign[s] = best;
        changed++;
      }
    }
    const sums: number[][] = Array.from({ length: k }, () => new Array<number>(d).fill(0));
    const cnt: number[] = new Array<number>(k).fill(0);
    for (let s = 0; s < sample.length; s++) {
      const j = assign[s]!;
      cnt[j] = cnt[j]! + 1;
      const sj = sums[j]!;
      for (let f = 0; f < d; f++) sj[f] = sj[f]! + z(sample[s]!, f);
    }
    for (let j = 0; j < k; j++) {
      if (!cnt[j]) continue;
      const cj = cent[j]!;
      const sj = sums[j]!;
      for (let f = 0; f < d; f++) cj[f] = sj[f]! / cnt[j]!;
    }
    if (changed === 0) break;
  }
  // assign every valid pixel; order clusters from dark to bright so colours are stable
  const bright = cent.map((cv, j) => {
    let b = 0;
    for (let f = 0; f < 6; f++) b += cv[f]! * sd[f]! + mean[f]!;
    return { j, b: b / 6 };
  });
  bright.sort((a, b) => a.b - b.b);
  const order: number[] = new Array<number>(k).fill(0);
  bright.forEach((e, rank) => {
    order[e.j] = rank;
  });
  const labels = new Uint8Array(n).fill(255);
  const counts: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    if (!d0.valid[i]) continue;
    let best = 0;
    let bd = Infinity;
    for (let j = 0; j < k; j++) {
      let dd = 0;
      const cj = cent[j]!;
      for (let f = 0; f < d; f++) {
        const x = z(i, f) - cj[f]!;
        dd += x * x;
      }
      if (dd < bd) {
        bd = dd;
        best = j;
      }
    }
    const lab = order[best]!;
    labels[i] = lab;
    counts[lab] = counts[lab]! + 1;
  }
  const table = lut('cividis');
  const rgba = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const lab = labels[i]!;
    if (lab === 255) continue;
    const t = Math.round((lab / Math.max(1, k - 1)) * 255) * 3;
    rgba[i * 4] = table[t]!;
    rgba[i * 4 + 1] = table[t + 1]!;
    rgba[i * 4 + 2] = table[t + 2]!;
    rgba[i * 4 + 3] = 200;
  }
  const centroids: number[][] = Array.from({ length: k }, () => new Array<number>(6).fill(0));
  bright.forEach((e, rank) => {
    const cj = cent[e.j]!;
    const row = centroids[rank]!;
    for (let f = 0; f < 6; f++) row[f] = cj[f]! * sd[f]! + mean[f]!;
  });
  const px = (d0.pixelM * d0.pixelM) / 1e6;
  return { type: 'kmeans', labels, rgba, centroids, counts, areasKm2: counts.map((cc) => cc * px), iterations };
}

function sam(msg: SamMsg): MaskResult {
  if (!data) throw new Error('no data loaded');
  const d0 = data;
  const n = d0.width * d0.height;
  const chans = [d0.blue, d0.green, d0.red, d0.nir, d0.swir16, d0.swir22];
  const e: number[] = new Array<number>(6).fill(0);
  let ne = 0;
  const em = msg.endmemberMask;
  if (em) {
    for (let i = 0; i < n; i++) {
      if (!d0.valid[i] || !em[i]) continue;
      ne++;
      for (let f = 0; f < 6; f++) e[f] = e[f]! + at(chans[f]!, i);
    }
  }
  if (ne === 0) {
    const bsi = computeIndex(d0, 'bsi');
    const q75 = at(percentiles(bsi, [75]), 0);
    for (let i = 0; i < n; i++) {
      if (!d0.valid[i] || !(at(bsi, i) >= q75)) continue;
      ne++;
      for (let f = 0; f < 6; f++) e[f] = e[f]! + at(chans[f]!, i);
    }
  }
  for (let f = 0; f < 6; f++) e[f] = e[f]! / Math.max(1, ne);
  let en2 = 0;
  for (let f = 0; f < 6; f++) en2 += e[f]! * e[f]!;
  const en = Math.sqrt(en2) || 1;
  const angles = new Float32Array(n).fill(NaN);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!d0.valid[i]) continue;
    let dot = 0;
    let nn = 0;
    for (let f = 0; f < 6; f++) {
      const x = at(chans[f]!, i);
      dot += x * e[f]!;
      nn += x * x;
    }
    const cos = dot / ((Math.sqrt(nn) || 1) * en);
    const a = Math.acos(Math.max(-1, Math.min(1, cos)));
    angles[i] = a;
    mask[i] = a <= msg.angleRad ? 1 : 0;
  }
  return { type: 'sam', threshold: msg.angleRad, mask, rgba: maskRgba(mask, n, [125, 211, 252]), areaKm2: maskArea(mask, d0.pixelM), values: angles };
}

function post(res: Response, transfer: ArrayBuffer[] = []): void {
  (self as unknown as Worker).postMessage(res, transfer);
}

self.onmessage = (ev: MessageEvent<Request>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'load') {
      data = { width: msg.width, height: msg.height, pixelM: msg.pixelM, valid: msg.valid, ...msg.bands };
      post({ type: 'loaded', reqId: msg.reqId });
      return;
    }
    let body: ResponseBody;
    if (msg.type === 'composite') body = composite(msg.kind);
    else if (msg.type === 'index') body = index(msg);
    else if (msg.type === 'otsu') body = otsu(msg);
    else if (msg.type === 'kmeans') body = kmeans(msg);
    else body = sam(msg);
    const transfer: ArrayBuffer[] = [];
    for (const v of Object.values(body)) {
      if (ArrayBuffer.isView(v)) transfer.push(v.buffer as ArrayBuffer);
    }
    post({ ...body, reqId: msg.reqId }, transfer);
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e), reqId: msg.reqId });
  }
};
