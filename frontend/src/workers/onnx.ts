// onnxruntime-web inside the band-math worker: one session per model file, WebGPU when the browser has
// it, WASM otherwise (single thread: the site is not cross-origin isolated, so there is no
// SharedArrayBuffer). The RF runs the [N, 16] feature tensor in chunks; the U-Net runs 512 x 512
// windows with overlap-tile blending, mirroring data-pipeline/train/unet_model.py (predict_tile).
import * as ort from 'onnxruntime-web/webgpu'; // the bundle with both the WebGPU and the WASM providers

export type Backend = 'webgpu' | 'wasm';

const sessions = new Map<string, Promise<{ session: ort.InferenceSession; backend: Backend }>>();
let configured = false;

function configure(): void {
  if (configured) return;
  configured = true;
  ort.env.wasm.wasmPaths = `${self.location.origin}/ort/`;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
}

async function hasWebGPU(): Promise<boolean> {
  const nav = self.navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };
  if (!nav.gpu) return false;
  try {
    return (await nav.gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

export function getSession(url: string, prefer: Backend | 'auto' = 'auto'): Promise<{ session: ort.InferenceSession; backend: Backend }> {
  configure();
  const key = `${url}|${prefer}`;
  let p = sessions.get(key);
  if (!p) {
    p = (async () => {
      const tryGpu = prefer === 'webgpu' || (prefer === 'auto' && (await hasWebGPU()));
      if (tryGpu) {
        try {
          const session = await ort.InferenceSession.create(url, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
          return { session, backend: 'webgpu' as Backend };
        } catch {
          // fall through to WASM; the UI shows which backend answered
        }
      }
      const session = await ort.InferenceSession.create(url, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return { session, backend: 'wasm' as Backend };
    })();
    sessions.set(key, p);
    p.catch(() => sessions.delete(key));
  }
  return p;
}

/** Random forest: feature planes (16 x N) -> probability of the mine class per pixel. */
export async function runForest(
  url: string,
  planes: Float32Array[],
  n: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ prob: Float32Array; backend: Backend; ms: number }> {
  const t0 = performance.now();
  const { session, backend } = await getSession(url, 'wasm'); // tree ensembles run on the CPU provider
  const input = session.inputNames[0]!;
  const prob = new Float32Array(n);
  const chunk = 65536;
  const nf = planes.length;
  for (let from = 0; from < n; from += chunk) {
    const to = Math.min(n, from + chunk);
    const rows = to - from;
    const x = new Float32Array(rows * nf);
    for (let f = 0; f < nf; f++) {
      const p = planes[f]!;
      for (let i = 0; i < rows; i++) x[i * nf + f] = p[from + i]!;
    }
    const out = await session.run({ [input]: new ort.Tensor('float32', x, [rows, nf]) });
    const probs = out[session.outputNames[session.outputNames.length - 1]!]!;
    const data = probs.data as Float32Array;
    const dims = probs.dims;
    if (dims.length === 2 && dims[1] === 2) {
      for (let i = 0; i < rows; i++) prob[from + i] = data[i * 2 + 1]!;
    } else {
      for (let i = 0; i < rows; i++) prob[from + i] = data[i]!;
    }
    onProgress?.(to, n);
  }
  return { prob, backend, ms: performance.now() - t0 };
}

const REFL_CLIP = 0.6;

/** U-Net: six reflectance planes (width x height, NaN where no data) -> probability map, sliding windows. */
export async function runUnet(
  url: string,
  planes: Float32Array[],
  width: number,
  height: number,
  opts: { window?: number; overlap?: number; prefer?: Backend | 'auto'; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ prob: Float32Array; backend: Backend; ms: number; windows: number }> {
  const t0 = performance.now();
  const window = opts.window ?? 512;
  const overlap = opts.overlap ?? 64;
  const { session, backend } = await getSession(url, opts.prefer ?? 'auto');
  const input = session.inputNames[0]!;
  const n = width * height;
  const prob = new Float32Array(n);
  const weight = new Float32Array(n);
  const ramp = new Float32Array(window).fill(1);
  for (let i = 0; i < overlap; i++) {
    const r = 0.5 * (1 - Math.cos((Math.PI * i) / (overlap - 1)));
    ramp[i] = r;
    ramp[window - 1 - i] = r;
  }
  const step = window - overlap;
  const ys: number[] = [];
  const xs: number[] = [];
  for (let y = 0; y < Math.max(1, height - window + 1); y += step) ys.push(y);
  for (let x = 0; x < Math.max(1, width - window + 1); x += step) xs.push(x);
  if (ys[ys.length - 1]! + window < height) ys.push(Math.max(0, height - window));
  if (xs[xs.length - 1]! + window < width) xs.push(Math.max(0, width - window));
  const total = ys.length * xs.length;
  let done = 0;
  const patch = new Float32Array(6 * window * window);
  for (const y0 of ys) {
    for (const x0 of xs) {
      const ph = Math.min(window, height - y0);
      const pw = Math.min(window, width - x0);
      // fill the patch; outside the image (small grids) reflect like torch's reflect padding
      for (let c = 0; c < 6; c++) {
        const plane = planes[c]!;
        for (let yy = 0; yy < window; yy++) {
          const sy = yy < ph ? yy : Math.max(0, 2 * ph - yy - 2);
          for (let xx = 0; xx < window; xx++) {
            const sx = xx < pw ? xx : Math.max(0, 2 * pw - xx - 2);
            const v = plane[(y0 + sy) * width + (x0 + sx)]!;
            const f = Number.isFinite(v) ? v : 0;
            patch[c * window * window + yy * window + xx] = (f < 0 ? 0 : f > REFL_CLIP ? REFL_CLIP : f) / REFL_CLIP;
          }
        }
      }
      const out = await session.run({ [input]: new ort.Tensor('float32', patch, [1, 6, window, window]) });
      const logits = out[session.outputNames[0]!]!.data as Float32Array;
      for (let yy = 0; yy < ph; yy++) {
        for (let xx = 0; xx < pw; xx++) {
          const wt = ramp[yy]! * ramp[xx]!;
          const p = 1 / (1 + Math.exp(-logits[yy * window + xx]!));
          const idx = (y0 + yy) * width + (x0 + xx);
          prob[idx] = prob[idx]! + p * wt;
          weight[idx] = weight[idx]! + wt;
        }
      }
      done++;
      opts.onProgress?.(done, total);
    }
  }
  for (let i = 0; i < n; i++) prob[i] = prob[i]! / Math.max(1e-6, weight[i]!);
  return { prob, backend, ms: performance.now() - t0, windows: total };
}
