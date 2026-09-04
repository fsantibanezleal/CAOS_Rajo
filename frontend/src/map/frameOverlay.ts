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

// --- the baked mask of the year (signal lane): a 1-bit PNG on the 30 m grid, draped like the frame ----

export const MASK_SOURCE = 'frame-mask';
export const MASK_LAYER = 'frame-mask-layer';
const MASK_COLORS: Record<string, string> = { otsu: '#e8a33d', rf: '#f472b6', unet: '#60a5fa' };
const tinted = new Map<string, string>();

export function maskUrl(manifest: SiteManifest, frame: Frame, method: string): string | null {
  const rel = frame.masks?.[method];
  return rel ? `${import.meta.env.BASE_URL}data/sites/${manifest.site_id}/${rel}` : null;
}

/** The 1-bit mask becomes a tinted RGBA image (white pixels -> the method colour, black -> transparent). */
export async function tintMask(url: string, method: string): Promise<string> {
  const key = `${url}|${method}`;
  const hit = tinted.get(key);
  if (hit) return hit;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`mask ${url} failed to load`));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height);
  const hex = MASK_COLORS[method] ?? '#e8a33d';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const on = px[i]! > 127;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = on ? 170 : 0;
  }
  ctx.putImageData(data, 0, 0);
  const out = canvas.toDataURL('image/png');
  tinted.set(key, out);
  return out;
}

export function ensureMaskLayer(map: MLMap, manifest: SiteManifest, url: string): void {
  const coordinates = windowCorners(manifest.window);
  if (!map.getSource(MASK_SOURCE)) {
    map.addSource(MASK_SOURCE, { type: 'image', url, coordinates });
  } else {
    (map.getSource(MASK_SOURCE) as ImageSource).updateImage({ url, coordinates });
  }
  if (!map.getLayer(MASK_LAYER)) {
    const before = map.getLayer('site-polygons-fill') ? 'site-polygons-fill' : firstSymbolLayer(map);
    map.addLayer(
      { id: MASK_LAYER, type: 'raster', source: MASK_SOURCE, paint: { 'raster-opacity': 1, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } },
      before,
    );
  }
}

export function removeMaskLayer(map: MLMap): void {
  if (map.getLayer(MASK_LAYER)) map.removeLayer(MASK_LAYER);
  if (map.getSource(MASK_SOURCE)) map.removeSource(MASK_SOURCE);
}
