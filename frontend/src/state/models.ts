// The shipped models and their held-out scores, read from /models/registry.json and
// /models/benchmark.json (written by the training scripts, copied by copy-data.mjs). The instrument shows
// what a model is, how big it is and how it scored on tiles it never saw; the Methods page shows the
// whole matrix. Nothing here is typed by hand: a missing registry means "no learned models shipped".
import { create } from 'zustand';

export interface ModelEntry {
  id: string;
  method: string;
  name: string;
  file: string;
  file_fp16?: string | null;
  bytes: number;
  sha256: string;
  input: string;
  output: string;
  parameters?: number;
  params?: Record<string, unknown>;
  training?: Record<string, unknown>;
  scores?: Record<string, { pooled_iou: number; pooled_f1: number; n_tiles: number }>;
  val_full?: { pooled: { iou: number; f1: number; precision: number; recall: number }; per_tile_mean_iou: number; n_tiles: number };
  parity?: Record<string, unknown>;
  threshold?: number; // chosen on the validation split by evaluate.py; the bake and the app use the same cut
  threshold_rule?: string;
  training_data: string;
  split: string;
  license: string;
  trained: string;
  engine_version: string;
}

export interface Registry {
  schema: string;
  models: ModelEntry[];
}

export interface BenchmarkMethod {
  n_tiles: number;
  pooled: { iou: number; f1: number; precision: number; recall: number; tp: number; fp: number; fn: number; tn: number };
  per_tile_mean_iou: number;
  per_tile_median_iou: number;
  boundary_f1_mean: number;
  by_minetype: Record<string, { iou: number; f1: number; precision: number; recall: number; n_tiles: number }>;
  angle_rad?: number;
}

export interface Benchmark {
  schema: string;
  generated: string;
  engine_version: string;
  models: Record<string, { id: string; sha256: string }>;
  metrics: string;
  haze_levels: number[];
  splits: Record<string, { n_tiles: number; methods: Record<string, BenchmarkMethod>; haze?: Record<string, Record<string, { iou: number; f1: number }>>; sam_angle_chosen?: number }>;
}

interface ModelsState {
  status: 'idle' | 'loading' | 'ready' | 'missing';
  registry: Registry | null;
  benchmark: Benchmark | null;
  load: () => Promise<void>;
  byMethod: (method: string) => ModelEntry | null;
}

export const useModels = create<ModelsState>((set, get) => ({
  status: 'idle',
  registry: null,
  benchmark: null,
  load: async () => {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });
    const base = import.meta.env.BASE_URL;
    try {
      const r = await fetch(`${base}models/registry.json`, { cache: 'no-cache' });
      if (!r.ok) {
        set({ status: 'missing' });
        return;
      }
      const registry = (await r.json()) as Registry;
      let benchmark: Benchmark | null = null;
      try {
        const b = await fetch(`${base}models/benchmark.json`, { cache: 'no-cache' });
        if (b.ok) benchmark = (await b.json()) as Benchmark;
      } catch {
        benchmark = null;
      }
      set({ status: 'ready', registry, benchmark });
    } catch {
      set({ status: 'missing' });
    }
  },
  byMethod: (method) => get().registry?.models.find((m) => m.method === method) ?? null,
}));
