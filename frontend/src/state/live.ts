// The live lane: one Sentinel-2 read of the site window (the latest clear scene by default) and the
// computations the worker performs on it. The store owns the worker, the read, the current layer shown
// on the map and the per-pixel values the cursor readout reads.
import { create } from 'zustand';

import type { ColormapName } from '../lib/colormap';
import { liveGrid, type LiveRead, readGroup, type ReadGrid } from '../lib/cog';
import type { SiteWindow } from '../lib/contract';
import type { IndexName } from '../lib/indices';
import { type S2DateGroup, searchSentinel2 } from '../lib/stac';
import type { IndexResult, KmeansResult, LearnedResult, MaskResult, RequestBody, Response } from '../workers/indices.worker';

export type LiveLayer =
  | { kind: 'composite'; composite: 'tc' | 'fc' | 'swir'; rgba: Uint8ClampedArray; clips: [number, number][] }
  | { kind: 'index'; result: IndexResult; cmap: ColormapName }
  | { kind: 'otsu'; result: MaskResult }
  | { kind: 'sam'; result: MaskResult }
  | { kind: 'kmeans'; result: KmeansResult }
  | { kind: 'rf'; result: LearnedResult }
  | { kind: 'unet'; result: LearnedResult };

// the shipped models, served from /models/ (copy-data.mjs copies ../models there)
export const MODEL_URLS = {
  rf: `${import.meta.env.BASE_URL}models/rf/rf-v1.forest.bin`, // flat-array forest, traversed in the worker
  unet: `${import.meta.env.BASE_URL}models/unet/unet-v1.onnx`,
} as const;

export interface LiveState {
  status: 'idle' | 'searching' | 'reading' | 'ready' | 'error';
  message: string;
  progress: number; // 0..1 while reading
  groups: S2DateGroup[];
  group: S2DateGroup | null;
  read: LiveRead | null;
  grid: ReadGrid | null;
  layer: LiveLayer | null;
  busy: boolean;
  fetchLatest: (win: SiteWindow, bbox: [number, number, number, number], daysBack?: number, maxCloud?: number) => Promise<void>;
  fetchGroup: (win: SiteWindow, group: S2DateGroup) => Promise<void>;
  composite: (kind: 'tc' | 'fc' | 'swir') => Promise<void>;
  index: (name: IndexName, cmap: ColormapName, lo?: number, hi?: number) => Promise<void>;
  otsu: (threshold?: number) => Promise<void>;
  kmeans: (k: number) => Promise<void>;
  sam: (angleRad: number, endmemberMask?: Uint8Array) => Promise<void>;
  learnedProgress: { done: number; total: number; note: string } | null;
  learnedError: string | null;
  rf: (threshold: number, scale: 1 | 2) => Promise<void>;
  unet: (threshold: number, scale: 1 | 2, prefer?: 'webgpu' | 'wasm' | 'auto') => Promise<void>;
  clear: () => void;
}

let worker: Worker | null = null;
let reqId = 0;
const pending = new Map<number, { resolve: (r: Response) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/indices.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<Response>) => {
      if (ev.data.type === 'progress') {
        useLive.setState({ learnedProgress: { done: ev.data.done, total: ev.data.total, note: ev.data.note } });
        return;
      }
      const p = pending.get(ev.data.reqId);
      if (!p) return;
      pending.delete(ev.data.reqId);
      if (ev.data.type === 'error') p.reject(new Error(ev.data.message));
      else p.resolve(ev.data);
    };
  }
  return worker;
}

function ask(msg: RequestBody, transfer: Transferable[] = []): Promise<Response> {
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, reqId: id }, transfer);
  });
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400_000);
  return d.toISOString().slice(0, 10);
}

let abort: AbortController | null = null;

