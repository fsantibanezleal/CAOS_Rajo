// The time-lapse frame as a georeferenced image draped on the map (and on the terrain): a MapLibre image
// source whose four corners are the projected corners of the site window. Frames are swapped by updating
// the source; the browser cache keeps the decoded images, and the neighbours of the current year are
// preloaded so scrubbing never waits on the network.
import type { ImageSource, Map as MLMap } from 'maplibre-gl';

import type { Frame, SiteManifest } from '../lib/contract';
import { windowCorners } from '../lib/utm';

export const FRAME_SOURCE = 'frame';
export const FRAME_LAYER = 'frame-layer';

const preloaded = new Map<string, HTMLImageElement>();

export function frameUrl(manifest: SiteManifest, frame: Frame, mode: 'tc' | 'swir'): string {
  const rel = mode === 'swir' ? frame.swir_image : frame.image;
  return `${import.meta.env.BASE_URL}data/sites/${manifest.site_id}/${rel}`;
}

export function preload(url: string): Promise<void> {
  if (preloaded.has(url)) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      preloaded.set(url, img);
      resolve();
    };
    img.onerror = () => resolve();
    img.src = url;
  });
}

function firstSymbolLayer(map: MLMap): string | undefined {
  return map.getStyle()?.layers.find((l) => l.type === 'symbol')?.id;
}

export function ensureFrameLayer(map: MLMap, manifest: SiteManifest, url: string): void {
  const coordinates = windowCorners(manifest.window);
  if (!map.getSource(FRAME_SOURCE)) {
    map.addSource(FRAME_SOURCE, { type: 'image', url, coordinates });
  } else {
    (map.getSource(FRAME_SOURCE) as ImageSource).updateImage({ url, coordinates });
  }
  if (!map.getLayer(FRAME_LAYER)) {
    const before = map.getLayer('site-polygons-fill') ? 'site-polygons-fill' : firstSymbolLayer(map);
    map.addLayer(
      {
        id: FRAME_LAYER,
        type: 'raster',
        source: FRAME_SOURCE,
        paint: { 'raster-opacity': 1, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
      },
      before,
    );
  }
}

export function setFrameOpacity(map: MLMap, opacity: number): void {
  if (map.getLayer(FRAME_LAYER)) map.setPaintProperty(FRAME_LAYER, 'raster-opacity', opacity);
}

export function removeFrameLayer(map: MLMap): void {
  if (map.getLayer(FRAME_LAYER)) map.removeLayer(FRAME_LAYER);
  if (map.getSource(FRAME_SOURCE)) map.removeSource(FRAME_SOURCE);
}
