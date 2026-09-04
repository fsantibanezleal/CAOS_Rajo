// The random forest traversed in the worker from the flat-array file written by
// data-pipeline/train/forest_format.py (onnxruntime-web ships no TreeEnsembleClassifier kernel).
// Thresholds are float64 and features float32, exactly scikit-learn's comparison, so the probabilities
// equal predict_proba to floating-point precision (forest.test.ts replays the golden chip).

export interface Forest {
  nTrees: number;
  nNodes: number;
  nFeatures: number;
  features: string[];
  offsets: Int32Array;
  feature: Int32Array;
  threshold: Float64Array;
  left: Int32Array;
  right: Int32Array;
  value: Float32Array;
}

const MAGIC = 'RAJOF1';

export function parseForest(buffer: ArrayBuffer): Forest {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, 6));
  if (magic !== MAGIC) throw new Error(`not a Rajo forest file (${magic})`);
  const view = new DataView(buffer);
  const hl = view.getUint32(6, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(10, 10 + hl))) as {
    n_trees: number;
    n_nodes: number;
    n_features: number;
    features: string[];
    offsets: number[];
  };
  const n = header.n_nodes;
  let o = 10 + hl;
  // the arrays follow the variable-length header, so they are copied into aligned typed arrays
  const feature = new Int32Array(buffer.slice(o, o + 4 * n));
  o += 4 * n;
  const threshold = new Float64Array(buffer.slice(o, o + 8 * n));
  o += 8 * n;
  const left = new Int32Array(buffer.slice(o, o + 4 * n));
  o += 4 * n;
  const right = new Int32Array(buffer.slice(o, o + 4 * n));
  o += 4 * n;
  const value = new Float32Array(buffer.slice(o, o + 4 * n));
  return { nTrees: header.n_trees, nNodes: n, nFeatures: header.n_features, features: header.features, offsets: Int32Array.from(header.offsets), feature, threshold, left, right, value };
}

const cache = new Map<string, Promise<Forest>>();

export function loadForest(url: string): Promise<Forest> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`forest ${url}: HTTP ${r.status}`);
      const ct = r.headers.get('content-type') ?? '';
      if (ct.includes('text/html')) throw new Error(`forest ${url}: not shipped in this build`);
      return parseForest(await r.arrayBuffer());
    });
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

/** Probability of the mine class for every pixel: planes are the feature planes in forest.features order. */
export function forestProb(forest: Forest, planes: Float32Array[], n: number, onProgress?: (done: number, total: number) => void): Float32Array {
  if (planes.length !== forest.nFeatures) throw new Error(`forest expects ${forest.nFeatures} features, got ${planes.length}`);
  const { nTrees, offsets, feature, threshold, left, right, value } = forest;
  const out = new Float32Array(n);
  const chunk = 32768;
  for (let start = 0; start < n; start += chunk) {
    const end = Math.min(n, start + chunk);
    for (let i = start; i < end; i++) {
      let sum = 0;
      for (let t = 0; t < nTrees; t++) {
        let node = offsets[t]!;
        let f = feature[node]!;
        while (f >= 0) {
          node = planes[f]![i]! <= threshold[node]! ? left[node]! : right[node]!;
          f = feature[node]!;
        }
        sum += value[node]!;
      }
      out[i] = sum / nTrees;
    }
    onProgress?.(end, n);
  }
  return out;
}