export const useLive = create<LiveState>((set, get) => ({
  status: 'idle',
  message: '',
  progress: 0,
  groups: [],
  group: null,
  read: null,
  grid: null,
  layer: null,
  busy: false,

  fetchLatest: async (win, bbox, daysBack = 150, maxCloud = 25) => {
    abort?.abort();
    abort = new AbortController();
    set({ status: 'searching', message: '', groups: [], group: null, read: null, layer: null, progress: 0 });
    try {
      const groups = await searchSentinel2(bbox, isoDaysAgo(daysBack), isoDaysAgo(0), { maxCloud, signal: abort.signal });
      const usable = groups.filter((g) => g.items.some((it) => it.epsg === win.epsg));
      set({ groups: usable });
      const best = usable[0];
      if (!best) {
        set({ status: 'error', message: 'no clear Sentinel-2 scene in the window' });
        return;
      }
      await get().fetchGroup(win, best);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      set({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  },

  fetchGroup: async (win, group) => {
    abort?.abort();
    abort = new AbortController();
    const grid = liveGrid(win.epsg, win.left, win.top, win.width, win.height);
    set({ status: 'reading', group, grid, progress: 0, layer: null, message: '' });
    try {
      const read = await readGroup(group, grid, (done, total, note) => set({ progress: done / total, message: note }), abort.signal);
      if (read.itemsRead.length === 0) {
        set({ status: 'error', message: `no tile of ${group.date} could be read: ${read.itemsSkipped.join('; ')}` });
        return;
      }
      const { blue, green, red, nir, swir16, swir22, valid } = read.bands;
      await ask(
        { type: 'load', width: grid.width, height: grid.height, pixelM: grid.pixelM, bands: { blue, green, red, nir, swir16, swir22 }, valid },
        [blue.buffer, green.buffer, red.buffer, nir.buffer, swir16.buffer, swir22.buffer, valid.buffer].map((b) => b as ArrayBuffer),
      );
      set({ status: 'ready', read, progress: 1, message: '' });
      await get().composite('tc');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      set({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  },

  composite: async (kind) => {
    if (get().status !== 'ready') return;
    set({ busy: true });
    const r = (await ask({ type: 'composite', kind })) as Extract<Response, { type: 'composite' }>;
    set({ layer: { kind: 'composite', composite: kind, rgba: r.rgba, clips: r.clips }, busy: false });
  },

  index: async (name, cmap, lo, hi) => {
    if (get().status !== 'ready') return;
    set({ busy: true });
    const r = (await ask({ type: 'index', name, cmap, lo, hi })) as IndexResult;
    set({ layer: { kind: 'index', result: r, cmap }, busy: false });
  },

  otsu: async (threshold) => {
    if (get().status !== 'ready') return;
    set({ busy: true });
    const r = (await ask({ type: 'otsu', threshold })) as MaskResult;
    set({ layer: { kind: 'otsu', result: r }, busy: false });
  },

  kmeans: async (k) => {
    if (get().status !== 'ready') return;
    set({ busy: true });
    const r = (await ask({ type: 'kmeans', k })) as KmeansResult;
    set({ layer: { kind: 'kmeans', result: r }, busy: false });
  },

  sam: async (angleRad, endmemberMask) => {
    if (get().status !== 'ready') return;
    set({ busy: true });
    const r = (await ask({ type: 'sam', angleRad, endmemberMask })) as MaskResult;
    set({ layer: { kind: 'sam', result: r }, busy: false });
  },

  learnedProgress: null,
  learnedError: null,

  rf: async (threshold, scale) => {
    if (get().status !== 'ready') return;
    set({ busy: true, learnedProgress: { done: 0, total: 1, note: 'rf' }, learnedError: null });
    try {
      const r = (await ask({ type: 'rf', modelUrl: MODEL_URLS.rf, threshold, scale })) as LearnedResult;
      set({ layer: { kind: 'rf', result: r }, busy: false, learnedProgress: null });
    } catch (e) {
      set({ busy: false, learnedProgress: null, learnedError: e instanceof Error ? e.message : String(e) });
    }
  },

  unet: async (threshold, scale, prefer = 'auto') => {
    if (get().status !== 'ready') return;
    set({ busy: true, learnedProgress: { done: 0, total: 1, note: 'unet' }, learnedError: null });
    try {
      const r = (await ask({ type: 'unet', modelUrl: MODEL_URLS.unet, threshold, scale, prefer })) as LearnedResult;
      set({ layer: { kind: 'unet', result: r }, busy: false, learnedProgress: null });
    } catch (e) {
      set({ busy: false, learnedProgress: null, learnedError: e instanceof Error ? e.message : String(e) });
    }
  },

  clear: () => {
    abort?.abort();
    set({ status: 'idle', message: '', groups: [], group: null, read: null, grid: null, layer: null, progress: 0, learnedProgress: null, learnedError: null });
  },
}));
