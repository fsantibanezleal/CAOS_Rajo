// Style readiness, as our own flag. MapLibre's isStyleLoaded() is false while ANY source still has tiles
// loading, so a hung tile host would keep every overlay from being added; adding sources and layers only
// needs the style document itself, which is what this flag tracks (true from 'style.load' until setStyle).
import type { Map as MLMap } from 'maplibre-gl';

const ready = new WeakMap<MLMap, boolean>();

export function setStyleReady(map: MLMap, value: boolean): void {
  ready.set(map, value);
}

export function styleReady(map: MLMap): boolean {
  return ready.get(map) === true;
}

// Calls fn now when the style is ready and again after every later style.load; the returned function
// removes the listener.
export function onStyleReady(map: MLMap, fn: () => void): () => void {
  if (styleReady(map)) fn();
  map.on('style.load', fn);
  return () => {
    map.off('style.load', fn);
  };
}
