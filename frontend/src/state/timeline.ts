// The timeline: which frame of the selected site is shown, whether it is playing, the composite mode and
// the overlay opacity. Playback is paused by default and halts when the tab is hidden (no compute or
// network churn in a background tab).
import { create } from 'zustand';

export type FrameMode = 'tc' | 'swir';

interface TimelineState {
  index: number;
  playing: boolean;
  mode: FrameMode;
  opacity: number;
  speedMs: number;
  setIndex: (i: number) => void;
  step: (delta: number, count: number) => void;
  setPlaying: (p: boolean) => void;
  togglePlaying: () => void;
  setMode: (m: FrameMode) => void;
  setOpacity: (o: number) => void;
  setSpeed: (ms: number) => void;
  // the signal lane: the series drawer, the method whose mask and breaks are shown, the mask overlay
  showSeries: boolean;
  seriesMethod: 'otsu' | 'rf' | 'unet';
  showMask: boolean;
  setShowSeries: (v: boolean) => void;
  setSeriesMethod: (m: 'otsu' | 'rf' | 'unet') => void;
  setShowMask: (v: boolean) => void;
}

export const useTimeline = create<TimelineState>((set, get) => ({
  index: -1,
  playing: false,
  mode: 'tc',
  opacity: 1,
  speedMs: 650,
  setIndex: (index) => set({ index }),
  step: (delta, count) => {
    if (count <= 0) return;
    const i = get().index;
    set({ index: ((i + delta) % count + count) % count });
  },
  setPlaying: (playing) => set({ playing }),
  togglePlaying: () => set({ playing: !get().playing }),
  setMode: (mode) => set({ mode }),
  setOpacity: (opacity) => set({ opacity: Math.max(0, Math.min(1, opacity)) }),
  setSpeed: (speedMs) => set({ speedMs }),
  showSeries: false,
  seriesMethod: 'otsu',
  showMask: false,
  setShowSeries: (showSeries) => set({ showSeries }),
  setSeriesMethod: (seriesMethod) => set({ seriesMethod }),
  setShowMask: (showMask) => set({ showMask }),
}));

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) useTimeline.getState().setPlaying(false);
  });
}
