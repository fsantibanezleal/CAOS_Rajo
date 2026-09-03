// The relief lane's state: which epoch the 3D relief shows, whether the DEM difference is draped, its
// opacity, the vertical exaggeration, and the profile line (two points picked on the map) with its
// samples. The panel sets state; the observatory applies it to the map.
import { create } from 'zustand';

import type { ProfileSample } from '../map/reliefOverlay';

export type Epoch = 'global' | 'cop';

export interface ReliefState {
  epoch: Epoch;
  showDelta: boolean;
  deltaOpacity: number;
  exaggeration: number;
  picking: boolean; // the next map clicks define the profile line
  points: Array<[number, number]>; // lon, lat
  samples: ProfileSample[] | null;
  sampling: boolean;
  setEpoch: (e: Epoch) => void;
  setShowDelta: (v: boolean) => void;
  setDeltaOpacity: (v: number) => void;
  setExaggeration: (v: number) => void;
  setPicking: (v: boolean) => void;
  addPoint: (p: [number, number]) => void;
  clearProfile: () => void;
  setSamples: (s: ProfileSample[] | null, sampling?: boolean) => void;
  reset: () => void;
}

export const useRelief = create<ReliefState>((set, get) => ({
  epoch: 'global',
  showDelta: false,
  deltaOpacity: 0.8,
  exaggeration: 1.3,
  picking: false,
  points: [],
  samples: null,
  sampling: false,
  setEpoch: (epoch) => set({ epoch }),
  setShowDelta: (showDelta) => set({ showDelta }),
  setDeltaOpacity: (deltaOpacity) => set({ deltaOpacity: Math.max(0, Math.min(1, deltaOpacity)) }),
  setExaggeration: (exaggeration) => set({ exaggeration: Math.max(0.5, Math.min(3, exaggeration)) }),
  setPicking: (picking) => set({ picking, points: picking ? [] : get().points, samples: picking ? null : get().samples }),
  addPoint: (p) => {
    const pts = [...get().points, p].slice(-2);
    set({ points: pts, picking: pts.length < 2 });
  },
  clearProfile: () => set({ points: [], samples: null, picking: false, sampling: false }),
  setSamples: (samples, sampling = false) => set({ samples, sampling }),
  reset: () => set({ epoch: 'global', showDelta: false, picking: false, points: [], samples: null, sampling: false }),
}));
