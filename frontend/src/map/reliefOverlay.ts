// The relief lane on the map: the site's Copernicus (2011 to 2015) terrarium tiles as a second
// raster-dem source so the 3D relief and the hillshade can switch epoch over the window, the DEM
// difference draped as an image, and terrarium sampling in the browser for the profile tool (both
// epochs, tiles fetched and decoded once, bilinear inside a tile).
import type { ImageSource, Map as MLMap, RasterDEMSourceSpecification } from 'maplibre-gl';

import type { SiteManifest } from '../lib/contract';
import { windowCorners } from '../lib/utm';

export const COP_SOURCE = 'terrain-cop';
export const COP_HILLSHADE = 'hillshade-cop';
export const DELTA_SOURCE = 'dem-delta';
export const DELTA_LAYER = 'dem-delta-layer';
export const TERRARIUM_GLOBAL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TERRAIN_EXAGGERATION_DEFAULT = 1.3;

function firstSymbolLayer(map: MLMap): string | undefined {
  return map.getStyle()?.layers.find((l) => l.type === 'symbol')?.id;
}

export function copTilesUrl(manifest: SiteManifest): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}data/sites/${manifest.site_id}/terrain/{z}/{x}/{y}.png`;
}

/** Adds the per-site Copernicus terrain source (bounded to the window) and its hillshade, hidden. */
export function ensureCopSource(map: MLMap, manifest: SiteManifest): void {
  const dem = manifest.dem;
  if (!dem || !dem.terrain_tiles.length) return;
  const [minx, miny, maxx, maxy] = manifest.window.bbox_wgs84;
  if (!map.getSource(COP_SOURCE)) {
    const spec: RasterDEMSourceSpecification = {
      type: 'raster-dem',
      tiles: [copTilesUrl(manifest)],
      tileSize: 256,
      encoding: 'terrarium',
      minzoom: dem.terrain_tile_zooms[0],
      maxzoom: dem.terrain_tile_zooms[1],
      bounds: [minx, miny, maxx, maxy],
      attribution: 'Copernicus DEM GLO-30 (DLR, Airbus, ESA, EU)',
    };
    map.addSource(COP_SOURCE, spec);
  }
  if (!map.getLayer(COP_HILLSHADE)) {
    const before = map.getLayer('site-polygons-fill') ? 'site-polygons-fill' : firstSymbolLayer(map);
    map.addLayer(
      {
        id: COP_HILLSHADE,
        type: 'hillshade',
        source: COP_SOURCE,
        layout: { visibility: 'none' },
        paint: { 'hillshade-exaggeration': 0.6, 'hillshade-shadow-color': '#1a1208', 'hillshade-highlight-color': '#fff8e8' },
      },
      before,
    );
  }
}

/** Switches the 3D relief (and the hillshade) between the global source and the site's Copernicus one. */
export function setEpoch(map: MLMap, epoch: 'global' | 'cop', exaggeration: number): void {
  const hasCop = !!map.getSource(COP_SOURCE);
  if (epoch === 'cop' && hasCop) {
    map.setTerrain({ source: COP_SOURCE, exaggeration });
    if (map.getLayer(COP_HILLSHADE)) map.setLayoutProperty(COP_HILLSHADE, 'visibility', 'visible');
  } else {
    if (map.getSource('terrain')) map.setTerrain({ source: 'terrain', exaggeration });
    if (map.getLayer(COP_HILLSHADE)) map.setLayoutProperty(COP_HILLSHADE, 'visibility', 'none');
  }
}

export function removeCop(map: MLMap): void {
  if (map.getLayer(COP_HILLSHADE)) map.removeLayer(COP_HILLSHADE);
  const t = map.getTerrain();
  if (t && t.source === COP_SOURCE && map.getSource('terrain')) map.setTerrain({ source: 'terrain', exaggeration: t.exaggeration });
  if (map.getSource(COP_SOURCE)) map.removeSource(COP_SOURCE);
}

export function showDelta(map: MLMap, manifest: SiteManifest, opacity: number): void {
  const dem = manifest.dem;
  if (!dem?.delta_png) return;
  const url = `${import.meta.env.BASE_URL}data/sites/${manifest.site_id}/${dem.delta_png}`;
  const coordinates = windowCorners(manifest.window);
  if (!map.getSource(DELTA_SOURCE)) map.addSource(DELTA_SOURCE, { type: 'image', url, coordinates });
  else (map.getSource(DELTA_SOURCE) as ImageSource).updateImage({ url, coordinates });
  if (!map.getLayer(DELTA_LAYER)) {
    const before = map.getLayer('site-polygons-fill') ? 'site-polygons-fill' : firstSymbolLayer(map);
    map.addLayer({ id: DELTA_LAYER, type: 'raster', source: DELTA_SOURCE, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } }, before);
  } else {
    map.setPaintProperty(DELTA_LAYER, 'raster-opacity', opacity);
  }
}

export function hideDelta(map: MLMap): void {
  if (map.getLayer(DELTA_LAYER)) map.removeLayer(DELTA_LAYER);
  if (map.getSource(DELTA_SOURCE)) map.removeSource(DELTA_SOURCE);
}

// --- terrarium sampling in the browser -------------------------------------------------------------

const tileCache = new Map<string, Promise<Float32Array | null>>();

async function decodeTerrarium(url: string): Promise<Float32Array | null> {
  let p = tileCache.get(url);
  if (!p) {
    p = (async () => {
      const r = await fetch(url, { mode: 'cors' });
      if (!r.ok) return null;
      const blob = await r.blob();
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      const out = new Float32Array(bmp.width * bmp.height);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) out[j] = d[i]! * 256 + d[i + 1]! + d[i + 2]! / 256 - 32768;
      return out;
    })();
    tileCache.set(url, p);
    p.catch(() => tileCache.delete(url));
  }
  return p;
}

function lonLatToTilePixel(lon: number, lat: number, z: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z;
  const xf = ((lon + 180) / 360) * n;
  const latR = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  const x = Math.floor(xf);
  const y = Math.floor(yf);
  return { x, y, px: (xf - x) * 256, py: (yf - y) * 256 };
}

/** Elevation of one point from a terrarium tile set at zoom z, bilinear inside the tile (null when the tile is missing). */
export async function sampleTerrarium(template: string, z: number, lon: number, lat: number): Promise<number | null> {
  const { x, y, px, py } = lonLatToTilePixel(lon, lat, z);
  const url = template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const tile = await decodeTerrarium(url);
  if (!tile) return null;
  const x0 = Math.min(255, Math.max(0, Math.floor(px)));
  const y0 = Math.min(255, Math.max(0, Math.floor(py)));
  const x1 = Math.min(255, x0 + 1);
  const y1 = Math.min(255, y0 + 1);
  const fx = Math.min(1, Math.max(0, px - x0));
  const fy = Math.min(1, Math.max(0, py - y0));
  const v00 = tile[y0 * 256 + x0]!;
  const v10 = tile[y0 * 256 + x1]!;
  const v01 = tile[y1 * 256 + x0]!;
  const v11 = tile[y1 * 256 + x1]!;
  return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
}

export interface ProfileSample {
  d: number; // metres along the line
  lon: number;
  lat: number;
  global: number | null;
  cop: number | null;
}

/** Both epochs along a line (n samples), the global source at z12 and the site's Copernicus tiles at z13. */
export async function profile(manifest: SiteManifest, a: [number, number], b: [number, number], n = 200): Promise<ProfileSample[]> {
  const copTemplate = copTilesUrl(manifest);
  const copZoom = manifest.dem ? manifest.dem.terrain_tile_zooms[1] : 13;
  const R = 6371008.8;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  const length = 2 * R * Math.asin(Math.sqrt(h));
  const out: ProfileSample[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const lon = a[0] + (b[0] - a[0]) * t;
    const lat = a[1] + (b[1] - a[1]) * t;
    const [g, c] = await Promise.all([sampleTerrarium(TERRARIUM_GLOBAL, 12, lon, lat), manifest.dem?.terrain_tiles.length ? sampleTerrarium(copTemplate, copZoom, lon, lat) : Promise.resolve(null)]);
    out.push({ d: length * t, lon, lat, global: g, cop: c });
  }
  return out;
}
