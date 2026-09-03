// The live raster on the map: an RGBA buffer on the live grid becomes a PNG blob and a georeferenced image
// source whose corners are the projected corners of the live grid. Replaces itself on every update and
// revokes the previous blob URL.
import type { ImageSource, Map as MLMap } from 'maplibre-gl';

import type { ReadGrid } from '../lib/cog';
import { utmToLonLat } from '../lib/utm';

export const LIVE_SOURCE = 'live';
export const LIVE_LAYER = 'live-layer';
let lastUrl: string | null = null;

export function gridCorners(g: ReadGrid): [[number, number], [number, number], [number, number], [number, number]] {
  const right = g.left + g.width * g.pixelM;
  const bottom = g.top - g.height * g.pixelM;
  return [utmToLonLat(g.epsg, g.left, g.top), utmToLonLat(g.epsg, right, g.top), utmToLonLat(g.epsg, right, bottom), utmToLonLat(g.epsg, g.left, bottom)];
}

export async function rgbaToUrl(rgba: Uint8ClampedArray, width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('png encode failed');
  return URL.createObjectURL(blob);
}

function firstSymbolLayer(map: MLMap): string | undefined {
  return map.getStyle()?.layers.find((l) => l.type === 'symbol')?.id;
}

export async function showLive(map: MLMap, grid: ReadGrid, rgba: Uint8ClampedArray, opacity = 1): Promise<void> {
  const url = await rgbaToUrl(rgba, grid.width, grid.height);
  const coordinates = gridCorners(grid);
  if (!map.getSource(LIVE_SOURCE)) {
    map.addSource(LIVE_SOURCE, { type: 'image', url, coordinates });
  } else {
    (map.getSource(LIVE_SOURCE) as ImageSource).updateImage({ url, coordinates });
  }
  if (!map.getLayer(LIVE_LAYER)) {
    const before = map.getLayer('site-polygons-fill') ? 'site-polygons-fill' : firstSymbolLayer(map);
    map.addLayer(
      { id: LIVE_LAYER, type: 'raster', source: LIVE_SOURCE, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } },
      before,
    );
  } else {
    map.setPaintProperty(LIVE_LAYER, 'raster-opacity', opacity);
  }
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = url;
}

export function hideLive(map: MLMap): void {
  if (map.getLayer(LIVE_LAYER)) map.removeLayer(LIVE_LAYER);
  if (map.getSource(LIVE_SOURCE)) map.removeSource(LIVE_SOURCE);
  if (lastUrl) {
    URL.revokeObjectURL(lastUrl);
    lastUrl = null;
  }
}

export function setLiveOpacity(map: MLMap, opacity: number): void {
  if (map.getLayer(LIVE_LAYER)) map.setPaintProperty(LIVE_LAYER, 'raster-opacity', opacity);
}
